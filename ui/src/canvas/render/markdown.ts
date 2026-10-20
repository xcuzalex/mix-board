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

type InlineRun = { text: string; bold: boolean; italic: boolean; code: boolean; link: boolean };

const CODE_FAMILY = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";
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
    } else if ((m = line.match(/^\s*\[([ xX])\]\s+(.*)$/u))) {
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

/** Draws Markdown and returns the total height used. */
export function drawMarkdown(ctx: CanvasRenderingContext2D, source: string, opts: MarkdownOptions): number {
  const { x, width, fontSize, fontFamily, color } = opts;
  const blocks = parseBlocks(source, fontSize);
  let y = opts.y;

  for (const block of blocks) {
    y += block.spacingBefore;
    const lineHeight = block.size * 1.45;

    if (block.runs.length === 0) {
      y += lineHeight * 0.6;
      continue;
    }

    const left = x + block.indent;
    const maxX = x + width;

    // Block marker (bullet / checkbox) on the first line.
    ctx.textBaseline = 'top';
    if (block.marker === 'bullet') {
      ctx.fillStyle = color;
      ctx.font = `${block.size}px ${fontFamily}`;
      ctx.fillText('•', x + block.size * 0.3, y);
    } else if (block.marker === 'todo' || block.marker === 'done') {
      const bs = block.size * 0.82;
      const by = y + (block.size - bs) / 2 + 1;
      ctx.strokeStyle = block.marker === 'done' ? '#007AFF' : color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(x + 1, by, bs, bs, 3);
      ctx.stroke();
      if (block.marker === 'done') {
        ctx.fillStyle = '#007AFF';
        ctx.beginPath();
        ctx.roundRect(x + 1, by, bs, bs, 3);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x + 1 + bs * 0.24, by + bs * 0.52);
        ctx.lineTo(x + 1 + bs * 0.43, by + bs * 0.72);
        ctx.lineTo(x + 1 + bs * 0.78, by + bs * 0.28);
        ctx.stroke();
      }
    }

    if (block.quote) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, y, 2.5, lineHeight);
    }

    // Lay out inline runs with word wrap.
    let cursorX = left;
    const drawWord = (word: string, run: InlineRun) => {
      ctx.font = runFont(run, block.size, block.weight, fontFamily);
      const w = ctx.measureText(word).width;
      if (cursorX + w > maxX && cursorX > left) {
        y += lineHeight;
        cursorX = left;
      }
      ctx.fillStyle = run.link
        ? LINK_COLOR
        : block.quote ? 'rgba(0,0,0,0.5)' : (block.marker === 'done' ? 'rgba(0,0,0,0.4)' : color);
      ctx.textBaseline = 'top';
      ctx.fillText(word, cursorX, y);
      cursorX += w;
    };

    for (const run of block.runs) {
      // Split into words but keep spaces so wrapping works naturally.
      const parts = run.text.split(/(\s+)/u);
      for (const part of parts) {
        if (part === '') continue;
        drawWord(part, run);
      }
    }
    y += lineHeight;
  }

  return y - opts.y;
}
