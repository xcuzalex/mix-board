/**
 * Drawing for structured note elements (table, kanban, 2×2 matrix, code card).
 * Geometry and the data model live in ../structured; these are pure paint
 * functions on a 2D context that follow the canvas theme.
 */
import type { CodeElement, KanbanElement, MatrixElement, TableElement } from '../../types/element';
import { canvasTheme } from '../canvas-theme';
import {
  CODE,
  CODE_FONT,
  KANBAN,
  MATRIX,
  STRUCTURED_FONT,
  TABLE_CELL_PAD,
  TABLE_FONT_SIZE,
  kanbanLayout,
  matrixLayout,
  matrixNotes,
  tableGrid,
  type EditSlot,
  type Rect,
} from '../structured';
import { drawMarkdown, type LinkHit, type MarkdownOptions, type TaskHit } from './markdown';
import { blendOver, withAlpha } from './color';

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2));
}


const surface = () => (canvasTheme.isDark ? '#232327' : '#FFFFFF');
const border = () => (canvasTheme.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.14)');
const subtle = () => (canvasTheme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)');
const muted = () => (canvasTheme.isDark ? 'rgba(230,230,234,0.55)' : 'rgba(27,27,31,0.5)');

function clipped(ctx: CanvasRenderingContext2D, r: Rect, draw: () => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  draw();
  ctx.restore();
}

/** A todo checkbox inside one slot (cell, card, quadrant note) of an element. */
export type SlotTaskHit = TaskHit & { slot: EditSlot };

/**
 * Draws a slot's Markdown clipped to `clip`, tagging its todo checkboxes with
 * the slot. Links and checkboxes cut off by the clip aren't clickable (their
 * hit boxes would otherwise reach into the neighbouring cell or quadrant).
 */
function drawSlotMarkdown(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: MarkdownOptions,
  slot: EditSlot,
  clip: Rect,
  hits?: LinkHit[],
  tasks?: SlotTaskHit[],
) {
  const links: LinkHit[] = [];
  const todos: TaskHit[] = [];
  clipped(ctx, clip, () => drawMarkdown(ctx, text, opts, hits && links, tasks && todos));
  const visible = (h: { y: number; h: number }) => h.y + h.h / 2 <= clip.y + clip.h;
  if (hits) hits.push(...links.filter(visible));
  if (tasks) for (const t of todos.filter(visible)) tasks.push({ ...t, slot });
}

/** Lines starting with a list, todo or heading marker: wrapping them in ** would hide the marker. */
const BLOCK_MARKER = /^\s*(?:[-*]\s|\[[ xX]\]\s|\d+\.\s|#{1,3}\s|>)/u;

function singleLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  let value = text;
  if (ctx.measureText(value).width > maxWidth) {
    while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
    value = `${value}…`;
  }
  ctx.fillText(value, x, y);
}

// --- Table -------------------------------------------------------------------

export function drawTable(ctx: CanvasRenderingContext2D, el: TableElement, hits?: LinkHit[], tasks?: SlotTaskHit[]) {
  const { xs, ws, ys, hs } = tableGrid(el);
  const box = { x: el.x, y: el.y, w: el.width, h: el.height };
  const fg = el.strokeColor && el.strokeColor !== '#1B1B1F' ? el.strokeColor : canvasTheme.foreground;

  ctx.save();
  roundRect(ctx, box, 8);
  ctx.fillStyle = surface();
  ctx.fill();
  ctx.clip();

  // Header row / cell fills.
  if (el.headerRow && hs[0]) {
    ctx.fillStyle = subtle();
    ctx.fillRect(box.x, ys[0], box.w, hs[0]);
  }
  el.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.backgroundColor && cell.backgroundColor !== 'transparent') {
      ctx.fillStyle = cell.backgroundColor;
      ctx.fillRect(xs[c], ys[r], ws[c], hs[r]);
    }
  }));

  // Grid lines.
  ctx.strokeStyle = border();
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < xs.length; c++) {
    ctx.moveTo(xs[c], box.y);
    ctx.lineTo(xs[c], box.y + box.h);
  }
  for (let r = 1; r < ys.length; r++) {
    ctx.moveTo(box.x, ys[r]);
    ctx.lineTo(box.x + box.w, ys[r]);
  }
  ctx.stroke();

  // Cell text (Markdown, so [[links]] and **bold** work in cells too).
  el.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (!cell.text) return;
    const rect = { x: xs[c], y: ys[r], w: ws[c], h: hs[r] };
    // The first row of a table with a header is bold, whatever moved into it
    // (single plain lines only: lists, todos and headings keep their markers).
    const bold = (el.headerRow && r === 0) || cell.fontWeight === 'bold';
    const plainLine = !cell.text.includes('**') && !cell.text.includes('\n') && !BLOCK_MARKER.test(cell.text);
    const text = bold && plainLine ? `**${cell.text}**` : cell.text;
    drawSlotMarkdown(ctx, text, {
      x: rect.x + TABLE_CELL_PAD,
      y: rect.y + TABLE_CELL_PAD - 2,
      width: Math.max(10, rect.w - TABLE_CELL_PAD * 2),
      fontSize: cell.fontSize || TABLE_FONT_SIZE,
      fontFamily: STRUCTURED_FONT,
      color: cell.textColor || fg,
    }, { kind: 'cell', row: r, col: c }, rect, hits, tasks);
  }));
  ctx.restore();

  ctx.save();
  roundRect(ctx, box, 8);
  ctx.strokeStyle = border();
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
}

// --- Kanban ------------------------------------------------------------------

/** `hints` draws editing affordances ("添加卡片", "双击输入…"); off for exports. */
export function drawKanban(ctx: CanvasRenderingContext2D, el: KanbanElement, hits?: LinkHit[], tasks?: SlotTaskHit[], hints = true) {
  const layout = kanbanLayout(el);
  const fg = canvasTheme.foreground;
  const box = { x: el.x, y: el.y, w: el.width, h: Math.max(el.height, layout.contentHeight) };

  ctx.save();
  roundRect(ctx, box, 14);
  ctx.fillStyle = canvasTheme.isDark ? '#1f1f23' : '#F4F5F7';
  ctx.fill();
  ctx.strokeStyle = border();
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `600 16px ${STRUCTURED_FONT}`;
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  singleLine(ctx, el.title || '看板', layout.title.x + 2, layout.title.y + layout.title.h / 2, layout.title.w);

  el.columns.forEach((column, i) => {
    const c = layout.columns[i];
    if (!c) return;
    // Column lane.
    roundRect(ctx, c.rect, 10);
    ctx.fillStyle = canvasTheme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)';
    ctx.fill();

    // Header: accent dot, title, count.
    ctx.fillStyle = column.color;
    ctx.beginPath();
    ctx.arc(c.header.x + 14, c.header.y + c.header.h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 14px ${STRUCTURED_FONT}`;
    ctx.fillStyle = fg;
    singleLine(ctx, column.title || '未命名', c.header.x + 26, c.header.y + c.header.h / 2, c.header.w - 60);
    ctx.font = `500 12px ${STRUCTURED_FONT}`;
    ctx.fillStyle = muted();
    ctx.textAlign = 'right';
    ctx.fillText(String(column.cards.length), c.header.x + c.header.w - 10, c.header.y + c.header.h / 2);
    ctx.textAlign = 'left';

    // Cards.
    column.cards.forEach((card, j) => {
      const r = c.cards[j];
      if (!r) return;
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.08)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      roundRect(ctx, r, 8);
      ctx.fillStyle = surface();
      ctx.fill();
      ctx.restore();
      roundRect(ctx, r, 8);
      ctx.strokeStyle = border();
      ctx.lineWidth = 1;
      ctx.stroke();
      // Accent stripe.
      ctx.fillStyle = withAlpha(column.color, 0.9);
      ctx.fillRect(r.x, r.y + 8, 3, r.h - 16);
      drawSlotMarkdown(ctx, card.text || ' ', {
        x: r.x + KANBAN.cardPad,
        y: r.y + KANBAN.cardPad - 2,
        width: Math.max(10, r.w - KANBAN.cardPad * 2),
        fontSize: KANBAN.fontSize,
        fontFamily: STRUCTURED_FONT,
        color: fg,
      }, { kind: 'card', col: i, card: j }, r, hits, tasks);
    });

    // "+ 添加卡片" affordance.
    if (!hints) return;
    ctx.font = `500 13px ${STRUCTURED_FONT}`;
    ctx.fillStyle = muted();
    ctx.textBaseline = 'middle';
    ctx.fillText('＋ 添加卡片', c.add.x + 10, c.add.y + c.add.h / 2);
  });
  ctx.restore();
}

// --- Matrix ------------------------------------------------------------------

const quadrantTint = () => (canvasTheme.isDark ? 0.12 : 0.07);

/** The quadrant's tinted background as a solid colour (for the editor over it). */
export function matrixQuadrantBackground(el: MatrixElement, index: number): string {
  return blendOver(surface(), el.quadrantColors[index] ?? '#8E8E93', quadrantTint());
}

export function drawMatrix(ctx: CanvasRenderingContext2D, el: MatrixElement, hits?: LinkHit[], tasks?: SlotTaskHit[], hints = true) {
  const l = matrixLayout(el);
  const fg = canvasTheme.foreground;
  const box = { x: el.x, y: el.y, w: el.width, h: el.height };

  ctx.save();
  roundRect(ctx, box, 14);
  ctx.fillStyle = surface();
  ctx.fill();
  ctx.strokeStyle = border();
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.font = `600 16px ${STRUCTURED_FONT}`;
  ctx.fillStyle = fg;
  singleLine(ctx, el.title || '矩阵', l.title.x + 2, l.title.y + l.title.h / 2, l.title.w);

  // Tinted quadrants with their titles.
  l.quadrants.forEach((q, i) => {
    const color = el.quadrantColors[i] ?? '#8E8E93';
    ctx.fillStyle = withAlpha(color, quadrantTint());
    ctx.fillRect(q.x, q.y, q.w, q.h);
    const label = l.labels[i];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(label.x + 6, label.y + label.h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 14px ${STRUCTURED_FONT}`;
    ctx.fillStyle = fg;
    singleLine(ctx, el.quadrants[i] || '', label.x + 18, label.y + label.h / 2, label.w - 18);

    // What's written in the quadrant (Markdown: lists, todos, links…).
    const body = l.notes[i];
    const text = matrixNotes(el)[i];
    if (body.h <= 0) return;
    if (text.trim()) {
      drawSlotMarkdown(ctx, text, {
        x: body.x + MATRIX.notePad,
        y: body.y + MATRIX.notePad - 2,
        width: Math.max(10, body.w - MATRIX.notePad * 2),
        fontSize: MATRIX.fontSize,
        fontFamily: STRUCTURED_FONT,
        color: fg,
      }, { kind: 'note', index: i }, body, hits, tasks);
      ctx.textBaseline = 'middle';
    } else if (hints) {
      ctx.font = `400 13px ${STRUCTURED_FONT}`;
      ctx.fillStyle = withAlpha(canvasTheme.isDark ? '#E6E6EA' : '#1B1B1F', 0.28);
      singleLine(ctx, '双击输入…', body.x + MATRIX.notePad, body.y + MATRIX.notePad + 8, body.w - MATRIX.notePad * 2);
    }
  });

  // Axes: cross lines with arrowheads.
  const { grid } = l;
  ctx.strokeStyle = muted();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(grid.x, grid.y + grid.h / 2);
  ctx.lineTo(grid.x + grid.w, grid.y + grid.h / 2);
  ctx.moveTo(grid.x + grid.w / 2, grid.y);
  ctx.lineTo(grid.x + grid.w / 2, grid.y + grid.h);
  ctx.stroke();
  ctx.strokeStyle = border();
  ctx.lineWidth = 1;
  ctx.strokeRect(grid.x, grid.y, grid.w, grid.h);

  // Axis labels: x below the grid, y rotated along the left edge.
  ctx.font = `500 12px ${STRUCTURED_FONT}`;
  ctx.fillStyle = muted();
  ctx.textAlign = 'center';
  l.xAxis.forEach((r, i) => singleLine(ctx, `${i === 1 ? '' : '← '}${el.xAxis[i] ?? ''}${i === 1 ? ' →' : ''}`, r.x + r.w / 2, r.y + r.h / 2, r.w));
  l.yAxis.forEach((r, i) => {
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.rotate(-Math.PI / 2);
    singleLine(ctx, `${i === 1 ? '' : '← '}${el.yAxis[i] ?? ''}${i === 1 ? ' →' : ''}`, 0, 0, r.h);
    ctx.restore();
  });
  ctx.textAlign = 'left';
  ctx.restore();
}

// --- Code --------------------------------------------------------------------

const KEYWORDS: Record<string, string[]> = {
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false', 'interface', 'type', 'implements', 'public', 'private', 'protected', 'readonly', 'enum', 'as', 'yield', 'static'],
  python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'pass', 'break', 'continue', 'None', 'True', 'False', 'self', 'async', 'await', 'global'],
  go: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'select', 'nil', 'true', 'false', 'break', 'continue'],
  rust: ['fn', 'let', 'mut', 'pub', 'use', 'mod', 'struct', 'enum', 'impl', 'trait', 'match', 'if', 'else', 'for', 'in', 'while', 'loop', 'return', 'self', 'Self', 'true', 'false', 'as', 'ref', 'where', 'async', 'await', 'move', 'const', 'static'],
  sql: ['select', 'from', 'where', 'and', 'or', 'not', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'as', 'null', 'is', 'in', 'distinct', 'count', 'sum', 'avg'],
  bash: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'echo', 'export', 'local', 'in', 'cd', 'exit'],
  c: ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'struct', 'typedef', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'const', 'static', 'include', 'define', 'class', 'public', 'private', 'new', 'delete', 'nullptr', 'true', 'false', 'namespace', 'using', 'auto', 'template', 'func', 'var', 'let', 'val', 'fun', 'import', 'package', 'null', 'this', 'override'],
};

const keywordCache = new Map<string, Set<string>>();

/** Keywords for a language, built once per language (drawCode runs every frame). */
function keywordSet(language: string) {
  let set = keywordCache.get(language);
  if (!set) {
    set = buildKeywordSet(language);
    keywordCache.set(language, set);
  }
  return set;
}

function buildKeywordSet(language: string) {
  const lang = language.toLowerCase();
  if (['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx'].includes(lang)) return new Set(KEYWORDS.js);
  if (['python', 'py'].includes(lang)) return new Set(KEYWORDS.python);
  if (lang === 'go') return new Set(KEYWORDS.go);
  if (lang === 'rust') return new Set(KEYWORDS.rust);
  if (lang === 'sql') return new Set([...KEYWORDS.sql, ...KEYWORDS.sql.map((k) => k.toUpperCase())]);
  if (['bash', 'sh', 'shell', 'zsh'].includes(lang)) return new Set(KEYWORDS.bash);
  if (['c', 'cpp', 'java', 'swift', 'kotlin', 'csharp'].includes(lang)) return new Set([...KEYWORDS.c, ...KEYWORDS.js]);
  return new Set<string>();
}

type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'function';

const CODE_COLORS: Record<'dark' | 'light', Record<TokenKind, string> & { bg: string; header: string; label: string; gutter: string }> = {
  dark: { bg: '#1E1F24', header: '#26272D', label: '#9CA3AF', gutter: '#5B606B', plain: '#E6E6EA', keyword: '#FF7AB2', string: '#FFB86C', comment: '#7F8C98', number: '#D9C97C', function: '#6BDFFF' },
  light: { bg: '#F7F8FA', header: '#EEF0F3', label: '#6B7280', gutter: '#A3A9B3', plain: '#1F2328', keyword: '#AD3DA4', string: '#C4561C', comment: '#6E7781', number: '#1C00CF', function: '#3E6CC1' },
};

const commentPrefix = (lang: string) => (['python', 'py', 'bash', 'sh', 'shell', 'zsh', 'yaml', 'yml'].includes(lang) ? '#' : lang === 'sql' ? '--' : '//');

/** A small line tokenizer: comments, strings, numbers, keywords, calls. */
function tokenize(line: string, language: string, keywords: Set<string>): Array<{ text: string; kind: TokenKind }> {
  const lang = language.toLowerCase();
  if (lang === 'plaintext' || lang === 'markdown') return [{ text: line, kind: 'plain' }];
  const tokens: Array<{ text: string; kind: TokenKind }> = [];
  const comment = commentPrefix(lang);
  const re = /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    // A comment runs to the end of the line (strings were already consumed whole).
    if (!m[1] && line.startsWith(comment, m.index)) {
      tokens.push({ text: line.slice(m.index), kind: 'comment' });
      break;
    }
    if (m[1]) tokens.push({ text: m[1], kind: 'string' });
    else if (m[2]) tokens.push({ text: m[2], kind: 'number' });
    else if (m[3]) {
      const next = line.slice(re.lastIndex).trimStart();
      tokens.push({ text: m[3], kind: keywords.has(m[3]) ? 'keyword' : next.startsWith('(') ? 'function' : 'plain' });
    } else tokens.push({ text: m[0], kind: 'plain' });
  }
  return tokens;
}

export function drawCode(ctx: CanvasRenderingContext2D, el: CodeElement) {
  const colors = CODE_COLORS[el.codeTheme === 'light' ? 'light' : 'dark'];
  const box = { x: el.x, y: el.y, w: el.width, h: el.height };
  const fontSize = el.fontSize || 13;
  const lineHeight = fontSize * CODE.lineHeight;
  const lines = el.code.split('\n');
  const gutterW = Math.max(2, String(lines.length).length) * fontSize * 0.62 + 14;

  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,0.18)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, box, 12);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, box, 12);
  ctx.clip();
  // Header: window dots + language.
  ctx.fillStyle = colors.header;
  ctx.fillRect(box.x, box.y, box.w, CODE.headerH);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(box.x + 16 + i * 16, box.y + CODE.headerH / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.font = `500 12px ${STRUCTURED_FONT}`;
  ctx.fillStyle = colors.label;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText(el.language, box.x + box.w - 14, box.y + CODE.headerH / 2);
  ctx.textAlign = 'left';

  // Body: line numbers + highlighted code.
  const keywords = keywordSet(el.language);
  ctx.font = `${fontSize}px ${CODE_FONT}`;
  ctx.textBaseline = 'middle';
  let y = box.y + CODE.headerH + CODE.pad + lineHeight / 2;
  const bottom = box.y + box.h;
  for (let i = 0; i < lines.length && y - lineHeight / 2 < bottom; i++) {
    ctx.fillStyle = colors.gutter;
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), box.x + gutterW - 6, y);
    ctx.textAlign = 'left';
    let x = box.x + gutterW + 8;
    for (const token of tokenize(lines[i], el.language, keywords)) {
      ctx.fillStyle = colors[token.kind];
      ctx.fillText(token.text, x, y);
      x += ctx.measureText(token.text).width;
    }
    y += lineHeight;
  }
  ctx.restore();
}

/** Text editor styling for a code card (matches the card's palette). */
export function codeEditorColors(el: CodeElement) {
  const colors = CODE_COLORS[el.codeTheme === 'light' ? 'light' : 'dark'];
  return { background: colors.bg, color: colors.plain };
}
