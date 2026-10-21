import { useState } from 'react';
import { isDesktop } from '../platform';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { useVaultStore } from '../store/vault';
import { exportCurrentBoardAsMarkdown, getDocumentDisplayName } from '../utils/document-io';
import { isVaultBoard, openLibrary, renameCurrentBoard } from '../utils/vault';
import { OutlineView } from './OutlinePanel';

/**
 * Top-left corner: the collapsible 大纲 sidebar. On desktop it also carries the
 * way back to the 资料库 page and the open board's title (click to rename).
 */

const headerButton = 'rounded-full p-1 text-slate-400 transition hover:bg-black/[0.05] hover:text-[#007aff] dark:hover:bg-white/10';

const SidebarIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M9.5 5v14" />
  </svg>
);

/** The open board's name; click to rename the file in place (vault boards only). */
function BoardTitle() {
  const filePath = useDocumentStore((s) => s.filePath);
  const vault = useVaultStore((s) => s.vault);
  const renamingPath = useVaultStore((s) => s.renamingPath);
  const setRenamingPath = useVaultStore((s) => s.setRenamingPath);
  const [draft, setDraft] = useState<string | null>(null);

  const name = getDocumentDisplayName(filePath);
  const editable = vault !== null && isVaultBoard(filePath);
  const editing = editable && (draft !== null || renamingPath === filePath);

  const finish = (commit: boolean) => {
    const value = (draft ?? name).trim();
    setDraft(null);
    if (renamingPath === filePath) setRenamingPath(null);
    if (commit && value && value !== name) void renameCurrentBoard(value);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft ?? name}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        aria-label="笔记名称"
        className="mx-1 w-44 rounded-md bg-white px-1.5 py-0.5 text-[13px] font-medium text-slate-800 outline-none ring-2 ring-[#007aff]/60 dark:bg-[#2c2c2e] dark:text-slate-100"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setDraft(name)}
      title={editable ? '点击重命名' : (filePath ?? '尚未保存到文件')}
      className="max-w-56 truncate rounded-md px-1.5 py-0.5 text-[13px] font-medium text-slate-700 enabled:hover:bg-black/[0.05] dark:text-slate-200 dark:enabled:hover:bg-white/10"
    >
      {name}
    </button>
  );
}

const LibraryIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);

function LibraryButton() {
  return (
    <button
      type="button"
      onClick={openLibrary}
      title="资料库（⇧⌘L）"
      className="rounded-full p-1.5 text-slate-500 transition hover:bg-black/[0.05] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {LibraryIcon}
    </button>
  );
}

export function LeftSidebar() {
  const desktop = isDesktop();
  const showOutline = useUIStore((s) => s.showOutline);
  const toggleOutline = useUIStore((s) => s.toggleOutline);

  if (!showOutline) {
    if (!desktop) {
      return (
        <button
          className="absolute left-3 top-4 z-40 flex h-9 items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/70 px-3 text-[13px] font-medium text-slate-600 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl transition hover:text-slate-900 dark:border-white/10 dark:bg-[#1c1c1e]/70 dark:text-slate-300 dark:hover:text-white"
          onClick={toggleOutline}
          title="大纲"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
          大纲
        </button>
      );
    }
    return (
      <div
        className="absolute left-3 top-4 z-40 flex h-9 items-center gap-0.5 rounded-full border border-black/[0.06] bg-white/70 pl-1 pr-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/70"
        data-overlay-panel
      >
        <LibraryButton />
        <button
          type="button"
          onClick={toggleOutline}
          title="大纲"
          className="rounded-full p-1.5 text-slate-500 transition hover:bg-black/[0.05] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
        >
          {SidebarIcon}
        </button>
        <BoardTitle />
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-4 left-3 top-4 z-40 flex w-72 flex-col overflow-hidden rounded-[20px] border border-black/[0.06] bg-white/75 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/80"
      data-overlay-panel
    >
      <div className="flex items-center justify-between gap-1 border-b border-black/[0.06] px-3 py-2.5 dark:border-white/10">
        {desktop ? (
          <div className="flex min-w-0 items-center gap-0.5">
            <LibraryButton />
            <BoardTitle />
          </div>
        ) : (
          <div className="px-1 text-[15px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">大纲</div>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          <button className={headerButton} onClick={() => void exportCurrentBoardAsMarkdown()} title="导出为 Markdown 文档">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
              <path d="M5 19h14" />
            </svg>
          </button>
          <button
            className="rounded-full p-1 text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
            onClick={toggleOutline}
            title="收起大纲"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      {desktop && <div className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">大纲</div>}
      <OutlineView />
    </div>
  );
}
