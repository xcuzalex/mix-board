/**
 * Canvas → Markdown document export (提炼成文档).
 *
 * Walks the board in reading order (top-to-bottom rows, then left-to-right) and
 * emits one Markdown section per note:
 *   - mindmap        → "## root" + nested bullet list of its branches
 *   - card / text    → its Markdown content as-is
 *   - frame/section  → "## title" (acts as a chapter heading)
 *   - shapes w/ text → the text as a paragraph
 * [[links]] are kept verbatim, so the result opens cleanly in Obsidian & co.
 */
import type { Element, MindmapElement, MindmapNode } from '../types/element';
import { getMindmapSiblings } from '../canvas/mindmap-ops';

const ROW_HEIGHT = 40;

function mindmapToMarkdown(el: MindmapElement): string {
  const lines = [`## ${el.rootNode.text?.trim() || '未命名主题'}`, ''];
  const walk = (node: MindmapNode, depth: number) => {
    for (const child of getMindmapSiblings(node)) {
      lines.push(`${'  '.repeat(depth)}- ${child.text?.trim() ?? ''}`);
      walk(child, depth + 1);
    }
  };
  walk(el.rootNode, 0);
  return lines.join('\n');
}

function elementToMarkdown(el: Element): string | null {
  switch (el.type) {
    case 'mindmap':
      return mindmapToMarkdown(el as MindmapElement);
    case 'sticky_note':
    case 'text': {
      // Normalize bare "[ ] task" lines to GFM "- [ ] task" so other apps see tasks.
      const text = ((el as any).text ?? '')
        .split('\n')
        .map((line: string) => line.replace(/^(\s*)\[([ xX])\]\s+/u, '$1- [$2] '))
        .join('\n')
        .trim();
      return text || null;
    }
    case 'frame':
    case 'section': {
      const title = ((el as any).title ?? '').trim();
      return title ? `## ${title}` : null;
    }
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle': {
      const text = (el.text ?? '').trim();
      return text || null;
    }
    case 'table': {
      // GFM table; a table without a header row gets an empty one.
      const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim() || ' ';
      const rows = el.cells.map((row) => `| ${row.map((c) => cell(c.text)).join(' | ')} |`);
      const separator = `| ${Array(el.columns).fill('---').join(' | ')} |`;
      const header = el.headerRow ? rows.shift() ?? '' : `| ${Array(el.columns).fill(' ').join(' | ')} |`;
      return [header, separator, ...rows].join('\n');
    }
    case 'kanban':
      return [
        `## ${el.title.trim() || '看板'}`,
        ...el.columns.flatMap((column) => ['', `### ${column.title.trim() || '未命名'}`, ...column.cards.map((card) => `- ${card.text.trim().replace(/\n/g, ' ')}`)]),
      ].join('\n');
    case 'matrix':
      return [`## ${el.title.trim() || '四象限'}`, '', ...el.quadrants.map((q) => `- ${q}`)].join('\n');
    case 'code':
      return `\`\`\`${el.language === 'plaintext' ? '' : el.language}\n${el.code}\n\`\`\``;
    default:
      return null;
  }
}

/** Builds a Markdown document from the board's notes in reading order. */
export function boardToMarkdown(elements: Element[], docTitle: string): string {
  const ordered = [...elements].sort((a, b) => {
    const rowA = Math.floor(a.y / ROW_HEIGHT);
    const rowB = Math.floor(b.y / ROW_HEIGHT);
    return rowA !== rowB ? rowA - rowB : a.x - b.x;
  });

  const sections = ordered
    .map(elementToMarkdown)
    .filter((section): section is string => !!section);

  return `# ${docTitle}\n\n${sections.join('\n\n')}\n`;
}
