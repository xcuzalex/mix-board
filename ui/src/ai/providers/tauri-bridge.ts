/**
 * Shared Tauri invoke wrappers for multi-provider credential and chat commands.
 * All providers use these helpers instead of calling invoke() directly.
 */
import { isDesktop } from '../../platform';
import type { AIProviderType } from './adapter';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

/** Extract a human-readable message from any thrown value.
 *  Tauri invoke errors are plain strings, not Error instances. */
export function errorMessage(error: unknown, fallback = '未知错误'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

export async function hasProviderCredentials(provider: AIProviderType): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    return await invoke<boolean>('has_provider_credentials', { provider });
  } catch {
    return false;
  }
}

export async function getProviderBaseUrl(provider: AIProviderType, fallback: string): Promise<string> {
  if (!isDesktop()) return fallback;
  try {
    const url = await invoke<string>('get_provider_base_url', { provider });
    return url || fallback;
  } catch {
    return fallback;
  }
}

export async function setProviderCredentials(
  provider: AIProviderType,
  apiKey: string,
  baseUrl: string,
): Promise<void> {
  if (!isDesktop()) throw new Error('Web 端暂不支持直接保存凭证。');
  await invoke('set_provider_credentials', { provider, apiKey, baseUrl });
}

export async function clearProviderCredentials(provider: AIProviderType): Promise<void> {
  if (!isDesktop()) return;
  await invoke('clear_provider_credentials', { provider });
}

export async function validateProviderCredentials(provider: AIProviderType): Promise<boolean> {
  if (!isDesktop()) return false;
  return invoke<boolean>('validate_provider_credentials', { provider });
}

export async function listProviderModels(provider: AIProviderType, baseUrl?: string): Promise<string> {
  if (!isDesktop()) throw new Error('Web 端暂不支持获取模型列表。');
  return invoke<string>('list_provider_models', { provider, baseUrl: baseUrl ?? null });
}

export interface ChatCompletionInput {
  provider: AIProviderType;
  messages: Array<{ role: string; content: string }>;
  model: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: object | null;
}

export async function providerChatCompletion(input: ChatCompletionInput): Promise<string> {
  if (!isDesktop()) {
    throw new Error('Web 端暂不支持直接调用 AI 服务，请使用桌面版或后续网关模式。');
  }
  return invoke<string>('provider_chat_completion', {
    provider: input.provider,
    messages: input.messages,
    model: input.model,
    temperature: input.temperature ?? 0.7,
    maxTokens: input.maxTokens,
    responseFormat: input.responseFormat ?? null,
  });
}
