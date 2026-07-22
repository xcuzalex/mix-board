import { useState, useRef, useEffect } from 'react';
import { useAIStore, type ConversationMessage } from '../store';
import { executeAIPlan, generateAIPlan } from '../runtime';
import type { AIOperationPlan } from '../schema/types';
import type { AIError } from '../errors';
import { useUIStore } from '../../store/ui';
import { generateId } from '../../utils/id';
import { OperationPreview } from './OperationPreview';

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-emerald-500 text-white'
            : 'bg-slate-100 text-slate-800'
        }`}
      >
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{message.content}</div>
        <div className={`text-[11px] mt-1.5 ${isUser ? 'text-emerald-100' : 'text-slate-400'}`}>
          {formatTimestamp(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="text-sm text-slate-500">思考中...</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categorised error display with recovery hints
// ---------------------------------------------------------------------------

const CATEGORY_STYLES: Record<string, { bg: string; border: string; icon: string; text: string }> = {
  auth:           { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-500', text: 'text-amber-800' },
  rate_limit:     { bg: 'bg-yellow-50', border: 'border-yellow-200', icon: 'text-yellow-500', text: 'text-yellow-800' },
  quota:          { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-500', text: 'text-orange-800' },
  network:        { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-500', text: 'text-blue-800' },
  invalid_output: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-500', text: 'text-purple-800' },
  ref_missing:    { bg: 'bg-rose-50', border: 'border-rose-200', icon: 'text-rose-500', text: 'text-rose-800' },
  capability:     { bg: 'bg-slate-50', border: 'border-slate-200', icon: 'text-slate-500', text: 'text-slate-800' },
  provider:       { bg: 'bg-red-50', border: 'border-red-100', icon: 'text-red-500', text: 'text-red-700' },
  execute:        { bg: 'bg-red-50', border: 'border-red-100', icon: 'text-red-500', text: 'text-red-700' },
  context:        { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-500', text: 'text-gray-800' },
  unknown:        { bg: 'bg-red-50', border: 'border-red-100', icon: 'text-red-500', text: 'text-red-700' },
};

function ErrorDisplay({
  aiError,
  fallbackMessage,
  onDismiss,
  onRetry,
}: {
  aiError?: AIError;
  fallbackMessage?: string;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const category = aiError?.category ?? 'unknown';
  const style = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.unknown;
  const message = aiError?.message ?? fallbackMessage ?? '未知错误';
  const recovery = aiError?.recovery;
  const retryable = aiError?.retryable ?? false;

  return (
    <div className="flex justify-start">
      <div className={`flex items-start gap-2 rounded-2xl ${style.bg} border ${style.border} px-4 py-3 max-w-[85%]`}>
        <svg viewBox="0 0 20 20" className={`h-5 w-5 ${style.icon} flex-shrink-0 mt-0.5`} fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <div className="flex-1">
          <div className={`text-sm ${style.text}`}>{message}</div>
          {recovery && (
            <div className="mt-1 text-xs text-slate-500">{recovery}</div>
          )}
          <div className="mt-1.5 flex items-center gap-3">
            {retryable && onRetry && (
              <button
                onClick={onRetry}
                className="text-xs font-medium text-emerald-600 hover:text-emerald-800 underline"
              >
                重试
              </button>
            )}
            <button
              onClick={onDismiss}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AIChatPanel() {
  const isPanelOpen = useAIStore((s) => s.isPanelOpen);
  const closePanel = useAIStore((s) => s.closePanel);
  const openSettings = useAIStore((s) => s.openSettings);
  const conversations = useAIStore((s) => s.conversations);
  const isLoading = useAIStore((s) => s.isLoading);
  const error = useAIStore((s) => s.error);
  const clearError = useAIStore((s) => s.clearError);
  const model = useAIStore((s) => s.model);
  const connectionStatus = useAIStore((s) => s.connectionStatus);
  const addMessage = useAIStore((s) => s.addMessage);
  const setLoading = useAIStore((s) => s.setLoading);
  const setError = useAIStore((s) => s.setError);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);

  const [input, setInput] = useState('');
  const [pendingPlan, setPendingPlan] = useState<AIOperationPlan | null>(null);
  const [isApplyingPlan, setIsApplyingPlan] = useState(false);
  const [lastAIError, setLastAIError] = useState<AIError | undefined>(undefined);
  const [lastUserMessage, setLastUserMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, isLoading]);

  useEffect(() => {
    if (isPanelOpen) {
      inputRef.current?.focus();
    }
  }, [isPanelOpen]);

  const doSend = async (userContent: string) => {
    const history = conversations.map((message) => ({
      role: message.role === 'system' ? 'assistant' : message.role,
      content: message.content,
    }));

    addMessage({
      id: generateId(),
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    });
    clearError();
    setLastAIError(undefined);
    setLoading(true);
    setInput('');
    setLastUserMessage(userContent);
    abortRef.current = false;

    try {
      const result = await generateAIPlan({
        userMessage: userContent,
        history,
        model,
      });

      if (abortRef.current) return; // user clicked stop

      if (!result.success) {
        setLastAIError(result.aiError);
        setError(result.details ? `${result.error}\n${result.details}` : result.error);
        return;
      }

      if (result.plan.operations.length === 0) {
        addMessage({
          id: generateId(),
          role: 'assistant',
          content: `${result.plan.summary}\n\n本次没有可执行的画布操作。`,
          timestamp: Date.now(),
        });
        return;
      }

      setPendingPlan(result.plan);
    } catch (err) {
      if (abortRef.current) return;
      setError(err instanceof Error ? err.message : 'AI 请求失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setLoading(false);
    addMessage({
      id: generateId(),
      role: 'assistant',
      content: '已停止生成。',
      timestamp: Date.now(),
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || pendingPlan || isApplyingPlan) return;
    await doSend(input.trim());
  };

  const handleRetry = () => {
    if (!lastUserMessage || isLoading) return;
    clearError();
    setLastAIError(undefined);
    void doSend(lastUserMessage);
  };

  const handleCancelPlan = () => {
    setPendingPlan(null);
    addMessage({
      id: generateId(),
      role: 'assistant',
      content: '已取消本次 AI 操作计划。',
      timestamp: Date.now(),
    });
  };

  const handleConfirmPlan = async (selectedIndices: number[]) => {
    if (!pendingPlan || isApplyingPlan) return;

    setIsApplyingPlan(true);
    clearError();
    setLastAIError(undefined);

    try {
      // Build a filtered plan with only the selected operations
      const filteredPlan: AIOperationPlan = {
        ...pendingPlan,
        operations: selectedIndices.map((i) => pendingPlan.operations[i]),
      };

      const result = executeAIPlan(filteredPlan);
      if (!result.success) {
        setLastAIError(result.aiError);
        setError(result.details ? `${result.error}\n${result.details}` : result.error);
        return;
      }

      if (result.executionResult.touchedElementIds.length > 0) {
        setSelectedIds(result.executionResult.touchedElementIds);
      }

      const operationsApplied = result.executionResult.operationsApplied;
      const skipped = pendingPlan.operations.length - operationsApplied;
      const skippedNote = skipped > 0 ? `（跳过 ${skipped} 项）` : '';

      addMessage({
        id: generateId(),
        role: 'assistant',
        content: `${result.executionResult.summary}\n\n已执行 ${operationsApplied} 个操作。${skippedNote}`,
        timestamp: Date.now(),
      });
      setPendingPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行 AI 计划失败');
    } finally {
      setIsApplyingPlan(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isPanelOpen) return null;

  return (
    <>
      <div data-overlay-panel className="fixed right-0 top-0 bottom-0 z-50 w-96 flex flex-col bg-white border-l border-slate-200 shadow-[-8px_0_24px_rgba(0,0,0,0.1)]" style={{ userSelect: 'text' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10" />
              <circle cx="12" cy="12" r="3" />
              <path d="M12 7.5l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5L7 11l3.5-.5z" fill="currentColor" stroke="none" />
            </svg>
            <span className="text-base font-semibold text-slate-900">AI 助手</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={openSettings}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
              title="切换模型"
            >
              <div className={`h-1.5 w-1.5 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-500' : connectionStatus === 'error' ? 'bg-red-400' : 'bg-slate-300'}`} />
              <span className="max-w-[120px] truncate">{model.split('/').pop()}</span>
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-3.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM12 15a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={closePanel}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="关闭"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4" tabIndex={-1}>
          {conversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-4 rounded-full bg-emerald-50 p-4">
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 7.5l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5L7 11l3.5-.5z" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div className="text-sm font-medium text-slate-900">你好！我是 AI 助手</div>
              <div className="mt-1.5 max-w-[240px] text-xs text-slate-500">
                可以帮助你创建和编辑画布内容，用自然语言描述你想要的操作
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {conversations.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isLoading && <LoadingIndicator />}
              {error && (
                <ErrorDisplay
                  aiError={lastAIError}
                  fallbackMessage={error}
                  onDismiss={clearError}
                  onRetry={lastAIError?.retryable ? handleRetry : undefined}
                />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t border-slate-200 p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述你想执行的操作..."
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              rows={1}
              disabled={isLoading || isApplyingPlan || !!pendingPlan}
            />
            {isLoading ? (
              <button
                onClick={handleStop}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-700 text-white transition hover:bg-slate-800"
                title="停止生成"
              >
                <div className="h-3 w-3 rounded-sm bg-white" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || isApplyingPlan || !!pendingPlan}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {pendingPlan && (
        <OperationPreview
          operations={pendingPlan.operations}
          summary={pendingPlan.summary}
          onConfirm={handleConfirmPlan}
          onCancel={handleCancelPlan}
          isLoading={isApplyingPlan}
        />
      )}
    </>
  );
}
