import { generateId } from '../../utils/id';
import type { MindmapNode, NodeShape } from '../../types/element';
import type { MindmapNodeInput } from '../schema/types';

function mapNodeChildren(node: MindmapNode, mapper: (node: MindmapNode) => MindmapNode): MindmapNode {
  const next = mapper(node);
  return {
    ...next,
    children: next.children.map((child) => mapNodeChildren(child, mapper)),
    leftChildren: next.leftChildren.map((child) => mapNodeChildren(child, mapper)),
    rightChildren: next.rightChildren.map((child) => mapNodeChildren(child, mapper)),
  };
}

export function findMindmapNode(root: MindmapNode, nodeId: string): MindmapNode | null {
  if (root.id === nodeId) return root;

  const children = [...root.children, ...root.leftChildren, ...root.rightChildren];
  for (const child of children) {
    const next = findMindmapNode(child, nodeId);
    if (next) return next;
  }
  return null;
}

export function createMindmapNode(input: MindmapNodeInput, nodeType: 'branch' | 'leaf'): MindmapNode {
  const nodeShape: NodeShape = input.nodeShape ?? 'rounded_rect';
  return {
    id: generateId(),
    text: input.text,
    description: input.description ?? null,
    nodeType,
    nodeShape,
    backgroundColor: input.backgroundColor ?? (nodeType === 'leaf' ? '#E7F5EE' : '#E7F5EE'),
    textColor: input.textColor ?? '#234032',
    fontSize: input.fontSize ?? 14,
    collapsed: false,
    children: [],
    leftChildren: [],
    rightChildren: [],
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
    leftChildren: root.leftChildren.map((child) => addMindmapChild(child, parentId, node)),
    rightChildren: root.rightChildren.map((child) => addMindmapChild(child, parentId, node)),
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

      const [nextChildren, childInserted] = insertInto(current.children);
      const [nextLeftChildren, leftInserted] = insertInto(current.leftChildren);
      const [nextRightChildren, rightInserted] = insertInto(current.rightChildren);

      if (childInserted || leftInserted || rightInserted) {
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
  const [leftChildren, insertedInLeft] = insertInto(root.leftChildren);
  const [rightChildren, insertedInRight] = insertInto(root.rightChildren);

  if (insertedInChildren || insertedInLeft || insertedInRight) {
    return {
      ...root,
      children,
      leftChildren,
      rightChildren,
    };
  }

  return root;
}

export function updateMindmapNode(root: MindmapNode, nodeId: string, changes: Partial<MindmapNodeInput>): MindmapNode {
  return mapNodeChildren(root, (node) => {
    if (node.id !== nodeId) return node;

    return {
      ...node,
      text: changes.text ?? node.text,
      description: changes.description ?? node.description ?? null,
      nodeShape: changes.nodeShape ?? node.nodeShape,
      backgroundColor: changes.backgroundColor ?? node.backgroundColor,
      textColor: changes.textColor ?? node.textColor,
      fontSize: changes.fontSize ?? node.fontSize,
    };
  });
}

function extractMindmapNode(root: MindmapNode, nodeId: string): { root: MindmapNode; extracted: MindmapNode | null } {
  const extractFromList = (nodes: MindmapNode[]): { nodes: MindmapNode[]; extracted: MindmapNode | null } => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) {
        return {
          nodes: [...nodes.slice(0, index), ...nodes.slice(index + 1)],
          extracted: node,
        };
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

      const nextLeftChildren = extractFromList(node.leftChildren);
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

      const nextRightChildren = extractFromList(node.rightChildren);
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

  const nextLeftChildren = extractFromList(root.leftChildren);
  if (nextLeftChildren.extracted) {
    return { root: { ...root, leftChildren: nextLeftChildren.nodes }, extracted: nextLeftChildren.extracted };
  }

  const nextRightChildren = extractFromList(root.rightChildren);
  if (nextRightChildren.extracted) {
    return { root: { ...root, rightChildren: nextRightChildren.nodes }, extracted: nextRightChildren.extracted };
  }

  return { root, extracted: null };
}

export function moveMindmapNode(root: MindmapNode, nodeId: string, nextParentNodeId: string): MindmapNode {
  if (nodeId === nextParentNodeId || root.id === nodeId) return root;

  const draggedNode = findMindmapNode(root, nodeId);
  if (!draggedNode || findMindmapNode(draggedNode, nextParentNodeId)) {
    return root;
  }

  const { root: withoutNode, extracted } = extractMindmapNode(root, nodeId);
  if (!extracted) return root;

  return addMindmapChild(withoutNode, nextParentNodeId, extracted);
}
