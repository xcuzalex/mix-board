/**
 * The .mixnote file format: version handling and defensive loading.
 *
 * Boards travel between Macs (iCloud) and app versions, so a file may come
 * from a newer MixNote, or carry elements with fields missing (hand-edited,
 * truncated sync, older builds). Loading refuses newer formats instead of
 * silently downgrading them. Elements get their common fields (position,
 * size, angle, stroke, opacity) defaulted; lines and drawings without points
 * and mindmaps without a root are dropped; tables, kanbans, matrices and code
 * cards are repaired (with size caps). Fields specific to other element types
 * are passed through as saved.
 */
import { createDocument, type AppState, type EmbeddedFile } from '../types/document';
import type { Element, KanbanColumn, TableCell } from '../types/element';
import { KANBAN_COLORS, MATRIX_COLORS, TABLE_DEFAULT_COL, TABLE_MIN_ROW, makeTableCell } from '../canvas/structured';
import { generateId } from './id';

/** Bump when a change can't be read by older builds, and add a migration below. */
export const DOCUMENT_VERSION = 1;

/** Caps for repaired tables (a corrupt count must not allocate millions of cells). */
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 100;
const POINT_TYPES = new Set(['line', 'arrow', 'freedraw', 'highlighter']);

export interface Board {
  elements: Element[];
  appState: AppState;
  files: Record<string, EmbeddedFile>;
}

export type ParseResult = { ok: true; board: Board } | { ok: false; reason: 'invalid' | 'newer' };

export function parseBoardFile(json: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!isObject(doc)) return { ok: false, reason: 'invalid' };
  const knownType = doc.type === undefined || doc.type === 'mixnote' || doc.type === 'mixboard';
  if (!knownType || !Array.isArray(doc.elements)) return { ok: false, reason: 'invalid' };
  if (typeof doc.version === 'number' && doc.version > DOCUMENT_VERSION) return { ok: false, reason: 'newer' };
  return {
    ok: true,
    board: {
      elements: normalizeElements(doc.elements),
      appState: { ...createDocument().appState, ...(isObject(doc.appState) ? doc.appState : {}) },
      files: normalizeFiles(doc.files),
    },
  };
}

/** The user-facing reason a board couldn't be opened. */
export function parseFailureMessage(reason: 'invalid' | 'newer'): string {
  return reason === 'newer'
    ? '这篇笔记由更新版本的 MixNote 保存，请先升级应用再打开'
    : '文件已损坏或不是 MixNote 笔记';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const tuple = <T>(value: unknown, defaults: T[], read: (v: unknown, d: T) => T) =>
  defaults.map((d, i) => read(Array.isArray(value) ? value[i] : undefined, d));

function normalizeFiles(files: unknown): Record<string, EmbeddedFile> {
  if (!isObject(files)) return {};
  const out: Record<string, EmbeddedFile> = {};
  for (const [id, file] of Object.entries(files)) {
    if (isObject(file) && typeof file.dataURL === 'string') {
      out[id] = { id, mimeType: str(file.mimeType, 'image/png'), dataURL: file.dataURL, created: num(file.created, 0) };
    }
  }
  return out;
}

/** Drops entries that aren't elements and repairs the shape of structured ones. */
export function normalizeElements(raw: unknown[]): Element[] {
  const out: Element[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.type !== 'string') continue;
    const el = { ...item } as Record<string, unknown>;
    el.x = num(el.x, 0);
    el.y = num(el.y, 0);
    el.width = num(el.width, 100);
    el.height = num(el.height, 100);
    el.angle = num(el.angle, 0);
    el.strokeWidth = num(el.strokeWidth, 2);
    el.opacity = num(el.opacity, 100);
    el.groupIds = Array.isArray(el.groupIds) ? el.groupIds.filter((id) => typeof id === 'string') : [];
    if (POINT_TYPES.has(el.type as string) && !validPoints(el.points)) continue;
    if (el.type === 'mindmap' && !isObject(el.rootNode)) continue;
    repairStructured(el);
    out.push(el as unknown as Element);
  }
  return out;
}

function validPoints(points: unknown): boolean {
  return Array.isArray(points) && points.length > 0 && points.every((p) =>
    Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

const clampCount = (value: number, max: number) => Math.min(max, Math.max(1, Math.floor(value)));

function repairCell(cell: unknown): TableCell {
  const base = makeTableCell();
  if (!isObject(cell)) return base;
  return {
    text: str(cell.text),
    backgroundColor: str(cell.backgroundColor, base.backgroundColor),
    textColor: str(cell.textColor, base.textColor),
    fontSize: num(cell.fontSize, base.fontSize),
    textAlign: (['left', 'center', 'right'] as const).find((a) => a === cell.textAlign) ?? base.textAlign,
    fontWeight: cell.fontWeight === 'bold' ? 'bold' : base.fontWeight,
  };
}

function repairStructured(el: Record<string, unknown>) {
  switch (el.type) {
    case 'table': {
      const rawRows = Array.isArray(el.cells) ? el.cells.slice(0, MAX_TABLE_ROWS) : [];
      const widest = Math.max(0, ...rawRows.map((row) => (Array.isArray(row) ? row.length : 0)));
      const columns = clampCount(Math.max(num(el.columns, 0), widest), MAX_TABLE_COLUMNS);
      const rows = clampCount(Math.max(num(el.rows, 0), rawRows.length), MAX_TABLE_ROWS);
      el.rows = rows;
      el.columns = columns;
      el.cells = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) =>
        repairCell(Array.isArray(rawRows[r]) ? (rawRows[r] as unknown[])[c] : undefined)));
      el.columnWidths = tuple(el.columnWidths, Array<number>(columns).fill(TABLE_DEFAULT_COL), (v, d) => num(v, d));
      el.rowHeights = tuple(el.rowHeights, Array<number>(rows).fill(TABLE_MIN_ROW), (v, d) => num(v, d));
      break;
    }
    case 'kanban': {
      const columns = Array.isArray(el.columns) ? el.columns : [];
      el.title = str(el.title, '看板');
      el.columns = columns.filter(isObject).map((column, i): KanbanColumn => ({
        id: str(column.id) || generateId(),
        title: str(column.title),
        color: str(column.color, KANBAN_COLORS[i % KANBAN_COLORS.length]),
        cards: (Array.isArray(column.cards) ? column.cards : [])
          .filter(isObject)
          .map((card) => ({ id: str(card.id) || generateId(), text: str(card.text) })),
      }));
      if ((el.columns as KanbanColumn[]).length === 0) {
        el.columns = [{ id: generateId(), title: '待办', color: KANBAN_COLORS[0], cards: [] }];
      }
      break;
    }
    case 'matrix':
      el.title = str(el.title);
      el.quadrants = tuple(el.quadrants, ['', '', '', ''], (v, d) => str(v, d));
      el.quadrantColors = tuple(el.quadrantColors, [...MATRIX_COLORS], (v, d) => str(v, d));
      el.xAxis = tuple(el.xAxis, ['', ''], (v, d) => str(v, d));
      el.yAxis = tuple(el.yAxis, ['', ''], (v, d) => str(v, d));
      if (el.notes !== undefined) el.notes = tuple(el.notes, ['', '', '', ''], (v, d) => str(v, d));
      el.childElementIds = Array.isArray(el.childElementIds) ? el.childElementIds.filter((id) => typeof id === 'string') : [];
      break;
    case 'code':
      el.code = str(el.code);
      el.language = str(el.language, 'plaintext');
      el.fontSize = num(el.fontSize, 13);
      el.codeTheme = el.codeTheme === 'light' ? 'light' : 'dark';
      break;
    default:
      break;
  }
}
