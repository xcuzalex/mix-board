import { useEffect, useState } from 'react';
import type { Element, KanbanElement } from '../types/element';
import { deleteKanbanColumn, insertKanbanColumn, kanbanHeight, kanbanLayout } from './structured';
import type { Viewport } from './viewport';

/**
 * On-board column controls for the selected kanban: a ⋯ on every column
 * header (insert left / right, delete) and a ＋ bar at the board's right edge
 * to append a column. Screen-space overlay that follows pan and zoom.
 */
export function KanbanControls({ board, viewport, onUpdate }: {
  board: KanbanElement;
  viewport: Viewport;
  onUpdate: (patch: Partial<Element>) => void;
}) {
  const [menu, setMenu] = useState<{ boardId: string; col: number } | null>(null);
  const open = menu?.boardId === board.id && menu.col < board.columns.length ? menu.col : null;

  const apply = (patch: Partial<KanbanElement> | null) => {
    if (patch) onUpdate(patch as Partial<Element>);
    setMenu(null);
  };

  // Escape or a click elsewhere closes the menu.
  useEffect(() => {
    if (open === null) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setMenu(null);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest('[data-kanban-menu]')) setMenu(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  const zoom = viewport.zoom;
  const layout = kanbanLayout(board);
  const origin = viewport.canvasToScreen(board.x, board.y);
  const width = board.width * zoom;
  const height = kanbanHeight(board) * zoom;
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <div className="pointer-events-none absolute inset-0 z-[15]" data-overlay-panel>
      {layout.columns.map((column, i) => {
        // Too narrow on screen (zoomed out / many columns): the ⋯ would cover the title.
        if (column.header.w * zoom < 110 && open !== i) return null;
        const header = viewport.canvasToScreen(column.header.x + column.header.w, column.header.y);
        const size = 22;
        return (
          <div
            key={board.columns[i]?.id ?? i}
            data-kanban-menu
            className="pointer-events-auto absolute"
            // Just left of the card count drawn at the header's right edge.
            style={{ left: header.x - 34 * zoom - size, top: header.y + (column.header.h * zoom - size) / 2 }}
          >
            <button
              type="button"
              title="列操作"
              aria-label={`第 ${i + 1} 列操作`}
              onPointerDown={stop}
              onClick={() => setMenu(open === i ? null : { boardId: board.id, col: i })}
              className={`flex items-center justify-center rounded-md text-slate-500 transition hover:bg-black/[0.06] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white ${
                open === i ? 'bg-black/[0.06] opacity-100 dark:bg-white/10' : 'opacity-60 hover:opacity-100'
              }`}
              style={{ width: size, height: size }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <circle cx="6" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="18" cy="12" r="1.7" />
              </svg>
            </button>
            {open === i && (
              <div
                role="menu"
                onPointerDown={stop}
                className="absolute left-0 top-full z-[2] mt-1 w-32 rounded-xl border border-black/[0.06] bg-white p-1 text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.14)] dark:border-white/10 dark:bg-[#2a2a2e]"
              >
                {[
                  { label: '左侧插入列', run: () => apply(insertKanbanColumn(board, i)) },
                  { label: '右侧插入列', run: () => apply(insertKanbanColumn(board, i + 1)) },
                ].map(({ label, run }) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onClick={run}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-black/[0.05] dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  disabled={board.columns.length <= 1}
                  title={board.columns[i]?.cards.length ? '卡片会移到相邻的列' : undefined}
                  onClick={() => apply(deleteKanbanColumn(board, i))}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
                >
                  删除列
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Append a column */}
      <button
        type="button"
        title="添加一列"
        aria-label="添加一列"
        onPointerDown={stop}
        onClick={() => apply(insertKanbanColumn(board, board.columns.length))}
        className="pointer-events-auto absolute flex items-center justify-center rounded-md bg-black/[0.04] text-[13px] text-slate-400 transition hover:bg-[#007aff]/15 hover:text-[#007aff] dark:bg-white/[0.06]"
        style={{ left: origin.x + width + 6, top: origin.y, width: 18, height }}
      >
        +
      </button>
    </div>
  );
}
