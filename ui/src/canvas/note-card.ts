import type { StickyNoteElement } from '../types/element';
import { createElementForTool } from './interaction';
import { CARD_PADDING, DEFAULT_NOTE_FONT, MIN_CARD_HEIGHT, measureMarkdown } from './render/markdown';

/**
 * A white Markdown note card holding `text`, centred on `center` and as tall
 * as its content (the toolbar's 卡片 button, pasted text).
 */
export function createNoteCard(text: string, center: { x: number; y: number }, width = 320): StickyNoteElement | null {
  const el = createElementForTool('sticky_note', center.x, center.y);
  if (!el || el.type !== 'sticky_note') return null;
  const fontSize = 16;
  const { height } = measureMarkdown(text, {
    width: width - CARD_PADDING * 2,
    fontSize,
    fontFamily: el.fontFamily ?? DEFAULT_NOTE_FONT,
  });
  Object.assign(el, {
    noteColor: 'white',
    fontSize,
    text,
    width,
    height: Math.max(MIN_CARD_HEIGHT, Math.ceil(height + CARD_PADDING * 2)),
  });
  el.x = center.x - el.width / 2;
  el.y = center.y - el.height / 2;
  return el;
}
