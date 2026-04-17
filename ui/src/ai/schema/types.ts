import type {
  ArrowType,
  BranchStyle,
  ConnectorShape,
  FillStyle,
  MindmapLayout,
  NodeShape,
  NoteColor,
  ShapeVariant,
  StrokeStyle,
  TextAlign,
} from '../../types/element';
import type { AISupportedElementType } from '../types';

export const AI_PLAN_SCHEMA_VERSION = 'mixboard.ai/v1' as const;

export type ElementReference =
  | { id: string }
  | { ref: string };

export const ALIGNMENT_VALUES = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
export type ElementAlignment = (typeof ALIGNMENT_VALUES)[number];

export const DISTRIBUTION_DIRECTIONS = ['horizontal', 'vertical'] as const;
export type DistributionDirection = (typeof DISTRIBUTION_DIRECTIONS)[number];

export const REORDER_ACTIONS = [
  'bring_to_front',
  'send_to_back',
  'bring_forward',
  'send_backward',
] as const;
export type ReorderAction = (typeof REORDER_ACTIONS)[number];

export interface ElementPropsInput {
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  title?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  opacity?: number;
  roundness?: number;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: TextAlign;
  shapeVariant?: ShapeVariant;
  connectorShape?: ConnectorShape;
  startArrowType?: ArrowType;
  endArrowType?: ArrowType;
  noteColor?: NoteColor;
  layout?: MindmapLayout;
  branchStyle?: BranchStyle;
  points?: [number, number][];
}

export type ElementUpdatePatch = Partial<ElementPropsInput>;

export interface MindmapNodeInput {
  text: string;
  description?: string | null;
  nodeShape?: NodeShape;
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
}

export interface AddElementOperation {
  op: 'add_element';
  ref?: string;
  elementType: AISupportedElementType;
  props: ElementPropsInput;
}

export interface UpdateElementOperation {
  op: 'update_element';
  target: ElementReference;
  changes: ElementUpdatePatch;
}

export interface DeleteElementsOperation {
  op: 'delete_elements';
  targets: ElementReference[];
}

export interface MoveElementsOperation {
  op: 'move_elements';
  targets: ElementReference[];
  dx: number;
  dy: number;
}

export interface ConnectElementsOperation {
  op: 'connect_elements';
  from: ElementReference;
  to: ElementReference;
  connector: {
    type: 'line' | 'arrow';
    connectorShape?: ConnectorShape;
    startArrowType?: ArrowType;
    endArrowType?: ArrowType;
  };
}

export interface AlignElementsOperation {
  op: 'align_elements';
  targets: ElementReference[];
  alignment: ElementAlignment;
}

export interface DistributeElementsOperation {
  op: 'distribute_elements';
  targets: ElementReference[];
  direction: DistributionDirection;
}

export interface GroupElementsOperation {
  op: 'group_elements';
  targets: ElementReference[];
}

export interface UngroupElementsOperation {
  op: 'ungroup_elements';
  targets: ElementReference[];
}

export interface ReorderElementsOperation {
  op: 'reorder_elements';
  targets: ElementReference[];
  action: ReorderAction;
}

export interface MindmapAddChildOperation {
  op: 'mindmap_add_child';
  target: ElementReference;
  parentNodeId: string;
  node: MindmapNodeInput;
}

export interface MindmapAddSiblingOperation {
  op: 'mindmap_add_sibling';
  target: ElementReference;
  siblingNodeId: string;
  node: MindmapNodeInput;
}

export interface MindmapUpdateNodeOperation {
  op: 'mindmap_update_node';
  target: ElementReference;
  nodeId: string;
  changes: Partial<MindmapNodeInput>;
}

export interface MindmapMoveNodeOperation {
  op: 'mindmap_move_node';
  target: ElementReference;
  nodeId: string;
  nextParentNodeId: string;
}

export type AIOperation =
  | AddElementOperation
  | UpdateElementOperation
  | DeleteElementsOperation
  | MoveElementsOperation
  | ConnectElementsOperation
  | AlignElementsOperation
  | DistributeElementsOperation
  | GroupElementsOperation
  | UngroupElementsOperation
  | ReorderElementsOperation
  | MindmapAddChildOperation
  | MindmapAddSiblingOperation
  | MindmapUpdateNodeOperation
  | MindmapMoveNodeOperation;

export interface AIOperationPlan {
  schemaVersion: typeof AI_PLAN_SCHEMA_VERSION;
  summary: string;
  intent: string;
  operations: AIOperation[];
}
