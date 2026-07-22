import type {
  ArrowType,
  BranchStyle,
  ConnectorShape,
  FillStyle,
  MindmapLayout,
  NoteColor,
  ShapeVariant,
  StrokeStyle,
} from '../types/element';
import {
  AI_OPERATION_NAMES,
  AI_SUPPORTED_ELEMENT_TYPES,
  type BoardCapabilityManifest,
} from './types';

export const AI_SUPPORTED_SHAPE_VARIANTS = [
  'rectangle',
  'round_rectangle',
  'pill',
  'ellipse',
  'diamond',
  'triangle',
  'hexagon',
  'octagon',
  'parallelogram',
  'trapezoid',
  'star',
  'speech_bubble',
  'cloud',
  'cylinder',
  'document',
  'multi_document',
  'predefined_process',
  'manual_input',
  'display',
  'delay',
  'internal_storage',
  'class_box',
  'package',
  'weak_entity',
  'weak_relationship',
  'component',
  'start_state',
  'end_state',
  'sync_bar',
  'actor',
  'arrow_left',
  'arrow_right',
  'double_arrow',
  'plus',
] as const satisfies readonly ShapeVariant[];

export const AI_STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const satisfies readonly StrokeStyle[];
export const AI_FILL_STYLES = ['solid', 'hachure', 'cross-hatch', 'none'] as const satisfies readonly FillStyle[];
export const AI_CONNECTOR_SHAPES = ['straight', 'polyline', 'curve', 'right_angled_polyline'] as const satisfies readonly ConnectorShape[];
export const AI_ARROW_TYPES = [
  'none',
  'arrow',
  'open_arrow',
  'hollow_arrow',
  'diamond',
  'hollow_diamond',
  'circle',
  'hollow_circle',
  'bar',
  'triangle',
  'hollow_triangle',
] as const satisfies readonly ArrowType[];
export const AI_NOTE_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange', 'red', 'gray', 'white'] as const satisfies readonly NoteColor[];
export const AI_MINDMAP_LAYOUTS = [
  'mindmap_lr',
  'mindmap_right',
  'mindmap_left',
  'tree_down',
  'tree_right',
  'org_chart',
  'timeline',
] as const satisfies readonly MindmapLayout[];
export const AI_BRANCH_STYLES = ['curve', 'polyline'] as const satisfies readonly BranchStyle[];

export const BOARD_CAPABILITY_MANIFEST: BoardCapabilityManifest = {
  version: 'mixboard.ai/v1',
  supportedElementTypes: [...AI_SUPPORTED_ELEMENT_TYPES],
  supportedShapeVariants: [...AI_SUPPORTED_SHAPE_VARIANTS],
  supportedOperations: [...AI_OPERATION_NAMES],
  enumValues: {
    strokeStyle: [...AI_STROKE_STYLES],
    fillStyle: [...AI_FILL_STYLES],
    connectorShape: [...AI_CONNECTOR_SHAPES],
    arrowType: [...AI_ARROW_TYPES],
    noteColor: [...AI_NOTE_COLORS],
    mindmapLayout: [...AI_MINDMAP_LAYOUTS],
    branchStyle: [...AI_BRANCH_STYLES],
  },
  limits: {
    maxOperationsPerTurn: 32,
    enableImageGeneration: false,
    enableTable: false,
  },
};
