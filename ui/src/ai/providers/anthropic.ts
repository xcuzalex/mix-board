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
import { getCachedModels, setCachedModels } from './model-cache';

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', supportsStructuredOutput: false, supportsStreaming: true },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', supportsStructuredOutput: false, supportsStreaming: true },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', supportsStructuredOutput: false, supportsStreaming: true },
];

/** Anthropic /v1/models response item */
interface AnthropicModel {
  id: string;
  display_name?: string;
  type?: string;
  created_at?: string;
}

interface AnthropicModelsResponse {
  data: AnthropicModel[];
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
  if (!value) return DEFAULT_ANTHROPIC_BASE_URL;
  return value.replace(/\/+$/u, '');
}

function parseAnthropicModels(raw: string): ModelInfo[] {
  const response = JSON.parse(raw) as AnthropicModelsResponse;
  return response.data
    .filter((m) => m.type === 'model')
    .map((m) => ({
      id: m.id,
      name: m.display_name ?? m.id,
      supportsStructuredOutput: false,
      supportsStreaming: true,
    }));
}

export class AnthropicProvider implements AIProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly displayName = 'Claude';
  readonly supportsStructuredOutput = false;
  readonly supportsStreaming = true;

  async *chat(input: ProviderChatInput): AsyncGenerator<ProviderEvent, ProviderResult, unknown> {
    if (!isDesktop()) {
      yield { type: 'error', error: 'Web 端暂不支持直接调用 Claude，请使用桌面版或后续网关模式。' };
      return { content: '' };
    }

    try {
      const rawResponse = await providerChatCompletion({
        provider: 'anthropic',
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        model: input.model,
        temperature: input.temperature ?? 0.7,
        maxTokens: input.maxTokens,
        responseFormat: null,
      });

      const parsed = JSON.parse(rawResponse) as OpenAICompatResponse;
      const content = parsed.choices?.[0]?.message?.content ?? '';
      if (!content.trim()) {
        yield { type: 'error', error: 'Claude 未返回可解析的文本内容。' };
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
      yield { type: 'error', error: errorMessage(error, 'Failed to call Claude.') };
      return { content: '' };
    }
  }

  async validateCredential(): Promise<CredentialValidationResult> {
    if (!isDesktop()) return { valid: false, error: 'Web 端暂不支持直接保存 Claude 凭证，请使用桌面版。' };
    try {
      const valid = await validateProviderCredentials('anthropic');
      return valid ? { valid: true } : { valid: false, error: '凭证无效或 API Key 不可用。' };
    } catch (error) {
      return { valid: false, error: errorMessage(error) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const cached = getCachedModels('anthropic');
    if (cached) return cached;

    try {
      const raw = await listProviderModels('anthropic');
      const models = parseAnthropicModels(raw);
      if (models.length > 0) {
        setCachedModels('anthropic', models);
        return models;
      }
    } catch { /* fall through */ }
    return [...FALLBACK_MODELS];
  }

  async saveCredential(input: Required<ProviderCredentialInput>): Promise<void> {
    await setProviderCredentials('anthropic', input.apiKey.trim(), normalizeBaseUrl(input.baseUrl));
  }

  async clearCredential(): Promise<void> {
    await clearProviderCredentials('anthropic');
  }

  async hasSavedCredential(): Promise<boolean> {
    return hasProviderCredentials('anthropic');
  }

  async getStoredBaseUrl(): Promise<string> {
    return getProviderBaseUrl('anthropic', DEFAULT_ANTHROPIC_BASE_URL);
  }
}

export const anthropicProvider = new AnthropicProvider();
