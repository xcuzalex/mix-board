import { getShapePathData } from '../canvas/shape-utils';
import type { ShapeVariant } from '../types/element';
import type { ToolType } from '../types/tool';

export interface LibraryItem {
  id: string;
  label: string;
  tool: ToolType;
  shapeVariant?: ShapeVariant;
  keywords: string;
  section: string;
  shortcut?: string;
}

export const SHAPE_TOOL_TYPES: ToolType[] = ['rectangle', 'ellipse', 'diamond', 'triangle'];

export const SHAPE_LIBRARY_SECTIONS: Array<{ title: string; items: LibraryItem[] }> = [
  {
    title: '基础',
    items: [
      { id: 'round_rectangle', label: '圆角矩形', tool: 'rectangle', shapeVariant: 'round_rectangle', keywords: '矩形 圆角 方框 状态 状态图', section: '基础', shortcut: 'R' },
      { id: 'rectangle', label: '矩形', tool: 'rectangle', shapeVariant: 'rectangle', keywords: '矩形 方框 实体 实体关系图', section: '基础' },
      { id: 'pill', label: '胶囊', tool: 'rectangle', shapeVariant: 'pill', keywords: '胶囊 圆角 按钮', section: '基础' },
      { id: 'ellipse', label: '椭圆', tool: 'ellipse', shapeVariant: 'ellipse', keywords: '椭圆 圆形 属性 实体关系图', section: '基础', shortcut: 'O' },
      { id: 'diamond', label: '菱形', tool: 'diamond', shapeVariant: 'diamond', keywords: '菱形 判断 关系 实体关系图', section: '基础', shortcut: 'D' },
      { id: 'triangle', label: '三角形', tool: 'triangle', shapeVariant: 'triangle', keywords: '三角形', section: '基础' },
      { id: 'hexagon', label: '六边形', tool: 'rectangle', shapeVariant: 'hexagon', keywords: '六边形', section: '基础' },
      { id: 'octagon', label: '八边形', tool: 'rectangle', shapeVariant: 'octagon', keywords: '八边形', section: '基础' },
      { id: 'star', label: '星形', tool: 'rectangle', shapeVariant: 'star', keywords: '星形 五角星', section: '基础' },
      { id: 'plus', label: '十字', tool: 'rectangle', shapeVariant: 'plus', keywords: '加号 十字 医疗', section: '基础' },
      { id: 'speech_bubble', label: '对话框', tool: 'rectangle', shapeVariant: 'speech_bubble', keywords: '注释 对话 气泡', section: '基础' },
      { id: 'cloud', label: '云朵', tool: 'rectangle', shapeVariant: 'cloud', keywords: '云 注释 想法', section: '基础' },
      { id: 'arrow_left', label: '左箭头', tool: 'rectangle', shapeVariant: 'arrow_left', keywords: '箭头 左', section: '基础' },
      { id: 'arrow_right', label: '右箭头', tool: 'rectangle', shapeVariant: 'arrow_right', keywords: '箭头 右', section: '基础' },
      { id: 'double_arrow', label: '双向箭头', tool: 'rectangle', shapeVariant: 'double_arrow', keywords: '双向 箭头', section: '基础' },
    ],
  },
  {
    title: '流程图',
    items: [
      { id: 'parallelogram', label: '平行四边形', tool: 'rectangle', shapeVariant: 'parallelogram', keywords: '流程图 输入 输出', section: '流程图' },
      { id: 'trapezoid', label: '梯形', tool: 'rectangle', shapeVariant: 'trapezoid', keywords: '流程图 梯形', section: '流程图' },
      { id: 'manual_input', label: '手动输入', tool: 'rectangle', shapeVariant: 'manual_input', keywords: '流程图 手动输入', section: '流程图' },
      { id: 'predefined_process', label: '预定义过程', tool: 'rectangle', shapeVariant: 'predefined_process', keywords: '流程图 子过程 子程序', section: '流程图' },
      { id: 'document', label: '文档', tool: 'rectangle', shapeVariant: 'document', keywords: '文档 流程图 文件', section: '流程图' },
      { id: 'multi_document', label: '多文档', tool: 'rectangle', shapeVariant: 'multi_document', keywords: '多文档 文件 流程图', section: '流程图' },
      { id: 'cylinder', label: '数据库', tool: 'rectangle', shapeVariant: 'cylinder', keywords: '数据库 存储 流程图', section: '流程图' },
      { id: 'internal_storage', label: '内部存储', tool: 'rectangle', shapeVariant: 'internal_storage', keywords: '存储 内存 流程图', section: '流程图' },
      { id: 'display', label: '显示', tool: 'rectangle', shapeVariant: 'display', keywords: '显示 屏幕 流程图', section: '流程图' },
      { id: 'delay', label: '延迟', tool: 'rectangle', shapeVariant: 'delay', keywords: '延迟 等待 流程图', section: '流程图' },
      { id: 'start_state', label: '开始', tool: 'ellipse', shapeVariant: 'start_state', keywords: '状态图 开始 初始', section: '流程图' },
      { id: 'end_state', label: '结束', tool: 'ellipse', shapeVariant: 'end_state', keywords: '状态图 结束 终止', section: '流程图' },
      { id: 'sync_bar', label: '同步条', tool: 'rectangle', shapeVariant: 'sync_bar', keywords: '状态图 同步 并发', section: '流程图' },
    ],
  },
  {
    title: 'UML 与架构',
    items: [
      { id: 'class_box', label: '类', tool: 'rectangle', shapeVariant: 'class_box', keywords: '类图 类 属性 方法', section: 'UML 与架构' },
      { id: 'package', label: '包', tool: 'rectangle', shapeVariant: 'package', keywords: '类图 包 模块 文件夹', section: 'UML 与架构' },
      { id: 'component', label: '组件', tool: 'rectangle', shapeVariant: 'component', keywords: '组件图 组件 模块', section: 'UML 与架构' },
      { id: 'actor', label: '角色', tool: 'rectangle', shapeVariant: 'actor', keywords: '角色 人物 UML', section: 'UML 与架构' },
      { id: 'weak_entity', label: '弱实体', tool: 'rectangle', shapeVariant: 'weak_entity', keywords: '实体关系图 弱实体', section: 'UML 与架构' },
      { id: 'weak_relationship', label: '弱关系', tool: 'diamond', shapeVariant: 'weak_relationship', keywords: '实体关系图 弱关系 菱形', section: 'UML 与架构' },
    ],
  },
  {
    title: '结构',
    items: [
      { id: 'table', label: '表格', tool: 'table', keywords: '表格 table 行 列', section: '结构' },
      { id: 'kanban', label: '看板', tool: 'kanban', keywords: '看板 kanban 任务 待办', section: '结构' },
      { id: 'matrix', label: '四象限', tool: 'matrix', keywords: '四象限 矩阵 优先级 SWOT', section: '结构' },
      { id: 'code', label: '代码块', tool: 'code', keywords: '代码 code 程序', section: '结构' },
    ],
  },
  {
    title: '笔记与容器',
    items: [
      { id: 'sticky_note', label: '便签', tool: 'sticky_note', keywords: '便签 备注', section: '笔记与容器', shortcut: 'N' },
      { id: 'text', label: '文本', tool: 'text', keywords: '文本 标题', section: '笔记与容器', shortcut: 'T' },
      { id: 'mindmap', label: '脑图', tool: 'mindmap', keywords: '脑图 思维导图', section: '笔记与容器', shortcut: 'M' },
      { id: 'frame', label: '框架', tool: 'frame', keywords: '画板 框架', section: '笔记与容器', shortcut: 'F' },
      { id: 'section', label: '分区', tool: 'section', keywords: '分区 区域', section: '笔记与容器', shortcut: 'Shift+S' },
      { id: 'image', label: '图片', tool: 'image', keywords: '图片 插图', section: '笔记与容器', shortcut: 'I' },
    ],
  },
];

export function isShapeToolActive(tool: ToolType) {
  return SHAPE_TOOL_TYPES.includes(tool);
}

function ShapeGlyph({
  variant,
  className = 'h-4 w-4',
}: {
  variant: ShapeVariant;
  className?: string;
}) {
  const path = getShapePathData(variant, 3, 3, 18, 18, 4);
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
      {variant === 'document' && <path d="M16.7 3.2V8.5H21" />}
      {variant === 'multi_document' && (
        <>
          <path d="M5.4 5.5h11.4l2.2 2.2" />
          <path d="M16.8 5.5v2.2H19" />
        </>
      )}
      {variant === 'cylinder' && <path d="M3 6.3C3 3.9 21 3.9 21 6.3" />}
      {variant === 'predefined_process' && (
        <>
          <path d="M7.2 5.2v13.6" />
          <path d="M16.8 5.2v13.6" />
        </>
      )}
      {variant === 'internal_storage' && (
        <>
          <path d="M7.2 3.5v17" />
          <path d="M3.5 7.4h17" />
        </>
      )}
      {variant === 'class_box' && (
        <>
          <path d="M3.5 10.2h17" />
          <path d="M3.5 16h17" />
        </>
      )}
      {variant === 'package' && <path d="M3.5 8.2h7V3.5" />}
      {variant === 'weak_entity' && <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />}
      {variant === 'weak_relationship' && <path d="M12 6.5l5.5 5.5-5.5 5.5-5.5-5.5z" />}
      {variant === 'component' && (
        <>
          <rect x="15.3" y="7.2" width="2.7" height="3.2" rx="0.6" />
          <rect x="15.3" y="13.6" width="2.7" height="3.2" rx="0.6" />
        </>
      )}
      {variant === 'end_state' && <circle cx="12" cy="12" r="5.2" />}
    </svg>
  );
}

export function ToolGlyph({
  tool,
  shapeVariant,
  className = 'h-4 w-4',
}: {
  tool: ToolType;
  shapeVariant?: ShapeVariant;
  className?: string;
}) {
  if (shapeVariant) {
    return <ShapeGlyph variant={shapeVariant} className={className} />;
  }

  switch (tool) {
    case 'select':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M5 3.5l12.5 8.2-5.6 1.1 2.3 6.1-2.2.8-2.3-6.1-4.7 3V3.5z" />
        </svg>
      );
    case 'hand':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 11V6.8a1.8 1.8 0 1 1 3.6 0V10" />
          <path d="M10.6 10V5.5a1.8 1.8 0 1 1 3.6 0V10" />
          <path d="M14.2 10V7a1.8 1.8 0 1 1 3.6 0v7.2c0 3.4-2.4 5.8-5.8 5.8h-.9c-2.8 0-4.7-1.6-5.3-4.2L4.8 12a1.6 1.6 0 0 1 3-1.1L9 13" />
        </svg>
      );
    case 'text':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <path d="M5 5.5h14" />
          <path d="M12 5.5v13" />
          <path d="M8 18.5h8" />
        </svg>
      );
    case 'sticky_note':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 4.5h14v10.8L14.3 20H5z" />
          <path d="M14 15.3h5" />
          <path d="M14 15.3V20" />
        </svg>
      );
    case 'line':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M5 18L19 6" />
        </svg>
      );
    case 'arrow':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 18L18 6" />
          <path d="M13.8 6H18v4.2" />
        </svg>
      );
    case 'freedraw':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17c2.4-4.5 4.6-7.2 6.6-8.1 1.2-.5 2.4-.2 3 .8.5 1-.1 2.4-.9 3.3l3.8-1.5 2.5 2.5L12 21l-3.2-3.2" />
        </svg>
      );
    case 'highlighter':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 15.5l6.6-6.6 4.4 4.4-6.6 6.6H6z" />
          <path d="M4.5 19.5h9" />
        </svg>
      );
    case 'table':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14" />
        </svg>
      );
    case 'kanban':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="4.5" width="5" height="15" rx="1.5" />
          <rect x="9.5" y="4.5" width="5" height="10" rx="1.5" />
          <rect x="15.5" y="4.5" width="5" height="12.5" rx="1.5" />
        </svg>
      );
    case 'matrix':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M12 4v16M4 12h16" />
        </svg>
      );
    case 'code':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" />
        </svg>
      );
    case 'frame':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5h14v14H5z" />
          <path d="M8 8h8v8H8z" />
        </svg>
      );
    case 'section':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 6.5h15v11h-15z" />
          <path d="M4.5 10h15" />
        </svg>
      );
    case 'mindmap':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6.25" cy="6.25" r="1.75" />
          <circle cx="17.75" cy="6.25" r="1.75" />
          <circle cx="17.75" cy="17.75" r="1.75" />
          <rect x="8.5" y="9" width="7" height="6" rx="3" />
          <path d="M7.7 7.4l2.6 2.5" />
          <path d="M16.3 7.4l-2.6 2.5" />
          <path d="M16.3 16.6l-2.6-2.5" />
        </svg>
      );
    case 'image':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="5" width="15" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.2" />
          <path d="M6.5 16.5l3.2-3.6 2.7 2.6 2.3-2.3 2.8 3.3" />
        </svg>
      );
    case 'rectangle':
      return <ShapeGlyph variant="round_rectangle" className={className} />;
    case 'ellipse':
      return <ShapeGlyph variant="ellipse" className={className} />;
    case 'diamond':
      return <ShapeGlyph variant="diamond" className={className} />;
    case 'triangle':
      return <ShapeGlyph variant="triangle" className={className} />;
    default:
      return null;
  }
}
