/**
 * Mindmap layout engine — the pure tree layout algorithm and its cache
 * signature. Extracted from renderer.ts (P0.B). No canvas/ctx here: node
 * measurement is injected as `measure`, so this module is pure geometry and is
 * the piece reused by the outline <-> mindmap work (P2).
 *
 * The Renderer still owns layout caching (signature compare + shift) and the
 * ctx-backed `measure` implementation; it calls these functions.
 */
import type { MindmapElement, MindmapNode } from '../../types/element';

export type Rect = { x: number; y: number; w: number; h: number };

/** Measures a node's rendered box. Injected by the Renderer (ctx.measureText + cache). */
export type MeasureNode = (node: MindmapNode) => { w: number; h: number };

/** Structural signature used to invalidate the layout cache when the tree changes. */
export function getMindmapLayoutSignature(el: MindmapElement): string {
  const visit = (node: MindmapNode): string => {
    const children = node.children.map(visit).join(',');
    const leftChildren = (node.leftChildren || []).map(visit).join(',');
    const rightChildren = (node.rightChildren || []).map(visit).join(',');
    return [
      node.id,
      node.text,
      node.fontSize,
      node.nodeShape,
      node.nodeType,
      node.collapsed ? 1 : 0,
      `[${children}]`,
      `[${leftChildren}]`,
      `[${rightChildren}]`,
    ].join('|');
  };

  return [el.layout, visit(el.rootNode)].join('::');
}

/** Computes absolute rects for every node, honoring the element's layout direction. */
export function layoutMindmapNodes(el: MindmapElement, measure: MeasureNode): Map<string, Rect> {
  const hGap = 60;
  const vGap = 20;
  const root = el.rootNode;
  const layout = new Map<string, Rect>();

  const getSubtreeHeight = (node: MindmapNode): number => {
    const children = node.collapsed ? [] : node.children;
    const size = measure(node);
    const existing = layout.get(node.id);
    layout.set(node.id, { x: existing?.x ?? 0, y: existing?.y ?? 0, w: size.w, h: size.h });
    if (children.length === 0) return size.h;
    let total = 0;
    for (const child of children) {
      total += getSubtreeHeight(child);
    }
    total += (children.length - 1) * vGap;
    return Math.max(size.h, total);
  };

  const layoutTree = (
    node: MindmapNode,
    x: number,
    y: number,
    direction: 'right' | 'left' | 'down',
  ) => {
    const size = measure(node);
    layout.set(node.id, { x, y, w: size.w, h: size.h });

    const children = node.collapsed ? [] : node.children;
    if (children.length === 0) return;

    if (direction === 'down') {
      const childWidths = children.map((c: MindmapNode) => {
        getSubtreeHeight(c);
        return layout.get(c.id)?.w ?? 60;
      });
      const totalW = childWidths.reduce((a: number, b: number) => a + b, 0) + (children.length - 1) * hGap;
      let startX = x + size.w / 2 - totalW / 2;
      for (let i = 0; i < children.length; i++) {
        layoutTree(children[i], startX, y + size.h + vGap * 2, direction);
        startX += childWidths[i] + hGap;
      }
    } else {
      const subtreeHeight = getSubtreeHeight(node);
      let startY = y + size.h / 2 - subtreeHeight / 2;
      for (const child of children) {
        const ch = getSubtreeHeight(child);
        const childRect = layout.get(child.id);
        const childH = childRect?.h ?? 30;
        const childW = childRect?.w ?? 60;
        const childY = startY + ch / 2 - childH / 2;
        const childX = direction === 'right'
          ? x + size.w + hGap
          : x - childW - hGap;
        layoutTree(child, childX, childY, direction);
        startY += ch + vGap;
      }
    }
  };

  const elLayout = el.layout || 'mindmap_right';
  if (elLayout === 'tree_down') {
    layoutTree(root, el.x, el.y, 'down');
  } else if (elLayout === 'mindmap_left') {
    layoutTree(root, el.x, el.y, 'left');
  } else if (elLayout === 'mindmap_lr') {
    const size = measure(root);
    layout.set(root.id, { x: el.x, y: el.y, w: size.w, h: size.h });

    const rightChildren = root.rightChildren?.length ? root.rightChildren : root.children;
    const leftChildren = root.leftChildren || [];

    let totalRH = 0;
    for (const child of rightChildren) totalRH += getSubtreeHeight(child);
    totalRH += Math.max(0, rightChildren.length - 1) * vGap;
    let ry = el.y + size.h / 2 - totalRH / 2;
    for (const child of rightChildren) {
      const ch = getSubtreeHeight(child);
      const childH = layout.get(child.id)?.h ?? 30;
      layoutTree(child, el.x + size.w + hGap, ry + ch / 2 - childH / 2, 'right');
      ry += ch + vGap;
    }

    let totalLH = 0;
    for (const child of leftChildren) totalLH += getSubtreeHeight(child);
    totalLH += Math.max(0, leftChildren.length - 1) * vGap;
    let ly = el.y + size.h / 2 - totalLH / 2;
    for (const child of leftChildren) {
      const ch = getSubtreeHeight(child);
      const childRect = layout.get(child.id);
      const childH = childRect?.h ?? 30;
      const childW = childRect?.w ?? 60;
      layoutTree(child, el.x - childW - hGap, ly + ch / 2 - childH / 2, 'left');
      ly += ch + vGap;
    }
  } else {
    layoutTree(root, el.x, el.y, 'right');
  }

  return layout;
}
