import type { AIProviderAdapter, AIProviderType } from './adapter';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { openrouterProvider } from './openrouter';
import { kiloProvider } from './kilo';

const providers: Record<AIProviderType, AIProviderAdapter> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  openrouter: openrouterProvider,
  kilo: kiloProvider,
};

export function getProvider(type: AIProviderType): AIProviderAdapter {
  const provider = providers[type];
  if (!provider) {
    throw new Error(`Unknown provider: ${type}`);
  }
  return provider;
}

export function getAvailableProviders(): AIProviderAdapter[] {
  return Object.values(providers);
}
