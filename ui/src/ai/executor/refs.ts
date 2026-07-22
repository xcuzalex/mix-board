import type { Element } from '../../types/element';
import type { ElementReference } from '../schema/types';

export function describeReference(reference: ElementReference) {
  return 'id' in reference ? `id:${reference.id}` : `ref:${reference.ref}`;
}

export function registerReference(refMap: Map<string, string>, ref: string | undefined, id: string) {
  if (!ref) return;
  if (refMap.has(ref)) {
    throw new Error(`Duplicate ref "${ref}".`);
  }
  refMap.set(ref, id);
}

export function resolveReferenceId(refMap: Map<string, string>, reference: ElementReference): string {
  if ('id' in reference) {
    return reference.id;
  }
  const resolved = refMap.get(reference.ref);
  if (!resolved) {
    throw new Error(`Unknown ref "${reference.ref}".`);
  }
  return resolved;
}

export function resolveReferenceElement(
  elements: Element[],
  refMap: Map<string, string>,
  reference: ElementReference,
): Element {
  const id = resolveReferenceId(refMap, reference);
  const element = elements.find((candidate) => candidate.id === id);
  if (!element) {
    throw new Error(`Element not found for ${describeReference(reference)}.`);
  }
  return element;
}

export function resolveReferenceElements(
  elements: Element[],
  refMap: Map<string, string>,
  references: ElementReference[],
): Element[] {
  return references.map((reference) => resolveReferenceElement(elements, refMap, reference));
}
