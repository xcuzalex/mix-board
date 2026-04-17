import {
  AI_ARROW_TYPES,
  AI_BRANCH_STYLES,
  AI_CONNECTOR_SHAPES,
  AI_FILL_STYLES,
  AI_MINDMAP_LAYOUTS,
  AI_NOTE_COLORS,
  AI_STROKE_STYLES,
  AI_SUPPORTED_SHAPE_VARIANTS,
} from '../capabilities';
import { AI_SUPPORTED_ELEMENT_TYPES } from '../types';
import {
  AI_PLAN_SCHEMA_VERSION,
  ALIGNMENT_VALUES,
  DISTRIBUTION_DIRECTIONS,
  REORDER_ACTIONS,
} from './types';

const NUMBER_SCHEMA = { type: 'number' } as const;
const STRING_SCHEMA = { type: 'string' } as const;
const NON_EMPTY_STRING_SCHEMA = { type: 'string', minLength: 1 } as const;
const NULLABLE_STRING_SCHEMA = {
  anyOf: [
    { type: 'string' },
    { type: 'null' },
  ],
} as const;

const POINT_SCHEMA = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
} as const;

const POINTS_SCHEMA = {
  type: 'array',
  items: POINT_SCHEMA,
} as const;

const ELEMENT_REFERENCE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: NON_EMPTY_STRING_SCHEMA,
      },
      required: ['id'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: NON_EMPTY_STRING_SCHEMA,
      },
      required: ['ref'],
    },
  ],
} as const;

const ELEMENT_REFERENCE_ARRAY_SCHEMA = {
  type: 'array',
  minItems: 1,
  items: ELEMENT_REFERENCE_SCHEMA,
} as const;

const ELEMENT_PATCH_PROPERTIES = {
  x: NUMBER_SCHEMA,
  y: NUMBER_SCHEMA,
  width: NUMBER_SCHEMA,
  height: NUMBER_SCHEMA,
  text: STRING_SCHEMA,
  title: STRING_SCHEMA,
  strokeColor: STRING_SCHEMA,
  strokeWidth: NUMBER_SCHEMA,
  strokeStyle: { enum: [...AI_STROKE_STYLES] },
  backgroundColor: STRING_SCHEMA,
  fillStyle: { enum: [...AI_FILL_STYLES] },
  opacity: NUMBER_SCHEMA,
  roundness: NUMBER_SCHEMA,
  fontSize: NUMBER_SCHEMA,
  fontFamily: STRING_SCHEMA,
  textAlign: { enum: ['left', 'center', 'right'] },
  shapeVariant: { enum: [...AI_SUPPORTED_SHAPE_VARIANTS] },
  connectorShape: { enum: [...AI_CONNECTOR_SHAPES] },
  startArrowType: { enum: [...AI_ARROW_TYPES] },
  endArrowType: { enum: [...AI_ARROW_TYPES] },
  noteColor: { enum: [...AI_NOTE_COLORS] },
  layout: { enum: [...AI_MINDMAP_LAYOUTS] },
  branchStyle: { enum: [...AI_BRANCH_STYLES] },
  points: POINTS_SCHEMA,
} as const;

const ELEMENT_PROPS_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: ELEMENT_PATCH_PROPERTIES,
  required: ['x', 'y'],
} as const;

const ELEMENT_UPDATE_PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: ELEMENT_PATCH_PROPERTIES,
} as const;

const CONNECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { enum: ['line', 'arrow'] },
    connectorShape: { enum: [...AI_CONNECTOR_SHAPES] },
    startArrowType: { enum: [...AI_ARROW_TYPES] },
    endArrowType: { enum: [...AI_ARROW_TYPES] },
  },
  required: ['type'],
} as const;

const MINDMAP_NODE_INPUT_PROPERTIES = {
  text: NON_EMPTY_STRING_SCHEMA,
  description: NULLABLE_STRING_SCHEMA,
  nodeShape: { enum: ['text', 'rounded_rect', 'pill'] },
  backgroundColor: STRING_SCHEMA,
  textColor: STRING_SCHEMA,
  fontSize: NUMBER_SCHEMA,
} as const;

const MINDMAP_NODE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: MINDMAP_NODE_INPUT_PROPERTIES,
  required: ['text'],
} as const;

const MINDMAP_NODE_UPDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    text: NON_EMPTY_STRING_SCHEMA,
    description: NULLABLE_STRING_SCHEMA,
    nodeShape: { enum: ['text', 'rounded_rect', 'pill'] },
    backgroundColor: STRING_SCHEMA,
    textColor: STRING_SCHEMA,
    fontSize: NUMBER_SCHEMA,
  },
} as const;

const ADD_ELEMENT_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'add_element' },
    ref: NON_EMPTY_STRING_SCHEMA,
    elementType: { enum: [...AI_SUPPORTED_ELEMENT_TYPES] },
    props: ELEMENT_PROPS_INPUT_SCHEMA,
  },
  required: ['op', 'elementType', 'props'],
} as const;

const UPDATE_ELEMENT_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'update_element' },
    target: ELEMENT_REFERENCE_SCHEMA,
    changes: ELEMENT_UPDATE_PATCH_SCHEMA,
  },
  required: ['op', 'target', 'changes'],
} as const;

const DELETE_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'delete_elements' },
    targets: ELEMENT_REFERENCE_ARRAY_SCHEMA,
  },
  required: ['op', 'targets'],
} as const;

const MOVE_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'move_elements' },
    targets: ELEMENT_REFERENCE_ARRAY_SCHEMA,
    dx: NUMBER_SCHEMA,
    dy: NUMBER_SCHEMA,
  },
  required: ['op', 'targets', 'dx', 'dy'],
} as const;

const CONNECT_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'connect_elements' },
    from: ELEMENT_REFERENCE_SCHEMA,
    to: ELEMENT_REFERENCE_SCHEMA,
    connector: CONNECTOR_SCHEMA,
  },
  required: ['op', 'from', 'to', 'connector'],
} as const;

const ALIGN_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'align_elements' },
    targets: ELEMENT_REFERENCE_ARRAY_SCHEMA,
    alignment: { enum: [...ALIGNMENT_VALUES] },
  },
  required: ['op', 'targets', 'alignment'],
} as const;

const DISTRIBUTE_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'distribute_elements' },
    targets: ELEMENT_REFERENCE_ARRAY_SCHEMA,
    direction: { enum: [...DISTRIBUTION_DIRECTIONS] },
  },
  required: ['op', 'targets', 'direction'],
} as const;

const GROUP_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'group_elements' },
    targets: ELEMENT_REFERENCE_ARRAY_SCHEMA,
  },
  required: ['op', 'targets'],
} as const;

const UNGROUP_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'ungroup_elements' },
    targets: ELEMENT_REFERENCE_ARRAY_SCHEMA,
  },
  required: ['op', 'targets'],
} as const;

const REORDER_ELEMENTS_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'reorder_elements' },
    targets: ELEMENT_REFERENCE_ARRAY_SCHEMA,
    action: { enum: [...REORDER_ACTIONS] },
  },
  required: ['op', 'targets', 'action'],
} as const;

const MINDMAP_ADD_CHILD_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'mindmap_add_child' },
    target: ELEMENT_REFERENCE_SCHEMA,
    parentNodeId: NON_EMPTY_STRING_SCHEMA,
    node: MINDMAP_NODE_INPUT_SCHEMA,
  },
  required: ['op', 'target', 'parentNodeId', 'node'],
} as const;

const MINDMAP_ADD_SIBLING_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'mindmap_add_sibling' },
    target: ELEMENT_REFERENCE_SCHEMA,
    siblingNodeId: NON_EMPTY_STRING_SCHEMA,
    node: MINDMAP_NODE_INPUT_SCHEMA,
  },
  required: ['op', 'target', 'siblingNodeId', 'node'],
} as const;

const MINDMAP_UPDATE_NODE_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'mindmap_update_node' },
    target: ELEMENT_REFERENCE_SCHEMA,
    nodeId: NON_EMPTY_STRING_SCHEMA,
    changes: MINDMAP_NODE_UPDATE_SCHEMA,
  },
  required: ['op', 'target', 'nodeId', 'changes'],
} as const;

const MINDMAP_MOVE_NODE_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { const: 'mindmap_move_node' },
    target: ELEMENT_REFERENCE_SCHEMA,
    nodeId: NON_EMPTY_STRING_SCHEMA,
    nextParentNodeId: NON_EMPTY_STRING_SCHEMA,
  },
  required: ['op', 'target', 'nodeId', 'nextParentNodeId'],
} as const;

export const AI_OPERATION_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { const: AI_PLAN_SCHEMA_VERSION },
    summary: NON_EMPTY_STRING_SCHEMA,
    intent: NON_EMPTY_STRING_SCHEMA,
    operations: {
      type: 'array',
      items: {
        oneOf: [
          ADD_ELEMENT_OPERATION_SCHEMA,
          UPDATE_ELEMENT_OPERATION_SCHEMA,
          DELETE_ELEMENTS_OPERATION_SCHEMA,
          MOVE_ELEMENTS_OPERATION_SCHEMA,
          CONNECT_ELEMENTS_OPERATION_SCHEMA,
          ALIGN_ELEMENTS_OPERATION_SCHEMA,
          DISTRIBUTE_ELEMENTS_OPERATION_SCHEMA,
          GROUP_ELEMENTS_OPERATION_SCHEMA,
          UNGROUP_ELEMENTS_OPERATION_SCHEMA,
          REORDER_ELEMENTS_OPERATION_SCHEMA,
          MINDMAP_ADD_CHILD_OPERATION_SCHEMA,
          MINDMAP_ADD_SIBLING_OPERATION_SCHEMA,
          MINDMAP_UPDATE_NODE_OPERATION_SCHEMA,
          MINDMAP_MOVE_NODE_OPERATION_SCHEMA,
        ],
      },
    },
  },
  required: ['schemaVersion', 'summary', 'intent', 'operations'],
} as const;
