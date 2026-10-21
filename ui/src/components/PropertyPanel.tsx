import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
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

// Inspector, Freeform-style: a slim rail of attribute buttons on the right.
// Clicking one opens just that attribute's controls in a popover beside it,
// so the canvas isn't covered by a tall panel of every option at once.

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

const STROKE_STYLE_OPTIONS: { value: StrokeStyle; label: string }[] = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
];

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

const CONNECTOR_SHAPE_OPTIONS: { value: ConnectorShape; label: string }[] = [
  { value: 'straight', label: '直线' },
  { value: 'polyline', label: '折线' },
  { value: 'curve', label: '曲线' },
  { value: 'right_angled_polyline', label: '直角' },
];

const TEXT_ALIGN_OPTIONS: { value: TextAlign; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
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

const SOLID_COLORS = PRESET_COLORS.filter((c) => c !== 'transparent');
/** Style keys every element type has; edits to these apply to a mixed selection. */
const SHARED_STYLE_KEYS = new Set(['strokeColor', 'strokeWidth', 'strokeStyle', 'opacity', 'backgroundColor']);

interface Group {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

function getFirstBranchNode(root: MindmapNode): MindmapNode | null {
  return root.children[0] ?? root.rightChildren?.[0] ?? root.leftChildren?.[0] ?? null;
}

export function PropertyPanel() {
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
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // Only re-render when the selected elements themselves change.
  const selectedElements = useDocumentStore(useShallow((s) => s.elements.filter((el) => selectedIdSet.has(el.id))));

  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [popoverTop, setPopoverTop] = useState(0);

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

  // A new selection (or tool) starts with every popover closed.
  const selectionKey = `${selectedIds.join(',')}|${activeTool}`;
  useEffect(() => {
    setOpenId(null);
  }, [selectionKey]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

  // Line the popover up with its button, kept inside the window.
  useLayoutEffect(() => {
    if (!openId) return;
    const root = rootRef.current;
    const button = buttonRefs.current.get(openId);
    const popover = popoverRef.current;
    if (!root || !button || !popover) return;
    const rootRect = root.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const height = popover.offsetHeight;
    const margin = 12;
    const desired = buttonRect.top + buttonRect.height / 2 - height / 2;
    const clamped = Math.max(margin, Math.min(window.innerHeight - margin - height, desired));
    setPopoverTop(clamped - rootRect.top);
  }, [openId, selectionKey]);

  const beginHistoryGesture = () => {
    if (historyGestureRef.current) return;
    pushHistory();
    historyGestureRef.current = true;
  };

  const endHistoryGesture = () => {
    historyGestureRef.current = false;
  };

  /**
   * Applies `updates` to the selection. Style keys every element has go to all
   * of it; type-specific keys only to elements of the same type as the one the
   * controls were built from (so a mindmap's tree never lands on a rectangle).
   * `ids` narrows it further, e.g. to the one mindmap being edited.
   */
  const update = (updates: Partial<Element>, options?: { withHistory?: boolean; ids?: string[] }) => {
    const first = selectedElements[0];
    if (!first) return;
    if (options?.withHistory ?? true) {
      pushHistory();
    }
    const targetIds = new Set(options?.ids ?? selectedIds);
    const sharedOnly = Object.keys(updates).every((key) => SHARED_STYLE_KEYS.has(key));
    const updatedAt = Date.now();
    applyTransaction((draft) => {
      for (const element of draft.elements) {
        if (!targetIds.has(element.id)) continue;
        if (!sharedOnly && element.type !== first.type) continue;
        Object.assign(element, updates, { updatedAt });
      }
    });
  };

  const updateInHistoryGesture = (updates: Partial<Element>, ids?: string[]) => {
    beginHistoryGesture();
    update(updates, { withHistory: false, ids });
  };

  const slider = (props: { value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) => (
    <Slider {...props} onBegin={beginHistoryGesture} onEnd={endHistoryGesture} />
  );

  const groups = buildGroups();

  function buildGroups(): Group[] {
    // Drawing tools with nothing selected: just the pen color.
    if (selectedIds.length === 0) {
      if (activeTool === 'freedraw') {
        return [{
          id: 'pen',
          label: '画笔颜色',
          icon: <Swatch color={freedrawColor} />,
          content: (
            <SwatchRow
              colors={FREEDRAW_COLORS.map((c) => ({ value: c, display: c }))}
              selected={freedrawColor}
              onSelect={setFreedrawColor}
            />
          ),
        }];
      }
      if (activeTool === 'highlighter') {
        const current = HIGHLIGHTER_COLORS.find((c) => c.label === highlighterColor)?.display ?? '#FFEB3B';
        return [{
          id: 'pen',
          label: '荧光笔颜色',
          icon: <Swatch color={current} />,
          content: (
            <SwatchRow
              colors={HIGHLIGHTER_COLORS.map((c) => ({ value: c.label, display: c.display }))}
              selected={highlighterColor}
              onSelect={setHighlighterColor}
            />
          ),
        }];
      }
      return [];
    }

    if (selectedElements.length === 0) return [];
    const first = selectedElements[0];
    const anyFirst = first as any;

    const isShape = ['rectangle', 'ellipse', 'diamond', 'triangle'].includes(first.type);
    const isText = first.type === 'text';
    const isStickyNote = first.type === 'sticky_note';
    const isLinear = first.type === 'line' || first.type === 'arrow';
    const isFreedraw = first.type === 'freedraw';
    const isHighlighter = first.type === 'highlighter';
    const mindmap = first.type === 'mindmap' ? first as MindmapElement : null;

    const result: Group[] = [];

    if (mindmap) {
      result.push(...buildMindmapGroups(mindmap));
    }

    if (isHighlighter) {
      const normalize = (color: string | undefined) => (color ?? '').replace(/\s/g, '');
      const swatch = HIGHLIGHTER_COLORS.find((c) => normalize(c.label) === normalize(anyFirst.highlightColor));
      const current = swatch?.display ?? '#FFEB3B';
      result.push({
        id: 'highlight',
        label: '荧光',
        icon: <Swatch color={current} />,
        content: (
          <>
            <Field label="颜色">
              <ColorGrid
                colors={HIGHLIGHTER_COLORS.map((c) => c.display)}
                selected={current}
                onSelect={(c) => {
                  const preset = HIGHLIGHTER_COLORS.find((h) => h.display.toLowerCase() === c.toLowerCase());
                  const r = parseInt(c.slice(1, 3), 16);
                  const g = parseInt(c.slice(3, 5), 16);
                  const b = parseInt(c.slice(5, 7), 16);
                  update({ highlightColor: preset?.label ?? `rgba(${r},${g},${b},0.4)` } as any);
                }}
              />
            </Field>
            <Field label="笔触粗细">
              {slider({ value: first.strokeWidth, min: 8, max: 40, step: 2, unit: 'px', onChange: (v) => updateInHistoryGesture({ strokeWidth: v } as any) })}
            </Field>
          </>
        ),
      });
    }

    if (isStickyNote) {
      result.push({
        id: 'note',
        label: '便签颜色',
        icon: <Swatch color={STICKY_NOTE_COLORS[anyFirst.noteColor] ?? '#FFF9C4'} />,
        content: (
          <SwatchRow
            colors={(Object.keys(STICKY_NOTE_COLORS) as NoteColor[]).map((c) => ({ value: c, display: STICKY_NOTE_COLORS[c] }))}
            selected={anyFirst.noteColor}
            onSelect={(c) => update({ noteColor: c } as any)}
          />
        ),
      });
    }

    if (isShape) {
      result.push({
        id: 'fill',
        label: '填充',
        icon: <Swatch color={first.backgroundColor} />,
        content: (
          <>
            <ColorGrid colors={PRESET_COLORS} selected={first.backgroundColor} onSelect={(c) => update({ backgroundColor: c } as any)} />
            {first.type === 'rectangle' && (
              <Field label="圆角">
                {slider({ value: anyFirst.roundness ?? 0, min: 0, max: 50, unit: 'px', onChange: (v) => updateInHistoryGesture({ roundness: v } as any) })}
              </Field>
            )}
          </>
        ),
      });
    }

    if (!isStickyNote && !mindmap && !isHighlighter) {
      result.push({
        id: 'stroke',
        label: isText ? '文字颜色' : '描边',
        icon: isText ? <Swatch color={first.strokeColor} /> : <Swatch color={first.strokeColor} ring />,
        content: (
          <>
            <ColorGrid colors={SOLID_COLORS} selected={first.strokeColor} onSelect={(c) => update({ strokeColor: c } as any)} />
            {!isText && (
              <Field label="粗细">
                {slider({ value: first.strokeWidth, min: 0, max: 10, step: 0.5, unit: 'px', onChange: (v) => updateInHistoryGesture({ strokeWidth: v } as any) })}
              </Field>
            )}
            {(isShape || isLinear || isFreedraw) && (
              <Field label="样式">
                <Segmented options={STROKE_STYLE_OPTIONS} value={first.strokeStyle} onChange={(style) => update({ strokeStyle: style } as any)} />
              </Field>
            )}
          </>
        ),
      });
    }

    if (isLinear) {
      result.push({
        id: 'connector',
        label: '连线',
        icon: <ConnectorIcon />,
        content: (
          <>
            <Field label="类型">
              <Segmented options={CONNECTOR_SHAPE_OPTIONS} value={anyFirst.connectorShape} onChange={(v) => update({ connectorShape: v } as any)} />
            </Field>
            <Field label="起点">
              <Select value={anyFirst.startArrowType || 'none'} options={ARROW_TYPE_OPTIONS} onChange={(v) => update({ startArrowType: v as ArrowType } as any)} />
            </Field>
            <Field label="终点">
              <Select value={anyFirst.endArrowType || 'none'} options={ARROW_TYPE_OPTIONS} onChange={(v) => update({ endArrowType: v as ArrowType } as any)} />
            </Field>
          </>
        ),
      });
    }

    if (isText || isStickyNote) {
      result.push({
        id: 'text',
        label: '文字',
        icon: <span className="text-[13px] font-semibold tracking-tight">Aa</span>,
        content: (
          <>
            <Field label="字号">
              {slider({ value: anyFirst.fontSize ?? 16, min: 10, max: 72, unit: 'px', onChange: (v) => updateInHistoryGesture({ fontSize: v } as any) })}
            </Field>
            <Field label="对齐">
              <Segmented options={TEXT_ALIGN_OPTIONS} value={anyFirst.textAlign} onChange={(v) => update({ textAlign: v } as any)} />
            </Field>
            {isText && (
              <Field label="字体">
                <Select
                  value={anyFirst.fontFamily || 'Inter, system-ui, sans-serif'}
                  options={[
                    { value: 'Inter, system-ui, sans-serif', label: '无衬线' },
                    { value: 'Georgia, serif', label: '衬线' },
                    { value: 'monospace', label: '等宽' },
                    { value: "'Kalam', cursive", label: '手写' },
                  ]}
                  onChange={(v) => update({ fontFamily: v } as any)}
                />
              </Field>
            )}
          </>
        ),
      });
    }

    if (selectedIds.length >= 2) {
      result.push({
        id: 'align',
        label: '对齐与分布',
        icon: <AlignIcon />,
        content: (
          <>
            <div className="grid grid-cols-3 gap-1">
              <TextBtn title="左对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'left'); }}>左对齐</TextBtn>
              <TextBtn title="水平居中" onClick={() => { pushHistory(); alignElements(selectedIds, 'center'); }}>水平居中</TextBtn>
              <TextBtn title="右对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'right'); }}>右对齐</TextBtn>
              <TextBtn title="顶部对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'top'); }}>顶对齐</TextBtn>
              <TextBtn title="垂直居中" onClick={() => { pushHistory(); alignElements(selectedIds, 'middle'); }}>垂直居中</TextBtn>
              <TextBtn title="底部对齐" onClick={() => { pushHistory(); alignElements(selectedIds, 'bottom'); }}>底对齐</TextBtn>
            </div>
            {selectedIds.length >= 3 && (
              <div className="grid grid-cols-2 gap-1">
                <TextBtn title="横向分布" onClick={() => { pushHistory(); distributeElements(selectedIds, 'horizontal'); }}>横向分布</TextBtn>
                <TextBtn title="纵向分布" onClick={() => { pushHistory(); distributeElements(selectedIds, 'vertical'); }}>纵向分布</TextBtn>
              </div>
            )}
          </>
        ),
      });
    }

    result.push({
      id: 'arrange',
      label: '透明度与尺寸',
      icon: <ArrangeIcon />,
      content: (
        <>
          <Field label="透明度">
            {slider({ value: first.opacity, min: 0, max: 100, unit: '%', onChange: (v) => updateInHistoryGesture({ opacity: v } as any) })}
          </Field>
          {!mindmap && selectedElements.length === 1 && (
            <Field label="位置尺寸">
              <div className="grid grid-cols-2 gap-1.5">
                <LabeledInput label="X" value={Math.round(first.x)} onCommit={(v) => update({ x: v } as any)} />
                <LabeledInput label="Y" value={Math.round(first.y)} onCommit={(v) => update({ y: v } as any)} />
                <LabeledInput label="W" value={Math.round(first.width)} min={1} onCommit={(v) => update({ width: v } as any)} />
                <LabeledInput label="H" value={Math.round(first.height)} min={1} onCommit={(v) => update({ height: v } as any)} />
              </div>
            </Field>
          )}
        </>
      ),
    });

    return result;
  }

  function buildMindmapGroups(mindmap: MindmapElement): Group[] {
    const branchSample = getFirstBranchNode(mindmap.rootNode);
    // Mindmap controls edit only this mindmap, never other selected elements.
    const updateMindmap = (updates: Partial<MindmapElement>) => update(updates as Partial<Element>, { ids: [mindmap.id] });
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

    const updateNodePalette = (target: 'root' | 'branches', key: 'backgroundColor' | 'textColor', value: string) => {
      updateMindmap({
        rootNode: mapMindmapTree(mindmap.rootNode, (node) => (
          (node.nodeType === 'root') === (target === 'root') ? { [key]: value } : null
        )),
      });
    };

    return [
      {
        id: 'mm-ops',
        label: '展开与视图',
        icon: <ExpandIcon />,
        content: (
          <div className="grid grid-cols-2 gap-1">
            <TextBtn onClick={() => updateMindmap({ rootNode: mapMindmapTree(mindmap.rootNode, () => ({ collapsed: false })) })}>展开全部</TextBtn>
            <TextBtn
              onClick={() => updateMindmap({
                rootNode: mapMindmapTree(mindmap.rootNode, (n, depth) => ({ collapsed: depth >= 1 && getMindmapSiblings(n).length > 0 })),
              })}
            >
              只看一级
            </TextBtn>
            <TextBtn
              disabled={!canToggle}
              title={canToggle ? undefined : '先在脑图中选中一个有子主题的节点'}
              onClick={() => selNodeId && updateMindmap({
                rootNode: mapMindmapTree(mindmap.rootNode, (n) => (n.id === selNodeId ? { collapsed: !n.collapsed } : null)),
              })}
            >
              {selNode?.collapsed ? '展开所选' : '收起所选'}
            </TextBtn>
            <TextBtn onClick={fitToScreen}>适应屏幕</TextBtn>
          </div>
        ),
      },
      {
        id: 'mm-layout',
        label: '布局',
        icon: <LayoutIcon />,
        content: (
          <>
            <Field label="方向">
              <Segmented options={MINDMAP_LAYOUT_OPTIONS} value={mindmap.layout} onChange={(v) => updateMindmap({ layout: v })} />
            </Field>
            <Field label="分支形态">
              <Segmented options={BRANCH_STYLE_OPTIONS} value={mindmap.branchStyle} onChange={(v) => updateMindmap({ branchStyle: v })} />
            </Field>
          </>
        ),
      },
      {
        id: 'mm-line',
        label: '连线',
        icon: <Swatch color={mindmap.lineStyle.color} ring />,
        content: (
          <>
            <ColorGrid
              colors={SOLID_COLORS}
              selected={mindmap.lineStyle.color}
              onSelect={(color) => updateMindmap({ lineStyle: { ...mindmap.lineStyle, color } })}
            />
            <Field label="粗细">
              {slider({
                value: mindmap.lineStyle.width,
                min: 1,
                max: 10,
                step: 0.5,
                unit: 'px',
                onChange: (v) => updateInHistoryGesture({ lineStyle: { ...mindmap.lineStyle, width: v } } as Partial<Element>, [mindmap.id]),
              })}
            </Field>
            <Field label="样式">
              <Segmented
                options={STROKE_STYLE_OPTIONS}
                value={mindmap.lineStyle.style}
                onChange={(style) => updateMindmap({ lineStyle: { ...mindmap.lineStyle, style } })}
              />
            </Field>
          </>
        ),
      },
      {
        id: 'mm-colors',
        label: '节点颜色',
        icon: <Swatch color={mindmap.rootNode.backgroundColor} />,
        content: (
          <NodeColorEditor
            rootBackground={mindmap.rootNode.backgroundColor}
            rootText={mindmap.rootNode.textColor}
            branchBackground={branchSample?.backgroundColor ?? '#E7F5EE'}
            branchText={branchSample?.textColor ?? '#234032'}
            onPick={updateNodePalette}
          />
        ),
      },
    ];
  }

  if (groups.length === 0) return null;
  const openGroup = groups.find((g) => g.id === openId) ?? null;

  return (
    <div ref={rootRef} data-overlay-panel className="absolute right-3 top-1/2 z-10 -translate-y-1/2">
      <div className="flex flex-col items-center gap-0.5 rounded-[18px] border border-black/[0.06] bg-white/75 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_30px_rgba(0,0,0,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/75">
        {groups.map((group) => {
          const active = group.id === openId;
          return (
            <button
              key={group.id}
              ref={(node) => {
                if (node) buttonRefs.current.set(group.id, node);
                else buttonRefs.current.delete(group.id);
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-[12px] transition ${
                active
                  ? 'bg-[#007aff]/12 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#4aa8ff]'
                  : 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
              }`}
              title={group.label}
              aria-expanded={active}
              onClick={() => setOpenId(active ? null : group.id)}
            >
              {group.icon}
            </button>
          );
        })}
      </div>

      {openGroup && (
        <div
          ref={popoverRef}
          className="absolute right-full mr-2.5 flex w-60 flex-col gap-3 rounded-[16px] border border-black/[0.06] bg-white/85 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/90"
          style={{ top: popoverTop }}
        >
          <div className="text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">{openGroup.label}</div>
          {openGroup.content}
        </div>
      )}
    </div>
  );
}

// --- Controls ---

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-[10px] bg-black/[0.05] p-0.5 dark:bg-white/[0.07]">
      {options.map((option) => (
        <button
          key={option.value}
          className={`flex-1 rounded-[8px] px-1.5 py-1 text-xs transition ${
            value === option.value
              ? 'bg-white font-medium text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.12)] dark:bg-white/15 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  onBegin,
  onEnd,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onBegin}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onEnd}
        onBlur={onEnd}
        className="h-1 flex-1 accent-[#007aff]"
      />
      <span className="w-10 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{value}{unit}</span>
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-[10px] bg-black/[0.05] px-2 py-1.5 text-xs text-slate-700 outline-none dark:bg-white/[0.07] dark:text-slate-200"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function TextBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="rounded-[10px] px-2 py-1.5 text-xs text-slate-600 transition hover:bg-black/[0.05] hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-white/10"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function NodeColorEditor({
  rootBackground,
  rootText,
  branchBackground,
  branchText,
  onPick,
}: {
  rootBackground: string;
  rootText: string;
  branchBackground: string;
  branchText: string;
  onPick: (target: 'root' | 'branches', key: 'backgroundColor' | 'textColor', color: string) => void;
}) {
  const [target, setTarget] = useState<'root' | 'branches'>('root');
  const [key, setKey] = useState<'backgroundColor' | 'textColor'>('backgroundColor');
  const selected = target === 'root'
    ? key === 'backgroundColor' ? rootBackground : rootText
    : key === 'backgroundColor' ? branchBackground : branchText;
  return (
    <>
      <Segmented
        options={[{ value: 'root', label: '中心主题' }, { value: 'branches', label: '分支' }]}
        value={target}
        onChange={setTarget}
      />
      <Segmented
        options={[{ value: 'backgroundColor', label: '背景' }, { value: 'textColor', label: '文字' }]}
        value={key}
        onChange={setKey}
      />
      <ColorGrid colors={SOLID_COLORS} selected={selected} onSelect={(color) => onPick(target, key, color)} />
    </>
  );
}

function SwatchRow<T extends string>({
  colors,
  selected,
  onSelect,
}: {
  colors: { value: T; display: string }[];
  selected: string | undefined;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map(({ value, display }) => (
        <button
          key={value}
          className={`h-6 w-6 rounded-full transition ${
            selected === value
              ? 'ring-2 ring-[#007aff] ring-offset-2 ring-offset-white dark:ring-offset-[#1c1c1e]'
              : 'ring-1 ring-black/10 hover:ring-black/25 dark:ring-white/15 dark:hover:ring-white/30'
          }`}
          style={{ backgroundColor: display }}
          title={display}
          aria-label={display}
          aria-pressed={selected === value}
          onClick={() => onSelect(value)}
        />
      ))}
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
    <div className="grid grid-cols-8 gap-1.5">
      {colors.map((color) => {
        const isSel = selected?.toLowerCase() === color.toLowerCase();
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

/** Number field that applies on Enter or blur (one undo step, no half-typed values). */
function LabeledInput({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(parsed)) return;
    const next = min !== undefined ? Math.max(min, parsed) : parsed;
    if (next !== value) onCommit(next);
  };
  return (
    <label className="flex items-center gap-1 rounded-[10px] bg-black/[0.05] px-2 dark:bg-white/[0.07]">
      <span className="w-3 text-[10px] text-slate-400 dark:text-slate-500">{label}</span>
      <input
        type="number"
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
        className="w-full bg-transparent py-1 text-xs text-slate-700 outline-none dark:text-slate-200"
      />
    </label>
  );
}

// --- Rail icons ---

function Swatch({ color, ring }: { color: string; ring?: boolean }) {
  const transparent = !color || color === 'transparent';
  if (ring) {
    return <span className="block h-[18px] w-[18px] rounded-full border-[3px]" style={{ borderColor: transparent ? '#cbd5e1' : color }} />;
  }
  return (
    <span
      className="block h-[18px] w-[18px] rounded-full ring-1 ring-black/10 dark:ring-white/20"
      style={{
        backgroundColor: transparent ? 'transparent' : color,
        backgroundImage: transparent
          ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)'
          : 'none',
        backgroundSize: '6px 6px',
        backgroundPosition: '0 0, 3px 3px',
      }}
    />
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function ExpandIcon() {
  return <Icon><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Icon>;
}

function LayoutIcon() {
  return <Icon><rect x="3" y="10" width="6" height="4" rx="1.2" /><rect x="15" y="4" width="6" height="4" rx="1.2" /><rect x="15" y="16" width="6" height="4" rx="1.2" /><path d="M9 12h3M12 6v12M12 6h3M12 18h3" /></Icon>;
}

function ConnectorIcon() {
  return <Icon><path d="M4 19c6 0 4-14 14-14" /><path d="M14 4h5v5" /></Icon>;
}

function AlignIcon() {
  return <Icon><path d="M4 4v16" /><rect x="7" y="6" width="10" height="4" rx="1" /><rect x="7" y="14" width="6" height="4" rx="1" /></Icon>;
}

function ArrangeIcon() {
  return <Icon><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" /></Icon>;
}
