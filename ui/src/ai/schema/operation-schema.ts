import {
  AI_ARROW_TYPES,
  AI_BRANCH_STYLES,
  AI_CONNECTOR_SHAPES,
  AI_FILL_STYLES,
  AI_MINDMAP_LAYOUTS,
  AI_NOTE_COLORS,
  AI_STROKE_STYLES,
} from '../capabilities';
import { AI_SUPPORTED_ELEMENT_TYPES } from '../types';
import {
  AI_PLAN_SCHEMA_VERSION,
  ALIGNMENT_VALUES,
  DISTRIBUTION_DIRECTIONS,
  REORDER_ACTIONS,
  type AIOperation,
  type AIOperationPlan,
  type ElementReference,
  type ElementUpdatePatch,
  type MindmapNodeInput,
} from './types';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: ValidationIssue[] };

const ELEMENT_UPDATE_FIELDS = new Set<keyof ElementUpdatePatch>([
  'x',
  'y',
  'width',
  'height',
  'text',
  'title',
  'strokeColor',
  'strokeWidth',
  'strokeStyle',
  'backgroundColor',
  'fillStyle',
  'opacity',
  'roundness',
  'fontSize',
  'fontFamily',
  'textAlign',
  'shapeVariant',
  'connectorShape',
  'startArrowType',
  'endArrowType',
  'noteColor',
  'layout',
  'branchStyle',
  'points',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyOneReferenceKey(value: Record<string, unknown>) {
  const hasId = isString(value.id);
  const hasRef = isString(value.ref);
  return (hasId || hasRef) && !(hasId && hasRef);
}

function validateReference(value: unknown, path: string, issues: ValidationIssue[]): value is ElementReference {
  if (!isRecord(value) || !hasOnlyOneReferenceKey(value)) {
    issues.push({ path, message: 'Expected exactly one of "id" or "ref".' });
    return false;
  }
  return true;
}

function validateReferenceArray(value: unknown, path: string, issues: ValidationIssue[]): value is ElementReference[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: 'Expected a non-empty reference array.' });
    return false;
  }

  let valid = true;
  value.forEach((item, index) => {
    if (!validateReference(item, `${path}[${index}]`, issues)) {
      valid = false;
    }
  });
  return valid;
}

function validatePoints(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'Expected an array of points.' });
    return false;
  }

  let valid = true;
  value.forEach((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !isNumber(point[0]) || !isNumber(point[1])) {
      issues.push({ path: `${path}[${index}]`, message: 'Expected a [x, y] numeric tuple.' });
      valid = false;
    }
  });
  return valid;
}

function validateElementProps(value: unknown, path: string, issues: ValidationIssue[], requirePosition: boolean) {
  if (!isRecord(value)) {
    issues.push({ path, message: 'Expected an object.' });
    return false;
  }

  if (requirePosition) {
    if (!isNumber(value.x)) issues.push({ path: `${path}.x`, message: 'Expected a number.' });
    if (!isNumber(value.y)) issues.push({ path: `${path}.y`, message: 'Expected a number.' });
  }

  const optionalNumberFields = ['width', 'height', 'strokeWidth', 'opacity', 'roundness', 'fontSize'] as const;
  optionalNumberFields.forEach((field) => {
    const candidate = value[field];
    if (candidate !== undefined && !isNumber(candidate)) {
      issues.push({ path: `${path}.${field}`, message: 'Expected a number.' });
    }
  });

  const optionalStringFields = ['text', 'title', 'strokeColor', 'backgroundColor', 'fontFamily', 'shapeVariant'] as const;
  optionalStringFields.forEach((field) => {
    const candidate = value[field];
    if (candidate !== undefined && typeof candidate !== 'string') {
      issues.push({ path: `${path}.${field}`, message: 'Expected a string.' });
    }
  });

  if (value.strokeStyle !== undefined && !AI_STROKE_STYLES.includes(value.strokeStyle as typeof AI_STROKE_STYLES[number])) {
    issues.push({ path: `${path}.strokeStyle`, message: 'Unsupported strokeStyle.' });
  }
  if (value.fillStyle !== undefined && !AI_FILL_STYLES.includes(value.fillStyle as typeof AI_FILL_STYLES[number])) {
    issues.push({ path: `${path}.fillStyle`, message: 'Unsupported fillStyle.' });
  }
  if (value.connectorShape !== undefined && !AI_CONNECTOR_SHAPES.includes(value.connectorShape as typeof AI_CONNECTOR_SHAPES[number])) {
    issues.push({ path: `${path}.connectorShape`, message: 'Unsupported connectorShape.' });
  }
  if (value.startArrowType !== undefined && !AI_ARROW_TYPES.includes(value.startArrowType as typeof AI_ARROW_TYPES[number])) {
    issues.push({ path: `${path}.startArrowType`, message: 'Unsupported startArrowType.' });
  }
  if (value.endArrowType !== undefined && !AI_ARROW_TYPES.includes(value.endArrowType as typeof AI_ARROW_TYPES[number])) {
    issues.push({ path: `${path}.endArrowType`, message: 'Unsupported endArrowType.' });
  }
  if (value.noteColor !== undefined && !AI_NOTE_COLORS.includes(value.noteColor as typeof AI_NOTE_COLORS[number])) {
    issues.push({ path: `${path}.noteColor`, message: 'Unsupported noteColor.' });
  }
  if (value.layout !== undefined && !AI_MINDMAP_LAYOUTS.includes(value.layout as typeof AI_MINDMAP_LAYOUTS[number])) {
    issues.push({ path: `${path}.layout`, message: 'Unsupported layout.' });
  }
  if (value.branchStyle !== undefined && !AI_BRANCH_STYLES.includes(value.branchStyle as typeof AI_BRANCH_STYLES[number])) {
    issues.push({ path: `${path}.branchStyle`, message: 'Unsupported branchStyle.' });
  }
  if (value.points !== undefined) {
    validatePoints(value.points, `${path}.points`, issues);
  }

  return true;
}

function validateUpdatePatch(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push({ path, message: 'Expected an object.' });
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    issues.push({ path, message: 'Expected at least one change field.' });
    return false;
  }

  keys.forEach((key) => {
    if (!ELEMENT_UPDATE_FIELDS.has(key as keyof ElementUpdatePatch)) {
      issues.push({ path: `${path}.${key}`, message: 'Unsupported update field.' });
    }
  });

  validateElementProps(value, path, issues, false);
  return true;
}

function validateMindmapNodeInput(value: unknown, path: string, issues: ValidationIssue[]): value is MindmapNodeInput {
  if (!isRecord(value)) {
    issues.push({ path, message: 'Expected an object.' });
    return false;
  }

  if (!isString(value.text)) {
    issues.push({ path: `${path}.text`, message: 'Expected a non-empty string.' });
  }
  if (value.description !== undefined && value.description !== null && typeof value.description !== 'string') {
    issues.push({ path: `${path}.description`, message: 'Expected a string or null.' });
  }
  if (value.backgroundColor !== undefined && typeof value.backgroundColor !== 'string') {
    issues.push({ path: `${path}.backgroundColor`, message: 'Expected a string.' });
  }
  if (value.textColor !== undefined && typeof value.textColor !== 'string') {
    issues.push({ path: `${path}.textColor`, message: 'Expected a string.' });
  }
  if (value.fontSize !== undefined && !isNumber(value.fontSize)) {
    issues.push({ path: `${path}.fontSize`, message: 'Expected a number.' });
  }
  if (value.nodeShape !== undefined && !['text', 'rounded_rect', 'pill'].includes(value.nodeShape as string)) {
    issues.push({ path: `${path}.nodeShape`, message: 'Unsupported nodeShape.' });
  }
  return true;
}

function validateOperation(value: unknown, index: number, issues: ValidationIssue[]): value is AIOperation {
  const path = `operations[${index}]`;
  if (!isRecord(value) || !isString(value.op)) {
    issues.push({ path, message: 'Expected an operation object with "op".' });
    return false;
  }

  switch (value.op) {
    case 'add_element':
      if (value.ref !== undefined && !isString(value.ref)) {
        issues.push({ path: `${path}.ref`, message: 'Expected a non-empty string.' });
      }
      if (!AI_SUPPORTED_ELEMENT_TYPES.includes(value.elementType as typeof AI_SUPPORTED_ELEMENT_TYPES[number])) {
        issues.push({ path: `${path}.elementType`, message: 'Unsupported elementType.' });
      }
      validateElementProps(value.props, `${path}.props`, issues, true);
      return true;
    case 'update_element':
      validateReference(value.target, `${path}.target`, issues);
      validateUpdatePatch(value.changes, `${path}.changes`, issues);
      return true;
    case 'delete_elements':
    case 'group_elements':
    case 'ungroup_elements':
      validateReferenceArray(value.targets, `${path}.targets`, issues);
      return true;
    case 'move_elements':
      validateReferenceArray(value.targets, `${path}.targets`, issues);
      if (!isNumber(value.dx)) issues.push({ path: `${path}.dx`, message: 'Expected a number.' });
      if (!isNumber(value.dy)) issues.push({ path: `${path}.dy`, message: 'Expected a number.' });
      return true;
    case 'connect_elements':
      validateReference(value.from, `${path}.from`, issues);
      validateReference(value.to, `${path}.to`, issues);
      if (!isRecord(value.connector)) {
        issues.push({ path: `${path}.connector`, message: 'Expected an object.' });
        return true;
      }
      if (!['line', 'arrow'].includes(value.connector.type as string)) {
        issues.push({ path: `${path}.connector.type`, message: 'Unsupported connector type.' });
      }
      validateElementProps(value.connector, `${path}.connector`, issues, false);
      return true;
    case 'align_elements':
      validateReferenceArray(value.targets, `${path}.targets`, issues);
      if (!ALIGNMENT_VALUES.includes(value.alignment as typeof ALIGNMENT_VALUES[number])) {
        issues.push({ path: `${path}.alignment`, message: 'Unsupported alignment.' });
      }
      return true;
    case 'distribute_elements':
      validateReferenceArray(value.targets, `${path}.targets`, issues);
      if (!DISTRIBUTION_DIRECTIONS.includes(value.direction as typeof DISTRIBUTION_DIRECTIONS[number])) {
        issues.push({ path: `${path}.direction`, message: 'Unsupported distribution direction.' });
      }
      return true;
    case 'reorder_elements':
      validateReferenceArray(value.targets, `${path}.targets`, issues);
      if (!REORDER_ACTIONS.includes(value.action as typeof REORDER_ACTIONS[number])) {
        issues.push({ path: `${path}.action`, message: 'Unsupported reorder action.' });
      }
      return true;
    case 'mindmap_add_child':
      validateReference(value.target, `${path}.target`, issues);
      if (!isString(value.parentNodeId)) issues.push({ path: `${path}.parentNodeId`, message: 'Expected a non-empty string.' });
      validateMindmapNodeInput(value.node, `${path}.node`, issues);
      return true;
    case 'mindmap_add_sibling':
      validateReference(value.target, `${path}.target`, issues);
      if (!isString(value.siblingNodeId)) issues.push({ path: `${path}.siblingNodeId`, message: 'Expected a non-empty string.' });
      validateMindmapNodeInput(value.node, `${path}.node`, issues);
      return true;
    case 'mindmap_update_node':
      validateReference(value.target, `${path}.target`, issues);
      if (!isString(value.nodeId)) issues.push({ path: `${path}.nodeId`, message: 'Expected a non-empty string.' });
      if (!isRecord(value.changes) || Object.keys(value.changes).length === 0) {
        issues.push({ path: `${path}.changes`, message: 'Expected a non-empty object.' });
      } else {
        const changes = value.changes;
        if (changes.text !== undefined && !isString(changes.text)) {
          issues.push({ path: `${path}.changes.text`, message: 'Expected a non-empty string.' });
        }
        if (changes.description !== undefined && changes.description !== null && typeof changes.description !== 'string') {
          issues.push({ path: `${path}.changes.description`, message: 'Expected a string or null.' });
        }
        if (changes.backgroundColor !== undefined && typeof changes.backgroundColor !== 'string') {
          issues.push({ path: `${path}.changes.backgroundColor`, message: 'Expected a string.' });
        }
        if (changes.textColor !== undefined && typeof changes.textColor !== 'string') {
          issues.push({ path: `${path}.changes.textColor`, message: 'Expected a string.' });
        }
        if (changes.fontSize !== undefined && !isNumber(changes.fontSize)) {
          issues.push({ path: `${path}.changes.fontSize`, message: 'Expected a number.' });
        }
        if (changes.nodeShape !== undefined && !['text', 'rounded_rect', 'pill'].includes(changes.nodeShape as string)) {
          issues.push({ path: `${path}.changes.nodeShape`, message: 'Unsupported nodeShape.' });
        }
      }
      return true;
    case 'mindmap_move_node':
      validateReference(value.target, `${path}.target`, issues);
      if (!isString(value.nodeId)) issues.push({ path: `${path}.nodeId`, message: 'Expected a non-empty string.' });
      if (!isString(value.nextParentNodeId)) {
        issues.push({ path: `${path}.nextParentNodeId`, message: 'Expected a non-empty string.' });
      }
      return true;
    default:
      issues.push({ path: `${path}.op`, message: `Unsupported operation "${String(value.op)}".` });
      return false;
  }
}

export function validateOperationPlan(input: unknown): ValidationResult<AIOperationPlan> {
  if (!isRecord(input)) {
    return { success: false, issues: [{ path: '', message: 'Expected an object.' }] };
  }

  // Default missing top-level fields
  if (input.schemaVersion === undefined) input.schemaVersion = AI_PLAN_SCHEMA_VERSION;
  if (typeof input.summary !== 'string') input.summary = '';
  if (typeof input.intent !== 'string') input.intent = '';

  if (!Array.isArray(input.operations)) {
    input.operations = [];
  } else {
    // Filter out invalid operations instead of failing the entire plan.
    // This way partial results still get executed.
    const validOps: unknown[] = [];
    for (const operation of input.operations) {
      const opIssues: ValidationIssue[] = [];
      if (validateOperation(operation, validOps.length, opIssues)) {
        // Only keep operations with no blocking issues
        if (opIssues.length === 0) {
          validOps.push(operation);
        }
      }
    }
    input.operations = validOps;
  }

  return { success: true, value: input as unknown as AIOperationPlan };
}

/**
 * Normalize common model output variations before strict validation.
 * Many models use "type" instead of "op", or "action" instead of "op".
 */
/** Normalize a single reference field: string → { id: string } */
function normalizeRefField(op: Record<string, unknown>, field: string) {
  if (typeof op[field] === 'string') {
    op[field] = { id: op[field] };
  }
}

/** Normalize a reference array: ["id1", "id2"] → [{id:"id1"},{id:"id2"}] */
function normalizeRefArray(op: Record<string, unknown>, field: string) {
  if (!Array.isArray(op[field])) return;
  op[field] = (op[field] as unknown[]).map((item) =>
    typeof item === 'string' ? { id: item } : item
  );
}

function normalizeOperations(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.operations)) return input;

  input.operations = input.operations.map((op: unknown) => {
    if (!isRecord(op)) return op;
    // Map common alternative field names → "op"
    if (!op.op && typeof op.type === 'string') {
      op.op = op.type;
      delete op.type;
    }
    if (!op.op && typeof op.action === 'string') {
      op.op = op.action;
      delete op.action;
    }
    // Normalize connector.type — models often use variations
    if (isRecord(op.connector) && typeof op.connector.type === 'string') {
      const ct = op.connector.type.toLowerCase();
      if (ct === 'line' || ct === 'straight' || ct === 'polyline') {
        op.connector.type = 'line';
      } else {
        op.connector.type = 'arrow';
      }
    }
    // Normalize target references — models often use plain strings instead of {id: "..."}
    normalizeRefField(op, 'target');
    normalizeRefField(op, 'from');
    normalizeRefField(op, 'to');
    normalizeRefArray(op, 'targets');
    return op;
  });

  // Default missing top-level fields
  if (input.schemaVersion === undefined) input.schemaVersion = AI_PLAN_SCHEMA_VERSION;

  return input;
}

/**
 * Try to extract a JSON object from a string that may contain surrounding text.
 * Models often prefix JSON with explanatory text like "我来帮你创建...\n\n{...}".
 */
function extractJson(raw: string): string | null {
  // Strip markdown code fences
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '').trim();
  }

  // If it already starts with {, use as-is
  if (cleaned.startsWith('{')) return cleaned;

  // Find the first { and last } — extract the JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

export function parseOperationPlan(raw: string): ValidationResult<AIOperationPlan> {
  const jsonStr = extractJson(raw);

  if (!jsonStr) {
    // No JSON found — the model returned pure conversational text.
    // Treat it as a valid plan with no operations so the UI can display it.
    return {
      success: true,
      value: {
        schemaVersion: AI_PLAN_SCHEMA_VERSION,
        intent: '',
        summary: raw.trim(),
        operations: [],
      } as AIOperationPlan,
    };
  }

  try {
    const parsed = normalizeOperations(JSON.parse(jsonStr));
    return validateOperationPlan(parsed);
  } catch (error) {
    return {
      success: false,
      issues: [{
        path: '',
        message: `JSON Parse error: ${error instanceof Error ? error.message : 'Failed to parse JSON.'}`,
      }],
    };
  }
}
