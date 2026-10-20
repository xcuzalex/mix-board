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

// Note-first toolbar: the primary column foregrounds note tools; drawing tools
// live in a secondary "绘图" flyout so the surface stays calm (苹果无边际).
const NOTE_TOOLS: Array<{ tool: ToolType; label: string }> = [
  { tool: 'text', label: '文本' },
  { tool: 'sticky_note', label: '便签' },
  { tool: 'mindmap', label: '脑图' },
  { tool: 'frame', label: '框架' },
];

const DRAW_TOOLS: Array<{ tool: ToolType; label: string }> = [
  { tool: 'arrow', label: '箭头' },
  { tool: 'freedraw', label: '画笔' },
  { tool: 'section', label: '分区' },
  { tool: 'image', label: '图片' },
];

const DRAW_TOOL_SET = new Set<ToolType>(['arrow', 'line', 'freedraw', 'section', 'image']);

export function Toolbar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const activeShapeVariant = useUIStore((s) => s.activeShapeVariant);
  const setActiveShapeVariant = useUIStore((s) => s.setActiveShapeVariant);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const viewportX = useUIStore((s) => s.viewportX);
  const viewportY = useUIStore((s) => s.viewportY);
  const zoom = useUIStore((s) => s.zoom);
  const showOutline = useUIStore((s) => s.showOutline);
  const addElement = useDocumentStore((s) => s.addElement);
  const pushHistory = useDocumentStore((s) => s.pushHistory);

  const [showDrawPanel, setShowDrawPanel] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [query, setQuery] = useState('');
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openDrawPanel = () => {
    clearCloseTimer();
    setShowDrawPanel(true);
  };

  const scheduleCloseDrawPanel = () => {
    clearCloseTimer();
    if (showLibrary) return;
    closeTimerRef.current = window.setTimeout(() => {
      setShowDrawPanel(false);
      closeTimerRef.current = null;
    }, 160);
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
    setShowDrawPanel(false);
    setShowLibrary(false);
  };

  const pickTool = (tool: ToolType) => {
    setActiveTool(tool);
    setShowDrawPanel(false);
  };

  const drawActive = isShapeToolActive(activeTool) || DRAW_TOOL_SET.has(activeTool);
  const toolbarLeft = showOutline ? 'left-[20rem]' : showLibrary ? 'left-[18.5rem]' : 'left-3';

  return (
    <>
      {showLibrary && (
        <div className="absolute left-3 top-4 bottom-4 z-20 w-64 overflow-hidden rounded-[20px] border border-black/[0.06] bg-white/75 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/80">
          <div className="border-b border-black/[0.06] px-4 py-3 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">素材</div>
              <button
                className="rounded-full p-1 text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
                onClick={() => setShowLibrary(false)}
                title="关闭素材面板"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-2 dark:bg-white/5">
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
                            ? 'bg-[#007aff]/12 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#4aa8ff]'
                            : 'bg-transparent text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
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
        <div className="flex w-[52px] flex-col items-center gap-0.5 rounded-[20px] border border-black/[0.06] bg-white/70 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_30px_rgba(0,0,0,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/70">
          <ToolbarButton active={activeTool === 'select'} label="选择" onClick={() => pickTool('select')}>
            <ToolGlyph tool="select" className="h-5 w-5" />
          </ToolbarButton>
          <ToolbarButton active={activeTool === 'hand'} label="抓手" onClick={() => pickTool('hand')}>
            <ToolGlyph tool="hand" className="h-5 w-5" />
          </ToolbarButton>

          <Divider />

          {NOTE_TOOLS.map((item) => (
            <ToolbarButton
              key={item.tool}
              active={activeTool === item.tool}
              label={item.label}
              onClick={() => pickTool(item.tool)}
            >
              <ToolGlyph tool={item.tool} className="h-5 w-5" />
            </ToolbarButton>
          ))}

          <Divider />

          {/* Drawing tools — tucked into a secondary flyout */}
          <div className="relative" onMouseEnter={openDrawPanel} onMouseLeave={scheduleCloseDrawPanel}>
            <ToolbarButton
              active={drawActive}
              label="绘图工具"
              onClick={() => {
                if (!drawActive) setActiveTool('rectangle');
                setShowDrawPanel((v) => !v);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15.5 4.5l4 4L8 20l-4 1 1-4z" />
                <path d="M13.5 6.5l4 4" />
              </svg>
            </ToolbarButton>

            {showDrawPanel && !showLibrary && (
              <div className="absolute left-full top-0 ml-3 w-60 rounded-[20px] border border-black/[0.06] bg-white/80 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/85">
                <div className="mb-2 px-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">工具</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {DRAW_TOOLS.map((item) => (
                    <button
                      key={item.tool}
                      className={`flex h-10 items-center justify-center rounded-xl transition ${
                        activeTool === item.tool
                          ? 'bg-[#007aff]/12 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#4aa8ff]'
                          : 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
                      }`}
                      title={item.label}
                      onClick={() => pickTool(item.tool)}
                    >
                      <ToolGlyph tool={item.tool} className="h-5 w-5" />
                    </button>
                  ))}
                </div>

                <div className="mb-2 mt-3 px-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">形状</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {QUICK_SHAPE_ITEMS.map((shape) => (
                    <button
                      key={shape.id}
                      className={`flex h-9 items-center justify-center rounded-xl transition ${
                        activeTool === shape.tool && activeShapeVariant === shape.shapeVariant
                          ? 'bg-[#007aff]/12 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#4aa8ff]'
                          : 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
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
                  className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-black/[0.04] text-[13px] font-medium text-slate-600 transition hover:bg-black/[0.07] dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                  onClick={() => {
                    setShowLibrary(true);
                    setShowDrawPanel(false);
                  }}
                >
                  更多素材
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Divider() {
  return <div className="my-1 h-px w-6 bg-black/[0.07] dark:bg-white/10" />;
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
      className={`flex h-10 w-10 items-center justify-center rounded-[14px] transition ${
        active
          ? 'bg-[#007aff]/12 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#4aa8ff]'
          : 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
      }`}
      onClick={onClick}
      title={label}
    >
      {children}
    </button>
  );
}
