import type {
  ArrowType,
  BranchStyle,
  ConnectorShape,
  ElementType,
  FillStyle,
  MindmapLayout,
  NoteColor,
  ShapeVariant,
  StrokeStyle,
} from '../types/element';

export const AI_SUPPORTED_ELEMENT_TYPES = [
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'text',
  'sticky_note',
  'line',
  'arrow',
  'section',
  'frame',
  'mindmap',
] as const satisfies readonly ElementType[];

export type AISupportedElementType = (typeof AI_SUPPORTED_ELEMENT_TYPES)[number];

export const AI_OPERATION_NAMES = [
  'add_element',
  'update_element',
  'delete_elements',
  'move_elements',
  'connect_elements',
  'align_elements',
  'distribute_elements',
  'group_elements',
  'ungroup_elements',
  'reorder_elements',
  'mindmap_add_child',
  'mindmap_add_sibling',
  'mindmap_update_node',
  'mindmap_move_node',
] as const;

export type AIOperationName = (typeof AI_OPERATION_NAMES)[number];

export interface BoardCapabilityManifest {
  version: 'mixboard.ai/v1';
  supportedElementTypes: AISupportedElementType[];
  supportedShapeVariants: ShapeVariant[];
  supportedOperations: AIOperationName[];
  enumValues: {
    strokeStyle: StrokeStyle[];
    fillStyle: FillStyle[];
    connectorShape: ConnectorShape[];
    arrowType: ArrowType[];
    noteColor: NoteColor[];
    mindmapLayout: MindmapLayout[];
    branchStyle: BranchStyle[];
  };
  limits: {
    maxOperationsPerTurn: number;
    enableImageGeneration: boolean;
    enableTable: boolean;
  };
}
