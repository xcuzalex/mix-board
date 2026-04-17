/**
 * Shared model list cache for all providers.
 * Each provider stores its own list; cache expires after 10 minutes.
 */
import type { AIProviderType, ModelInfo } from './adapter';

const CACHE_TTL = 10 * 60 * 1000;

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

const cache = new Map<AIProviderType, CacheEntry>();

export function getCachedModels(provider: AIProviderType): ModelInfo[] | null {
  const entry = cache.get(provider);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    cache.delete(provider);
    return null;
  }
  return entry.models;
}

export function setCachedModels(provider: AIProviderType, models: ModelInfo[]): void {
  cache.set(provider, { models, fetchedAt: Date.now() });
}

export function findCachedModel(provider: AIProviderType, modelId: string): ModelInfo | undefined {
  const models = getCachedModels(provider);
  return models?.find((m) => m.id === modelId);
}
