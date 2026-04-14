import { useEffect, useRef } from 'react';

export interface ContextMenuState {
  show: boolean;
  x: number;
  y: number;
}

interface ContextMenuProps {
  state: ContextMenuState;
  hasSelection: boolean;
  hasClipboard: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onSelectAll: () => void;
  onGroup: () => void;
  onUngroup: () => void;
}

export function ContextMenu({
  state,
  hasSelection,
  hasClipboard,
  canGroup,
  canUngroup,
  onClose,
  onDelete,
  onDuplicate,
  onCopy,
  onPaste,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  onSelectAll,
  onGroup,
  onUngroup,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.show) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [state.show, onClose]);

  if (!state.show) return null;

  return (
    <div
      ref={ref}
      className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[180px]"
      style={{ left: state.x, top: state.y }}
    >
      {hasSelection && (
        <>
          <MenuItem label="复制" shortcut="Ctrl+C" onClick={() => { onCopy(); onClose(); }} />
          <MenuItem label="复制一份" shortcut="Ctrl+D" onClick={() => { onDuplicate(); onClose(); }} />
          <MenuItem label="删除" shortcut="Del" onClick={() => { onDelete(); onClose(); }} />
          <Divider />
          <MenuItem label="置于顶层" shortcut="Ctrl+]" onClick={() => { onBringToFront(); onClose(); }} />
          <MenuItem label="上移一层" onClick={() => { onBringForward(); onClose(); }} />
          <MenuItem label="下移一层" onClick={() => { onSendBackward(); onClose(); }} />
          <MenuItem label="置于底层" shortcut="Ctrl+[" onClick={() => { onSendToBack(); onClose(); }} />
          <Divider />
          {canGroup && (
            <MenuItem label="成组" shortcut="Ctrl+G" onClick={() => { onGroup(); onClose(); }} />
          )}
          {canUngroup && (
            <MenuItem label="取消成组" shortcut="Ctrl+Shift+G" onClick={() => { onUngroup(); onClose(); }} />
          )}
          {(canGroup || canUngroup) && <Divider />}
        </>
      )}
      <MenuItem
        label="粘贴"
        shortcut="Ctrl+V"
        disabled={!hasClipboard}
        onClick={() => { onPaste(); onClose(); }}
      />
      <MenuItem label="全选" shortcut="Ctrl+A" onClick={() => { onSelectAll(); onClose(); }} />
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-full flex items-center justify-between px-3 py-1.5 text-xs ${
        disabled
          ? 'text-gray-300 cursor-not-allowed'
          : 'text-gray-700 hover:bg-gray-50'
      }`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <span>{label}</span>
      {shortcut && <span className="text-gray-400 ml-4">{shortcut}</span>}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-gray-100 my-1" />;
}
