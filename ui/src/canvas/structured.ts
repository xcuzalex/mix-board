/**
 * Structured note elements — table, kanban, 2×2 matrix and code card.
 *
 * Their content lives inside the element and is edited one "slot" at a time
 * (a table cell, a kanban card or column title, a matrix label, the code).
 * This module is the pure model: layout geometry, slot hit-testing, slot text
 * get/apply (with auto-fit sizing), factories and structure edits. Drawing is
 * in ./render/structured; the canvas only wires slots to its text editor.
 */
import type {
  CodeElement,
  Element,
  KanbanColumn,
  KanbanElement,
  MatrixElement,
  TableCell,
  TableElement,
} from '../types/element';
import { generateId } from '../utils/id';
import { measureMarkdown } from './render/markdown';

export const STRUCTURED_FONT = "Inter, system-ui, -apple-system, 'PingFang SC', sans-serif";
export const CODE_FONT = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";

export type EditSlot =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'column'; col: number }
  | { kind: 'card'; col: number; card: number }
  | { kind: 'title' }
  | { kind: 'quadrant'; index: number }
  | { kind: 'axis'; axis: 'x' | 'y'; end: 0 | 1 }
  | { kind: 'code' };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// --- Table -----------------------------------------------------------------

export const TABLE_CELL_PAD = 10;
export const TABLE_FONT_SIZE = 14;
const TABLE_MIN_ROW = 36;
const TABLE_DEFAULT_COL = 140;

export function makeTableCell(text = ''): TableCell {
  return { text, backgroundColor: 'transparent', textColor: '', fontSize: TABLE_FONT_SIZE, textAlign: 'left', fontWeight: 'normal' };
}

/** Column x-offsets / widths and row y-offsets / heights scaled to the element box. */
export function tableGrid(el: TableElement) {
  const sumW = el.columnWidths.reduce((a, b) => a + b, 0) || 1;
  const sumH = el.rowHeights.reduce((a, b) => a + b, 0) || 1;
  const sx = el.width / sumW;
  const sy = el.height / sumH;
  const xs: number[] = [];
  const ws: number[] = [];
  let x = el.x;
  for (const w of el.columnWidths) {
    xs.push(x);
    ws.push(w * sx);
    x += w * sx;
  }
  const ys: number[] = [];
  const hs: number[] = [];
  let y = el.y;
  for (const h of el.rowHeights) {
    ys.push(y);
    hs.push(h * sy);
    y += h * sy;
  }
  return { xs, ws, ys, hs };
}

export function tableCellRect(el: TableElement, row: number, col: number): Rect {
  const { xs, ws, ys, hs } = tableGrid(el);
  return { x: xs[col], y: ys[row], w: ws[col], h: hs[row] };
}

export function tableCellAt(el: TableElement, x: number, y: number): { row: number; col: number } | null {
  const { xs, ws, ys, hs } = tableGrid(el);
  const col = xs.findIndex((cx, i) => x >= cx && x <= cx + ws[i]);
  const row = ys.findIndex((cy, i) => y >= cy && y <= cy + hs[i]);
  return row >= 0 && col >= 0 ? { row, col } : null;
}

/**
 * Grows rows to fit their content at the current column widths. Rows keep any
 * extra height they already have (e.g. from resizing the table taller).
 */
function fitTable(el: TableElement): Partial<TableElement> {
  const { ws, hs } = tableGrid(el);
  const rowHeights = el.cells.map((row, r) => {
    let needed = Math.max(TABLE_MIN_ROW, hs[r] ?? 0);
    row.forEach((cell, c) => {
      if (!cell.text) return;
      const { height } = measureMarkdown(cell.text, {
        width: Math.max(20, ws[c] - TABLE_CELL_PAD * 2),
        fontSize: cell.fontSize || TABLE_FONT_SIZE,
        fontFamily: STRUCTURED_FONT,
      });
      needed = Math.max(needed, Math.ceil(height + TABLE_CELL_PAD * 2));
    });
    return needed;
  });
  return {
    columnWidths: ws,
    rowHeights,
    width: ws.reduce((a, b) => a + b, 0),
    height: rowHeights.reduce((a, b) => a + b, 0),
  };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Applies a structural edit in on-screen units, then re-fits row heights. */
function reshapeTable(
  el: TableElement,
  edit: (grid: { cells: TableCell[][]; ws: number[]; hs: number[] }) => void,
): Partial<TableElement> {
  const { ws, hs } = tableGrid(el);
  const grid = { cells: el.cells.map((r) => r.map((c) => ({ ...c }))), ws: [...ws], hs: [...hs] };
  edit(grid);
  const next: TableElement = {
    ...el,
    cells: grid.cells,
    rows: grid.cells.length,
    columns: grid.ws.length,
    columnWidths: grid.ws,
    rowHeights: grid.hs,
    width: sum(grid.ws),
    height: sum(grid.hs),
  };
  return { ...fitTable(next), cells: next.cells, rows: next.rows, columns: next.columns };
}

export function insertTableRow(el: TableElement, at: number): Partial<TableElement> {
  // The header always stays the first row.
  if (el.headerRow && at === 0) at = 1;
  return reshapeTable(el, (g) => {
    g.cells.splice(at, 0, Array.from({ length: el.columns }, () => makeTableCell()));
    g.hs.splice(at, 0, TABLE_MIN_ROW);
  });
}

export function insertTableColumn(el: TableElement, at: number): Partial<TableElement> {
  return reshapeTable(el, (g) => {
    for (const row of g.cells) row.splice(at, 0, makeTableCell());
    if (el.headerRow && g.cells[0]) g.cells[0][at].fontWeight = 'bold';
    g.ws.splice(at, 0, TABLE_DEFAULT_COL);
  });
}

export function deleteTableRow(el: TableElement, at: number): Partial<TableElement> | null {
  if (el.rows <= 1) return null;
  return reshapeTable(el, (g) => {
    g.cells.splice(at, 1);
    g.hs.splice(at, 1);
  });
}

export function deleteTableColumn(el: TableElement, at: number): Partial<TableElement> | null {
  if (el.columns <= 1) return null;
  return reshapeTable(el, (g) => {
    for (const row of g.cells) row.splice(at, 1);
    g.ws.splice(at, 1);
  });
}

// --- Kanban ----------------------------------------------------------------

export const KANBAN = {
  pad: 12,
  titleH: 40,
  headerH: 36,
  gap: 12,
  cardGap: 8,
  cardPad: 10,
  addH: 30,
  fontSize: 14,
  minCardH: 40,
} as const;

export const KANBAN_COLORS = ['#8E8E93', '#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF2D55'];

export interface KanbanLayout {
  title: Rect;
  columns: Array<{ rect: Rect; header: Rect; cards: Rect[]; add: Rect }>;
  /** Height the board needs to show every card. */
  contentHeight: number;
}

const kanbanLayoutCache = new WeakMap<KanbanElement, KanbanLayout>();

export function kanbanLayout(el: KanbanElement): KanbanLayout {
  const cached = kanbanLayoutCache.get(el);
  if (cached) return cached;
  const n = Math.max(1, el.columns.length);
  const colW = (el.width - KANBAN.pad * 2 - KANBAN.gap * (n - 1)) / n;
  const top = el.y + KANBAN.titleH;
  let tallest = 0;
  const columns = el.columns.map((column, i) => {
    const x = el.x + KANBAN.pad + i * (colW + KANBAN.gap);
    const header: Rect = { x, y: top, w: colW, h: KANBAN.headerH };
    let y = top + KANBAN.headerH + KANBAN.cardGap;
    const cards = column.cards.map((card) => {
      const { height } = measureMarkdown(card.text || ' ', {
        width: Math.max(20, colW - KANBAN.cardPad * 2),
        fontSize: KANBAN.fontSize,
        fontFamily: STRUCTURED_FONT,
      });
      const h = Math.max(KANBAN.minCardH, Math.ceil(height + KANBAN.cardPad * 2));
      const rect = { x, y, w: colW, h };
      y += h + KANBAN.cardGap;
      return rect;
    });
    const add: Rect = { x, y, w: colW, h: KANBAN.addH };
    tallest = Math.max(tallest, y + KANBAN.addH - el.y);
    return { rect: { x, y: top, w: colW, h: 0 }, header, cards, add };
  });
  const contentHeight = tallest + KANBAN.pad;
  const bottom = el.y + Math.max(el.height, contentHeight) - KANBAN.pad;
  for (const c of columns) c.rect.h = bottom - c.rect.y;
  const layout = { title: { x: el.x + KANBAN.pad, y: el.y + 6, w: el.width - KANBAN.pad * 2, h: KANBAN.titleH - 8 }, columns, contentHeight };
  kanbanLayoutCache.set(el, layout);
  return layout;
}

export type KanbanHit =
  | { kind: 'title' }
  | { kind: 'column'; col: number }
  | { kind: 'card'; col: number; card: number }
  | { kind: 'add'; col: number }
  | { kind: 'body'; col: number };

export function kanbanHitAt(el: KanbanElement, x: number, y: number): KanbanHit | null {
  const layout = kanbanLayout(el);
  if (inside(layout.title, x, y)) return { kind: 'title' };
  for (let col = 0; col < layout.columns.length; col++) {
    const c = layout.columns[col];
    if (inside(c.header, x, y)) return { kind: 'column', col };
    const card = c.cards.findIndex((r) => inside(r, x, y));
    if (card >= 0) return { kind: 'card', col, card };
    if (inside(c.add, x, y)) return { kind: 'add', col };
    if (inside(c.rect, x, y)) return { kind: 'body', col };
  }
  return null;
}

/** Where a card dragged to (x, y) would land: column and insertion index. */
export function kanbanDropAt(el: KanbanElement, x: number, y: number): { col: number; index: number } {
  const layout = kanbanLayout(el);
  let col = 0;
  let best = Infinity;
  layout.columns.forEach((c, i) => {
    const d = Math.abs(x - (c.rect.x + c.rect.w / 2));
    if (d < best) {
      best = d;
      col = i;
    }
  });
  const cards = layout.columns[col]?.cards ?? [];
  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    if (y < cards[i].y + cards[i].h / 2) {
      index = i;
      break;
    }
  }
  return { col, index };
}

export function moveKanbanCard(el: KanbanElement, from: { col: number; card: number }, to: { col: number; index: number }): KanbanColumn[] {
  const columns = el.columns.map((c) => ({ ...c, cards: [...c.cards] }));
  const [card] = columns[from.col].cards.splice(from.card, 1);
  if (!card) return el.columns;
  let index = to.index;
  if (to.col === from.col && from.card < index) index -= 1;
  columns[to.col].cards.splice(index, 0, card);
  return columns;
}

/** Grows the board to fit its cards (never shrinks a board the user made bigger). */
export function fitKanban(el: KanbanElement, columns: KanbanColumn[]): Partial<KanbanElement> {
  const next = { ...el, columns };
  const { contentHeight } = kanbanLayout(next);
  return { columns, height: Math.max(el.height, contentHeight) };
}

export function addKanbanCard(el: KanbanElement, col: number): { patch: Partial<KanbanElement>; card: number } {
  const columns = el.columns.map((c, i) => (i === col ? { ...c, cards: [...c.cards, { id: generateId(), text: '' }] } : c));
  return { patch: fitKanban(el, columns), card: columns[col].cards.length - 1 };
}

export function addKanbanColumn(el: KanbanElement): Partial<KanbanElement> {
  const colW = (el.width - KANBAN.pad * 2 - KANBAN.gap * (el.columns.length - 1)) / Math.max(1, el.columns.length);
  const color = KANBAN_COLORS[el.columns.length % KANBAN_COLORS.length];
  return {
    columns: [...el.columns, { id: generateId(), title: '新的一列', color, cards: [] }],
    width: el.width + colW + KANBAN.gap,
  };
}

/** Removes the last column; its cards move to the column before it (never lost). */
export function removeKanbanColumn(el: KanbanElement): Partial<KanbanElement> | null {
  if (el.columns.length <= 1) return null;
  const colW = (el.width - KANBAN.pad * 2 - KANBAN.gap * (el.columns.length - 1)) / el.columns.length;
  const removed = el.columns[el.columns.length - 1];
  const columns = el.columns.slice(0, -1).map((c, i, list) => (
    i === list.length - 1 ? { ...c, cards: [...c.cards, ...removed.cards] } : c
  ));
  const width = el.width - colW - KANBAN.gap;
  return { ...fitKanban({ ...el, width }, columns), width };
}

/** The board's real height: never less than what its cards need. */
export function kanbanHeight(el: KanbanElement): number {
  return Math.max(el.height, kanbanLayout(el).contentHeight);
}

// --- Matrix ----------------------------------------------------------------

export const MATRIX = { titleH: 40, axisW: 28, axisH: 28, pad: 12, labelH: 30 } as const;

export const MATRIX_PRESETS = {
  priority: {
    label: '优先级矩阵',
    title: '优先级矩阵',
    quadrants: ['重要且紧急', '重要不紧急', '紧急不重要', '不重要不紧急'] as [string, string, string, string],
    xAxis: ['紧急程度低', '紧急程度高'] as [string, string],
    yAxis: ['重要性低', '重要性高'] as [string, string],
  },
  swot: {
    label: 'SWOT 分析',
    title: 'SWOT 分析',
    quadrants: ['优势 Strengths', '劣势 Weaknesses', '机会 Opportunities', '威胁 Threats'] as [string, string, string, string],
    xAxis: ['有利', '不利'] as [string, string],
    yAxis: ['外部', '内部'] as [string, string],
  },
  effort: {
    label: '投入产出',
    title: '投入产出矩阵',
    quadrants: ['重点投入', '快速见效', '谨慎评估', '暂缓'] as [string, string, string, string],
    xAxis: ['投入低', '投入高'] as [string, string],
    yAxis: ['价值低', '价值高'] as [string, string],
  },
};

export const MATRIX_COLORS: [string, string, string, string] = ['#FF3B30', '#007AFF', '#FF9500', '#8E8E93'];

export function matrixLayout(el: MatrixElement) {
  const grid: Rect = {
    x: el.x + MATRIX.pad + MATRIX.axisW,
    y: el.y + MATRIX.titleH,
    w: el.width - MATRIX.pad * 2 - MATRIX.axisW,
    h: el.height - MATRIX.titleH - MATRIX.pad - MATRIX.axisH,
  };
  const hw = grid.w / 2;
  const hh = grid.h / 2;
  const quadrants: Rect[] = [
    { x: grid.x, y: grid.y, w: hw, h: hh },
    { x: grid.x + hw, y: grid.y, w: hw, h: hh },
    { x: grid.x, y: grid.y + hh, w: hw, h: hh },
    { x: grid.x + hw, y: grid.y + hh, w: hw, h: hh },
  ];
  const labels = quadrants.map((q) => ({ x: q.x + 10, y: q.y + 8, w: q.w - 20, h: MATRIX.labelH }));
  const title: Rect = { x: el.x + MATRIX.pad, y: el.y + 6, w: el.width - MATRIX.pad * 2, h: MATRIX.titleH - 8 };
  const axisY = grid.y + grid.h + 4;
  const xAxis: [Rect, Rect] = [
    { x: grid.x, y: axisY, w: hw, h: MATRIX.axisH - 6 },
    { x: grid.x + hw, y: axisY, w: hw, h: MATRIX.axisH - 6 },
  ];
  // y-axis labels run along the left edge (drawn rotated); hit areas are the strips.
  const yAxis: [Rect, Rect] = [
    { x: el.x + MATRIX.pad, y: grid.y + hh, w: MATRIX.axisW - 4, h: hh },
    { x: el.x + MATRIX.pad, y: grid.y, w: MATRIX.axisW - 4, h: hh },
  ];
  return { grid, quadrants, labels, title, xAxis, yAxis };
}

export function matrixSlotAt(el: MatrixElement, x: number, y: number): EditSlot | null {
  const l = matrixLayout(el);
  if (inside(l.title, x, y)) return { kind: 'title' };
  const label = l.labels.findIndex((r) => inside(r, x, y));
  if (label >= 0) return { kind: 'quadrant', index: label };
  for (const end of [0, 1] as const) {
    if (inside(l.xAxis[end], x, y)) return { kind: 'axis', axis: 'x', end };
    if (inside(l.yAxis[end], x, y)) return { kind: 'axis', axis: 'y', end };
  }
  return null;
}

// --- Code ------------------------------------------------------------------

export const CODE = { headerH: 32, pad: 14, lineHeight: 1.55 } as const;

export const CODE_LANGUAGES = [
  'plaintext', 'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c', 'cpp',
  'swift', 'kotlin', 'sql', 'bash', 'json', 'yaml', 'html', 'css', 'markdown',
];

export function codeBodyRect(el: CodeElement): Rect {
  return { x: el.x, y: el.y + CODE.headerH, w: el.width, h: el.height - CODE.headerH };
}

function fitCode(el: CodeElement, code: string): Partial<CodeElement> {
  const lines = Math.max(1, code.split('\n').length);
  const height = CODE.headerH + CODE.pad * 2 + lines * el.fontSize * CODE.lineHeight;
  return { code, height: Math.ceil(height) };
}

// --- Slots -------------------------------------------------------------------

/** The editable slot under (x, y), if any. */
export function slotAt(el: Element, x: number, y: number): EditSlot | null {
  switch (el.type) {
    case 'table': {
      const cell = tableCellAt(el, x, y);
      return cell ? { kind: 'cell', ...cell } : null;
    }
    case 'kanban': {
      const hit = kanbanHitAt(el, x, y);
      if (!hit) return null;
      if (hit.kind === 'title') return { kind: 'title' };
      if (hit.kind === 'column') return { kind: 'column', col: hit.col };
      if (hit.kind === 'card') return { kind: 'card', col: hit.col, card: hit.card };
      return null;
    }
    case 'matrix':
      return matrixSlotAt(el, x, y);
    case 'code':
      return { kind: 'code' };
    default:
      return null;
  }
}

export function slotRect(el: Element, slot: EditSlot): Rect | null {
  if (el.type === 'table' && slot.kind === 'cell') {
    if (slot.row >= el.rows || slot.col >= el.columns) return null;
    return tableCellRect(el, slot.row, slot.col);
  }
  if (el.type === 'kanban') {
    const layout = kanbanLayout(el);
    if (slot.kind === 'title') return layout.title;
    if (slot.kind === 'column') return layout.columns[slot.col]?.header ?? null;
    if (slot.kind === 'card') return layout.columns[slot.col]?.cards[slot.card] ?? null;
  }
  if (el.type === 'matrix') {
    const l = matrixLayout(el);
    if (slot.kind === 'title') return l.title;
    if (slot.kind === 'quadrant') return l.labels[slot.index];
    if (slot.kind === 'axis') {
      // y-axis labels are edited horizontally next to their strip.
      const r = slot.axis === 'x' ? l.xAxis[slot.end] : l.yAxis[slot.end];
      return slot.axis === 'x' ? r : { x: r.x, y: r.y + r.h / 2 - 14, w: 140, h: 28 };
    }
  }
  if (el.type === 'code' && slot.kind === 'code') return codeBodyRect(el);
  return null;
}

export function getSlotText(el: Element, slot: EditSlot): string {
  if (el.type === 'table' && slot.kind === 'cell') return el.cells[slot.row]?.[slot.col]?.text ?? '';
  if (el.type === 'kanban') {
    if (slot.kind === 'title') return el.title;
    if (slot.kind === 'column') return el.columns[slot.col]?.title ?? '';
    if (slot.kind === 'card') return el.columns[slot.col]?.cards[slot.card]?.text ?? '';
  }
  if (el.type === 'matrix') {
    if (slot.kind === 'title') return el.title;
    if (slot.kind === 'quadrant') return el.quadrants[slot.index] ?? '';
    if (slot.kind === 'axis') return (slot.axis === 'x' ? el.xAxis : el.yAxis)[slot.end] ?? '';
  }
  if (el.type === 'code' && slot.kind === 'code') return el.code;
  return '';
}

/** The element patch that stores `text` into `slot` (re-fitting sizes). */
export function applySlotText(el: Element, slot: EditSlot, text: string): Partial<Element> | null {
  if (el.type === 'table' && slot.kind === 'cell') {
    const cells = el.cells.map((row, r) => row.map((cell, c) => (r === slot.row && c === slot.col ? { ...cell, text } : cell)));
    return { ...fitTable({ ...el, cells }), cells } as Partial<Element>;
  }
  if (el.type === 'kanban') {
    if (slot.kind === 'title') return { title: text } as Partial<Element>;
    if (slot.kind === 'column') {
      return { columns: el.columns.map((c, i) => (i === slot.col ? { ...c, title: text } : c)) } as Partial<Element>;
    }
    if (slot.kind === 'card') {
      // An emptied card is removed rather than left blank.
      const columns = el.columns.map((c, i) => (i === slot.col
        ? { ...c, cards: text.trim() ? c.cards.map((card, j) => (j === slot.card ? { ...card, text } : card)) : c.cards.filter((_, j) => j !== slot.card) }
        : c));
      return fitKanban(el, columns) as Partial<Element>;
    }
  }
  if (el.type === 'matrix') {
    if (slot.kind === 'title') return { title: text } as Partial<Element>;
    if (slot.kind === 'quadrant') {
      const quadrants = [...el.quadrants] as MatrixElement['quadrants'];
      quadrants[slot.index] = text;
      return { quadrants } as Partial<Element>;
    }
    if (slot.kind === 'axis') {
      const key = slot.axis === 'x' ? 'xAxis' : 'yAxis';
      const axis = [...el[key]] as [string, string];
      axis[slot.end] = text;
      return { [key]: axis } as Partial<Element>;
    }
  }
  if (el.type === 'code' && slot.kind === 'code') return fitCode(el, text) as Partial<Element>;
  return null;
}

/** Next table cell for Tab / Shift+Tab (wrapping across rows). */
export function nextTableCell(el: TableElement, slot: { row: number; col: number }, backwards: boolean) {
  const index = slot.row * el.columns + slot.col + (backwards ? -1 : 1);
  if (index < 0 || index >= el.rows * el.columns) return null;
  return { kind: 'cell' as const, row: Math.floor(index / el.columns), col: index % el.columns };
}

// --- Factories -----------------------------------------------------------------

export function createTableFields(rows = 3, columns = 3) {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => makeTableCell(r === 0 ? `标题 ${c + 1}` : '')),
  );
  for (const cell of cells[0]) cell.fontWeight = 'bold';
  return {
    rows,
    columns,
    cells,
    columnWidths: Array(columns).fill(TABLE_DEFAULT_COL),
    rowHeights: Array(rows).fill(TABLE_MIN_ROW),
    headerRow: true,
    width: columns * TABLE_DEFAULT_COL,
    height: rows * TABLE_MIN_ROW,
  };
}

export function createKanbanFields() {
  const columns: KanbanColumn[] = [
    { id: generateId(), title: '待办', color: KANBAN_COLORS[0], cards: [{ id: generateId(), text: '写下要做的事' }] },
    { id: generateId(), title: '进行中', color: KANBAN_COLORS[1], cards: [] },
    { id: generateId(), title: '已完成', color: KANBAN_COLORS[3], cards: [] },
  ];
  return { title: '看板', columns, width: 3 * 220 + KANBAN.pad * 2 + KANBAN.gap * 2, height: 320 };
}

export function createMatrixFields() {
  const preset = MATRIX_PRESETS.priority;
  return {
    title: preset.title,
    quadrants: [...preset.quadrants] as MatrixElement['quadrants'],
    quadrantColors: [...MATRIX_COLORS] as MatrixElement['quadrantColors'],
    xAxis: [...preset.xAxis] as [string, string],
    yAxis: [...preset.yAxis] as [string, string],
    childElementIds: [],
    width: 640,
    height: 520,
  };
}

export function createCodeFields() {
  const code = "function hello(name) {\n  return `Hello, ${name}!`;\n}";
  const fontSize = 13;
  return {
    code,
    language: 'javascript',
    fontSize,
    codeTheme: 'dark' as const,
    width: 420,
    height: Math.ceil(CODE.headerH + CODE.pad * 2 + 3 * fontSize * CODE.lineHeight),
  };
}

/** Plain text of a structured element (for search, links, outline titles). */
export function structuredText(el: Element): string {
  switch (el.type) {
    case 'table':
      return el.cells.map((row) => row.map((c) => c.text).join('\t')).join('\n');
    case 'kanban':
      return [el.title, ...el.columns.flatMap((c) => [c.title, ...c.cards.map((card) => card.text)])].join('\n');
    case 'matrix':
      return [el.title, ...el.quadrants].join('\n');
    case 'code':
      return el.code;
    default:
      return '';
  }
}
