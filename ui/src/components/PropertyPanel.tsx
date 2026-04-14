import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { PRESET_COLORS, STICKY_NOTE_COLORS } from '../utils/color';
import type {
  Element,
  StrokeStyle,
  NoteColor,
  ArrowType,
  ConnectorShape,
  TextAlign,
  BranchStyle,
  MindmapLayout,
  MindmapElement,
  MindmapNode,
} from '../types/element';

const ARROW_TYPE_OPTIONS: { value: ArrowType; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'arrow', label: '箭头' },
  { value: 'open_arrow', label: '空心箭头' },
  { value: 'hollow_arrow', label: '描边箭头' },
  { value: 'triangle', label: '三角形' },
  { value: 'hollow_triangle', label: '空心三角形' },
  { value: 'diamond', label: '菱形' },
  { value: 'hollow_diamond', label: '空心菱形' },
  { value: 'circle', label: '圆形' },
  { value: 'hollow_circle', label: '空心圆形' },
  { value: 'bar', label: '短横线' },
];

const STROKE_STYLE_LABELS: Record<StrokeStyle, string> = {
  solid: '实线',
  dashed: '虚线',
  dotted: '点线',
};

const MINDMAP_LAYOUT_OPTIONS: { value: MindmapLayout; label: string }[] = [
  { value: 'mindmap_right', label: '向右' },
  { value: 'mindmap_left', label: '向左' },
  { value: 'mindmap_lr', label: '左右' },
  { value: 'tree_down', label: '向下' },
];

const BRANCH_STYLE_OPTIONS: { value: BranchStyle; label: string }[] = [
  { value: 'curve', label: '曲线' },
  { value: 'polyline', label: '折线' },
];

const FREEDRAW_COLORS = ['#1B1B1F', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899'];
const HIGHLIGHTER_COLORS = [
  { label: 'rgba(255,235,59,0.4)', display: '#FFEB3B' },
  { label: 'rgba(76,175,80,0.4)', display: '#4CAF50' },
  { label: 'rgba(33,150,243,0.4)', display: '#2196F3' },
  { label: 'rgba(233,30,99,0.4)', display: '#E91E63' },
  { label: 'rgba(255,152,0,0.4)', display: '#FF9800' },
  { label: 'rgba(156,39,176,0.4)', display: '#9C27B0' },
  { label: 'rgba(0,188,212,0.4)', display: '#00BCD4' },
  { label: 'rgba(244,67,54,0.4)', display: '#F44336' },
];

function mapMindmapNodes(
  node: MindmapNode,
  transform: (node: MindmapNode) => MindmapNode,
): MindmapNode {
  const nextNode = transform(node);
  return {
    ...nextNode,
    children: nextNode.children.map((child) => mapMindmapNodes(child, transform)),
    leftChildren: (nextNode.leftChildren || []).map((child) => mapMindmapNodes(child, transform)),
    rightChildren: (nextNode.rightChildren || []).map((child) => mapMindmapNodes(child, transform)),
  };
}

function getFirstBranchNode(root: MindmapNode): MindmapNode | null {
  return root.children[0] ?? root.rightChildren?.[0] ?? root.leftChildren?.[0] ?? null;
}

export function PropertyPanel() {
  const elements = useDocumentStore((s) => s.elements);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const pushHistory = useDocumentStore((s) => s.pushHistory);
  const alignElements = useDocumentStore((s) => s.alignElements);
  const distributeElements = useDocumentStore((s) => s.distributeElements);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const activeTool = useUIStore((s) => s.activeTool);
  const freedrawColor = useUIStore((s) => s.freedrawColor);
  const highlighterColor = useUIStore((s) => s.highlighterColor);
  const setFreedrawColor = useUIStore((s) => s.setFreedrawColor);
  const setHighlighterColor = useUIStore((s) => s.setHighlighterColor);

  // Show drawing tool color picker when no element is selected
  if (selectedIds.length === 0) {
    if (activeTool === 'freedraw') {
      return (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-52 bg-white rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
          <div className="text-xs font-medium text-gray-500 tracking-wide">画笔</div>
          <Section label="颜色">
            <div className="flex flex-wrap gap-1.5">
              {FREEDRAW_COLORS.map((c) => (
                <button key={c} onClick={() => setFreedrawColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${freedrawColor === c ? 'border-blue-500 scale-110' : 'border-gray-200'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </Section>
        </div>
      );
    }
    if (activeTool === 'highlighter') {
      return (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-52 bg-white rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3">
          <div className="text-xs font-medium text-gray-500 tracking-wide">荧光笔</div>
          <Section label="颜色">
            <div className="flex flex-wrap gap-1.5">
              {HIGHLIGHTER_COLORS.map(({ label, display }) => (
                <button key={label} onClick={() => setHighlighterColor(label)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${highlighterColor === label ? 'border-blue-500 scale-110' : 'border-gray-200'}`}
                  style={{ backgroundColor: display }} />
              ))}
            </div>
          </Section>
        </div>
      );
    }
    return null;
  }

  const selectedElements = elements.filter((el) => selectedIds.includes(el.id));
  if (selectedElements.length === 0) return null;

  const first = selectedElements[0];

  const update = (updates: Partial<Element>) => {
    pushHistory();
    for (const id of selectedIds) {
      updateElement(id, updates);
    }
  };

  const isShape = ['rectangle', 'ellipse', 'diamond', 'triangle'].includes(first.type);
  const isText = first.type === 'text';
  const isStickyNote = first.type === 'sticky_note';
  const isLinear = first.type === 'line' || first.type === 'arrow';
  const isFreedraw = first.type === 'freedraw';
  const isHighlighter = first.type === 'highlighter';
  const isMindmap = first.type === 'mindmap';
  const mindmap = isMindmap ? first as MindmapElement : null;
  const branchSample = mindmap ? getFirstBranchNode(mindmap.rootNode) : null;

  const updateMindmapNodePalette = (
    target: 'root' | 'branches',
    key: 'backgroundColor' | 'textColor',
    value: string,
  ) => {
    if (!mindmap) return;
    update({
      rootNode: mapMindmapNodes(mindmap.rootNode, (node) => {
        if (target === 'root') {
          return node.nodeType === 'root' ? { ...node, [key]: value } : node;
        }
        return node.nodeType === 'root' ? node : { ...node, [key]: value };
      }),
    } as any);
  };

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-52 bg-white rounded-xl shadow-lg border border-gray-200 p-3 z-10 flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
      <div className="text-xs font-medium text-gray-500 tracking-wide">属性</div>

      {/* Highlighter color */}
      {isHighlighter && (
        <Section label="荧光颜色">
          <ColorGrid
            colors={['#FFEB3B', '#4CAF50', '#2196F3', '#E91E63', '#FF9800', '#9C27B0', '#00BCD4', '#F44336']}
            selected={(first as any).highlightColor?.replace('0.4)', '1)').replace('rgba', 'rgb') ?? '#FFEB3B'}
            onSelect={(c) => {
              const r = parseInt(c.slice(1, 3), 16);
              const g = parseInt(c.slice(3, 5), 16);
              const b = parseInt(c.slice(5, 7), 16);
              update({ highlightColor: `rgba(${r}, ${g}, ${b}, 0.4)` } as any);
            }}
          />
        </Section>
      )}

      {/* Stroke Color */}
      {!isStickyNote && !isMindmap && !isHighlighter && (
        <Section label="描边颜色">
          <ColorGrid
            colors={PRESET_COLORS.filter(c => c !== 'transparent')}
            selected={first.strokeColor}
            onSelect={(c) => update({ strokeColor: c } as any)}
          />
        </Section>
      )}

      {/* Fill Color */}
      {(isShape || isStickyNote) && (
        <Section label={isStickyNote ? '便签颜色' : '填充颜色'}>
          {isStickyNote ? (
            <div className="flex flex-wrap gap-1">
              {(Object.keys(STICKY_NOTE_COLORS) as NoteColor[]).map((color) => (
                <button
                  key={color}
                  className={`w-6 h-6 rounded-md border-2 ${
                    (first as any).noteColor === color ? 'border-blue-500' : 'border-gray-200'
                  }`}
                  style={{ backgroundColor: STICKY_NOTE_COLORS[color] }}
                  onClick={() => update({ noteColor: color } as any)}
                />
              ))}
            </div>
          ) : (
            <ColorGrid
              colors={PRESET_COLORS}
              selected={first.backgroundColor}
              onSelect={(c) => update({ backgroundColor: c } as any)}
            />
          )}
        </Section>
      )}

      {/* Stroke Width */}
      {!isStickyNote && !isMindmap && !isHighlighter && (
        <Section label="描边粗细">
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={first.strokeWidth}
            onChange={(e) => update({ strokeWidth: Number(e.target.value) } as any)}
            className="w-full h-1.5 accent-blue-500"
          />
          <span className="text-xs text-gray-500">{first.strokeWidth}px</span>
        </Section>
      )}

      {/* Highlighter width */}
      {isHighlighter && (
        <Section label="笔触粗细">
          <input
            type="range"
            min={8}
            max={40}
            step={2}
            value={first.strokeWidth}
            onChange={(e) => update({ strokeWidth: Number(e.target.value) } as any)}
            className="w-full h-1.5 accent-blue-500"
          />
          <span className="text-xs text-gray-500">{first.strokeWidth}px</span>
        </Section>
      )}

      {/* Stroke Style */}
      {(isShape || isLinear || isFreedraw) && (
        <Section label="线条样式">
          <div className="flex gap-1">
            {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((style) => (
              <button
                key={style}
                className={`px-2 py-1 text-xs rounded ${
                  first.strokeStyle === style ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
                }`}
                onClick={() => update({ strokeStyle: style } as any)}
              >
                {STROKE_STYLE_LABELS[style]}
              </button>
            ))}
          </div>
        </Section>
      )}

      {isMindmap && mindmap && (
        <>
          <Section label="布局">
            <div className="grid grid-cols-2 gap-1">
              {MINDMAP_LAYOUT_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`px-2 py-1 text-xs rounded ${
                    mindmap.layout === value ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  onClick={() => update({ layout: value } as any)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          <Section label="分支形态">
            <div className="flex gap-1">
              {BRANCH_STYLE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`px-2 py-1 text-xs rounded ${
                    mindmap.branchStyle === value ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  onClick={() => update({ branchStyle: value } as any)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          <Section label="连线颜色">
            <ColorGrid
              colors={PRESET_COLORS.filter(c => c !== 'transparent')}
              selected={mindmap.lineStyle.color}
              onSelect={(color) => update({
                lineStyle: { ...mindmap.lineStyle, color },
              } as any)}
            />
          </Section>

          <Section label="连线粗细">
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={mindmap.lineStyle.width}
              onChange={(e) => update({
                lineStyle: { ...mindmap.lineStyle, width: Number(e.target.value) },
              } as any)}
              className="w-full h-1.5 accent-blue-500"
            />
            <span className="text-xs text-gray-500">{mindmap.lineStyle.width}px</span>
          </Section>

          <Section label="连线样式">
            <div className="flex gap-1">
              {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((style) => (
                <button
                  key={style}
                  className={`px-2 py-1 text-xs rounded ${
                    mindmap.lineStyle.style === style ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  onClick={() => update({
                    lineStyle: { ...mindmap.lineStyle, style },
                  } as any)}
                >
                  {STROKE_STYLE_LABELS[style]}
                </button>
              ))}
            </div>
          </Section>

          <Section label="中心节点颜色">
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px] text-gray-400">背景</div>
                <ColorGrid
                  colors={PRESET_COLORS.filter(c => c !== 'transparent')}
                  selected={mindmap.rootNode.backgroundColor}
                  onSelect={(color) => updateMindmapNodePalette('root', 'backgroundColor', color)}
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-gray-400">文字</div>
                <ColorGrid
                  colors={PRESET_COLORS.filter(c => c !== 'transparent')}
                  selected={mindmap.rootNode.textColor}
                  onSelect={(color) => updateMindmapNodePalette('root', 'textColor', color)}
                />
              </div>
            </div>
          </Section>

          <Section label="分支节点颜色">
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px] text-gray-400">背景</div>
                <ColorGrid
                  colors={PRESET_COLORS.filter(c => c !== 'transparent')}
                  selected={branchSample?.backgroundColor ?? '#E7F5EE'}
                  onSelect={(color) => updateMindmapNodePalette('branches', 'backgroundColor', color)}
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-gray-400">文字</div>
                <ColorGrid
                  colors={PRESET_COLORS.filter(c => c !== 'transparent')}
                  selected={branchSample?.textColor ?? '#234032'}
                  onSelect={(color) => updateMindmapNodePalette('branches', 'textColor', color)}
                />
              </div>
            </div>
          </Section>
        </>
      )}

      {/* Opacity */}
      <Section label="透明度">
        <input
          type="range"
          min={0}
          max={100}
          value={first.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) } as any)}
          className="w-full h-1.5 accent-blue-500"
        />
        <span className="text-xs text-gray-500">{first.opacity}%</span>
      </Section>

      {/* Font Size */}
      {(isText || isStickyNote) && (
        <Section label="字号">
          <input
            type="number"
            min={8}
            max={120}
            value={(first as any).fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) } as any)}
            className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
          />
        </Section>
      )}

      {/* Roundness (rectangle) */}
      {first.type === 'rectangle' && (
        <Section label="圆角">
          <input
            type="range"
            min={0}
            max={50}
            value={(first as any).roundness ?? 0}
            onChange={(e) => update({ roundness: Number(e.target.value) } as any)}
            className="w-full h-1.5 accent-blue-500"
          />
          <span className="text-xs text-gray-500">{(first as any).roundness ?? 0}px</span>
        </Section>
      )}

      {/* Text Align */}
      {(isText || isStickyNote) && (
        <Section label="文本对齐">
          <div className="flex gap-1">
            {(['left', 'center', 'right'] as TextAlign[]).map((align) => (
              <button
                key={align}
                className={`px-2 py-1 text-xs rounded ${
                  (first as any).textAlign === align ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
                }`}
                onClick={() => update({ textAlign: align } as any)}
              >
                {align === 'left' ? '⫷' : align === 'center' ? '⫿' : '⫸'}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Font Family */}
      {isText && (
        <Section label="字体">
          <select
            value={(first as any).fontFamily || 'Inter, system-ui, sans-serif'}
            onChange={(e) => update({ fontFamily: e.target.value } as any)}
            className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
          >
            <option value="Inter, system-ui, sans-serif">无衬线</option>
            <option value="Georgia, serif">衬线</option>
            <option value="monospace">等宽</option>
            <option value="'Comic Sans MS', cursive">手写</option>
            <option value="Arial, sans-serif">Arial</option>
          </select>
        </Section>
      )}

      {/* Connector Shape */}
      {isLinear && (
        <Section label="连线类型">
          <div className="flex gap-1">
            {([
              { value: 'straight', label: '直线' },
              { value: 'polyline', label: '折线' },
              { value: 'curve', label: '曲线' },
              { value: 'right_angled_polyline', label: '直角' },
            ] as { value: ConnectorShape; label: string }[]).map(({ value, label }) => (
              <button
                key={value}
                className={`px-2 py-1 text-xs rounded ${
                  (first as any).connectorShape === value ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
                }`}
                onClick={() => update({ connectorShape: value } as any)}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Arrow Types */}
      {isLinear && (
        <>
          <Section label="起点端点">
            <select
              value={(first as any).startArrowType || 'none'}
              onChange={(e) => update({ startArrowType: e.target.value as ArrowType } as any)}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
            >
              {ARROW_TYPE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Section>
          <Section label="终点端点">
            <select
              value={(first as any).endArrowType || 'none'}
              onChange={(e) => update({ endArrowType: e.target.value as ArrowType } as any)}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
            >
              {ARROW_TYPE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Section>
        </>
      )}

      {/* Alignment (multi-selection) */}
      {selectedIds.length >= 2 && (
        <Section label="对齐">
          <div className="grid grid-cols-3 gap-1">
            <AlignBtn label="⫷" title="左对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'left'); }} />
            <AlignBtn label="⫿" title="水平居中" onClick={() => { pushHistory(); alignElements(selectedIds, 'center'); }} />
            <AlignBtn label="⫸" title="右对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'right'); }} />
            <AlignBtn label="⊤" title="顶部对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'top'); }} />
            <AlignBtn label="⊖" title="垂直居中" onClick={() => { pushHistory(); alignElements(selectedIds, 'middle'); }} />
            <AlignBtn label="⊥" title="底部对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'bottom'); }} />
          </div>
          {selectedIds.length >= 3 && (
            <div className="grid grid-cols-2 gap-1 mt-1">
              <AlignBtn label="横向分布" title="横向分布" onClick={() => { pushHistory(); distributeElements(selectedIds, 'horizontal'); }} />
              <AlignBtn label="纵向分布" title="纵向分布" onClick={() => { pushHistory(); distributeElements(selectedIds, 'vertical'); }} />
            </div>
          )}
        </Section>
      )}

      {/* Position / Size */}
      <Section label="位置尺寸">
        <div className="grid grid-cols-2 gap-1">
          <LabeledInput label="X" value={Math.round(first.x)} onChange={(v) => update({ x: v } as any)} />
          <LabeledInput label="Y" value={Math.round(first.y)} onChange={(v) => update({ y: v } as any)} />
          <LabeledInput label="W" value={Math.round(first.width)} onChange={(v) => update({ width: v } as any)} />
          <LabeledInput label="H" value={Math.round(first.height)} onChange={(v) => update({ height: v } as any)} />
        </div>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-400">{label}</span>
      {children}
    </div>
  );
}

function ColorGrid({
  colors,
  selected,
  onSelect,
}: {
  colors: string[];
  selected: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {colors.map((color) => (
        <button
          key={color}
          className={`w-5 h-5 rounded border-2 ${
            selected === color ? 'border-blue-500' : 'border-gray-200'
          }`}
          style={{
            backgroundColor: color === 'transparent' ? '#fff' : color,
            backgroundImage:
              color === 'transparent'
                ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)'
                : 'none',
            backgroundSize: '6px 6px',
            backgroundPosition: '0 0, 3px 3px',
          }}
          onClick={() => onSelect(color)}
        />
      ))}
    </div>
  );
}

function AlignBtn({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      className="px-1 py-1 text-[10px] rounded text-gray-600 hover:bg-gray-100 border border-gray-200"
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-gray-400 w-3">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-1 py-0.5 text-xs border border-gray-200 rounded"
      />
    </div>
  );
}
