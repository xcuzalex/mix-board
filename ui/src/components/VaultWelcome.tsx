import { useState, type ReactNode } from 'react';
import { useVaultStore } from '../store/vault';
import { chooseLocalDraftsOnly, openICloudVault, openRecentVault, pickVaultFolder } from '../utils/vault';

function Choice({
  icon,
  title,
  detail,
  primary,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition disabled:opacity-50 ${
        primary
          ? 'border-[#007aff]/30 bg-[#007aff]/[0.06] hover:bg-[#007aff]/[0.10] dark:border-[#0a84ff]/40 dark:bg-[#0a84ff]/10'
          : 'border-black/[0.06] bg-white/60 hover:bg-black/[0.03] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${primary ? 'bg-[#007aff] text-white' : 'bg-black/[0.05] text-slate-600 dark:bg-white/10 dark:text-slate-200'}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-slate-500 dark:text-slate-400">{detail}</span>
      </span>
    </button>
  );
}

/**
 * First desktop launch (or the vault went missing): choose where boards live.
 */
export function VaultWelcome() {
  const ready = useVaultStore((s) => s.ready);
  const needsWelcome = useVaultStore((s) => s.needsWelcome);
  const recent = useVaultStore((s) => s.recent);
  const notice = useVaultStore((s) => s.notice);
  const [busy, setBusy] = useState(false);

  if (!ready || !needsWelcome) return null;

  const choose = (action: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-white/70 px-4 backdrop-blur-md dark:bg-black/50" data-overlay-panel>
      <div
        role="dialog"
        aria-label="选择资料库"
        className="w-full max-w-md rounded-[24px] border border-black/[0.06] bg-white/90 p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_24px_64px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#1c1c1e]/95"
      >
        <div className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">欢迎使用 MixBoard</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
          选一个文件夹作为资料库，所有画板都会以 .mixboard 文件自动保存在里面，无需再选择保存位置。
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <Choice
            primary
            disabled={busy}
            onClick={choose(openICloudVault)}
            title="使用 iCloud 云盘（推荐）"
            detail="存放在 iCloud 云盘/MixBoard，在你的所有 Mac 间同步"
            icon={(
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5H7z" />
              </svg>
            )}
          />
          <Choice
            disabled={busy}
            onClick={choose(pickVaultFolder)}
            title="选择文件夹…"
            detail="使用任意本地文件夹，也可以是坚果云、Git 等同步目录"
            icon={(
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
              </svg>
            )}
          />
          <Choice
            disabled={busy}
            onClick={choose(chooseLocalDraftsOnly)}
            title="暂时只用本机草稿"
            detail="像以前一样：草稿存在本机，保存时再选位置。之后可在「文件」菜单打开资料库"
            icon={(
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="5" width="16" height="11" rx="1.5" />
                <path d="M9 19h6" />
              </svg>
            )}
          />
        </div>

        {recent.length > 0 && (
          <div className="mt-5">
            <div className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">最近的资料库</div>
            <div className="flex flex-col gap-0.5">
              {recent.map((vault) => (
                <button
                  key={vault.path}
                  type="button"
                  disabled={busy || !vault.exists}
                  onClick={choose(() => openRecentVault(vault.path))}
                  title={vault.exists ? vault.path : `${vault.path}（找不到该文件夹）`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-slate-600 transition hover:bg-black/[0.04] disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-white/5"
                >
                  <span className="truncate font-medium">{vault.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400 dark:text-slate-500">{vault.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {notice && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:bg-red-500/10 dark:text-red-300">{notice}</div>}
      </div>
    </div>
  );
}
