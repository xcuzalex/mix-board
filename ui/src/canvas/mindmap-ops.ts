/**
 * Mindmap tree operations — pure, immutable helpers for reading and editing a
 * mindmap node tree (find / visit / add child / add sibling / extract / move /
 * rename / create). Extracted from Canvas.tsx (P0.C).
 *
 * No React or canvas here; these are the tree-edit primitives the canvas
 * interactions (Tab/Enter, drag-reparent, inline rename) build on, and the
 * reusable core for the outline <-> mindmap work (P2).
 */
import type { MindmapNode } from '../types/element';
import { generateId } from '../utils/id';

/** Derives a new child's styling from an existing branch node, for visual consistency. */
export function getMindmapBranchTemplate(root: MindmapNode) {
  const sample = root.children[0] ?? root.rightChildren?.[0] ?? root.leftChildren?.[0];
  return {
    nodeShape: sample?.nodeShape ?? 'rounded_rect',
    backgroundColor: sample?.backgroundColor ?? '#E7F5EE',
    textColor: sample?.textColor ?? '#234032',
    fontSize: sample?.fontSize ?? 14,
  };
}

export function createMindmapTopic(
  nodeType: 'branch' | 'leaf' = 'branch',
  template?: Partial<Pick<MindmapNode, 'nodeShape' | 'backgroundColor' | 'textColor' | 'fontSize'>>,
): MindmapNode {
  return {
    id: generateId(),
    text: '新主题',
    nodeType,
    nodeShape: template?.nodeShape ?? 'rounded_rect',
    backgroundColor: template?.backgroundColor ?? '#E7F5EE',
    textColor: template?.textColor ?? '#234032',
    fontSize: template?.fontSize ?? 14,
    collapsed: false,
    children: [],
    leftChildren: [],
    rightChildren: [],
  };
}

export function findMindmapNode(root: MindmapNode, nodeId: string): MindmapNode | null {
  if (root.id === nodeId) return root;
  const children = [...root.children, ...(root.leftChildren || []), ...(root.rightChildren || [])];
  for (const child of children) {
    const result = findMindmapNode(child, nodeId);
    if (result) return result;
  }
  return null;
}

/** The parent node of `nodeId`, or null if `nodeId` is the root or not found. */
export function findMindmapParent(root: MindmapNode, nodeId: string): MindmapNode | null {
  const children = [...root.children, ...(root.leftChildren || []), ...(root.rightChildren || [])];
  for (const child of children) {
    if (child.id === nodeId) return root;
    const found = findMindmapParent(child, nodeId);
    if (found) return found;
  }
  return null;
}

/** Returns a new tree with `patch(node, depth)` merged into every node (root depth = 0). */
export function mapMindmapTree(
  root: MindmapNode,
  patch: (node: MindmapNode, depth: number) => Partial<MindmapNode> | null,
): MindmapNode {
  const walk = (node: MindmapNode, depth: number): MindmapNode => ({
    ...node,
    ...(patch(node, depth) ?? {}),
    children: node.children.map((c) => walk(c, depth + 1)),
    leftChildren: (node.leftChildren || []).map((c) => walk(c, depth + 1)),
    rightChildren: (node.rightChildren || []).map((c) => walk(c, depth + 1)),
  });
  return walk(root, 0);
}

/** Ordered sibling list a node belongs to (its parent's combined children). */
export function getMindmapSiblings(parent: MindmapNode): MindmapNode[] {
  return [...parent.children, ...(parent.leftChildren || []), ...(parent.rightChildren || [])];
}

export function visitMindmapNodes(root: MindmapNode, visit: (node: MindmapNode) => void) {
  visit(root);
  const children = [...root.children, ...(root.leftChildren || []), ...(root.rightChildren || [])];
  for (const child of children) {
    visitMindmapNodes(child, visit);
  }
}

export function updateMindmapNodeText(root: MindmapNode, nodeId: string, text: string): MindmapNode {
  if (root.id === nodeId) {
    return { ...root, text };
  }

  return {
    ...root,
    children: root.children.map((child) => updateMindmapNodeText(child, nodeId, text)),
    leftChildren: (root.leftChildren || []).map((child) => updateMindmapNodeText(child, nodeId, text)),
    rightChildren: (root.rightChildren || []).map((child) => updateMindmapNodeText(child, nodeId, text)),
  };
}

export function addMindmapChild(root: MindmapNode, parentId: string, node: MindmapNode): MindmapNode {
  if (root.id === parentId) {
    return {
      ...root,
      collapsed: false,
      children: [...root.children, node],
    };
  }

  return {
    ...root,
    children: root.children.map((child) => addMindmapChild(child, parentId, node)),
    leftChildren: (root.leftChildren || []).map((child) => addMindmapChild(child, parentId, node)),
    rightChildren: (root.rightChildren || []).map((child) => addMindmapChild(child, parentId, node)),
  };
}

export function addMindmapSibling(root: MindmapNode, targetId: string, node: MindmapNode): MindmapNode {
  const insertInto = (nodes: MindmapNode[]): [MindmapNode[], boolean] => {
    let inserted = false;
    const nextNodes = nodes.flatMap((current) => {
      if (current.id === targetId) {
        inserted = true;
        return [current, node];
      }

      const [nextChildren, insertedInChildren] = insertInto(current.children);
      const [nextLeftChildren, insertedInLeftChildren] = insertInto(current.leftChildren || []);
      const [nextRightChildren, insertedInRightChildren] = insertInto(current.rightChildren || []);

      if (insertedInChildren || insertedInLeftChildren || insertedInRightChildren) {
        inserted = true;
        return [{
          ...current,
          children: nextChildren,
          leftChildren: nextLeftChildren,
          rightChildren: nextRightChildren,
        }];
      }

      return [current];
    });

    return [nextNodes, inserted];
  };

  if (root.id === targetId) {
    return {
      ...root,
      collapsed: false,
      children: [...root.children, node],
    };
  }

  const [children, insertedInChildren] = insertInto(root.children);
  const [leftChildren, insertedInLeftChildren] = insertInto(root.leftChildren || []);
  const [rightChildren, insertedInRightChildren] = insertInto(root.rightChildren || []);

  if (insertedInChildren || insertedInLeftChildren || insertedInRightChildren) {
    return {
      ...root,
      children,
      leftChildren,
      rightChildren,
    };
  }

  return root;
}

export function extractMindmapNode(root: MindmapNode, nodeId: string): { root: MindmapNode; extracted: MindmapNode | null } {
  const extractFromList = (nodes: MindmapNode[]): { nodes: MindmapNode[]; extracted: MindmapNode | null } => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) {
        return { nodes: [...nodes.slice(0, index), ...nodes.slice(index + 1)], extracted: node };
      }

      const nextChildren = extractFromList(node.children);
      if (nextChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, children: nextChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextChildren.extracted,
        };
      }

      const nextLeftChildren = extractFromList(node.leftChildren || []);
      if (nextLeftChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, leftChildren: nextLeftChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextLeftChildren.extracted,
        };
      }

      const nextRightChildren = extractFromList(node.rightChildren || []);
      if (nextRightChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, rightChildren: nextRightChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextRightChildren.extracted,
        };
      }
    }

    return { nodes, extracted: null };
  };

  if (root.id === nodeId) {
    return { root, extracted: null };
  }

  const nextChildren = extractFromList(root.children);
  if (nextChildren.extracted) {
    return { root: { ...root, children: nextChildren.nodes }, extracted: nextChildren.extracted };
  }

  const nextLeftChildren = extractFromList(root.leftChildren || []);
  if (nextLeftChildren.extracted) {
    return { root: { ...root, leftChildren: nextLeftChildren.nodes }, extracted: nextLeftChildren.extracted };
  }

  const nextRightChildren = extractFromList(root.rightChildren || []);
  if (nextRightChildren.extracted) {
    return { root: { ...root, rightChildren: nextRightChildren.nodes }, extracted: nextRightChildren.extracted };
  }

  return { root, extracted: null };
}

export function moveMindmapNode(root: MindmapNode, nodeId: string, targetParentId: string): MindmapNode {
  if (root.id === nodeId || nodeId === targetParentId) return root;

  const draggedNode = findMindmapNode(root, nodeId);
  if (!draggedNode || findMindmapNode(draggedNode, targetParentId)) {
    return root;
  }

  const { root: withoutNode, extracted } = extractMindmapNode(root, nodeId);
  if (!extracted) return root;

  return addMindmapChild(withoutNode, targetParentId, extracted);
}
