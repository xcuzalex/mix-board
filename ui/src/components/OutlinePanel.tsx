import { useMemo, useState } from 'react';
import { useDocumentStore } from '../store/document';
import { centerViewOn, useUIStore } from '../store/ui';
import {
  updateMindmapNodeText,
  addMindmapSibling,
  moveMindmapNode,
  createMindmapTopic,
  getMindmapBranchTemplate,
  findMindmapParent,
  getMindmapSiblings,
} from '../canvas/mindmap-ops';
import { buildLinkIndex, getNoteTitle } from '../utils/links';
import type { Element, MindmapElement, MindmapNode } from '../types/element';

/**
 * Outline view (笔记功能), the 大纲 tab of the left sidebar. Projects the canvas's
 * structured content — mindmap trees plus text/sticky notes — into an editable
 * linear outline.
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

export function OutlineView() {
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const selectedMindmapNode = useUIStore((s) => s.selectedMindmapNode);
  const setSelectedMindmapNode = useUIStore((s) => s.setSelectedMindmapNode);
  const elements = useDocumentStore((s) => s.elements);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const pushHistory = useDocumentStore((s) => s.pushHistory);

  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(elements), [elements]);
  const linkIndex = useMemo(() => buildLinkIndex(elements), [elements]);
  const backlinkSources = (selectedIds.length === 1 ? linkIndex.backlinks.get(selectedIds[0]) : undefined) ?? [];

  const focusElement = (el: Element) => {
    setSelectedIds([el.id]);
    setSelectedMindmapNode(el.type === 'mindmap' ? { elementId: el.id, nodeId: (el as MindmapElement).rootNode.id } : null);
    centerViewOn(el.x + el.width / 2, el.y + el.height / 2);
  };

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
    <>
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
                    // One undo step per row edit: recorded on the first keystroke.
                    pushHistory();
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

      {backlinkSources.length > 0 && (
        <div className="border-t border-black/[0.06] px-3 py-2.5 dark:border-white/10">
          <div className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">
            反向链接 · {backlinkSources.length}
          </div>
          <div className="flex flex-col gap-0.5">
            {backlinkSources.map((src) => (
              <button
                key={src.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-slate-600 transition hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
                onClick={() => focusElement(src)}
                title="跳转到该笔记"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-[#007aff]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" />
                </svg>
                <span className="truncate">{getNoteTitle(src) || '未命名'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
