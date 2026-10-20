/**
 * Wiki-style [[ ]] links between notes (双向链接).
 *
 * A note's "title" is its mindmap root text, or the first non-empty line of a
 * text/sticky card (with Markdown markers stripped). `[[title]]` anywhere in a
 * note links to the note with that title; the backlink index is the reverse.
 */
import type { Element, MindmapElement, MindmapNode } from '../types/element';

const LINK_RE = /\[\[([^\]]+)\]\]/g;

function collectMindmapText(el: MindmapElement): string {
  const parts: string[] = [];
  const walk = (n: MindmapNode) => {
    if (n.text) parts.push(n.text);
    for (const c of [...n.children, ...(n.leftChildren ?? []), ...(n.rightChildren ?? [])]) walk(c);
  };
  walk(el.rootNode);
  return parts.join('\n');
}

/** Display title used to resolve [[links]] against this element. */
export function getNoteTitle(el: Element): string {
  if (el.type === 'mindmap') return ((el as MindmapElement).rootNode.text ?? '').trim();
  if (el.type === 'text' || el.type === 'sticky_note') {
    const text: string = (el as any).text ?? '';
    const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l) ?? '';
    return firstLine.replace(/^#{1,6}\s*/u, '').replace(/[*`[\]]/gu, '').trim();
  }
  return '';
}

/** The [[names]] a note links out to. */
export function extractLinks(el: Element): string[] {
  const text = el.type === 'mindmap'
    ? collectMindmapText(el as MindmapElement)
    : ((el as any).text ?? '');
  const names: string[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text))) {
    const name = m[1].trim();
    if (name) names.push(name);
  }
  return names;
}

export interface LinkIndex {
  /** lowercased title -> element id (first match wins). */
  titleToId: Map<string, string>;
  /** target element id -> the elements that link to it. */
  backlinks: Map<string, Element[]>;
}

export function buildLinkIndex(elements: Element[]): LinkIndex {
  const titleToId = new Map<string, string>();
  for (const el of elements) {
    const title = getNoteTitle(el).toLowerCase();
    if (title && !titleToId.has(title)) titleToId.set(title, el.id);
  }

  const backlinks = new Map<string, Element[]>();
  for (const el of elements) {
    const seen = new Set<string>();
    for (const name of extractLinks(el)) {
      const targetId = titleToId.get(name.toLowerCase());
      if (!targetId || targetId === el.id || seen.has(targetId)) continue;
      seen.add(targetId);
      const list = backlinks.get(targetId) ?? [];
      list.push(el);
      backlinks.set(targetId, list);
    }
  }

  return { titleToId, backlinks };
}
