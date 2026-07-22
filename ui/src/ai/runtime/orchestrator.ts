import { getProvider } from '../providers/registry';
import type { AIProviderType, ProviderResult } from '../providers/adapter';
import {
  buildPromptMessages,
  type PromptMessage,
} from '../context/prompt-builder';
import {
  readSelectionContextFromStores,
  type SelectionContext,
} from '../context/selection-context';
import {
  readBoardSnapshotFromStores,
  type BoardSnapshot,
} from '../context/board-snapshot';
import { parseOperationPlan, type ValidationResult } from '../schema/operation-schema';
import { AI_OPERATION_PLAN_JSON_SCHEMA } from '../schema/json-schema';
import type { AIOperationPlan } from '../schema/types';
import { executeOperationPlan } from '../executor/execute';
import type { AIOperationExecutionResult } from '../executor/execute';
import {
  type AIError,
  contextError,
  invalidOutputError,
  classifyProviderError,
  classifyExecutionError,
} from '../errors';
import { useAIStore } from '../store';

export interface AIInteractionInput {
  userMessage: string;
  history?: PromptMessage[];
  provider?: AIProviderType;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIInteractionSuccess {
  success: true;
  plan: AIOperationPlan;
  executionResult: AIOperationExecutionResult;
  rawResponse: string;
  providerResult: ProviderResult;
}

export interface AIPlanGenerationSuccess {
  success: true;
  plan: AIOperationPlan;
  rawResponse: string;
  providerResult: ProviderResult;
}

export interface AIInteractionError {
  success: false;
  error: string;
  stage: AIError['stage'];
  details?: string;
  aiError: AIError;
}

export type AIInteractionResult = AIInteractionSuccess | AIInteractionError;
export type AIPlanGenerationResult = AIPlanGenerationSuccess | AIInteractionError;

export interface AIPlanExecutionSuccess {
  success: true;
  executionResult: AIOperationExecutionResult;
}

export type AIPlanExecutionResult = AIPlanExecutionSuccess | AIInteractionError;

function wrapError(aiError: AIError): AIInteractionError {
  return {
    success: false,
    error: aiError.message,
    stage: aiError.stage,
    details: aiError.details,
    aiError,
  };
}

function resolveProvider(): AIProviderType {
  return useAIStore.getState().provider;
}

function resolveModel(explicit?: string): string {
  return explicit ?? useAIStore.getState().model;
}

export async function runAIInteraction(input: AIInteractionInput): Promise<AIInteractionResult> {
  const generationResult = await generateAIPlan(input);
  if (!generationResult.success) {
    return generationResult;
  }

  const executionResult = executeAIPlan(generationResult.plan);
  if (!executionResult.success) {
    return executionResult;
  }

  return {
    success: true,
    plan: generationResult.plan,
    executionResult: executionResult.executionResult,
    rawResponse: generationResult.rawResponse,
    providerResult: generationResult.providerResult,
  };
}

export async function generateAIPlan(input: AIInteractionInput): Promise<AIPlanGenerationResult> {
  const {
    userMessage,
    history = [],
    temperature = 0.7,
    maxTokens = 4096,
  } = input;

  const providerType = input.provider ?? resolveProvider();
  const model = resolveModel(input.model);

  let selectionContext: SelectionContext;
  let boardSnapshot: BoardSnapshot;

  try {
    selectionContext = readSelectionContextFromStores();
  } catch (error) {
    return wrapError(
      contextError(
        '读取选择上下文失败',
        error instanceof Error ? error.message : undefined,
      ),
    );
  }

  try {
    boardSnapshot = readBoardSnapshotFromStores(selectionContext);
  } catch (error) {
    return wrapError(
      contextError(
        '读取画布快照失败',
        error instanceof Error ? error.message : undefined,
      ),
    );
  }

  let messages: PromptMessage[];
  try {
    messages = buildPromptMessages({
      userMessage,
      boardSnapshot,
      selectionContext,
      history,
    });
  } catch (error) {
    return wrapError(
      contextError(
        '构建提示消息失败',
        error instanceof Error ? error.message : undefined,
      ),
    );
  }

  let providerResult: ProviderResult;
  let rawResponse = '';
  const provider = getProvider(providerType);

  try {
    const chatGenerator = provider.chat({
      messages,
      model,
      temperature,
      maxTokens,
      structuredOutputSchema: provider.supportsStructuredOutput
        ? AI_OPERATION_PLAN_JSON_SCHEMA
        : undefined,
    });

    let accumulatedContent = '';
    let finalResult: ProviderResult | undefined;

    for await (const event of chatGenerator) {
      if (event.type === 'content') {
        accumulatedContent += event.content;
      } else if (event.type === 'error') {
        return wrapError(classifyProviderError(event.error));
      } else if (event.type === 'done') {
        finalResult = { content: accumulatedContent };
      }
    }

    if (!finalResult) {
      finalResult = { content: accumulatedContent };
    }

    providerResult = finalResult;
    rawResponse = accumulatedContent;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider chat failed';
    return wrapError(classifyProviderError(message));
  }

  let planResult: ValidationResult<AIOperationPlan>;
  try {
    planResult = parseOperationPlan(rawResponse);
  } catch (error) {
    return wrapError(
      invalidOutputError(
        '解析 AI 返回内容失败',
        error instanceof Error ? error.message : undefined,
      ),
    );
  }

  if (!planResult.success) {
    const issues = planResult.issues.map((issue) =>
      issue.path ? `${issue.path}: ${issue.message}` : issue.message
    );
    return wrapError(
      invalidOutputError(
        `操作计划校验失败: ${issues.join('; ')}`,
        JSON.stringify(planResult.issues),
      ),
    );
  }

  return {
    success: true,
    plan: planResult.value,
    rawResponse,
    providerResult,
  };
}

export function executeAIPlan(plan: AIOperationPlan): AIPlanExecutionResult {
  let executionResult: AIOperationExecutionResult;
  try {
    executionResult = executeOperationPlan(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : '执行操作计划失败';
    return wrapError(classifyExecutionError(message));
  }

  return {
    success: true,
    executionResult,
  };
}

export type { SelectionContext, BoardSnapshot, PromptMessage };
export type { AIOperationExecutionResult } from '../executor/execute';
export type { AIOperationPlan } from '../schema/types';
export type { ValidationResult } from '../schema/operation-schema';
