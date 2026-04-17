import { useAIStore } from '../store';

export function AIButton() {
  const isPanelOpen = useAIStore((s) => s.isPanelOpen);
  const togglePanel = useAIStore((s) => s.togglePanel);

  return (
    <button
      className={`flex h-10 w-10 items-center justify-center rounded-2xl transition ${
        isPanelOpen
          ? 'bg-emerald-50 text-emerald-700 shadow-sm'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
      onClick={togglePanel}
      title="AI 助手"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 7.5l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5L7 11l3.5-.5z" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
