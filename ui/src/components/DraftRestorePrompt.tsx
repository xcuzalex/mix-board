import { isDesktop } from '../platform';
import { discardDraft, restoreDraft, useAutosaveStore } from '../utils/autosave';
import { getDocumentDisplayName } from '../utils/document-io';

function formatDraftTime(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Offers to bring back an unsaved draft found in IndexedDB at startup. */
export function DraftRestorePrompt() {
  const draft = useAutosaveStore((s) => s.pendingDraft);
  if (!draft) return null;

  // Sits below the top-docked toolbar.
  const top = isDesktop() ? 'top-16' : 'top-[6.5rem]';

  return (
    <div className={`pointer-events-none absolute inset-x-0 ${top} z-50 flex justify-center px-4`}>
      <div
        role="dialog"
        aria-label="恢复未保存的草稿"
        className="pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl border border-black/[0.06] bg-white/85 py-2 pl-4 pr-2 text-[13px] text-slate-600 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/85 dark:text-slate-300"
      >
        <span className="min-w-0 truncate">
          「{getDocumentDisplayName(draft.filePath)}」有未保存的草稿 · {formatDraftTime(draft.savedAt)}
        </span>
        <button
          type="button"
          onClick={() => void discardDraft()}
          className="shrink-0 rounded-lg px-2.5 py-1 font-medium text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100"
        >
          丢弃
        </button>
        <button
          type="button"
          onClick={() => void restoreDraft()}
          className="shrink-0 rounded-lg bg-sky-500 px-3 py-1 font-medium text-white hover:bg-sky-600"
        >
          恢复
        </button>
      </div>
    </div>
  );
}
