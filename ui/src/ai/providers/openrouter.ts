import type {
  AIProviderAdapter,
  CredentialValidationResult,
  ModelInfo,
  ProviderChatInput,
  ProviderCredentialInput,
  ProviderEvent,
  ProviderResult,
} from './adapter';
import { isDesktop } from '../../platform';
import {
  hasProviderCredentials,
  getProviderBaseUrl,
  setProviderCredentials,
  clearProviderCredentials,
  validateProviderCredentials,
  providerChatCompletion,
  listProviderModels,
  errorMessage,
} from './tauri-bridge';
import { getCachedModels, setCachedModels, findCachedModel } from './model-cache';

/**
 * OpenRouter — OpenAI-compatible API at https://openrouter.ai/api
 * /v1/models is public (no auth required).
 */

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'openai/gpt-4o', name: 'GPT-4o (via OpenRouter)', supportsStructuredOutput: true, supportsStreaming: true },
  { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (via OpenRouter)', supportsStructuredOutput: false, supportsStreaming: true },
];

/** OpenRouter /v1/models response item */
interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface OpenAICompatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function normalizeBaseUrl(baseUrl?: string) {
  const value = baseUrl?.trim();
  if (!value) return DEFAULT_OPENROUTER_BASE_URL;
  return value.replace(/\/+$/u, '');
}

function modelSupportsStructuredOutput(params?: string[]): boolean {
  if (!params) return false;
  return params.includes('structured_outputs') || params.includes('response_format');
}

function parseOpenRouterModels(raw: string): ModelInfo[] {
  const data = JSON.parse(raw) as OpenRouterModelsResponse;
  return data.data
    .filter((m) => {
      const params = m.supported_parameters ?? [];
      return params.includes('max_tokens') || params.includes('temperature');
    })
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      supportsStructuredOutput: modelSupportsStructuredOutput(m.supported_parameters),
      supportsStreaming: true,
    }));
}

export class OpenRouterProvider implements AIProviderAdapter {
  readonly provider = 'openrouter' as const;
  readonly displayName = 'OpenRouter';
  readonly supportsStructuredOutput = true;
  readonly supportsStreaming = true;

  async *chat(input: ProviderChatInput): AsyncGenerator<ProviderEvent, ProviderResult, unknown> {
    if (!isDesktop()) {
      yield { type: 'error', error: 'Web 端暂不支持直接调用 OpenRouter，请使用桌面版或后续网关模式。' };
      return { content: '' };
    }

    try {
      const modelInfo = findCachedModel('openrouter', input.model);
      const useStructured = modelInfo?.supportsStructuredOutput ?? false;

      const rawResponse = await providerChatCompletion({
        provider: 'openrouter',
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        model: input.model,
        temperature: input.temperature ?? 0.7,
        maxTokens: input.maxTokens,
        responseFormat: input.structuredOutputSchema && useStructured
          ? { type: 'json_schema', json_schema: { name: 'mixboard_ai_plan', strict: true, schema: input.structuredOutputSchema } }
          : null,
      });

      const parsed = JSON.parse(rawResponse) as OpenAICompatResponse;
      const content = parsed.choices?.[0]?.message?.content ?? '';
      if (!content.trim()) {
        yield { type: 'error', error: 'OpenRouter 未返回可解析的文本内容。' };
        return { content: '' };
      }

      yield { type: 'content', content };
      yield { type: 'done' };
      return {
        content,
        usage: parsed.usage?.total_tokens !== undefined
          ? { promptTokens: parsed.usage.prompt_tokens ?? 0, completionTokens: parsed.usage.completion_tokens ?? 0, totalTokens: parsed.usage.total_tokens ?? 0 }
          : undefined,
      };
    } catch (error) {
      yield { type: 'error', error: errorMessage(error, 'Failed to call OpenRouter.') };
      return { content: '' };
    }
  }

  async validateCredential(): Promise<CredentialValidationResult> {
    if (!isDesktop()) return { valid: false, error: 'Web 端暂不支持直接保存 OpenRouter 凭证，请使用桌面版。' };
    try {
      const valid = await validateProviderCredentials('openrouter');
      return valid ? { valid: true } : { valid: false, error: '凭证无效或 API Key 不可用。' };
    } catch (error) {
      return { valid: false, error: errorMessage(error) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const cached = getCachedModels('openrouter');
    if (cached) return cached;

    try {
      const raw = await listProviderModels('openrouter');
      const models = parseOpenRouterModels(raw);
      if (models.length > 0) {
        setCachedModels('openrouter', models);
        return models;
      }
    } catch { /* fall through */ }
    return [...FALLBACK_MODELS];
  }

  async saveCredential(input: Required<ProviderCredentialInput>): Promise<void> {
    await setProviderCredentials('openrouter', input.apiKey.trim(), normalizeBaseUrl(input.baseUrl));
  }

  async clearCredential(): Promise<void> {
    await clearProviderCredentials('openrouter');
  }

  async hasSavedCredential(): Promise<boolean> {
    return hasProviderCredentials('openrouter');
  }

  async getStoredBaseUrl(): Promise<string> {
    return getProviderBaseUrl('openrouter', DEFAULT_OPENROUTER_BASE_URL);
  }
}

export const openrouterProvider = new OpenRouterProvider();
