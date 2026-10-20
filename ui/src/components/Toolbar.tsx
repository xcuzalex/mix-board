import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createElementForTool } from '../canvas/interaction';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import type { ShapeVariant } from '../types/element';
import type { ToolType } from '../types/tool';
import {
  QUICK_SHAPE_ITEMS,
  SHAPE_LIBRARY_SECTIONS,
  ToolGlyph,
  isShapeToolActive,
  type LibraryItem,
} from './shapeLibrary';

const MAIN_TOOLS: Array<{ kind: 'tool'; tool: ToolType; label: string } | { kind: 'shape'; label: string } | { kind: 'library'; label: string }> = [
  { kind: 'tool', tool: 'select', label: '选择' },
  { kind: 'tool', tool: 'hand', label: '抓手' },
  { kind: 'shape', label: '图形' },
  { kind: 'tool', tool: 'text', label: '文本' },
  { kind: 'tool', tool: 'sticky_note', label: '便签' },
  { kind: 'tool', tool: 'arrow', label: '箭头' },
  { kind: 'tool', tool: 'frame', label: '框架' },
  { kind: 'tool', tool: 'section', label: '分区' },
  { kind: 'tool', tool: 'freedraw', label: '画笔' },
  { kind: 'tool', tool: 'mindmap', label: '脑图' },
  { kind: 'tool', tool: 'image', label: '图片' },
  { kind: 'library', label: '素材' },
];

export function Toolbar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const activeShapeVariant = useUIStore((s) => s.activeShapeVariant);
  const setActiveShapeVariant = useUIStore((s) => s.setActiveShapeVariant);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const viewportX = useUIStore((s) => s.viewportX);
  const viewportY = useUIStore((s) => s.viewportY);
  const zoom = useUIStore((s) => s.zoom);
  const addElement = useDocumentStore((s) => s.addElement);
  const pushHistory = useDocumentStore((s) => s.pushHistory);

  const [showShapePanel, setShowShapePanel] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [query, setQuery] = useState('');
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openShapePanel = () => {
    clearCloseTimer();
    setShowShapePanel(true);
  };

  const scheduleCloseShapePanel = () => {
    clearCloseTimer();
    if (showLibrary) return;
    closeTimerRef.current = window.setTimeout(() => {
      setShowShapePanel(false);
      closeTimerRef.current = null;
    }, 140);
  };

  useEffect(() => () => clearCloseTimer(), []);

  const filteredSections = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return SHAPE_LIBRARY_SECTIONS;
    return SHAPE_LIBRARY_SECTIONS
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(keyword)),
      }))
      .filter((section) => section.items.length > 0);
  }, [query]);

  const getInsertSize = (tool: ToolType, shapeVariant?: ShapeVariant) => {
    if (shapeVariant === 'start_state' || shapeVariant === 'end_state') {
      return { width: 56, height: 56 };
    }
    if (shapeVariant === 'sync_bar') {
      return { width: 180, height: 20 };
    }
    if (shapeVariant === 'actor') {
      return { width: 92, height: 132 };
    }
    switch (tool) {
      case 'text':
        return { width: 220, height: 36 };
      case 'sticky_note':
        return { width: 220, height: 220 };
      case 'frame':
      case 'section':
        return { width: 360, height: 220 };
      case 'mindmap':
        return { width: 400, height: 200 };
      case 'image':
        return { width: 200, height: 200 };
      default:
        return { width: 140, height: 88 };
    }
  };

  const getViewportCenter = () => {
    const canvas = document.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (rect.width / 2 - viewportX) / zoom,
        y: (rect.height / 2 - viewportY) / zoom,
      };
    }
    return {
      x: (window.innerWidth / 2 - viewportX) / zoom,
      y: (window.innerHeight / 2 - viewportY) / zoom,
    };
  };

  const insertItem = (item: LibraryItem) => {
    if (item.tool === 'image') {
      setActiveTool('image');
      return false;
    }

    const center = getViewportCenter();
    const element = createElementForTool(item.tool, center.x, center.y, { shapeVariant: item.shapeVariant });
    if (!element) return false;

    const { width, height } = getInsertSize(item.tool, item.shapeVariant);
    element.width = width;
    element.height = height;
    element.x = center.x - width / 2;
    element.y = center.y - height / 2;

    pushHistory();
    addElement(element);
    setSelectedIds([element.id]);
    setActiveTool('select');
    if (item.shapeVariant) {
      setActiveShapeVariant(item.shapeVariant);
    }
    return true;
  };

  const selectItem = (item: LibraryItem) => {
    if (!insertItem(item)) {
      if (item.shapeVariant) {
        setActiveTool(item.tool);
        setActiveShapeVariant(item.shapeVariant);
      } else {
        setActiveTool(item.tool);
      }
    }
    setShowShapePanel(false);
    setShowLibrary(false);
  };

  const toolbarLeft = showLibrary ? 'left-[18.5rem]' : 'left-3';

  return (
    <>
      {showLibrary && (
        <div className="absolute left-3 top-4 bottom-4 z-20 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_8px_24px_rgba(0,0,0,0.10)] backdrop-blur dark:border-white/10 dark:bg-[#23232a]/95">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">素材</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">点击后直接插入到当前画布</div>
              </div>
              <button
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
                onClick={() => setShowLibrary(false)}
                title="关闭素材面板"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20" />
              </svg>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索组件"
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
              />
            </div>
          </div>

          <div className="h-[calc(100%-104px)] overflow-y-auto px-3 py-3">
            {filteredSections.map((section) => (
              <div key={section.title} className="mb-2.5 last:mb-0">
                <div className="mb-2 px-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">{section.title}</div>
                <div className="grid grid-cols-5 gap-0.5">
                  {section.items.map((item) => {
                    const active = item.shapeVariant
                      ? activeTool === item.tool && activeShapeVariant === item.shapeVariant
                      : activeTool === item.tool;
                    return (
                      <button
                        key={item.id}
                        className={`group flex h-10 items-center justify-center rounded-xl px-1.5 py-1.5 transition ${
                          active
                            ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-400/15 dark:text-violet-300 dark:ring-violet-400/30'
                            : 'bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white'
                        }`}
                        onClick={() => selectItem(item)}
                        title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
                      >
                        <ToolGlyph tool={item.tool} shapeVariant={item.shapeVariant} className="h-5 w-5" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`absolute top-1/2 z-20 -translate-y-1/2 transition-all duration-200 ${toolbarLeft}`}>
        <div className="flex w-14 flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white/92 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.08)] backdrop-blur dark:border-white/10 dark:bg-[#23232a]/92">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#fff2df,#eef8ff)] text-slate-700 shadow-sm dark:bg-[linear-gradient(135deg,#3a3320,#1f2a33)] dark:text-slate-200">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5.5 18V6.5L12 13l6.5-6.5V18" />
              <path d="M9.2 9.8l2.8 2.8 2.8-2.8" />
            </svg>
          </div>

          {MAIN_TOOLS.map((item) => {
            if (item.kind === 'shape') {
              const active = isShapeToolActive(activeTool);
              return (
                <div
                  key={item.label}
                  className="relative"
                  onMouseEnter={openShapePanel}
                  onMouseLeave={scheduleCloseShapePanel}
                >
                  <ToolbarButton
                    active={active}
                    label={item.label}
                    onClick={() => {
                      if (!isShapeToolActive(activeTool)) {
                        setActiveTool('rectangle');
                      }
                    }}
                  >
                    <ToolGlyph tool="rectangle" shapeVariant={activeShapeVariant} className="h-5 w-5" />
                  </ToolbarButton>

                  {showShapePanel && !showLibrary && (
                    <div className="absolute left-full top-0 ml-3 w-56 rounded-2xl border border-slate-200 bg-white/96 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.10)] backdrop-blur dark:border-white/10 dark:bg-[#23232a]/96">
                      <div className="grid grid-cols-5 gap-2">
                        {QUICK_SHAPE_ITEMS.map((shape) => (
                          <button
                            key={shape.id}
                            className={`flex h-9 items-center justify-center rounded-xl border transition ${
                              activeTool === shape.tool && activeShapeVariant === shape.shapeVariant
                                ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/15 dark:text-violet-300'
                                : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/10'
                            }`}
                            title={shape.label}
                            onClick={() => {
                              selectItem(shape);
                              clearCloseTimer();
                            }}
                          >
                            <ToolGlyph tool={shape.tool} shapeVariant={shape.shapeVariant} className="h-4 w-4" />
                          </button>
                        ))}
                      </div>
                      <button
                        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20 dark:hover:bg-white/10"
                        onClick={() => {
                          setShowLibrary(true);
                          setShowShapePanel(false);
                        }}
                      >
                        更多组件
                        <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">全部</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            }

            if (item.kind === 'library') {
              return (
                <ToolbarButton
                  key={item.label}
                  active={showLibrary}
                  label={item.label}
                  onClick={() => {
                    setShowLibrary((value) => !value);
                    setShowShapePanel(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6.5" cy="6.5" r="1.2" />
                    <circle cx="12" cy="6.5" r="1.2" />
                    <circle cx="17.5" cy="6.5" r="1.2" />
                    <circle cx="6.5" cy="12" r="1.2" />
                    <circle cx="12" cy="12" r="1.2" />
                    <circle cx="17.5" cy="12" r="1.2" />
                    <circle cx="6.5" cy="17.5" r="1.2" />
                    <circle cx="12" cy="17.5" r="1.2" />
                    <circle cx="17.5" cy="17.5" r="1.2" />
                  </svg>
                </ToolbarButton>
              );
            }

            return (
              <ToolbarButton
                key={item.tool}
                active={activeTool === item.tool}
                label={item.label}
                onClick={() => {
                  setActiveTool(item.tool);
                  setShowShapePanel(false);
                }}
              >
                <ToolGlyph tool={item.tool} className="h-5 w-5" />
              </ToolbarButton>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ToolbarButton({
  active,
  label,
  children,
  onClick,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-10 w-10 items-center justify-center rounded-2xl transition ${
        active
          ? 'bg-violet-50 text-violet-700 shadow-sm dark:bg-violet-400/15 dark:text-violet-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white'
      }`}
      onClick={onClick}
      title={label}
    >
      {children}
    </button>
  );
}
