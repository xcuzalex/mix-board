import type {
  AIProviderAdapter,
  CredentialValidationResult,
  ProviderCredentialInput,
  ModelInfo,
  ProviderChatInput,
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

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', supportsStructuredOutput: true, supportsStreaming: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', supportsStructuredOutput: true, supportsStreaming: true },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', supportsStructuredOutput: true, supportsStreaming: true },
];

/** OpenAI /v1/models response item */
interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenAIModelsResponse {
  data: OpenAIModel[];
}

interface OpenAIMessageContentPart {
  type?: string;
  text?: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | OpenAIMessageContentPart[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function normalizeBaseUrl(baseUrl?: string) {
  const value = baseUrl?.trim();
  if (!value) return DEFAULT_OPENAI_BASE_URL;
  return value.replace(/\/+$/u, '');
}

function readAssistantContent(response: OpenAIChatCompletionResponse) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

/** GPT-4o series and newer support structured output */
function inferStructuredOutputSupport(modelId: string): boolean {
  return /gpt-4o|gpt-4-turbo|o[1-9]/.test(modelId);
}

/** Only keep chat-capable models, skip embeddings / whisper / dall-e etc. */
function isChatModel(m: OpenAIModel): boolean {
  return /^(gpt-|o[1-9]|chatgpt-)/.test(m.id) && !/(instruct|realtime|audio|search)/.test(m.id);
}

function parseOpenAIModels(raw: string): ModelInfo[] {
  const response = JSON.parse(raw) as OpenAIModelsResponse;
  return response.data
    .filter(isChatModel)
    .sort((a, b) => b.created - a.created)
    .map((m) => ({
      id: m.id,
      name: m.id,
      supportsStructuredOutput: inferStructuredOutputSupport(m.id),
      supportsStreaming: true,
    }));
}

export class OpenAIProvider implements AIProviderAdapter {
  readonly provider = 'openai' as const;
  readonly displayName = 'OpenAI';
  readonly supportsStructuredOutput = true;
  readonly supportsStreaming = true;

  async *chat(input: ProviderChatInput): AsyncGenerator<ProviderEvent, ProviderResult, unknown> {
    if (!isDesktop()) {
      yield { type: 'error', error: 'Web 端暂不支持直接调用 OpenAI，请使用桌面版或后续网关模式。' };
      return { content: '' };
    }

    try {
      const modelInfo = findCachedModel('openai', input.model);
      const useStructured = modelInfo?.supportsStructuredOutput ?? inferStructuredOutputSupport(input.model);

      const rawResponse = await providerChatCompletion({
        provider: 'openai',
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        model: input.model,
        temperature: input.temperature ?? 0.7,
        maxTokens: input.maxTokens,
        responseFormat: input.structuredOutputSchema && useStructured
          ? { type: 'json_schema', json_schema: { name: 'mixboard_ai_plan', strict: true, schema: input.structuredOutputSchema } }
          : null,
      });

      const parsed = JSON.parse(rawResponse) as OpenAIChatCompletionResponse;
      const content = readAssistantContent(parsed);
      if (!content.trim()) {
        yield { type: 'error', error: 'OpenAI 未返回可解析的文本内容。' };
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
      yield { type: 'error', error: errorMessage(error, 'Failed to call OpenAI.') };
      return { content: '' };
    }
  }

  async validateCredential(): Promise<CredentialValidationResult> {
    if (!isDesktop()) return { valid: false, error: 'Web 端暂不支持直接保存 OpenAI 凭证，请使用桌面版。' };
    try {
      const valid = await validateProviderCredentials('openai');
      return valid ? { valid: true } : { valid: false, error: '凭证无效或当前账户没有可用模型。' };
    } catch (error) {
      return { valid: false, error: errorMessage(error) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const cached = getCachedModels('openai');
    if (cached) return cached;

    try {
      const raw = await listProviderModels('openai');
      const models = parseOpenAIModels(raw);
      if (models.length > 0) {
        setCachedModels('openai', models);
        return models;
      }
    } catch { /* fall through */ }
    return [...FALLBACK_MODELS];
  }

  async saveCredential(input: Required<ProviderCredentialInput>): Promise<void> {
    await setProviderCredentials('openai', input.apiKey.trim(), normalizeBaseUrl(input.baseUrl));
  }

  async clearCredential(): Promise<void> {
    await clearProviderCredentials('openai');
  }

  async hasSavedCredential(): Promise<boolean> {
    return hasProviderCredentials('openai');
  }

  async getStoredBaseUrl(): Promise<string> {
    return getProviderBaseUrl('openai', DEFAULT_OPENAI_BASE_URL);
  }
}

export const openaiProvider = new OpenAIProvider();
