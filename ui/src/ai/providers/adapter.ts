import type { PromptMessage } from '../context/prompt-builder';

export type AIProviderType = 'openai' | 'anthropic' | 'openrouter' | 'kilo';

export interface ModelInfo {
  id: string;
  name: string;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
}

export interface CredentialValidationResult {
  valid: boolean;
  error?: string;
}

export interface ProviderCredentialInput {
  apiKey?: string;
  baseUrl?: string;
}

export type ProviderEvent =
  | { type: 'content'; content: string }
  | { type: 'error'; error: string }
  | { type: 'done' };

export interface ProviderChatInput {
  messages: PromptMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  structuredOutputSchema?: object;
}

export interface ProviderResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProviderAdapter {
  provider: AIProviderType;
  displayName: string;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;

  chat(input: ProviderChatInput): AsyncGenerator<ProviderEvent, ProviderResult, unknown>;
  validateCredential(): Promise<CredentialValidationResult>;
  listModels(): Promise<ModelInfo[]>;

  // Credential management (all providers share the Tauri keychain pattern)
  saveCredential(input: Required<ProviderCredentialInput>): Promise<void>;
  clearCredential(): Promise<void>;
  hasSavedCredential(): Promise<boolean>;
  getStoredBaseUrl(): Promise<string>;
}