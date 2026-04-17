import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'error';

export type AIProvider = 'openai' | 'anthropic' | 'openrouter' | 'kilo';

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
}

interface AIStore {
  isPanelOpen: boolean;
  isSettingsOpen: boolean;
  provider: AIProvider;
  model: string;
  connectionStatus: ConnectionStatus;
  conversations: ConversationMessage[];
  isLoading: boolean;
  error: string | null;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  setProvider: (provider: AIProvider) => void;
  setModel: (model: string) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  addMessage: (message: ConversationMessage) => void;
  clearConversation: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

function loadPersistedProvider(): AIProvider {
  try {
    const v = localStorage.getItem('mixboard:ai:provider');
    if (v && ['openai', 'anthropic', 'openrouter', 'kilo'].includes(v)) return v as AIProvider;
  } catch { /* ignore */ }
  return 'kilo';
}

function loadPersistedModel(): string {
  try {
    return localStorage.getItem('mixboard:ai:model') ?? 'kilo-auto/frontier';
  } catch { /* ignore */ }
  return 'kilo-auto/frontier';
}

export const useAIStore = create<AIStore>()(
  immer((set) => ({
    isPanelOpen: false,
    isSettingsOpen: false,
    provider: loadPersistedProvider(),
    model: loadPersistedModel(),
    connectionStatus: 'disconnected',
    conversations: [],
    isLoading: false,
    error: null,

    openPanel: () =>
      set((state) => {
        state.isPanelOpen = true;
      }),
    closePanel: () =>
      set((state) => {
        state.isPanelOpen = false;
      }),
    togglePanel: () =>
      set((state) => {
        state.isPanelOpen = !state.isPanelOpen;
      }),
    openSettings: () =>
      set((state) => {
        state.isSettingsOpen = true;
      }),
    closeSettings: () =>
      set((state) => {
        state.isSettingsOpen = false;
      }),
    setProvider: (provider) =>
      set((state) => {
        state.provider = provider;
        try { localStorage.setItem('mixboard:ai:provider', provider); } catch { /* ignore */ }
      }),
    setModel: (model) =>
      set((state) => {
        state.model = model;
        try { localStorage.setItem('mixboard:ai:model', model); } catch { /* ignore */ }
      }),
    setConnectionStatus: (status) =>
      set((state) => {
        state.connectionStatus = status;
      }),
    addMessage: (message) =>
      set((state) => {
        state.conversations.push(message);
      }),
    clearConversation: () =>
      set((state) => {
        state.conversations = [];
      }),
    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading;
      }),
    setError: (error) =>
      set((state) => {
        state.error = error;
      }),
    clearError: () =>
      set((state) => {
        state.error = null;
      }),
  })),
);
