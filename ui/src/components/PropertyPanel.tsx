import { useEffect, useRef } from 'react';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import { PRESET_COLORS, STICKY_NOTE_COLORS } from '../utils/color';
import { mapMindmapTree, findMindmapNode, getMindmapSiblings } from '../canvas/mindmap-ops';
import { layoutMindmapNodes, measureMindmapNodeWith, getLayoutBounds } from '../canvas/render/mindmap-layout';
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
  const applyTransaction = useDocumentStore((s) => s.applyTransaction);
  const pushHistory = useDocumentStore((s) => s.pushHistory);
  const alignElements = useDocumentStore((s) => s.alignElements);
  const distributeElements = useDocumentStore((s) => s.distributeElements);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const activeTool = useUIStore((s) => s.activeTool);
  const freedrawColor = useUIStore((s) => s.freedrawColor);
  const highlighterColor = useUIStore((s) => s.highlighterColor);
  const setFreedrawColor = useUIStore((s) => s.setFreedrawColor);
  const setHighlighterColor = useUIStore((s) => s.setHighlighterColor);
  const selectedMindmapNode = useUIStore((s) => s.selectedMindmapNode);
  const setZoom = useUIStore((s) => s.setZoom);
  const setViewport = useUIStore((s) => s.setViewport);
  const historyGestureRef = useRef(false);

  useEffect(() => {
    const endHistoryGesture = () => {
      historyGestureRef.current = false;
    };

    window.addEventListener('pointerup', endHistoryGesture);
    window.addEventListener('mouseup', endHistoryGesture);
    window.addEventListener('touchend', endHistoryGesture);
    window.addEventListener('touchcancel', endHistoryGesture);
    window.addEventListener('blur', endHistoryGesture);

    return () => {
      window.removeEventListener('pointerup', endHistoryGesture);
      window.removeEventListener('mouseup', endHistoryGesture);
      window.removeEventListener('touchend', endHistoryGesture);
      window.removeEventListener('touchcancel', endHistoryGesture);
      window.removeEventListener('blur', endHistoryGesture);
      historyGestureRef.current = false;
    };
  }, []);

  // Show drawing tool color picker when no element is selected
  if (selectedIds.length === 0) {
    if (activeTool === 'freedraw') {
      return (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-56 bg-white/80 dark:bg-[#1c1c1e]/85 backdrop-blur-xl rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] border border-black/[0.06] dark:border-white/10 p-3 z-10 flex flex-col gap-3">
          <div className="text-xs font-medium text-gray-500 dark:text-slate-400 tracking-wide">画笔</div>
          <Section label="颜色">
            <div className="flex flex-wrap gap-1.5">
              {FREEDRAW_COLORS.map((c) => (
                <button key={c} onClick={() => setFreedrawColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${freedrawColor === c ? 'border-blue-500 scale-110' : 'border-gray-200 dark:border-white/10'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </Section>
        </div>
      );
    }
    if (activeTool === 'highlighter') {
      return (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-56 bg-white/80 dark:bg-[#1c1c1e]/85 backdrop-blur-xl rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] border border-black/[0.06] dark:border-white/10 p-3 z-10 flex flex-col gap-3">
          <div className="text-xs font-medium text-gray-500 dark:text-slate-400 tracking-wide">荧光笔</div>
          <Section label="颜色">
            <div className="flex flex-wrap gap-1.5">
              {HIGHLIGHTER_COLORS.map(({ label, display }) => (
                <button key={label} onClick={() => setHighlighterColor(label)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${highlighterColor === label ? 'border-blue-500 scale-110' : 'border-gray-200 dark:border-white/10'}`}
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

  const beginHistoryGesture = () => {
    if (historyGestureRef.current) return;
    pushHistory();
    historyGestureRef.current = true;
  };

  const endHistoryGesture = () => {
    historyGestureRef.current = false;
  };

  const update = (updates: Partial<Element>, options?: { withHistory?: boolean }) => {
    if (options?.withHistory ?? true) {
      pushHistory();
    }
    const selectedIdSet = new Set(selectedIds);
    const updatedAt = Date.now();
    applyTransaction((draft) => {
      for (const element of draft.elements) {
        if (selectedIdSet.has(element.id)) {
          Object.assign(element, updates, { updatedAt });
        }
      }
    });
  };

  const updateInHistoryGesture = (updates: Partial<Element>) => {
    beginHistoryGesture();
    update(updates, { withHistory: false });
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
    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-56 bg-white/80 dark:bg-[#1c1c1e]/85 backdrop-blur-xl rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] border border-black/[0.06] dark:border-white/10 p-3 z-10 flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
      <div className="text-[15px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">属性</div>

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
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(STICKY_NOTE_COLORS) as NoteColor[]).map((color) => (
                <button
                  key={color}
                  className={`h-[22px] w-[22px] rounded-full transition ${
                    (first as any).noteColor === color
                      ? 'ring-2 ring-[#007aff] ring-offset-2 ring-offset-white dark:ring-offset-[#1c1c1e]'
                      : 'ring-1 ring-black/10 hover:ring-black/25 dark:ring-white/15 dark:hover:ring-white/30'
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
            onPointerDown={beginHistoryGesture}
            onMouseDown={beginHistoryGesture}
            onTouchStart={beginHistoryGesture}
            onChange={(e) => updateInHistoryGesture({ strokeWidth: Number(e.target.value) } as any)}
            onPointerUp={endHistoryGesture}
            onMouseUp={endHistoryGesture}
            onTouchEnd={endHistoryGesture}
            onBlur={endHistoryGesture}
            className="w-full h-1.5 accent-blue-500"
          />
          <span className="text-xs text-gray-500 dark:text-slate-400">{first.strokeWidth}px</span>
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
            onPointerDown={beginHistoryGesture}
            onMouseDown={beginHistoryGesture}
            onTouchStart={beginHistoryGesture}
            onChange={(e) => updateInHistoryGesture({ strokeWidth: Number(e.target.value) } as any)}
            onPointerUp={endHistoryGesture}
            onMouseUp={endHistoryGesture}
            onTouchEnd={endHistoryGesture}
            onBlur={endHistoryGesture}
            className="w-full h-1.5 accent-blue-500"
          />
          <span className="text-xs text-gray-500 dark:text-slate-400">{first.strokeWidth}px</span>
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
                  first.strokeStyle === style ? 'bg-blue-50 text-blue-600' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
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
          <Section label="操作">
            {(() => {
              const selNodeId = selectedMindmapNode?.elementId === mindmap.id ? selectedMindmapNode.nodeId : null;
              const selNode = selNodeId ? findMindmapNode(mindmap.rootNode, selNodeId) : null;
              const canToggle = !!selNode && selNode.id !== mindmap.rootNode.id && getMindmapSiblings(selNode).length > 0;
              const fitToScreen = () => {
                const ctx = document.createElement('canvas').getContext('2d');
                if (!ctx) return;
                const bounds = getLayoutBounds(layoutMindmapNodes(mindmap, (n) => measureMindmapNodeWith(ctx, n)));
                if (!bounds) return;
                const rect = document.querySelector('canvas')?.getBoundingClientRect();
                const w = rect?.width ?? window.innerWidth;
                const h = rect?.height ?? window.innerHeight;
                const pad = 96;
                const z = Math.max(0.1, Math.min(2, Math.min((w - pad * 2) / bounds.width, (h - pad * 2) / bounds.height)));
                setZoom(z);
                setViewport(w / 2 - (bounds.x + bounds.width / 2) * z, h / 2 - (bounds.y + bounds.height / 2) * z);
              };
              const btn = 'rounded-lg px-2 py-1.5 text-xs text-slate-600 transition hover:bg-black/[0.05] hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-white/10';
              return (
                <div className="grid grid-cols-2 gap-1">
                  <button className={btn} onClick={() => update({ rootNode: mapMindmapTree(mindmap.rootNode, () => ({ collapsed: false })) } as any)}>
                    展开全部
                  </button>
                  <button
                    className={btn}
                    onClick={() => update({
                      rootNode: mapMindmapTree(mindmap.rootNode, (n, depth) => ({ collapsed: depth >= 1 && getMindmapSiblings(n).length > 0 })),
                    } as any)}
                  >
                    只看一级
                  </button>
                  <button
                    className={btn}
                    disabled={!canToggle}
                    title={canToggle ? undefined : '先在脑图中选中一个有子主题的节点'}
                    onClick={() => selNodeId && update({
                      rootNode: mapMindmapTree(mindmap.rootNode, (n) => (n.id === selNodeId ? { collapsed: !n.collapsed } : null)),
                    } as any)}
                  >
                    {selNode?.collapsed ? '展开所选' : '收起所选'}
                  </button>
                  <button className={btn} onClick={fitToScreen}>
                    适应屏幕
                  </button>
                </div>
              );
            })()}
          </Section>

          <Section label="布局">
            <div className="grid grid-cols-2 gap-1">
              {MINDMAP_LAYOUT_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`px-2 py-1 text-xs rounded ${
                    mindmap.layout === value ? 'bg-blue-50 text-blue-600' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
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
                    mindmap.branchStyle === value ? 'bg-blue-50 text-blue-600' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
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
              onPointerDown={beginHistoryGesture}
              onMouseDown={beginHistoryGesture}
              onTouchStart={beginHistoryGesture}
              onChange={(e) => updateInHistoryGesture({
                lineStyle: { ...mindmap.lineStyle, width: Number(e.target.value) },
              } as any)}
              onPointerUp={endHistoryGesture}
              onMouseUp={endHistoryGesture}
              onTouchEnd={endHistoryGesture}
              onBlur={endHistoryGesture}
              className="w-full h-1.5 accent-blue-500"
            />
            <span className="text-xs text-gray-500 dark:text-slate-400">{mindmap.lineStyle.width}px</span>
          </Section>

          <Section label="连线样式">
            <div className="flex gap-1">
              {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((style) => (
                <button
                  key={style}
                  className={`px-2 py-1 text-xs rounded ${
                    mindmap.lineStyle.style === style ? 'bg-blue-50 text-blue-600' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
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
                <div className="mb-1 text-[10px] text-gray-400 dark:text-slate-500">背景</div>
                <ColorGrid
                  colors={PRESET_COLORS.filter(c => c !== 'transparent')}
                  selected={mindmap.rootNode.backgroundColor}
                  onSelect={(color) => updateMindmapNodePalette('root', 'backgroundColor', color)}
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-gray-400 dark:text-slate-500">文字</div>
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
                <div className="mb-1 text-[10px] text-gray-400 dark:text-slate-500">背景</div>
                <ColorGrid
                  colors={PRESET_COLORS.filter(c => c !== 'transparent')}
                  selected={branchSample?.backgroundColor ?? '#E7F5EE'}
                  onSelect={(color) => updateMindmapNodePalette('branches', 'backgroundColor', color)}
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-gray-400 dark:text-slate-500">文字</div>
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
          onPointerDown={beginHistoryGesture}
          onMouseDown={beginHistoryGesture}
          onTouchStart={beginHistoryGesture}
          onChange={(e) => updateInHistoryGesture({ opacity: Number(e.target.value) } as any)}
          onPointerUp={endHistoryGesture}
          onMouseUp={endHistoryGesture}
          onTouchEnd={endHistoryGesture}
          onBlur={endHistoryGesture}
          className="w-full h-1.5 accent-blue-500"
        />
        <span className="text-xs text-gray-500 dark:text-slate-400">{first.opacity}%</span>
      </Section>

      {/* Font Size */}
      {(isText || isStickyNote) && (
        <Section label="字号">
          <input
            type="number"
            min={8}
            max={120}
            value={(first as any).fontSize}
            onChange={(e) => updateInHistoryGesture({ fontSize: Number(e.target.value) } as any)}
            onBlur={endHistoryGesture}
            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-white/10 rounded"
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
            onPointerDown={beginHistoryGesture}
            onMouseDown={beginHistoryGesture}
            onTouchStart={beginHistoryGesture}
            onChange={(e) => updateInHistoryGesture({ roundness: Number(e.target.value) } as any)}
            onPointerUp={endHistoryGesture}
            onMouseUp={endHistoryGesture}
            onTouchEnd={endHistoryGesture}
            onBlur={endHistoryGesture}
            className="w-full h-1.5 accent-blue-500"
          />
          <span className="text-xs text-gray-500 dark:text-slate-400">{(first as any).roundness ?? 0}px</span>
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
                  (first as any).textAlign === align ? 'bg-blue-50 text-blue-600' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
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
            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-white/10 rounded"
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
                  (first as any).connectorShape === value ? 'bg-blue-50 text-blue-600' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
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
              className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-white/10 rounded"
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
              className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-white/10 rounded"
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
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
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
  const customValue = /^#[0-9a-fA-F]{6}$/.test(selected) ? selected : '#000000';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((color) => {
        const isSel = selected === color;
        const transparent = color === 'transparent';
        return (
          <button
            key={color}
            className={`h-[22px] w-[22px] rounded-full transition ${
              isSel
                ? 'ring-2 ring-[#007aff] ring-offset-2 ring-offset-white dark:ring-offset-[#1c1c1e]'
                : 'ring-1 ring-black/10 hover:ring-black/25 dark:ring-white/15 dark:hover:ring-white/30'
            }`}
            style={{
              backgroundColor: transparent ? 'transparent' : color,
              backgroundImage: transparent
                ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)'
                : 'none',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 4px 4px',
            }}
            onClick={() => onSelect(color)}
            title={transparent ? '透明' : color}
          />
        );
      })}
      {/* Custom color */}
      <label
        className="relative flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full ring-1 ring-black/10 transition hover:ring-black/25 dark:ring-white/15 dark:hover:ring-white/30"
        style={{ background: 'conic-gradient(from 0deg, #ff5f57, #febc2e, #28c840, #007aff, #af52de, #ff5f57)' }}
        title="自定义颜色"
      >
        <input
          type="color"
          value={customValue}
          onChange={(e) => onSelect(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

function AlignBtn({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      className="flex-1 rounded-lg py-1.5 text-[11px] text-slate-600 transition hover:bg-black/[0.05] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10"
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
      <span className="text-[10px] text-gray-400 dark:text-slate-500 w-3">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg bg-black/[0.04] px-2 py-1 text-xs text-slate-700 outline-none focus:bg-black/[0.06] dark:bg-white/5 dark:text-slate-200"
      />
    </div>
  );
}
