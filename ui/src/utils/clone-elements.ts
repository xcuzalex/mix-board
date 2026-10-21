import { normalizeLinearPoints } from '../canvas/linear';
import type { Binding, Element, LinearElement } from '../types/element';
import { generateId } from './id';

/**
 * Copies elements for paste / duplicate. Every copy gets a fresh id, groups get
 * fresh group ids (so a pasted group is its own group), and references between
 * copied elements (arrow bindings, frame/container/child ids) point at the
 * copies. References to elements outside the batch are dropped; an arrow that
 * loses a binding keeps the endpoint it was drawn at, via `resolvePoints`.
 */
export function cloneElementsWithNewIds(
  sources: Element[],
  offset: number,
  resolvePoints?: (el: LinearElement) => [number, number][],
): Element[] {
  const idMap = new Map(sources.map((el) => [el.id, generateId()]));
  const groupMap = new Map<string, string>();
  const newGroupId = (groupId: string) => {
    let next = groupMap.get(groupId);
    if (!next) {
      next = generateId();
      groupMap.set(groupId, next);
    }
    return next;
  };
  const remapBinding = (binding: Binding | null | undefined): Binding | null => {
    const target = binding ? idMap.get(binding.elementId) : undefined;
    return binding && target ? { ...binding, elementId: target } : null;
  };
  const now = Date.now();

  return sources.map((source) => {
    const el = structuredClone(source) as Element & Record<string, unknown>;
    el.id = idMap.get(source.id)!;
    el.createdAt = now;
    el.updatedAt = now;
    el.groupIds = source.groupIds.map(newGroupId);
    el.frameId = (source.frameId && idMap.get(source.frameId)) || null;
    el.boundElements = (source.boundElements ?? [])
      .filter((bound) => idMap.has(bound.id))
      .map((bound) => ({ ...bound, id: idMap.get(bound.id)! }));
    if ('containerId' in source) {
      el.containerId = (source.containerId && idMap.get(source.containerId as string)) || null;
    }
    if ('childElementIds' in source && Array.isArray(source.childElementIds)) {
      el.childElementIds = (source.childElementIds as string[])
        .filter((id) => idMap.has(id))
        .map((id) => idMap.get(id)!);
    }

    if (source.type === 'line' || source.type === 'arrow') {
      const linear = el as unknown as LinearElement;
      const startBinding = remapBinding(source.startBinding);
      const endBinding = remapBinding(source.endBinding);
      const lostBinding = (source.startBinding && !startBinding) || (source.endBinding && !endBinding);
      if (lostBinding && resolvePoints) {
        // Freeze the drawn geometry before the binding that defined it goes away.
        Object.assign(linear, normalizeLinearPoints(resolvePoints(source)));
      }
      linear.startBinding = startBinding;
      linear.endBinding = endBinding;
    }

    el.x += offset;
    el.y += offset;
    return el as Element;
  });
}
