import { useState } from 'react';
import type { AIOperation } from '../schema/types';

interface OperationPreviewProps {
  operations: AIOperation[];
  summary: string;
  onConfirm: (selectedIndices: number[]) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function getOperationTypeLabel(op: AIOperation): string {
  switch (op.op) {
    case 'add_element':
      return `添加 ${op.elementType}`;
    case 'update_element':
      return '更新元素';
    case 'delete_elements':
      return `删除 ${op.targets.length} 个元素`;
    case 'move_elements':
      return `移动 ${op.targets.length} 个元素`;
    case 'connect_elements':
      return '连接元素';
    case 'align_elements':
      return `对齐元素 (${op.alignment})`;
    case 'distribute_elements':
      return `分布元素 (${op.direction})`;
    case 'group_elements':
      return `分组 ${op.targets.length} 个元素`;
    case 'ungroup_elements':
      return '取消分组';
    case 'reorder_elements':
      return `重新排序 (${op.action})`;
    case 'mindmap_add_child':
      return '添加子节点';
    case 'mindmap_add_sibling':
      return '添加兄弟节点';
    case 'mindmap_update_node':
      return '更新节点';
    case 'mindmap_move_node':
      return '移动节点';
    default:
      return '未知操作';
  }
}

function getOperationDetail(op: AIOperation): string | null {
  switch (op.op) {
    case 'add_element': {
      const parts: string[] = [];
      if (op.props.text) parts.push(`"${op.props.text}"`);
      if (op.props.title) parts.push(`标题: "${op.props.title}"`);
      parts.push(`位置: (${Math.round(op.props.x)}, ${Math.round(op.props.y)})`);
      if (op.props.width && op.props.height) {
        parts.push(`${Math.round(op.props.width)}x${Math.round(op.props.height)}`);
      }
      return parts.join(' | ');
    }
    case 'update_element': {
      const keys = Object.keys(op.changes).filter((k) => op.changes[k as keyof typeof op.changes] !== undefined);
      return keys.length > 0 ? `修改: ${keys.join(', ')}` : null;
    }
    case 'move_elements':
      return `偏移: (${op.dx}, ${op.dy})`;
    case 'connect_elements':
      return `${op.connector.type}${op.connector.connectorShape ? ` (${op.connector.connectorShape})` : ''}`;
    case 'mindmap_add_child':
      return op.node.text ? `"${op.node.text}"` : null;
    case 'mindmap_add_sibling':
      return op.node.text ? `"${op.node.text}"` : null;
    case 'mindmap_update_node': {
      const keys = Object.keys(op.changes).filter((k) => op.changes[k as keyof typeof op.changes] !== undefined);
      return keys.length > 0 ? `修改: ${keys.join(', ')}` : null;
    }
    default:
      return null;
  }
}

function getOperationIcon(op: AIOperation): React.ReactNode {
  switch (op.op) {
    case 'add_element':
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-emerald-600" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      );
    case 'update_element':
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-blue-600" fill="currentColor">
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
      );
    case 'delete_elements':
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-red-600" fill="currentColor">
          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
    case 'move_elements':
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-amber-600" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 01.707.293l3 3a1 1 0 01-1.414 1.414L11 6.414V13a1 1 0 11-2 0V6.414L7.707 7.707a1 1 0 01-1.414-1.414l3-3A1 1 0 0110 3zm-3.707 9.293a1 1 0 011.414 0L9 13.586V7a1 1 0 012 0v6.586l1.293-1.293a1 1 0 011.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      );
    case 'connect_elements':
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-purple-600" fill="currentColor">
          <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
        </svg>
      );
    case 'align_elements':
    case 'distribute_elements':
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-indigo-600" fill="currentColor">
          <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd" />
        </svg>
      );
    case 'group_elements':
    case 'ungroup_elements':
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-cyan-600" fill="currentColor">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" clipRule="evenodd" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-600" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      );
  }
}

function getOperationCountByType(operations: AIOperation[]): Record<string, number> {
  return operations.reduce((acc, op) => {
    const type = op.op;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

export function OperationPreview({
  operations,
  summary,
  onConfirm,
  onCancel,
  isLoading = false,
}: OperationPreviewProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(operations.map((_, i) => i)));
  const operationCounts = getOperationCountByType(operations);
  const allSelected = selected.size === operations.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(operations.map((_, i) => i)));
    }
  };

  const toggleOne = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm([...selected].sort((a, b) => a - b));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
              <svg viewBox="0 0 20 20" className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3L4 9l5 6M11 3l5 6-5 6M14 9l5 6-5 6" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-slate-900">操作预览</span>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          {/* Summary */}
          <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-sm font-medium text-slate-700">操作摘要</div>
            <div className="mt-1.5 text-sm text-slate-600">{summary}</div>
          </div>

          {/* Operation Count + Select All */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="font-medium text-slate-900">
                已选 {selected.size}/{operations.length} 个操作
              </span>
              <span className="text-slate-400">|</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(operationCounts).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                  >
                    {count}x {type.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={toggleAll}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              {allSelected ? '取消全选' : '全选'}
            </button>
          </div>

          {/* Operations List */}
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
            {operations.map((op, index) => {
              const detail = getOperationDetail(op);
              const isChecked = selected.has(index);

              return (
                <label
                  key={index}
                  className={`flex items-start gap-2.5 rounded-lg p-2 cursor-pointer transition ${
                    isChecked ? 'bg-white' : 'bg-slate-50 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleOne(index)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-200"
                  />
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    {getOperationIcon(op)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700">{getOperationTypeLabel(op)}</div>
                    {detail && (
                      <div className="mt-0.5 truncate text-xs text-slate-400">{detail}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-slate-200 px-5 py-4">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading || selected.size === 0}
            className="flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading
              ? '执行中...'
              : selected.size === operations.length
                ? '确认执行'
                : `执行 ${selected.size} 项`}
          </button>
        </div>
      </div>
    </div>
  );
}
