export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type FillStyle = 'solid' | 'hachure' | 'cross-hatch' | 'none';
export type ConnectorShape = 'straight' | 'polyline' | 'curve' | 'right_angled_polyline';
export type ArrowType =
  | 'none' | 'arrow' | 'open_arrow' | 'hollow_arrow'
  | 'diamond' | 'hollow_diamond' | 'circle' | 'hollow_circle'
  | 'bar' | 'triangle' | 'hollow_triangle';
export type NoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange' | 'red' | 'gray' | 'white';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type MindmapLayout =
  | 'mindmap_lr'
  | 'mindmap_right'
  | 'mindmap_left'
  | 'tree_down'
  | 'tree_right'
  | 'org_chart'
  | 'timeline';
export type BranchStyle = 'curve' | 'polyline';
export type NodeShape = 'text' | 'rounded_rect' | 'pill';
export type FontWeight = 'normal' | 'bold';
export type ShapeVariant =
  | 'rectangle'
  | 'round_rectangle'
  | 'pill'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'hexagon'
  | 'octagon'
  | 'parallelogram'
  | 'trapezoid'
  | 'star'
  | 'speech_bubble'
  | 'cloud'
  | 'cylinder'
  | 'document'
  | 'multi_document'
  | 'predefined_process'
  | 'manual_input'
  | 'display'
  | 'delay'
  | 'internal_storage'
  | 'class_box'
  | 'package'
  | 'weak_entity'
  | 'weak_relationship'
  | 'component'
  | 'start_state'
  | 'end_state'
  | 'sync_bar'
  | 'actor'
  | 'arrow_left'
  | 'arrow_right'
  | 'double_arrow'
  | 'plus';

export interface BoundElement {
  type: 'arrow' | 'text';
  id: string;
}

export interface Binding {
  elementId: string;
  focus: number;
  gap: number;
}

export interface BaseProperties {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  backgroundColor: string;
  fillStyle: FillStyle;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  boundElements: BoundElement[];
  locked: boolean;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: TextAlign;
  shapeVariant?: ShapeVariant;
}

export type ElementType =
  | 'rectangle' | 'ellipse' | 'diamond' | 'triangle'
  | 'line' | 'arrow' | 'text' | 'freedraw' | 'highlighter'
  | 'sticky_note' | 'mindmap' | 'image' | 'section' | 'frame' | 'table'
  | 'kanban' | 'matrix' | 'code';

export interface RectangleElement extends BaseProperties {
  type: 'rectangle';
  roundness: number;
}

export interface EllipseElement extends BaseProperties {
  type: 'ellipse';
}

export interface DiamondElement extends BaseProperties {
  type: 'diamond';
}

export interface TriangleElement extends BaseProperties {
  type: 'triangle';
}

export interface LinearElement extends BaseProperties {
  type: 'line' | 'arrow';
  connectorShape: ConnectorShape;
  points: [number, number][];
  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowType: ArrowType;
  endArrowType: ArrowType;
}

export interface TextElement extends BaseProperties {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  containerId: string | null;
}

export interface FreedrawElement extends BaseProperties {
  type: 'freedraw';
  points: [number, number][];
  pressures: number[];
}

export interface HighlighterElement extends BaseProperties {
  type: 'highlighter';
  points: [number, number][];
  pressures: number[];
  highlightColor: string;
}

export interface StickyNoteElement extends BaseProperties {
  type: 'sticky_note';
  text: string;
  fontSize: number;
  noteColor: NoteColor;
  author?: string;
}

export interface ImageElement extends BaseProperties {
  type: 'image';
  fileId: string;
  scale: [number, number];
}

export interface SectionElement extends BaseProperties {
  type: 'section';
  title: string;
  childElementIds: string[];
}

export interface FrameElement extends BaseProperties {
  type: 'frame';
  title: string;
  childElementIds: string[];
}

export interface MindmapNode {
  id: string;
  text: string;
  description?: string | null;
  nodeType: 'root' | 'branch' | 'leaf';
  nodeShape: NodeShape;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  icon?: string | null;
  imageFileId?: string | null;
  collapsed: boolean;
  /**
   * Where the user dragged this topic, relative to its automatic position.
   * Its whole subtree moves with it; null/absent means automatic layout.
   */
  offset?: { x: number; y: number } | null;
  children: MindmapNode[];
  leftChildren: MindmapNode[];
  rightChildren: MindmapNode[];
}

export interface LineStyleConfig {
  color: string;
  width: number;
  style: StrokeStyle;
}

export interface MindmapElement extends BaseProperties {
  type: 'mindmap';
  layout: MindmapLayout;
  branchStyle: BranchStyle;
  lineStyle: LineStyleConfig;
  rootNode: MindmapNode;
}

export interface TableCell {
  text: string;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  textAlign: TextAlign;
  fontWeight: FontWeight;
}

export interface TableElement extends BaseProperties {
  type: 'table';
  rows: number;
  columns: number;
  cells: TableCell[][];
  /** Relative column widths / row heights; scaled to the element's box. */
  columnWidths: number[];
  rowHeights: number[];
  /** Style the first row as a header. */
  headerRow?: boolean;
}

export interface KanbanCard {
  id: string;
  text: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  /** Accent colour of the column header and its cards. */
  color: string;
  cards: KanbanCard[];
}

/** A kanban board: titled columns of Markdown cards, laid out automatically. */
export interface KanbanElement extends BaseProperties {
  type: 'kanban';
  title: string;
  columns: KanbanColumn[];
}

/**
 * A 2×2 matrix (priority / SWOT…): a titled container whose quadrants have
 * labels and tints; notes placed on it move with it, like a frame.
 */
export interface MatrixElement extends BaseProperties {
  type: 'matrix';
  title: string;
  /** Quadrant titles: top-left, top-right, bottom-left, bottom-right. */
  quadrants: [string, string, string, string];
  quadrantColors: [string, string, string, string];
  /** Markdown written straight into each quadrant (lists, todos…). */
  notes?: [string, string, string, string];
  /** Axis labels: x low → high, y low → high. */
  xAxis: [string, string];
  yAxis: [string, string];
  childElementIds: string[];
}

/** A code snippet card with a language label and syntax highlighting. */
export interface CodeElement extends BaseProperties {
  type: 'code';
  code: string;
  language: string;
  fontSize: number;
  codeTheme: 'dark' | 'light';
}

export type Element =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | TriangleElement
  | LinearElement
  | TextElement
  | FreedrawElement
  | HighlighterElement
  | StickyNoteElement
  | ImageElement
  | MindmapElement
  | SectionElement
  | FrameElement
  | TableElement
  | KanbanElement
  | MatrixElement
  | CodeElement;

export type DrawableElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | TriangleElement
  | LinearElement
  | TextElement
  | FreedrawElement
  | HighlighterElement
  | StickyNoteElement
  | ImageElement
  | SectionElement
  | FrameElement
  | MindmapElement
  | TableElement;

export interface ElementPatch extends Partial<BaseProperties> {
  type?: ElementType;
  roundness?: number;
  connectorShape?: ConnectorShape;
  points?: [number, number][];
  startBinding?: Binding | null;
  endBinding?: Binding | null;
  startArrowType?: ArrowType;
  endArrowType?: ArrowType;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  containerId?: string | null;
  pressures?: number[];
  highlightColor?: string;
  noteColor?: NoteColor;
  author?: string;
  fileId?: string;
  scale?: [number, number];
  title?: string;
  childElementIds?: string[];
  layout?: MindmapLayout;
  branchStyle?: BranchStyle;
  lineStyle?: LineStyleConfig;
  rootNode?: MindmapNode;
  rows?: number;
  columns?: number;
  cells?: TableCell[][];
  columnWidths?: number[];
  rowHeights?: number[];
}

export type TextualElement = TextElement | StickyNoteElement;
export type ContainerElement = SectionElement | FrameElement;

export function isLinearElement(element: Element): element is LinearElement {
  return element.type === 'line' || element.type === 'arrow';
}

export function isTextualElement(element: Element): element is TextualElement {
  return element.type === 'text' || element.type === 'sticky_note';
}

export function isShapeElement(
  element: Element,
): element is RectangleElement | EllipseElement | DiamondElement | TriangleElement {
  return ['rectangle', 'ellipse', 'diamond', 'triangle'].includes(element.type);
}

export function isContainerElement(element: Element): element is ContainerElement {
  return element.type === 'section' || element.type === 'frame';
}

/** Elements whose content is structured text edited slot by slot (cell, card, label…). */
export function isStructuredElement(element: Element): element is TableElement | KanbanElement | MatrixElement | CodeElement {
  return element.type === 'table' || element.type === 'kanban' || element.type === 'matrix' || element.type === 'code';
}

export function createBaseProperties(
  id: string, x: number, y: number, width: number, height: number
): BaseProperties {
  const now = Date.now();
  return {
    id, x, y, width, height,
    angle: 0,
    strokeColor: '#1B1B1F',
    strokeWidth: 2,
    strokeStyle: 'solid',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    opacity: 100,
    groupIds: [],
    frameId: null,
    boundElements: [],
    locked: false,
    zIndex: 0,
    createdAt: now,
    updatedAt: now,
  };
}
