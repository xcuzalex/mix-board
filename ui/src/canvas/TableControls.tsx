import { useEffect, useState } from 'react';
import type { Element, TableElement } from '../types/element';
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, tableGrid } from './structured';
import type { Viewport } from './viewport';
import { isTypingTarget } from './clipboard';

/**
 * On-canvas controls for the selected table (like Lark / Notion):
 * - a grip beside every row and above every column; clicking one selects that
 *   row / column and offers insert-before / insert-after / delete
 *   (Delete / Backspace also removes it);
 * - a ＋ on every row / column boundary to insert there;
 * - a ＋ bar under the table and to its right to append a row / column.
 * Positioned in screen space over the canvas, so it follows pan and zoom.
 */
export function TableControls({ table, viewport, onUpdate }: {
  table: TableElement;
  viewport: Viewport;
  onUpdate: (patch: Partial<Element>) => void;
}) {
  const [selection, setSelection] = useState<{ tableId: string; kind: 'row' | 'col'; index: number } | null>(null);
  // Ignore a selection that no longer fits (the table shrank, e.g. after undo).
  const active = selection?.tableId === table.id
    && selection.index < (selection.kind === 'row' ? table.rows : table.columns)
    ? selection
    : null;

  const apply = (patch: Partial<TableElement> | null) => {
    if (patch) onUpdate(patch as Partial<Element>);
  };
  const deleteSelected = () => {
    if (!active) return;
    apply(active.kind === 'row' ? deleteTableRow(table, active.index) : deleteTableColumn(table, active.index));
    setSelection(null);
  };

  // Delete / Backspace removes the selected row or column (not the whole table);
  // Escape clears the selection. Capture phase, so canvas shortcuts don't also run.
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopImmediatePropagation();
        deleteSelected();
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  const { xs, ws, ys, hs } = tableGrid(table);
  const zoom = viewport.zoom;
  const origin = viewport.canvasToScreen(table.x, table.y);
  const left = origin.x;
  const top = origin.y;
  const width = table.width * zoom;
  const height = table.height * zoom;
  const rowTop = (r: number) => top + (ys[r] - table.y) * zoom;
  const colLeft = (c: number) => left + (xs[c] - table.x) * zoom;
  const GRIP = 14;
  const GAP = 6;

  const grip = 'absolute rounded-[4px] transition-colors';
  const gripIdle = 'bg-black/[0.06] hover:bg-[#007aff]/40 dark:bg-white/10';
  const gripOn = 'bg-[#007aff]';
  const plus = 'absolute z-[2] flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#007aff] text-[12px] leading-none text-white opacity-25 shadow transition hover:scale-110 hover:opacity-100 focus-visible:opacity-100';
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <div className="pointer-events-none absolute inset-0 z-[15]" data-overlay-panel>
      {/* Selected row / column highlight */}
      {active && (
        <div
          className="absolute rounded-sm bg-[#007aff]/10 ring-2 ring-inset ring-[#007aff]"
          style={active.kind === 'row'
            ? { left, top: rowTop(active.index), width, height: hs[active.index] * zoom }
            : { left: colLeft(active.index), top, width: ws[active.index] * zoom, height }}
        />
      )}

      {/* Row grips + boundary inserts */}
      {ys.map((_, r) => (
        <button
          key={`row-${r}`}
          type="button"
          title={`选择第 ${r + 1} 行`}
          aria-label={`选择第 ${r + 1} 行`}
          onPointerDown={stop}
          onClick={() => setSelection(active?.kind === 'row' && active.index === r ? null : { tableId: table.id, kind: 'row', index: r })}
          className={`pointer-events-auto ${grip} ${active?.kind === 'row' && active.index === r ? gripOn : gripIdle}`}
          style={{ left: left - GRIP - GAP, top: rowTop(r) + 3, width: GRIP - 6, height: Math.max(8, hs[r] * zoom - 6) }}
        />
      ))}
      {ys.slice(0, -1).map((_, r) => (
        <button
          key={`row-plus-${r}`}
          type="button"
          title={`在第 ${r + 1} 行下方插入行`}
          aria-label={`在第 ${r + 1} 行下方插入行`}
          onPointerDown={stop}
          onClick={() => apply(insertTableRow(table, r + 1))}
          className={`pointer-events-auto ${plus}`}
          style={{ left: left - GRIP / 2 - GAP, top: rowTop(r) + hs[r] * zoom }}
        >
          +
        </button>
      ))}

      {/* Column grips + boundary inserts */}
      {xs.map((_, c) => (
        <button
          key={`col-${c}`}
          type="button"
          title={`选择第 ${c + 1} 列`}
          aria-label={`选择第 ${c + 1} 列`}
          onPointerDown={stop}
          onClick={() => setSelection(active?.kind === 'col' && active.index === c ? null : { tableId: table.id, kind: 'col', index: c })}
          className={`pointer-events-auto ${grip} ${active?.kind === 'col' && active.index === c ? gripOn : gripIdle}`}
          style={{ left: colLeft(c) + 3, top: top - GRIP - GAP, width: Math.max(8, ws[c] * zoom - 6), height: GRIP - 6 }}
        />
      ))}
      {xs.slice(0, -1).map((_, c) => (
        <button
          key={`col-plus-${c}`}
          type="button"
          title={`在第 ${c + 1} 列右侧插入列`}
          aria-label={`在第 ${c + 1} 列右侧插入列`}
          onPointerDown={stop}
          onClick={() => apply(insertTableColumn(table, c + 1))}
          className={`pointer-events-auto ${plus}`}
          style={{ left: colLeft(c) + ws[c] * zoom, top: top - GRIP / 2 - GAP }}
        >
          +
        </button>
      ))}

      {/* Append bars */}
      <button
        type="button"
        title="添加一行"
        aria-label="添加一行"
        onPointerDown={stop}
        onClick={() => apply(insertTableRow(table, table.rows))}
        className="pointer-events-auto absolute flex items-center justify-center rounded-md bg-black/[0.04] text-[13px] text-slate-400 transition hover:bg-[#007aff]/15 hover:text-[#007aff] dark:bg-white/[0.06]"
        style={{ left, top: top + height + GAP, width, height: 18 }}
      >
        +
      </button>
      <button
        type="button"
        title="添加一列"
        aria-label="添加一列"
        onPointerDown={stop}
        onClick={() => apply(insertTableColumn(table, table.columns))}
        className="pointer-events-auto absolute flex items-center justify-center rounded-md bg-black/[0.04] text-[13px] text-slate-400 transition hover:bg-[#007aff]/15 hover:text-[#007aff] dark:bg-white/[0.06]"
        style={{ left: left + width + GAP, top, width: 18, height }}
      >
        +
      </button>

      {/* Actions for the selected row / column */}
      {active && (
        <div
          className="pointer-events-auto absolute flex -translate-y-full items-center gap-0.5 rounded-xl border border-black/[0.06] bg-white/95 p-1 text-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur dark:border-white/10 dark:bg-[#2a2a2e]/95"
          style={active.kind === 'row'
            ? { left, top: rowTop(active.index) - 6 }
            : { left: colLeft(active.index), top: top - GRIP - GAP - 6 }}
          onPointerDown={stop}
        >
          {(active.kind === 'row'
            ? [
                // Nothing goes above a header row (insertTableRow keeps it first).
                ...(table.headerRow && active.index === 0
                  ? []
                  : [{ label: '上方插入', run: () => apply(insertTableRow(table, active.index)) }]),
                { label: '下方插入', run: () => apply(insertTableRow(table, active.index + 1)) },
              ]
            : [
                { label: '左侧插入', run: () => apply(insertTableColumn(table, active.index)) },
                { label: '右侧插入', run: () => apply(insertTableColumn(table, active.index + 1)) },
              ]
          ).map(({ label, run }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                run();
                setSelection(null);
              }}
              className="rounded-lg px-2 py-1 text-slate-600 hover:bg-black/[0.05] dark:text-slate-300 dark:hover:bg-white/10"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={active.kind === 'row' ? table.rows <= 1 : table.columns <= 1}
            onClick={deleteSelected}
            className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
          >
            {active.kind === 'row' ? '删除行' : '删除列'}
          </button>
        </div>
      )}
    </div>
  );
}
