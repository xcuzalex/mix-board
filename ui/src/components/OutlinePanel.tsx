import { useMemo, useState } from 'react';
import { useDocumentStore } from '../store/document';
import { useUIStore } from '../store/ui';
import {
  updateMindmapNodeText,
  addMindmapSibling,
  moveMindmapNode,
  createMindmapTopic,
  getMindmapBranchTemplate,
  findMindmapParent,
  getMindmapSiblings,
} from '../canvas/mindmap-ops';
import type { Element, MindmapElement, MindmapNode } from '../types/element';

/**
 * Outline view (笔记功能). Projects the canvas's structured content — mindmap
 * trees plus text/sticky notes — into an editable linear outline on the left.
 * Edits write back to the document store live; selecting a row highlights the
 * node on the canvas; Enter adds a sibling and Tab / Shift+Tab indent / outdent.
 */

type OutlineRow = {
  key: string;
  elementId: string;
  nodeId?: string; // present for mindmap nodes
  depth: number;
  text: string;
  isRoot?: boolean;
};

const PLACEHOLDER = new Set(['中心主题', '新主题', '输入文本', '']);

function flattenMindmap(el: MindmapElement, rows: OutlineRow[]) {
  const walk = (node: MindmapNode, depth: number) => {
    rows.push({
      key: `${el.id}:${node.id}`,
      elementId: el.id,
      nodeId: node.id,
      depth,
      text: node.text ?? '',
      isRoot: depth === 0,
    });
    for (const child of getMindmapSiblings(node)) walk(child, depth + 1);
  };
  walk(el.rootNode, 0);
}

function buildRows(elements: Element[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  for (const el of elements) {
    if (el.type === 'mindmap') {
      flattenMindmap(el as MindmapElement, rows);
    } else if (el.type === 'text' || el.type === 'sticky_note') {
      rows.push({
        key: el.id,
        elementId: el.id,
        depth: 0,
        text: (el as any).text ?? '',
      });
    }
  }
  return rows;
}

export function OutlinePanel() {
  const showOutline = useUIStore((s) => s.showOutline);
  const toggleOutline = useUIStore((s) => s.toggleOutline);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const selectedMindmapNode = useUIStore((s) => s.selectedMindmapNode);
  const setSelectedMindmapNode = useUIStore((s) => s.setSelectedMindmapNode);
  const elements = useDocumentStore((s) => s.elements);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const pushHistory = useDocumentStore((s) => s.pushHistory);

  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(elements), [elements]);

  if (!showOutline) {
    return (
      <button
        className="absolute left-3 top-4 z-40 flex h-9 items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/70 px-3 text-[13px] font-medium text-slate-600 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl transition hover:text-slate-900 dark:border-white/10 dark:bg-[#1c1c1e]/70 dark:text-slate-300 dark:hover:text-white"
        onClick={toggleOutline}
        title="大纲"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
        大纲
      </button>
    );
  }

  const getMindmap = (elementId: string) =>
    elements.find((e) => e.id === elementId && e.type === 'mindmap') as MindmapElement | undefined;

  const editText = (row: OutlineRow, text: string) => {
    if (row.nodeId) {
      const el = getMindmap(row.elementId);
      if (!el) return;
      updateElement(el.id, { rootNode: updateMindmapNodeText(el.rootNode, row.nodeId, text) } as any);
    } else {
      updateElement(row.elementId, { text } as any);
    }
  };

  const selectRow = (row: OutlineRow) => {
    setSelectedIds([row.elementId]);
    setSelectedMindmapNode(row.nodeId ? { elementId: row.elementId, nodeId: row.nodeId } : null);
  };

  // Enter → add a sibling after this node (or a child when on the root).
  const addSibling = (row: OutlineRow) => {
    const el = getMindmap(row.elementId);
    if (!el || !row.nodeId) return;
    pushHistory();
    const node = createMindmapTopic('branch', getMindmapBranchTemplate(el.rootNode));
    updateElement(el.id, { rootNode: addMindmapSibling(el.rootNode, row.nodeId, node) } as any);
    setPendingFocusKey(`${el.id}:${node.id}`);
    setSelectedMindmapNode({ elementId: el.id, nodeId: node.id });
  };

  // Tab → make this node a child of its previous sibling.
  const indent = (row: OutlineRow) => {
    const el = getMindmap(row.elementId);
    if (!el || !row.nodeId) return;
    const parent = findMindmapParent(el.rootNode, row.nodeId);
    if (!parent) return;
    const siblings = getMindmapSiblings(parent);
    const idx = siblings.findIndex((s) => s.id === row.nodeId);
    if (idx <= 0) return; // no previous sibling to nest under
    pushHistory();
    updateElement(el.id, { rootNode: moveMindmapNode(el.rootNode, row.nodeId, siblings[idx - 1].id) } as any);
    setPendingFocusKey(row.key);
  };

  // Shift+Tab → lift this node to be a sibling of its parent.
  const outdent = (row: OutlineRow) => {
    const el = getMindmap(row.elementId);
    if (!el || !row.nodeId) return;
    const parent = findMindmapParent(el.rootNode, row.nodeId);
    if (!parent || parent.id === el.rootNode.id) return; // already top level
    const grandparent = findMindmapParent(el.rootNode, parent.id);
    if (!grandparent) return;
    pushHistory();
    updateElement(el.id, { rootNode: moveMindmapNode(el.rootNode, row.nodeId, grandparent.id) } as any);
    setPendingFocusKey(row.key);
  };

  const onRowKeyDown = (row: OutlineRow, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!row.nodeId) return; // structural keys only apply to mindmap nodes
    if (e.key === 'Enter') {
      e.preventDefault();
      addSibling(row);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdent(row);
      else indent(row);
    }
  };

  return (
    <div className="absolute left-3 top-4 bottom-4 z-40 flex w-72 flex-col overflow-hidden rounded-[20px] border border-black/[0.06] bg-white/75 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1c1c1e]/80">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3 dark:border-white/10">
        <div className="text-[15px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">大纲</div>
        <button
          className="rounded-full p-1 text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
          onClick={toggleOutline}
          title="收起大纲"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-[13px] leading-relaxed text-slate-400 dark:text-slate-500">
            还没有可整理的内容。<br />在画布里添加脑图、文本或便签，这里会自动生成大纲。
          </div>
        ) : (
          rows.map((row) => {
            const rowSelected = row.nodeId
              ? selectedMindmapNode?.elementId === row.elementId && selectedMindmapNode?.nodeId === row.nodeId
              : selectedIds.includes(row.elementId);
            const isPlaceholder = PLACEHOLDER.has(row.text.trim());
            return (
              <div
                key={row.key}
                className={`group flex items-center gap-2 rounded-lg py-1 pr-2 transition ${
                  rowSelected ? 'bg-[#007aff]/[0.10]' : 'hover:bg-black/[0.04] dark:hover:bg-white/5'
                }`}
                style={{ paddingLeft: 8 + row.depth * 16 }}
                onMouseDown={() => selectRow(row)}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    row.isRoot ? 'bg-[#007aff]' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                />
                <input
                  value={row.text}
                  autoFocus={row.key === pendingFocusKey}
                  placeholder={isPlaceholder ? '未命名' : undefined}
                  onFocus={() => {
                    if (pendingFocusKey === row.key) setPendingFocusKey(null);
                    selectRow(row);
                  }}
                  onChange={(e) => editText(row, e.target.value)}
                  onKeyDown={(e) => onRowKeyDown(row, e)}
                  className={`w-full bg-transparent text-[13px] outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 ${
                    row.isRoot
                      ? 'font-semibold text-slate-800 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
