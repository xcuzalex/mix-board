import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { VaultEntry } from '../platform';
import { useDocumentStore } from '../store/document';
import { useBoardThumbnail } from '../utils/thumbnails';
import { isPathInside, useVaultStore, type LibrarySection } from '../store/vault';
import {
  chooseLocalDraftsOnly,
  createBoard,
  createFolder,
  openBoard,
  openICloudVault,
  openRecentVault,
  pickVaultFolder,
  renameEntry,
  setFavorite,
  trashEntry,
} from '../utils/vault';

/**
 * 资料库: a full page listing the vault, like Freeform's board browser.
 * Left: 全部笔记 / 个人收藏 and the folder tree. Right: board cards, newest
 * first, with star, rename and move-to-Trash.
 */

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

const byName = (a: VaultEntry, b: VaultEntry) => collator.compare(a.name, b.name);
const byModified = (a: VaultEntry, b: VaultEntry) => b.modified - a.modified;

function formatModified(ms: number) {
  if (!ms) return '';
  const date = new Date(ms);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function ancestorsOf(path: string | null, root: string) {
  const result: string[] = [];
  if (!path || !isPathInside(path, root)) return result;
  let current = path.slice(0, path.lastIndexOf('/'));
  while (current.length > root.length) {
    result.push(current);
    current = current.slice(0, current.lastIndexOf('/'));
  }
  return result;
}

function sameSection(a: LibrarySection, b: LibrarySection) {
  if (typeof a === 'object' && typeof b === 'object') return a.folder === b.folder;
  return a === b;
}

// --- Small pieces ---

function RenameInput({ initial, className, onDone }: { initial: string; className?: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const finish = (name: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label="名称"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(value)}
      className={`min-w-0 rounded-md bg-white px-1.5 py-0.5 text-[13px] text-slate-800 outline-none ring-2 ring-[#007aff]/60 dark:bg-[#2c2c2e] dark:text-slate-100 ${className ?? ''}`}
    />
  );
}

function commitRename(entry: VaultEntry) {
  return (name: string | null) => {
    useVaultStore.getState().setRenamingPath(null);
    const trimmed = name?.trim();
    if (trimmed && trimmed !== entry.name) void renameEntry(entry.path, trimmed);
  };
}

function Star({ filled, className = 'h-4 w-4' }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
    </svg>
  );
}

const FolderGlyph = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
);

const PencilIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z" />
  </svg>
);

const TrashIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7M9 7V4.5h6V7" />
  </svg>
);

function HoverAction({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-md p-1 text-slate-400 hover:bg-black/[0.06] hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
    >
      {children}
    </button>
  );
}

// --- Navigation column ---

function NavItem({ section, icon, label, count }: { section: LibrarySection; icon: ReactNode; label: string; count: number }) {
  const active = useVaultStore((s) => sameSection(s.section, section));
  const setSection = useVaultStore((s) => s.setSection);
  return (
    <button
      type="button"
      onClick={() => setSection(section)}
      className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition ${
        active ? 'bg-black/[0.07] font-medium text-slate-900 dark:bg-white/10 dark:text-white' : 'text-slate-600 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/5'
      }`}
    >
      <span className="flex w-4 justify-center text-[#007aff]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[11px] tabular-nums text-slate-400">{count}</span>
    </button>
  );
}

const FolderPlusIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    <path d="M12 11v5M9.5 13.5h5" />
  </svg>
);

const MoreIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
    <circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" />
  </svg>
);

function MenuItem({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
          : 'text-slate-700 hover:bg-[#007aff] hover:text-white dark:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

/** Actions for one folder: a quick "new subfolder" button plus a ⋯ menu (also opened by right-click). */
function FolderActions({ folder, menuOpen, setMenuOpen }: {
  folder: VaultEntry;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const setRenamingPath = useVaultStore((s) => s.setRenamingPath);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, setMenuOpen]);

  const run = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <div ref={ref} className={`relative shrink-0 items-center ${menuOpen ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}>
      <HoverAction title="新建子文件夹" onClick={() => void createFolder(folder.path)}>{FolderPlusIcon}</HoverAction>
      <HoverAction title="更多操作" onClick={() => setMenuOpen(!menuOpen)}>{MoreIcon}</HoverAction>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-40 rounded-xl border border-black/[0.06] bg-white/95 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_12px_32px_rgba(0,0,0,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-[#2a2a2e]/95"
        >
          <MenuItem label="新建笔记" onClick={() => run(() => void createBoard(folder.path))} />
          <MenuItem label="新建子文件夹" onClick={() => run(() => void createFolder(folder.path))} />
          <MenuItem label="重命名" onClick={() => run(() => setRenamingPath(folder.path))} />
          <div className="my-1 h-px bg-black/[0.06] dark:bg-white/10" />
          <MenuItem label="移到废纸篓" danger onClick={() => run(() => void trashEntry(folder.path))} />
        </div>
      )}
    </div>
  );
}

function FolderTree({ parent, depth, foldersByParent, expanded, toggle }: {
  parent: string;
  depth: number;
  foldersByParent: Map<string, VaultEntry[]>;
  expanded: Set<string>;
  toggle: (path: string) => void;
}) {
  const section = useVaultStore((s) => s.section);
  const renamingPath = useVaultStore((s) => s.renamingPath);
  const setFolder = useVaultStore((s) => s.setFolder);
  const setRenamingPath = useVaultStore((s) => s.setRenamingPath);
  const [menuPath, setMenuPath] = useState<string | null>(null);

  return (
    <>
      {(foldersByParent.get(parent) ?? []).map((folder) => {
        const hasChildren = (foldersByParent.get(folder.path)?.length ?? 0) > 0;
        const isOpen = expanded.has(folder.path);
        const active = typeof section === 'object' && section.folder === folder.path;
        return (
          <div key={folder.path}>
            <div
              role="treeitem"
              aria-selected={active}
              aria-expanded={hasChildren ? isOpen : undefined}
              onClick={() => setFolder(folder.path)}
              onDoubleClick={() => setRenamingPath(folder.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuPath(folder.path);
              }}
              className={`group flex h-8 cursor-default items-center gap-1.5 rounded-lg pr-1 text-[13px] transition ${
                active ? 'bg-black/[0.07] font-medium text-slate-900 dark:bg-white/10 dark:text-white' : 'text-slate-600 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/5'
              }`}
              style={{ paddingLeft: 4 + depth * 14 }}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={isOpen ? '收起' : '展开'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(folder.path);
                }}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 ${hasChildren ? 'hover:bg-black/[0.06] dark:hover:bg-white/10' : 'invisible'}`}
              >
                <svg viewBox="0 0 24 24" className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              <FolderGlyph className="h-4 w-4 shrink-0 text-[#007aff]/80" />
              {renamingPath === folder.path ? (
                <RenameInput initial={folder.name} className="flex-1" onDone={commitRename(folder)} />
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <FolderActions
                    folder={folder}
                    menuOpen={menuPath === folder.path}
                    setMenuOpen={(open) => setMenuPath(open ? folder.path : null)}
                  />
                </>
              )}
            </div>
            {isOpen && (
              <FolderTree parent={folder.path} depth={depth + 1} foldersByParent={foldersByParent} expanded={expanded} toggle={toggle} />
            )}
          </div>
        );
      })}
    </>
  );
}

function VaultSwitcher() {
  const vault = useVaultStore((s) => s.vault);
  const recent = useVaultStore((s) => s.recent);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (action: () => Promise<void>) => () => {
    setOpen(false);
    void action();
  };

  const itemClass = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-slate-700 hover:bg-[#007aff] hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-700 dark:text-slate-200';

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div className="absolute inset-x-0 bottom-full z-10 mb-1 rounded-xl border border-black/[0.08] bg-white/95 p-1 shadow-[0_12px_36px_rgba(0,0,0,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-[#2c2c2e]/95">
          {recent.length > 0 && (
            <>
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-slate-400">最近的资料库</div>
              {recent.map((item) => (
                <button key={item.path} type="button" className={itemClass} disabled={!item.exists} title={item.path} onClick={pick(() => openRecentVault(item.path))}>
                  <span className="w-3.5 shrink-0 text-center">{item.path === vault?.path ? '✓' : ''}</span>
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
              <div className="my-1 h-px bg-black/[0.06] dark:bg-white/10" />
            </>
          )}
          <button type="button" className={itemClass} onClick={pick(pickVaultFolder)}>
            <span className="w-3.5 shrink-0" />打开文件夹作为库…
          </button>
          <button type="button" className={itemClass} onClick={pick(openICloudVault)}>
            <span className="w-3.5 shrink-0" />使用 iCloud 云盘
          </button>
          {vault && (
            <button type="button" className={itemClass} onClick={pick(chooseLocalDraftsOnly)}>
              <span className="w-3.5 shrink-0" />关闭资料库，只用本机草稿
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={vault?.path}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-slate-600 transition hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/5"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M4 5.5h6l2 2h8v11H4z" />
        </svg>
        <span className="min-w-0 flex-1 truncate">{vault ? vault.name : '未打开资料库'}</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
        </svg>
      </button>
    </div>
  );
}

// --- Cards ---

/** True once the element has scrolled into (or near) view; stays true after. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}

function BoardCard({ entry, location }: { entry: VaultEntry; location?: string }) {
  const isCurrent = useDocumentStore((s) => s.filePath === entry.path);
  const renaming = useVaultStore((s) => s.renamingPath === entry.path);
  const setRenamingPath = useVaultStore((s) => s.setRenamingPath);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const visible = useOnScreen(previewRef);
  const thumbnail = useBoardThumbnail(entry.path, entry.modified, visible && entry.downloaded);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开笔记 ${entry.name}`}
      onClick={() => entry.downloaded && void openBoard(entry.path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && entry.downloaded && !renaming) void openBoard(entry.path);
      }}
      title={entry.downloaded ? undefined : '尚未从 iCloud 下载'}
      className={`group flex cursor-default flex-col rounded-2xl outline-none ${entry.downloaded ? '' : 'opacity-50'}`}
    >
      <div
        ref={previewRef}
        className={`relative aspect-[4/3] overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition group-hover:shadow-[0_6px_20px_rgba(0,0,0,0.10)] group-focus-visible:ring-2 group-focus-visible:ring-[#007aff] dark:bg-[#232327] ${
          isCurrent ? 'border-[#007aff]/60 ring-2 ring-[#007aff]/30' : 'border-black/[0.06] dark:border-white/10'
        }`}
      >
        {thumbnail ? (
          // The note's own content, scaled to fit.
          <img src={thumbnail} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(0,0,0,0.07)_1px,transparent_1.2px)] [background-size:14px_14px] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1.2px)]" />
            {/* Placeholder for an empty note (or while its preview renders) */}
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${thumbnail === undefined ? 'opacity-40' : ''}`}>
              <div className="h-10 w-14 rotate-[-4deg] rounded-md bg-[#fff3a8] shadow-sm dark:bg-[#5c5426]" />
              <div className="-ml-4 mt-6 h-8 w-12 rotate-[5deg] rounded-md bg-[#cfe8ff] shadow-sm dark:bg-[#24405c]" />
            </div>
          </>
        )}
        <button
          type="button"
          title={entry.favorite ? '取消收藏' : '收藏'}
          aria-pressed={entry.favorite}
          onClick={(e) => {
            e.stopPropagation();
            void setFavorite(entry.path, !entry.favorite);
          }}
          className={`absolute right-2 top-2 rounded-full bg-white/80 p-1 backdrop-blur transition dark:bg-black/40 ${
            entry.favorite ? 'text-amber-400' : 'text-slate-400 opacity-0 hover:text-amber-400 group-hover:opacity-100'
          }`}
        >
          <Star filled={entry.favorite} />
        </button>
        <div className="absolute bottom-2 right-2 hidden items-center gap-0.5 rounded-lg bg-white/85 p-0.5 backdrop-blur group-hover:flex dark:bg-black/50">
          <HoverAction title="重命名" onClick={() => setRenamingPath(entry.path)}>{PencilIcon}</HoverAction>
          <HoverAction title="移到废纸篓" onClick={() => void trashEntry(entry.path)}>{TrashIcon}</HoverAction>
        </div>
      </div>
      <div className="px-1 pt-2" onDoubleClick={(e) => {
        e.stopPropagation();
        setRenamingPath(entry.path);
      }}>
        {renaming ? (
          <RenameInput initial={entry.name} className="w-full" onDone={commitRename(entry)} />
        ) : (
          <div className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100" title={entry.name}>{entry.name}</div>
        )}
        <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
          {entry.downloaded ? formatModified(entry.modified) : '未下载'}
          {location && <> · {location}</>}
        </div>
      </div>
    </div>
  );
}

function FolderCard({ entry, count }: { entry: VaultEntry; count: number }) {
  const setFolder = useVaultStore((s) => s.setFolder);
  return (
    <button
      type="button"
      onClick={() => setFolder(entry.path)}
      className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[#232327]"
    >
      <FolderGlyph className="h-7 w-7 shrink-0 text-[#007aff]/80" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">{entry.name}</span>
        <span className="block text-[11px] text-slate-400">{count} 项</span>
      </span>
    </button>
  );
}

// --- Page ---

function NoVault() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <FolderGlyph className="h-12 w-12 text-[#007aff]/70" />
      <div className="text-[17px] font-semibold text-slate-800 dark:text-slate-100">还没有打开资料库</div>
      <p className="max-w-sm text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
        选一个文件夹作为资料库，所有笔记都会以 .mixnote 文件自动保存在里面，可以分文件夹整理、收藏。
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => void openICloudVault()} className="rounded-lg bg-[#007aff] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#0062cc]">
          使用 iCloud 云盘
        </button>
        <button type="button" onClick={() => void pickVaultFolder()} className="rounded-lg border border-black/[0.08] bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/10 dark:text-slate-100">
          选择文件夹…
        </button>
      </div>
    </div>
  );
}

export function LibraryPage() {
  const libraryOpen = useVaultStore((s) => s.libraryOpen);
  const vault = useVaultStore((s) => s.vault);
  const entries = useVaultStore((s) => s.entries);
  const section = useVaultStore((s) => s.section);
  const renamingPath = useVaultStore((s) => s.renamingPath);
  const setLibraryOpen = useVaultStore((s) => s.setLibraryOpen);
  const setFolder = useVaultStore((s) => s.setFolder);
  const refreshEntries = useVaultStore((s) => s.refreshEntries);
  const filePath = useDocumentStore((s) => s.filePath);
  const hasUnsavedContent = useDocumentStore((s) => s.elements.length > 0);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const pageRef = useRef<HTMLDivElement | null>(null);

  const root = vault?.path ?? '';

  const { foldersByParent, boards, childCounts } = useMemo(() => {
    const folders = new Map<string, VaultEntry[]>();
    const counts = new Map<string, number>();
    const boardList: VaultEntry[] = [];
    for (const entry of entries) {
      counts.set(entry.parent, (counts.get(entry.parent) ?? 0) + 1);
      if (entry.kind === 'folder') {
        const siblings = folders.get(entry.parent) ?? [];
        siblings.push(entry);
        folders.set(entry.parent, siblings);
      } else {
        boardList.push(entry);
      }
    }
    for (const list of folders.values()) list.sort(byName);
    boardList.sort(byModified);
    return { foldersByParent: folders, boards: boardList, childCounts: counts };
  }, [entries]);

  const folderPath = typeof section === 'object' ? section.folder : null;
  const sectionMissing = folderPath !== null && !entries.some((e) => e.path === folderPath);
  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (q) return { folders: [] as VaultEntry[], boards: boards.filter((b) => b.name.toLowerCase().includes(q)) };
    if (section === 'favorites') return { folders: [], boards: boards.filter((b) => b.favorite) };
    if (folderPath) {
      return {
        folders: foldersByParent.get(folderPath) ?? [],
        boards: boards.filter((b) => b.parent === folderPath),
      };
    }
    return { folders: [], boards };
  }, [q, section, folderPath, boards, foldersByParent]);

  // Refresh when the page opens or the window regains focus (Finder edits, sync).
  useEffect(() => {
    if (!libraryOpen || !vault) return undefined;
    void refreshEntries();
    const onFocus = () => void refreshEntries();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [libraryOpen, vault, refreshEntries]);

  // Keep keyboard focus on the page so canvas shortcuts (which skip overlay panels) stay quiet.
  useEffect(() => {
    if (libraryOpen) pageRef.current?.focus();
  }, [libraryOpen]);

  // A folder that was renamed or trashed elsewhere: fall back to all boards.
  useEffect(() => {
    if (sectionMissing && entries.length > 0) setFolder(null);
  }, [sectionMissing, entries.length, setFolder]);

  // Reveal the open folder and anything being renamed in the tree
  // (adjusting state during render, so it never paints collapsed first).
  const revealKey = [root, folderPath, renamingPath].join('\n');
  const [revealedKey, setRevealedKey] = useState('');
  if (root && revealKey !== revealedKey) {
    setRevealedKey(revealKey);
    const reveal = [...ancestorsOf(renamingPath, root), ...ancestorsOf(folderPath, root)];
    if (reveal.some((path) => !expanded.has(path))) setExpanded(new Set([...expanded, ...reveal]));
  }

  if (!libraryOpen) return null;

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const relativeFolder = (path: string) => (path === root ? '' : path.slice(root.length + 1));
  const title = q
    ? `搜索“${query.trim()}”`
    : section === 'favorites' ? '个人收藏' : folderPath ? folderPath.split('/').pop() : '全部笔记';
  const breadcrumb = folderPath ? relativeFolder(folderPath).split('/').slice(0, -1) : [];
  const favoriteCount = boards.filter((b) => b.favorite).length;
  // "Back" only makes sense when a note is open behind the library: a saved
  // one, or an untitled one with something on it.
  const canGoBack = filePath !== null || hasUnsavedContent;

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      data-overlay-panel
      onKeyDown={(e) => {
        if (e.key === 'Escape' && canGoBack && !(e.target instanceof HTMLInputElement)) setLibraryOpen(false);
      }}
      className="absolute inset-0 z-50 flex bg-[#f5f5f7] outline-none dark:bg-[#141417]"
    >
      <aside className="flex w-60 shrink-0 flex-col border-r border-black/[0.06] bg-[#ececef]/70 dark:border-white/10 dark:bg-[#1c1c1f]">
        <div className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">资料库</div>
        <nav className="flex flex-col gap-0.5 px-2">
          <NavItem
            section="all"
            label="全部笔记"
            count={boards.length}
            icon={(
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" />
                <rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />
              </svg>
            )}
          />
          <NavItem section="favorites" label="个人收藏" count={favoriteCount} icon={<Star filled={false} />} />
        </nav>

        <div className="mt-4 flex items-center justify-between px-4 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">文件夹</span>
          {vault && (
            <button
              type="button"
              title="在资料库中新建文件夹"
              aria-label="在资料库中新建文件夹"
              onClick={() => void createFolder(null)}
              className="rounded-md p-0.5 text-slate-400 hover:bg-black/[0.06] hover:text-[#007aff] dark:hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
        <div role="tree" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {vault && (foldersByParent.get(root)?.length ?? 0) === 0 && (
            <div className="px-2.5 py-1.5 text-[12px] text-slate-400 dark:text-slate-500">还没有文件夹</div>
          )}
          {vault && <FolderTree parent={root} depth={0} foldersByParent={foldersByParent} expanded={expanded} toggle={toggle} />}
        </div>
        <div className="border-t border-black/[0.06] p-2 dark:border-white/10">
          <VaultSwitcher />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-8 pb-4 pt-5">
          {canGoBack && (
            <button
              type="button"
              onClick={() => setLibraryOpen(false)}
              title="返回笔记（Esc）"
              className="flex h-8 items-center gap-1 rounded-full pl-1.5 pr-3 text-[13px] font-medium text-[#007aff] hover:bg-[#007aff]/10"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
              返回笔记
            </button>
          )}
          <div className="min-w-0 flex-1">
            {breadcrumb.length > 0 && !q && (
              <div className="truncate text-[11px] text-slate-400">{breadcrumb.join(' / ')}</div>
            )}
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
          </div>
          {vault && (
            <>
              <div className="flex w-56 items-center gap-2 rounded-lg bg-black/[0.05] px-2.5 py-1.5 dark:bg-white/[0.07]">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setQuery('');
                  }}
                  placeholder="搜索全部笔记"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
                />
              </div>
              <button
                type="button"
                onClick={() => void createFolder()}
                title={folderPath ? `在「${title}」中新建文件夹` : '在资料库中新建文件夹'}
                className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-slate-600 hover:bg-black/[0.05] dark:text-slate-300 dark:hover:bg-white/10"
              >
                {FolderPlusIcon}
                新建文件夹
              </button>
              <button
                type="button"
                onClick={() => void createBoard()}
                title={folderPath ? `在「${title}」中新建笔记（⌘N）` : '新建笔记（⌘N）'}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[#007aff] px-3 text-[13px] font-medium text-white shadow-sm hover:bg-[#0062cc]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                新建笔记
              </button>
            </>
          )}
        </header>

        {!vault ? (
          <NoVault />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
            {visible.folders.length > 0 && (
              <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                {visible.folders.map((folder) => (
                  <FolderCard key={folder.path} entry={folder} count={childCounts.get(folder.path) ?? 0} />
                ))}
              </div>
            )}
            {visible.boards.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-5 gap-y-6">
                {visible.boards.map((board) => (
                  <BoardCard
                    key={board.path}
                    entry={board}
                    location={folderPath && !q ? undefined : relativeFolder(board.parent) || undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-20 text-center text-[13px] leading-relaxed text-slate-400 dark:text-slate-500">
                {q ? '没有匹配的笔记'
                  : section === 'favorites' ? <>还没有收藏的笔记。<br />把鼠标移到笔记上，点右上角的星标即可收藏。</>
                    : folderPath ? (visible.folders.length > 0 ? '' : '这个文件夹是空的')
                      : <>还没有笔记。<br />点右上角「新建笔记」开始记录。</>}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** Floating notice for failed vault operations. */
export function VaultNotice() {
  const notice = useVaultStore((s) => s.notice);
  const needsWelcome = useVaultStore((s) => s.needsWelcome);
  const setNotice = useVaultStore((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  // The welcome dialog shows its own errors.
  if (!notice || needsWelcome) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-20 z-[55] flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-red-200 bg-white/90 py-2 pl-4 pr-2 text-[13px] text-red-600 shadow-[0_12px_36px_rgba(0,0,0,0.14)] backdrop-blur-xl dark:border-red-400/30 dark:bg-[#1c1c1e]/90 dark:text-red-300"
      >
        <span className="min-w-0">{notice}</span>
        <button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded-lg px-2 py-0.5 text-slate-500 hover:bg-black/[0.05] dark:text-slate-400 dark:hover:bg-white/10">
          好
        </button>
      </div>
    </div>
  );
}
