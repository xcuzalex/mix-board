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
 * Kilo AI Gateway — OpenAI-compatible at https://api.kilo.ai/api/gateway
 * No `/v1/` prefix. `/models` is public (no auth required).
 */

const DEFAULT_KILO_BASE_URL = 'https://api.kilo.ai/api/gateway';

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'kilo-auto/balanced', name: 'Kilo Auto Balanced', supportsStructuredOutput: false, supportsStreaming: true },
  { id: 'kilo-auto/frontier', name: 'Kilo Auto Frontier', supportsStructuredOutput: false, supportsStreaming: true },
  { id: 'kilo-auto/free', name: 'Kilo Auto Free', supportsStructuredOutput: false, supportsStreaming: true },
  { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', supportsStructuredOutput: true, supportsStreaming: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o', supportsStructuredOutput: true, supportsStreaming: true },
];

/** Kilo /models response item */
interface KiloModel {
  id: string;
  name?: string;
  supported_parameters?: string[];
}

interface KiloModelsResponse {
  data: KiloModel[];
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
  if (!value) return DEFAULT_KILO_BASE_URL;
  return value.replace(/\/+$/u, '');
}

function modelSupportsStructuredOutput(params?: string[]): boolean {
  if (!params) return false;
  return params.includes('structured_outputs') || params.includes('response_format');
}

function parseKiloModels(raw: string): ModelInfo[] {
  const data = JSON.parse(raw) as KiloModelsResponse;
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

export class KiloProvider implements AIProviderAdapter {
  readonly provider = 'kilo' as const;
  readonly displayName = 'Kilo';
  readonly supportsStructuredOutput = true;
  readonly supportsStreaming = true;

  async *chat(input: ProviderChatInput): AsyncGenerator<ProviderEvent, ProviderResult, unknown> {
    if (!isDesktop()) {
      yield { type: 'error', error: 'Web 端暂不支持直接调用 Kilo，请使用桌面版或后续网关模式。' };
      return { content: '' };
    }

    try {
      // Only pass response_format when the model is known to support it.
      // Many models (GLM, Llama, Mistral, etc.) don't support response_format
      // and will error or hang. The system prompt already instructs JSON output.
      const modelInfo = findCachedModel('kilo', input.model);
      const canUseResponseFormat = modelInfo?.supportsStructuredOutput ?? false;

      const rawResponse = await providerChatCompletion({
        provider: 'kilo',
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        model: input.model,
        temperature: input.temperature ?? 0.7,
        maxTokens: input.maxTokens,
        responseFormat: input.structuredOutputSchema && canUseResponseFormat
          ? { type: 'json_object' }
          : null,
      });

      const parsed = JSON.parse(rawResponse) as OpenAICompatResponse;
      const content = parsed.choices?.[0]?.message?.content ?? '';
      if (!content.trim()) {
        yield { type: 'error', error: 'Kilo 未返回可解析的文本内容。' };
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
      yield { type: 'error', error: errorMessage(error, 'Failed to call Kilo gateway.') };
      return { content: '' };
    }
  }

  async validateCredential(): Promise<CredentialValidationResult> {
    if (!isDesktop()) return { valid: false, error: 'Web 端暂不支持直接保存 Kilo 凭证，请使用桌面版。' };
    try {
      const valid = await validateProviderCredentials('kilo');
      return valid ? { valid: true } : { valid: false, error: '凭证无效或 API Key 不可用。' };
    } catch (error) {
      return { valid: false, error: errorMessage(error) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const cached = getCachedModels('kilo');
    if (cached) return cached;

    try {
      const raw = await listProviderModels('kilo');
      const models = parseKiloModels(raw);
      if (models.length > 0) {
        setCachedModels('kilo', models);
        return models;
      }
    } catch { /* fall through */ }
    return [...FALLBACK_MODELS];
  }

  async saveCredential(input: Required<ProviderCredentialInput>): Promise<void> {
    await setProviderCredentials('kilo', input.apiKey.trim(), normalizeBaseUrl(input.baseUrl));
  }

  async clearCredential(): Promise<void> {
    await clearProviderCredentials('kilo');
  }

  async hasSavedCredential(): Promise<boolean> {
    return hasProviderCredentials('kilo');
  }

  async getStoredBaseUrl(): Promise<string> {
    return getProviderBaseUrl('kilo', DEFAULT_KILO_BASE_URL);
  }
}

export const kiloProvider = new KiloProvider();
