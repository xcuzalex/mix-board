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

const ROW_HEIGHT = 40;

function mindmapToMarkdown(el: MindmapElement): string {
  const lines = [`## ${el.rootNode.text?.trim() || '未命名主题'}`, ''];
  const walk = (node: MindmapNode, depth: number) => {
    const children = [...node.children, ...(node.leftChildren ?? []), ...(node.rightChildren ?? [])];
    for (const child of children) {
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
