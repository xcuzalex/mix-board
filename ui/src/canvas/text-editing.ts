/**
 * Text-editing overlay geometry & formatting — the pure helpers behind the
 * inline textarea: placeholder handling, per-shape text insets, and the
 * screen-space position/style of the editor for the element or mindmap node
 * currently being edited. Extracted from Canvas.tsx (P0.C).
 *
 * Kept pure (no React/state) so P1's rich-text editor can replace the editor
 * chrome without disturbing this positioning math. The stateful start/finish
 * editing callbacks stay in Canvas for now.
 */
import type { Element } from '../types/element';
import type { Viewport } from './viewport';
import type { SceneIndex } from './linear';
import type { Renderer } from './renderer';
import { getElementShapeVariant } from './shape-utils';
import { findMindmapNode } from './mindmap-ops';
import { STICKY_NOTE_COLORS } from '../utils/color';

const EDIT_PLACEHOLDERS = new Set(['输入文本', '中心主题', '新主题', '分区', '框架']);

/** Returns the editable draft for a value, blanking out placeholder/default text. */
export function getEditableDraft(text: string) {
  const content = text.trim();
  if (!content) return '';
  return EDIT_PLACEHOLDERS.has(content) || /^分支\s+\d+$/.test(content) ? '' : text;
}

function getShapeTextInsets(el: Element, zoom: number) {
  const variant = getElementShapeVariant(el);
  const width = el.width * zoom;
  const height = el.height * zoom;

  const inset = {
    left: 10 * zoom,
    right: 10 * zoom,
    top: 8 * zoom,
    bottom: 8 * zoom,
  };

  switch (variant) {
    case 'ellipse':
      inset.left = inset.right = Math.max(width * 0.2, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'diamond':
      inset.left = inset.right = Math.max(width * 0.24, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.2, 10 * zoom);
      break;
    case 'triangle':
      inset.left = inset.right = Math.max(width * 0.18, 10 * zoom);
      inset.top = Math.max(height * 0.22, 12 * zoom);
      inset.bottom = Math.max(height * 0.12, 8 * zoom);
      break;
    case 'hexagon':
    case 'parallelogram':
    case 'manual_input':
      inset.left = inset.right = Math.max(width * 0.16, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.12, 8 * zoom);
      break;
    case 'octagon':
    case 'trapezoid':
    case 'display':
    case 'weak_entity':
      inset.left = inset.right = Math.max(width * 0.14, 12 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.14, 8 * zoom);
      break;
    case 'delay':
      inset.left = Math.max(width * 0.12, 10 * zoom);
      inset.right = Math.max(width * 0.24, 18 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 10 * zoom);
      break;
    case 'star':
    case 'cloud':
    case 'actor':
      inset.left = inset.right = Math.max(width * 0.18, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.18, 12 * zoom);
      break;
    case 'speech_bubble':
      inset.left = inset.right = Math.max(width * 0.12, 10 * zoom);
      inset.top = Math.max(height * 0.12, 8 * zoom);
      inset.bottom = Math.max(height * 0.22, 16 * zoom);
      break;
    case 'arrow_left':
      inset.left = Math.max(width * 0.28, 22 * zoom);
      inset.right = Math.max(width * 0.12, 10 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'arrow_right':
      inset.left = Math.max(width * 0.12, 10 * zoom);
      inset.right = Math.max(width * 0.28, 22 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'double_arrow':
      inset.left = inset.right = Math.max(width * 0.24, 20 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.16, 8 * zoom);
      break;
    case 'plus':
      inset.left = inset.right = Math.max(width * 0.18, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.18, 14 * zoom);
      break;
    case 'document':
    case 'multi_document':
    case 'cylinder':
    case 'package':
    case 'component':
    case 'class_box':
    case 'predefined_process':
    case 'internal_storage':
      inset.left = inset.right = Math.max(width * 0.12, 10 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.14, 8 * zoom);
      break;
    case 'weak_relationship':
      inset.left = inset.right = Math.max(width * 0.22, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.2, 12 * zoom);
      break;
    case 'sync_bar':
      inset.left = inset.right = Math.max(width * 0.08, 8 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.24, 12 * zoom);
      break;
    case 'start_state':
    case 'end_state':
      inset.left = inset.right = Math.max(width * 0.22, 14 * zoom);
      inset.top = inset.bottom = Math.max(height * 0.22, 14 * zoom);
      break;
    default:
      break;
  }

  return inset;
}

export interface EditingPosition {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color?: string;
  padding: string;
  backgroundColor?: string;
  borderRadius?: number;
  textAlign?: 'center' | 'left';
  chrome?: 'plain' | 'panel';
}

export interface ComputeEditingPositionParams {
  editingElement: Element | null;
  editingMindmapNode: { elementId: string; nodeId: string } | null;
  zoom: number;
  viewport: Viewport;
  sceneIndex: SceneIndex;
  renderer: Renderer | null;
}

/** Screen-space position & style for the inline text editor overlay. */
export function computeEditingPosition(params: ComputeEditingPositionParams): EditingPosition {
  const { editingElement, editingMindmapNode, zoom, viewport, sceneIndex, renderer } = params;

  if (editingElement) {
    // Section/frame: textarea positioned above the element (title area)
    if (editingElement.type === 'section' || editingElement.type === 'frame') {
      const titleH = 20 * zoom;
      const screen = viewport.canvasToScreen(editingElement.x, editingElement.y - 20);
      return {
        left: screen.x,
        top: screen.y,
        width: Math.max(editingElement.width * zoom, 100),
        height: titleH,
        fontSize: 12 * zoom,
        fontFamily: "'Kalam', 'Inter', system-ui, sans-serif",
        color: '#8B8FA3',
        padding: '2px 4px',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        borderRadius: 6 * zoom,
      };
    }
    // Shapes: textarea centered inside the shape
    const isShape = ['rectangle', 'ellipse', 'diamond', 'triangle'].includes(editingElement.type);
    if (isShape) {
      const shapeScreen = viewport.canvasToScreen(editingElement.x, editingElement.y);
      const fs = ((editingElement as any).fontSize || 16) * zoom;
      const insets = getShapeTextInsets(editingElement, zoom);
      const width = Math.max(editingElement.width * zoom - insets.left - insets.right, fs * 1.6);
      const height = Math.max(editingElement.height * zoom - insets.top - insets.bottom, fs * 1.35);
      const paddingTop = Math.max(2, (height - fs * 1.3) / 2);
      return {
        left: shapeScreen.x + insets.left,
        top: shapeScreen.y + insets.top,
        width,
        height,
        fontSize: fs,
        fontFamily: (editingElement as any).fontFamily || "'Kalam', 'Inter', system-ui, sans-serif",
        color: editingElement.strokeColor || '#1B1B1F',
        padding: `${paddingTop}px 2px 2px`,
        textAlign: 'center' as const,
        backgroundColor: 'transparent',
        borderRadius: 0,
        chrome: 'plain' as const,
      };
    }
    const screen = viewport.canvasToScreen(editingElement.x, editingElement.y);
    return {
      left: screen.x,
      top: screen.y,
      width: Math.max(editingElement.width * zoom, 100),
      height: Math.max(editingElement.height * zoom, 30),
      fontSize: ((editingElement as any).fontSize || 20) * zoom,
      fontFamily: (editingElement as any).fontFamily || "'Kalam', 'Inter', system-ui, sans-serif",
      color: editingElement.type === 'sticky_note' ? '#1B1B1F' : editingElement.strokeColor,
      padding: editingElement.type === 'sticky_note' ? `${12 * zoom}px` : '2px',
      backgroundColor: editingElement.type === 'sticky_note'
        ? STICKY_NOTE_COLORS[(editingElement as any).noteColor] || editingElement.backgroundColor
        : (editingElement.backgroundColor === 'transparent' ? 'rgba(255, 255, 255, 0.96)' : editingElement.backgroundColor),
      borderRadius: editingElement.type === 'sticky_note' ? 8 * zoom : 4 * zoom,
      chrome: 'panel' as const,
    };
  }

  if (editingMindmapNode) {
    const element = sceneIndex.byId.get(editingMindmapNode.elementId);
    if (element?.type === 'mindmap') {
      const node = findMindmapNode(element.rootNode, editingMindmapNode.nodeId);
      const rect = renderer?.getMindmapNodeRect(element, editingMindmapNode.nodeId);
      if (node && rect) {
        const screen = viewport.canvasToScreen(rect.x, rect.y);
        const insetX = node.nodeShape === 'pill' ? 12 * zoom : 8 * zoom;
        const insetY = node.nodeShape === 'text' ? 0 : 4 * zoom;
        const nodeW = Math.max(rect.w * zoom - insetX * 2, node.fontSize * zoom * 1.6);
        const nodeH = Math.max(rect.h * zoom - insetY * 2, node.fontSize * zoom * 1.35);
        const lineH = node.fontSize * zoom * 1.3;
        const paddingTop = Math.max(2, (nodeH - lineH) / 2);
        return {
          left: screen.x + insetX,
          top: screen.y + insetY,
          width: nodeW,
          height: nodeH,
          fontSize: node.fontSize * zoom,
          fontFamily: "'Kalam', 'Inter', system-ui, sans-serif",
          color: node.textColor,
          padding: `${paddingTop}px 2px 2px`,
          textAlign: 'center' as const,
          backgroundColor: node.nodeShape === 'text' ? 'rgba(255, 255, 255, 0.96)' : 'transparent',
          borderRadius: node.nodeShape === 'text' ? 10 * zoom : 0,
          chrome: node.nodeShape === 'text' ? 'panel' as const : 'plain' as const,
        };
      }
    }
  }

  return {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    fontSize: 20,
    fontFamily: "'Kalam', 'Inter', system-ui, sans-serif",
    color: '#1B1B1F',
    padding: '2px',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 4,
    chrome: 'panel' as const,
  };
}
