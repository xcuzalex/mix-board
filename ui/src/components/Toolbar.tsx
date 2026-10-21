import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createElementForTool } from '../canvas/interaction';
import { createNoteCard } from '../canvas/note-card';
import { useDocumentStore } from '../store/document';
import { getViewportCenter, useUIStore } from '../store/ui';
import type { ShapeVariant } from '../types/element';
import type { ToolType } from '../types/tool';
import { SHAPE_LIBRARY_SECTIONS, ToolGlyph, isShapeToolActive, type LibraryItem } from './shapeLibrary';
import { ShapePicker } from './ShapePicker';

// Note-first toolbar, docked top-center like Freeform: note tools up front,
// drawing tools tucked into a "绘图" flyout. It slides away while you work on
// the canvas and comes back when the pointer nears the top edge (unless pinned).
const NOTE_TOOLS: Array<{ tool: ToolType; label: string }> = [
  { tool: 'text', label: '文本' },
  { tool: 'sticky_note', label: '便签' },
  { tool: 'mindmap', label: '脑图' },
  { tool: 'frame', label: '框架' },
];

const DRAW_TOOL_SET = new Set<ToolType>(['arrow', 'line', 'freedraw', 'section', 'image']);

/** Structured note blocks (the library's 结构 section); they keep their own default size when inserted. */
const STRUCTURE_ITEMS: LibraryItem[] = SHAPE_LIBRARY_SECTIONS.find((section) => section.title === '结构')?.items ?? [];
const STRUCTURE_TOOLS = new Set<ToolType>(STRUCTURE_ITEMS.map((item) => item.tool));

// Pre-rename key, kept so the saved preference survives.
const PIN_STORAGE_KEY = 'mixboard.toolbar.pinned';
const REVEAL_ZONE_PX = 60;
const AUTO_HIDE_DELAY_MS = 900;
const INITIAL_SHOW_MS = 2500;
const TOOL_FLASH_MS = 1200;

export function Toolbar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const showOutline = useUIStore((s) => s.showOutline);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const activeShapeVariant = useUIStore((s) => s.activeShapeVariant);
  const setActiveShapeVariant = useUIStore((s) => s.setActiveShapeVariant);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const addElement = useDocumentStore((s) => s.addElement);
  const pushHistory = useDocumentStore((s) => s.pushHistory);

  const [showDrawPanel, setShowDrawPanel] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const structureRef = useRef<HTMLDivElement | null>(null);
  const structureTimerRef = useRef<number | null>(null);
  // Hover opens the structure menu (like the drawing tools); leaving closes it
  // after a short grace period so the pointer can travel into the menu.
  const openStructure = () => {
    if (structureTimerRef.current !== null) window.clearTimeout(structureTimerRef.current);
    structureTimerRef.current = null;
    setShowStructure(true);
  };
  const scheduleCloseStructure = () => {
    if (structureTimerRef.current !== null) window.clearTimeout(structureTimerRef.current);
    structureTimerRef.current = window.setTimeout(() => {
      structureTimerRef.current = null;
      setShowStructure(false);
    }, 160);
  };
  const drawPanelRef = useRef<HTMLDivElement | null>(null);
  // Typing in the shape search keeps the flyout open even if the pointer wanders off.
  const searchFocusedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hoveringRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(PIN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

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
    if (searchFocusedRef.current) return;
    closeTimerRef.current = window.setTimeout(() => {
      setShowDrawPanel(false);
      closeTimerRef.current = null;
    }, 160);
  };

  useEffect(() => () => {
    clearCloseTimer();
    if (structureTimerRef.current !== null) window.clearTimeout(structureTimerRef.current);
  }, []);

  const keepOpen = pinned || showDrawPanel || showStructure;

  // The structure menu closes on any click outside it, or Escape.
  useEffect(() => {
    if (!showStructure) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (!structureRef.current?.contains(e.target as Node)) setShowStructure(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowStructure(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showStructure]);

  // The drawing flyout also closes on a click outside it, or Escape.
  useEffect(() => {
    if (!showDrawPanel) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (!drawPanelRef.current?.contains(e.target as Node)) {
        searchFocusedRef.current = false;
        setShowDrawPanel(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDrawPanel(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showDrawPanel]);

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = useCallback((delay = AUTO_HIDE_DELAY_MS) => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (!hoveringRef.current) setRevealed(false);
    }, delay);
  }, []);

  const reveal = useCallback((thenHideAfter?: number) => {
    setRevealed(true);
    if (thenHideAfter !== undefined) scheduleHide(thenHideAfter);
    else if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, [scheduleHide]);

  // Reveal near the top edge of the canvas; hide again once the pointer leaves.
  useEffect(() => {
    if (keepOpen) {
      setRevealed(true);
      return;
    }
    scheduleHide(INITIAL_SHOW_MS);
    const onMove = (event: PointerEvent) => {
      // The wrapper never moves (only the inner bar slides), so its top marks the dock.
      const top = rootRef.current?.getBoundingClientRect().top ?? 0;
      const nearTop = event.clientY < top + REVEAL_ZONE_PX && event.buttons === 0;
      if (nearTop) reveal();
      else if (!hoveringRef.current && hideTimerRef.current === null) scheduleHide();
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      clearHideTimer();
    };
  }, [keepOpen, reveal, scheduleHide]);

  // Keyboard tool switches briefly show which tool is now active.
  const lastToolRef = useRef(activeTool);
  useEffect(() => {
    if (lastToolRef.current === activeTool) return;
    lastToolRef.current = activeTool;
    if (!keepOpen && !hoveringRef.current) reveal(TOOL_FLASH_MS);
  }, [activeTool, keepOpen, reveal]);

  const togglePinned = () => {
    setPinned((value) => {
      const next = !value;
      try {
        localStorage.setItem(PIN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Pinning is a per-viewer convenience; ignore storage failures.
      }
      return next;
    });
  };

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



  const insertItem = (item: LibraryItem) => {
    if (item.tool === 'image') {
      setActiveTool('image');
      return false;
    }

    const center = getViewportCenter();
    const element = createElementForTool(item.tool, center.x, center.y, { shapeVariant: item.shapeVariant });
    if (!element) return false;

    if (!STRUCTURE_TOOLS.has(item.tool)) {
      const { width, height } = getInsertSize(item.tool, item.shapeVariant);
      element.width = width;
      element.height = height;
    }
    element.x = center.x - element.width / 2;
    element.y = center.y - element.height / 2;

    pushHistory();
    addElement(element);
    // A matrix is a backdrop for notes: put it behind existing content so it
    // never hides (or steals clicks from) notes it is dropped onto.
    if (element.type === 'matrix') useDocumentStore.getState().sendToBack([element.id]);
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
    searchFocusedRef.current = false;
    setShowDrawPanel(false);
  };

  const pickTool = (tool: ToolType) => {
    setActiveTool(tool);
    setShowDrawPanel(false);
  };

  // One-click insert a clean white Markdown note card.
  const insertCard = () => {
    const element = createNoteCard('# 标题\n正文，支持 **粗体**、*斜体*、`代码`\n- 列表项\n[ ] 待办', getViewportCenter(), 300);
    if (!element) return;
    pushHistory();
    addElement(element);
    setSelectedIds([element.id]);
    setActiveTool('select');
  };

  const drawActive = isShapeToolActive(activeTool) || DRAW_TOOL_SET.has(activeTool);
  const shown = revealed || keepOpen;

  return (
    <>
      <div
        ref={rootRef}
        data-overlay-panel
        // With the outline open, centre in the space to its right so it never covers the tools.
        className={`absolute top-3 z-20 -translate-x-1/2 transition-[left] duration-200 ${showOutline ? 'left-[calc(50%+9.5rem)]' : 'left-1/2'}`}
        onMouseEnter={() => {
          hoveringRef.current = true;
          reveal();
        }}
        onMouseLeave={() => {
          hoveringRef.current = false;
          if (!keepOpen) scheduleHide();
        }}
      >
        {/* Slim handle left behind while the toolbar is tucked away */}
        <button
          aria-label="显示工具栏"
          className={`absolute left-1/2 top-0 h-5 w-16 -translate-x-1/2 transition-opacity duration-200 ${shown ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          onClick={() => reveal()}
        >
          <span className="mx-auto block h-1 w-9 rounded-full bg-black/15 dark:bg-white/20" />
        </button>

        <div
          // Hidden tools must not be reachable by Tab either.
          inert={!shown}
          className={`flex items-center gap-0.5 rounded-[18px] border border-black/[0.06] bg-white/75 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_30px_rgba(0,0,0,0.10)] backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] dark:border-white/10 dark:bg-[#1c1c1e]/75 ${
            shown ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-[calc(100%+16px)] opacity-0'
          }`}
        >
          <ToolbarButton active={activeTool === 'select'} label="选择" onClick={() => pickTool('select')}>
            <ToolGlyph tool="select" className="h-5 w-5" />
          </ToolbarButton>
          <ToolbarButton active={activeTool === 'hand'} label="抓手" onClick={() => pickTool('hand')}>
            <ToolGlyph tool="hand" className="h-5 w-5" />
          </ToolbarButton>

          <Divider />

          <ToolbarButton active={false} label="卡片（Markdown 笔记）" onClick={insertCard}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2.5" />
              <path d="M8 9h8M8 13h8M8 17h5" />
            </svg>
          </ToolbarButton>

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

          {/* Structured blocks: table, kanban, 2×2 matrix, code */}
          <div ref={structureRef} className="relative" onMouseEnter={openStructure} onMouseLeave={scheduleCloseStructure}>
            <ToolbarButton active={showStructure} label="表格与结构" onClick={openStructure}>
              <ToolGlyph tool="table" className="h-5 w-5" />
            </ToolbarButton>
            {showStructure && (
              <div
                role="menu"
                className="absolute left-1/2 top-full mt-3 w-44 -translate-x-1/2 rounded-[16px] border border-black/[0.06] bg-white/85 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/90"
              >
                {STRUCTURE_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      insertItem(item);
                      setShowStructure(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-slate-700 transition hover:bg-black/[0.05] dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    <ToolGlyph tool={item.tool} className="h-[18px] w-[18px] text-slate-500 dark:text-slate-400" />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Divider />

          {/* Drawing tools — tucked into a secondary flyout */}
          <div ref={drawPanelRef} className="relative" onMouseEnter={openDrawPanel} onMouseLeave={scheduleCloseDrawPanel}>
            <ToolbarButton
              active={drawActive}
              label="绘图工具"
              onClick={() => {
                if (!drawActive) setActiveTool('rectangle');
                // Hover already opens it; a click must not toggle it shut again.
                setShowDrawPanel(true);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15.5 4.5l4 4L8 20l-4 1 1-4z" />
                <path d="M13.5 6.5l4 4" />
              </svg>
            </ToolbarButton>

            {showDrawPanel && (
              <div className="absolute left-1/2 top-full mt-3 -translate-x-1/2 overflow-hidden rounded-[20px] border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#1c1c1e]">
                <ShapePicker
                  activeTool={activeTool}
                  activeShapeVariant={activeShapeVariant}
                  onPickTool={pickTool}
                  onSelectItem={(item) => {
                    selectItem(item);
                    clearCloseTimer();
                  }}
                  onSearchFocusChange={(focused) => {
                    searchFocusedRef.current = focused;
                  }}
                />
              </div>
            )}
          </div>

          <Divider />

          <ToolbarButton active={pinned} label={pinned ? '取消固定（自动隐藏）' : '固定工具栏'} onClick={togglePinned}>
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4h6l-1 5 3 3H7l3-3z" />
              <path d="M12 12v8" />
            </svg>
          </ToolbarButton>
        </div>
      </div>
    </>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-black/[0.07] dark:bg-white/10" />;
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
      className={`flex h-9 w-9 items-center justify-center rounded-[12px] transition ${
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
