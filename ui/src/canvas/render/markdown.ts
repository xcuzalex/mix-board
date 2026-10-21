/**
 * Minimal Markdown renderer for canvas note cards (富文本卡片).
 *
 * Supports a pragmatic subset that covers note-taking: headings (#, ##, ###),
 * bullet lists (-, *), task checkboxes ([ ] / [x]), blockquotes (>), and inline
 * **bold**, *italic* and `code`. It lays text out with word-wrap inside a width
 * and draws straight to the 2D context — no DOM, so it works with the canvas
 * zoom/pan transform. Editing stays plain-Markdown in the textarea overlay.
 */

export interface MarkdownOptions {
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontFamily: string;
  color: string;
}

/** A clickable [[link]] region in canvas coordinates (collected while drawing). */
export interface LinkHit {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A clickable todo checkbox: `line` is the source line it toggles. */
export interface TaskHit {
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Flips `[ ]` ↔ `[x]` on one source line (a todo or `- [ ]` item). */
export function toggleTaskLine(source: string, line: number): string {
  const lines = source.split('\n');
  const text = lines[line];
  if (text === undefined) return source;
  lines[line] = text.replace(/^(\s*(?:[-*]\s+)?)\[([ xX])\]/u, (_, prefix: string, mark: string) => `${prefix}[${mark === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

/**
 * Enter inside a list keeps the list going: the new line gets the same bullet,
 * an unchecked todo, or the next number (text after the caret moves along).
 * Enter on an item with no text at all ends the list (the marker is removed).
 * Returns null when the caret isn't after a list marker (plain newline).
 */
export function continueListOnEnter(value: string, caret: number): { value: string; caret: number } | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = value.indexOf('\n', caret);
  const line = value.slice(lineStart, caret);
  const m = line.match(/^(\s*)((?:[-*]\s+)?\[[ xX]\]\s+|[-*]\s+|(\d+)\.\s+)/u);
  if (!m) return null;
  const restOfLine = value.slice(caret, lineEnd === -1 ? value.length : lineEnd);
  if (line.slice(m[0].length).trim() === '' && restOfLine.trim() === '') {
    // Empty item: drop the marker and leave the list.
    const next = value.slice(0, lineStart) + value.slice(caret);
    return { value: next, caret: lineStart };
  }
  let marker = m[2];
  if (m[3]) marker = `${Number(m[3]) + 1}. `;
  else marker = marker.replace(/\[[xX]\]/u, '[ ]');
  const insert = `\n${m[1]}${marker}`;
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length };
}

type InlineRun = { text: string; bold: boolean; italic: boolean; code: boolean; link: boolean };

const CODE_FAMILY = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";

/** Default font for note cards (hand-drawn, CJK falls back to the system font). */
export const DEFAULT_NOTE_FONT = "'Kalam', 'Inter', system-ui, sans-serif";
/** Smallest height a card shrinks to when auto-fitting its content. */
export const MIN_CARD_HEIGHT = 96;
/** Inner padding of sticky notes / cards. */
export const CARD_PADDING = 12;
const LINK_COLOR = '#007AFF';

function tokenizeInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let bold = false;
  let italic = false;
  let code = false;
  let buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, bold, italic, code, link: false });
    buf = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    // [[wiki link]] — rendered as a single link run (brackets hidden).
    if (!code && text[i] === '[' && text[i + 1] === '[') {
      const close = text.indexOf(']]', i + 2);
      if (close !== -1) {
        flush();
        runs.push({ text: text.slice(i + 2, close), bold, italic, code: false, link: true });
        i = close + 1;
        continue;
      }
    }
    if (text[i] === '`') { flush(); code = !code; continue; }
    if (!code && text[i] === '*' && text[i + 1] === '*') { flush(); bold = !bold; i += 1; continue; }
    if (!code && text[i] === '*') { flush(); italic = !italic; continue; }
    buf += text[i];
  }
  flush();
  return runs;
}

function runFont(run: InlineRun, size: number, weight: number, family: string): string {
  if (run.code) return `${size}px ${CODE_FAMILY}`;
  const style = run.italic ? 'italic ' : '';
  const w = run.bold ? 700 : weight;
  return `${style}${w} ${size}px ${family}`;
}

interface Block {
  runs: InlineRun[];
  size: number;
  weight: number;
  marker?: 'bullet' | 'todo' | 'done';
  indent: number;
  quote?: boolean;
  spacingBefore: number;
}

function parseBlocks(source: string, base: number): Block[] {
  const blocks: Block[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/u, '');
    if (!line.trim()) {
      blocks.push({ runs: [], size: base * 0.5, weight: 400, indent: 0, spacingBefore: 0 });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/u))) {
      const level = m[1].length;
      const size = base * (level === 1 ? 1.6 : level === 2 ? 1.32 : 1.14);
      blocks.push({ runs: tokenizeInline(m[2]), size, weight: 700, indent: 0, spacingBefore: base * 0.3 });
    } else if ((m = line.match(/^\s*(?:[-*]\s+)?\[([ xX])\]\s+(.*)$/u))) {
      blocks.push({ runs: tokenizeInline(m[2]), size: base, weight: 400, marker: m[1] === ' ' ? 'todo' : 'done', indent: base * 1.3, spacingBefore: 0 });
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/u))) {
      blocks.push({ runs: tokenizeInline(m[1]), size: base, weight: 400, marker: 'bullet', indent: base * 1.1, spacingBefore: 0 });
    } else if ((m = line.match(/^>\s+(.*)$/u))) {
      blocks.push({ runs: tokenizeInline(m[1]), size: base, weight: 400, indent: base * 0.8, quote: true, spacingBefore: 0 });
    } else {
      blocks.push({ runs: tokenizeInline(line), size: base, weight: 400, indent: 0, spacingBefore: 0 });
    }
  }
  return blocks;
}

// --- Layout (parse + measure) -------------------------------------------------
// Laying Markdown out tokenises every line and calls measureText per word, which
// is far too much work to redo on every pan / zoom frame. The layout is computed
// once at the origin and cached per (text, width, font, size); painting replays
// it at the requested position. Font loads invalidate the cache (they change the
// measurements) via invalidateMarkdownLayoutCache().

/** Draw roles; quote / done text and the quote bar derive from the text color. */
type TextRole = 'base' | 'link' | 'quote' | 'done';

type LayoutOp =
  | { kind: 'text'; text: string; font: string; x: number; y: number; role: TextRole }
  | { kind: 'bullet'; font: string; x: number; y: number }
  | { kind: 'checkbox'; x: number; y: number; size: number; done: boolean }
  | { kind: 'quoteBar'; x: number; y: number; h: number };

interface MarkdownLayout {
  ops: LayoutOp[];
  /** Link regions relative to the layout origin. */
  hits: LinkHit[];
  /** Todo checkbox regions relative to the layout origin. */
  tasks: TaskHit[];
  width: number;
  height: number;
}

/** Alpha applied to the text color for derived roles (works for any CSS color format). */
const ROLE_ALPHA: Record<TextRole, number> = { base: 1, link: 1, quote: 0.6, done: 0.45 };
const QUOTE_BAR_ALPHA = 0.25;
const DONE_COLOR = '#007AFF';

const MAX_LAYOUTS = 500;
const layoutCache = new Map<string, MarkdownLayout>();

/** Drops cached layouts; call when web fonts finish loading (measurements change). */
export function invalidateMarkdownLayoutCache() {
  layoutCache.clear();
}

function computeLayout(
  ctx: CanvasRenderingContext2D,
  source: string,
  width: number,
  fontSize: number,
  fontFamily: string,
): MarkdownLayout {
  const blocks = parseBlocks(source, fontSize);
  const ops: LayoutOp[] = [];
  const hits: LinkHit[] = [];
  const tasks: TaskHit[] = [];
  let y = 0;
  let maxRight = 0;

  // parseBlocks yields exactly one block per source line, so index = line.
  for (const [line, block] of blocks.entries()) {
    y += block.spacingBefore;
    const lineHeight = block.size * 1.45;

    if (block.runs.length === 0) {
      y += lineHeight * 0.6;
      continue;
    }

    const left = block.indent;
    const maxX = width;

    // Block marker (bullet / checkbox) on the first line.
    if (block.marker === 'bullet') {
      ops.push({ kind: 'bullet', font: `${block.size}px ${fontFamily}`, x: block.size * 0.3, y });
    } else if (block.marker === 'todo' || block.marker === 'done') {
      const bs = block.size * 0.82;
      ops.push({ kind: 'checkbox', x: 1, y: y + (block.size - bs) / 2 + 1, size: bs, done: block.marker === 'done' });
      // A generous hit box around the checkbox.
      tasks.push({ line, x: -2, y: y - 2, w: bs + 8, h: block.size * 1.3 + 4 });
    }

    if (block.quote) {
      ops.push({ kind: 'quoteBar', x: 0, y, h: lineHeight });
    }

    const role: TextRole = block.quote ? 'quote' : block.marker === 'done' ? 'done' : 'base';

    // Lay out inline runs with word wrap; consecutive words of one run on one
    // line merge into a single fillText.
    let cursorX = left;
    let lastOp: Extract<LayoutOp, { kind: 'text' }> | null = null;
    let lastRun: InlineRun | null = null;
    const placeWord = (word: string, run: InlineRun) => {
      const font = runFont(run, block.size, block.weight, fontFamily);
      ctx.font = font;
      const w = ctx.measureText(word).width;
      if (cursorX + w > maxX && cursorX > left) {
        y += lineHeight;
        cursorX = left;
        lastOp = null;
      }
      if (lastOp && lastRun === run && lastOp.y === y) {
        lastOp.text += word;
      } else {
        lastOp = { kind: 'text', text: word, font, x: cursorX, y, role: run.link ? 'link' : role };
        lastRun = run;
        ops.push(lastOp);
      }
      if (run.link && word.trim()) {
        hits.push({ name: run.text, x: cursorX, y, w, h: block.size * 1.3 });
      }
      cursorX += w;
      if (word.trim()) maxRight = Math.max(maxRight, cursorX);
    };

    for (const run of block.runs) {
      // Split into words but keep spaces so wrapping works naturally.
      const parts = run.text.split(/(\s+)/u);
      for (const part of parts) {
        if (part === '') continue;
        placeWord(part, run);
      }
    }
    y += lineHeight;
  }

  return { ops, hits, tasks, width: maxRight, height: y };
}

function getLayout(
  ctx: CanvasRenderingContext2D,
  source: string,
  width: number,
  fontSize: number,
  fontFamily: string,
): MarkdownLayout {
  const key = `${width}|${fontSize}|${fontFamily}|${source}`;
  const hit = layoutCache.get(key);
  if (hit) {
    layoutCache.delete(key);
    layoutCache.set(key, hit);
    return hit;
  }
  ctx.save();
  const layout = computeLayout(ctx, source, width, fontSize, fontFamily);
  ctx.restore();
  layoutCache.set(key, layout);
  if (layoutCache.size > MAX_LAYOUTS) {
    const oldest = layoutCache.keys().next().value;
    if (oldest !== undefined) layoutCache.delete(oldest);
  }
  return layout;
}

function paintLayout(ctx: CanvasRenderingContext2D, layout: MarkdownLayout, ox: number, oy: number, color: string) {
  const baseAlpha = ctx.globalAlpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const op of layout.ops) {
    switch (op.kind) {
      case 'text':
        ctx.font = op.font;
        ctx.fillStyle = op.role === 'link' ? LINK_COLOR : color;
        ctx.globalAlpha = baseAlpha * ROLE_ALPHA[op.role];
        ctx.fillText(op.text, ox + op.x, oy + op.y);
        break;
      case 'bullet':
        ctx.font = op.font;
        ctx.fillStyle = color;
        ctx.globalAlpha = baseAlpha;
        ctx.fillText('•', ox + op.x, oy + op.y);
        break;
      case 'quoteBar':
        ctx.fillStyle = color;
        ctx.globalAlpha = baseAlpha * QUOTE_BAR_ALPHA;
        ctx.fillRect(ox + op.x, oy + op.y, 2.5, op.h);
        break;
      case 'checkbox': {
        const bx = ox + op.x;
        const by = oy + op.y;
        const bs = op.size;
        ctx.globalAlpha = baseAlpha;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(bx, by, bs, bs, 3);
        if (op.done) {
          ctx.fillStyle = DONE_COLOR;
          ctx.fill();
          ctx.strokeStyle = DONE_COLOR;
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(bx + bs * 0.24, by + bs * 0.52);
          ctx.lineTo(bx + bs * 0.43, by + bs * 0.72);
          ctx.lineTo(bx + bs * 0.78, by + bs * 0.28);
          ctx.stroke();
        } else {
          ctx.strokeStyle = color;
          ctx.stroke();
        }
        break;
      }
    }
  }
  ctx.globalAlpha = baseAlpha;
}

/**
 * Draws Markdown and returns the content size. Collects [[link]] hit regions
 * when `hits` is given. With `measureOnly`, lays out without painting (used to
 * auto-size cards and text to their content). Pass `width: Infinity` to
 * disable wrapping.
 */
export function drawMarkdown(
  ctx: CanvasRenderingContext2D,
  source: string,
  opts: MarkdownOptions & { measureOnly?: boolean },
  hits?: LinkHit[],
  tasks?: TaskHit[],
): { width: number; height: number } {
  const { x, y, width, fontSize, fontFamily, color } = opts;
  const layout = getLayout(ctx, source, width, fontSize, fontFamily);

  if (!opts.measureOnly) {
    ctx.save();
    paintLayout(ctx, layout, x, y, color);
    ctx.restore();
  }
  if (hits) {
    for (const h of layout.hits) hits.push({ name: h.name, x: x + h.x, y: y + h.y, w: h.w, h: h.h });
  }
  if (tasks) {
    for (const t of layout.tasks) tasks.push({ line: t.line, x: x + t.x, y: y + t.y, w: t.w, h: t.h });
  }

  return { width: layout.width, height: layout.height };
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Measures Markdown content size on a shared offscreen context (no painting). */
export function measureMarkdown(source: string, opts: Omit<MarkdownOptions, 'x' | 'y' | 'color'>): { width: number; height: number } {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) return { width: 0, height: 0 };
  return drawMarkdown(measureCtx, source, { ...opts, x: 0, y: 0, color: '#000', measureOnly: true });
}
