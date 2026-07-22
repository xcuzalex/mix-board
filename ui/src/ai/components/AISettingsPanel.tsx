import { useState, useEffect } from 'react';
import { useAIStore, type AIProvider } from '../store';
import { getProvider } from '../providers/registry';
import { isDesktop } from '../../platform';
import type { ModelInfo } from '../providers/adapter';

const PROVIDERS: Array<{ id: AIProvider; name: string; description: string; defaultBaseUrl: string }> = [
  { id: 'kilo', name: 'Kilo', description: 'Kilo AI Gateway，统一访问多家模型，动态模型列表', defaultBaseUrl: 'https://api.kilo.ai/api/gateway' },
  { id: 'openai', name: 'OpenAI', description: '使用 OpenAI API Key，支持 GPT-4o 等模型', defaultBaseUrl: 'https://api.openai.com' },
  { id: 'anthropic', name: 'Claude', description: '使用 Anthropic API Key，支持 Claude 4 系列', defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'openrouter', name: 'OpenRouter', description: '统一路由，一个 Key 访问多家模型', defaultBaseUrl: 'https://openrouter.ai/api' },
];

export function AISettingsPanel() {
  const isSettingsOpen = useAIStore((s) => s.isSettingsOpen);
  const closeSettings = useAIStore((s) => s.closeSettings);
  const provider = useAIStore((s) => s.provider);
  const setProvider = useAIStore((s) => s.setProvider);
  const model = useAIStore((s) => s.model);
  const setModel = useAIStore((s) => s.setModel);
  const connectionStatus = useAIStore((s) => s.connectionStatus);
  const setConnectionStatus = useAIStore((s) => s.setConnectionStatus);

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [hasStoredCredential, setHasStoredCredential] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const desktop = isDesktop();
  const providerMeta = PROVIDERS.find((p) => p.id === provider);

  // Load models and credential state when provider or panel changes
  useEffect(() => {
    if (!isSettingsOpen) return;

    let active = true;
    const adapter = getProvider(provider);

    void (async () => {
      const modelList = await adapter.listModels();
      if (!active) return;
      setModels(modelList);

      // Ensure current model is valid for this provider
      if (!modelList.find((m) => m.id === model)) {
        setModel(modelList[0]?.id ?? '');
      }

      if (!desktop) {
        setConnectionStatus('disconnected');
        setHasStoredCredential(false);
        setBaseUrl(providerMeta?.defaultBaseUrl ?? '');
        return;
      }

      const [storedBaseUrl, storedCredential, validation] = await Promise.all([
        adapter.getStoredBaseUrl(),
        adapter.hasSavedCredential(),
        adapter.validateCredential(),
      ]);

      if (!active) return;
      setBaseUrl(storedBaseUrl);
      setHasStoredCredential(storedCredential);
      setConnectionStatus(validation.valid ? 'connected' : 'disconnected');
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, isSettingsOpen, provider]);

  const handleSaveAndValidate = async () => {
    setIsValidating(true);
    setValidationError(null);

    try {
      if (!desktop) {
        throw new Error('Web 端暂不支持直接配置凭证，请使用桌面版。');
      }
      if (!apiKey.trim()) {
        throw new Error('请输入 API Key。');
      }

      const adapter = getProvider(provider);
      await adapter.saveCredential({ apiKey, baseUrl });
      const result = await adapter.validateCredential();
      if (result.valid) {
        setConnectionStatus('connected');
        setHasStoredCredential(true);
        setApiKey('');
      } else {
        setConnectionStatus('error');
        setValidationError(result.error ?? '验证失败');
      }
    } catch (err) {
      setConnectionStatus('error');
      setValidationError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsValidating(false);
    }
  };

  const handleClear = async () => {
    setValidationError(null);

    try {
      const adapter = getProvider(provider);
      await adapter.clearCredential();
      setApiKey('');
      setHasStoredCredential(false);
      setConnectionStatus('disconnected');
    } catch (err) {
      setConnectionStatus('error');
      setValidationError(err instanceof Error ? err.message : '清空凭证失败');
    }
  };

  const handleProviderChange = (newProvider: AIProvider) => {
    setProvider(newProvider);
    setConnectionStatus('disconnected');
    setValidationError(null);
    setApiKey('');
  };

  if (!isSettingsOpen) return null;

  return (
    <div data-overlay-panel className="fixed right-0 top-0 bottom-0 z-50 w-96 flex flex-col bg-white border-l border-slate-200 shadow-[-8px_0_24px_rgba(0,0,0,0.1)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" className="h-5 w-5 text-slate-600" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-3.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM12 15a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
          <span className="text-base font-semibold text-slate-900">AI 设置</span>
        </div>
        <button
          onClick={closeSettings}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          title="关闭"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Provider Selection */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-slate-700">模型提供商</label>
          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProviderChange(p.id)}
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                  provider === p.id
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 ${
                  provider === p.id ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
                }`}>
                  {provider === p.id && (
                    <div className="h-full w-full flex items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-900">{p.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{p.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Model Selection */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-slate-700">模型</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-slate-700">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasStoredCredential ? '重新输入会覆盖当前已保存的密钥' : `输入 ${providerMeta?.name ?? ''} API Key`}
            disabled={!desktop}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            {desktop
              ? '密钥保存到桌面端系统钥匙串，请求由 Tauri 侧代发，不直接暴露给前端。'
              : 'Web 端暂不支持直接保存第三方 Provider Secret。'}
          </p>
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-slate-700">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={providerMeta?.defaultBaseUrl ?? ''}
            disabled={!desktop}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            默认使用官方 API 地址，也可替换为兼容代理。
          </p>
        </div>

        {/* Connection Status */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-slate-700">连接状态</label>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className={`h-2.5 w-2.5 rounded-full ${
              connectionStatus === 'connected' ? 'bg-emerald-500' :
              connectionStatus === 'error' ? 'bg-red-500' :
              'bg-slate-300'
            }`} />
            <span className="text-sm text-slate-600">
              {connectionStatus === 'connected' ? '已连接' :
               connectionStatus === 'error' ? '连接错误' :
               '未连接'}
            </span>
            {hasStoredCredential && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                已保存密钥
              </span>
            )}
          </div>
        </div>

        {/* Validation Error */}
        {validationError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <div className="text-sm text-red-700">{validationError}</div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSaveAndValidate}
            disabled={isValidating || !desktop || !apiKey.trim()}
            className="flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isValidating ? '验证中...' : '保存并验证'}
          </button>
          <button
            onClick={handleClear}
            disabled={isValidating || !desktop || !hasStoredCredential}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            清空
          </button>
        </div>
      </div>
    </div>
  );
}
