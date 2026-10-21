import { useMemo, useState } from 'react';
import type { ShapeVariant } from '../types/element';
import type { ToolType } from '../types/tool';
import { SHAPE_LIBRARY_SECTIONS, ToolGlyph, type LibraryItem } from './shapeLibrary';

// The drawing flyout: search, the drawing tools, then every shape in one
// scrolling list. Starred shapes (收藏) and recently used ones come first.

const DRAW_TOOLS: Array<{ tool: ToolType; label: string }> = [
  { tool: 'arrow', label: '箭头' },
  { tool: 'freedraw', label: '画笔' },
  { tool: 'section', label: '分区' },
  { tool: 'image', label: '图片' },
];

// Pre-rename key prefix, like the other per-viewer preferences.
const FAVORITES_KEY = 'mixboard.shapes.favorites';
const RECENT_KEY = 'mixboard.shapes.recent';
const DEFAULT_FAVORITES = ['round_rectangle', 'ellipse', 'diamond', 'rectangle', 'cylinder'];
const RECENT_LIMIT = 5;

// Already one click away on the main toolbar (notes, mindmap, frame and the
// 表格与结构 menu), so the picker doesn't list them again (search still finds them).
const ON_TOOLBAR: ToolType[] = ['text', 'sticky_note', 'mindmap', 'frame', 'table', 'kanban', 'matrix', 'code'];

const ALL_ITEMS = SHAPE_LIBRARY_SECTIONS.flatMap((section) => section.items);
const ITEM_BY_ID = new Map(ALL_ITEMS.map((item) => [item.id, item]));

function readIds(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string' && ITEM_BY_ID.has(id));
  } catch {
    // Preferences are a per-viewer convenience; fall back to defaults.
  }
  return fallback;
}

function writeIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Ignore storage failures (private window, blocked storage).
  }
}

const toItems = (ids: string[]) => ids.map((id) => ITEM_BY_ID.get(id)).filter((item): item is LibraryItem => !!item);

export function ShapePicker({
  activeTool,
  activeShapeVariant,
  onPickTool,
  onSelectItem,
  onSearchFocusChange,
}: {
  activeTool: ToolType;
  activeShapeVariant: ShapeVariant | undefined;
  onPickTool: (tool: ToolType) => void;
  onSelectItem: (item: LibraryItem) => void;
  /** While the search box has focus the flyout should stay open. */
  onSearchFocusChange: (focused: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => readIds(FAVORITES_KEY, DEFAULT_FAVORITES));
  const [recent, setRecent] = useState(() => readIds(RECENT_KEY, []));

  // Stored right away (not in a state updater): picking an item closes the
  // flyout, unmounting this component before a deferred updater would run.
  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
    writeIds(FAVORITES_KEY, next);
    setFavorites(next);
  };

  const select = (item: LibraryItem) => {
    const next = [item.id, ...recent.filter((x) => x !== item.id)].slice(0, RECENT_LIMIT * 2);
    writeIds(RECENT_KEY, next);
    setRecent(next);
    onSelectItem(item);
  };

  // Every shape appears once: favorites and recents claim theirs first, and
  // items that look the same (an ER "entity" is a rectangle) or duplicate a
  // drawing tool are left out of the later sections.
  const { pinned, library } = useMemo(() => {
    const seen = new Set<string>([...DRAW_TOOLS.map((t) => t.tool), ...ON_TOOLBAR].map((tool) => `${tool}:`));
    const fresh = (items: LibraryItem[]) => items.filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      seen.clear();
      const matches = fresh(ALL_ITEMS.filter((item) => `${item.label} ${item.keywords} ${item.id}`.toLowerCase().includes(keyword)));
      return { pinned: [], library: [{ title: matches.length ? '搜索结果' : '没有找到匹配的素材', items: matches }] };
    }
    const favoriteItems = fresh(toItems(favorites));
    const recentItems = fresh(toItems(recent)).slice(0, RECENT_LIMIT);
    return {
      pinned: [
        ...(favoriteItems.length ? [{ title: '收藏', items: favoriteItems }] : []),
        ...(recentItems.length ? [{ title: '最近使用', items: recentItems }] : []),
      ],
      library: SHAPE_LIBRARY_SECTIONS
        .map((section) => ({ title: section.title, items: fresh(section.items) }))
        .filter((section) => section.items.length > 0),
    };
  }, [query, favorites, recent]);
  const sections = [...pinned, ...library];

  const isActive = (item: LibraryItem) => (item.shapeVariant
    ? activeTool === item.tool && activeShapeVariant === item.shapeVariant
    : activeTool === item.tool);

  const tile = (active: boolean) => `flex h-7 w-full items-center justify-center rounded-md transition ${
    active
      ? 'bg-[#007aff]/12 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#4aa8ff]'
      : 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
  }`;

  const renderSections = (list: typeof sections) => list.map((section) => (
    <div key={section.title}>
      <SectionTitle>{section.title}</SectionTitle>
      <div className="grid grid-cols-7 gap-0.5">
        {section.items.map((item) => {
          const starred = favorites.includes(item.id);
          // Toolbar items (found by search) can't be pinned: 收藏 never lists them.
          const starrable = !ON_TOOLBAR.includes(item.tool);
          return (
            <div key={item.id} className="group relative">
              <button
                type="button"
                className={tile(isActive(item))}
                title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
                onClick={() => select(item)}
              >
                <ToolGlyph tool={item.tool} shapeVariant={item.shapeVariant} className="h-4 w-4" />
              </button>
              {starrable && (
                <button
                  type="button"
                  aria-label={starred ? `取消收藏 ${item.label}` : `收藏 ${item.label}`}
                  title={starred ? '取消收藏' : '收藏（排到最前）'}
                  onClick={() => toggleFavorite(item.id)}
                  className={`absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full transition ${
                    starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400 dark:text-slate-500'
                  } opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                    <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  ));

  return (
    <div className="flex max-h-[min(70vh,520px)] w-60 flex-col">
      <div className="px-2.5 pt-2.5">
        <div className="flex items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-1.5 dark:bg-white/5">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => onSearchFocusChange(true)}
            onBlur={() => onSearchFocusChange(false)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                if (query) setQuery('');
                else event.currentTarget.blur();
              } else if (event.key === 'Enter') {
                const first = sections[0]?.items[0];
                if (query.trim() && first) select(first);
              }
            }}
            placeholder="搜索形状、图表…"
            className="w-full bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-2.5">
        {renderSections(pinned)}
        {!query.trim() && (
          <>
            <SectionTitle>工具</SectionTitle>
            <div className="grid grid-cols-7 gap-0.5">
              {DRAW_TOOLS.map((item) => (
                <button key={item.tool} type="button" className={tile(activeTool === item.tool)} title={item.label} onClick={() => onPickTool(item.tool)}>
                  <ToolGlyph tool={item.tool} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </>
        )}

        {renderSections(library)}
      </div>
    </div>
  );
}

const itemKey = (item: LibraryItem) => `${item.tool}:${item.shapeVariant ?? ''}`;

function SectionTitle({ children }: { children: string }) {
  return <div className="mb-0.5 mt-2 px-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">{children}</div>;
}
