import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { documentDir, join } from '@tauri-apps/api/path';
import { useVaultStore } from '../store/vault';
import type { PlatformBridge, VaultBridge, VaultEntry, VaultStatus } from './index';

const DEFAULT_DOCUMENT_NAME = '未命名.mixnote';
const DEFAULT_EXPORT_NAME = 'mixnote-export.png';

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type);
  });
}

const tauriVault: VaultBridge = {
  status: () => invoke<VaultStatus>('vault_status'),
  pickFolder: (inICloud) => invoke<VaultStatus | null>('vault_pick_folder', { inIcloud: inICloud ?? false }),
  useICloud: () => invoke<VaultStatus>('vault_use_icloud'),
  openRecent: (path) => invoke<VaultStatus>('vault_open_recent', { path }),
  forgetRecent: (path) => invoke<VaultStatus>('vault_forget_recent', { path }),
  useLocalDrafts: () => invoke<VaultStatus>('vault_use_local_drafts'),
  setLastBoard: (path) => invoke<void>('vault_set_last_board', { path }),
  list: () => invoke<VaultEntry[]>('vault_list'),
  setFavorite: (path, favorite) => invoke<void>('vault_set_favorite', { path, favorite }),
  createBoard: (dir, content) => invoke<{ path: string; version: string }>('vault_create_board', { dir, content }),
  createFolder: (dir) => invoke<string>('vault_create_folder', { dir }),
  rename: (path, name) => invoke<string>('vault_rename', { path, name }),
  moveToTrash: (path) => invoke<void>('vault_trash', { path }),
  download: (paths) => invoke<void>('vault_download', { paths }),
};

/**
 * Dialogs start in the open vault (else ~/Documents) for bare file names.
 * Without a directory the panel opens in the process's working directory
 * (often a temp folder).
 */
async function inDocuments(name: string) {
  if (name.startsWith('/')) return name;
  try {
    return await join(useVaultStore.getState().vault?.path ?? await documentDir(), name);
  } catch {
    return name;
  }
}

export class TauriBridge implements PlatformBridge {
  readonly vault = tauriVault;

  async saveFile(data: string, defaultPath?: string): Promise<string | null> {
    return this.saveAsFile(data, defaultPath);
  }

  async openFile(): Promise<{ path: string; content: string } | null> {
    const selected = await open({
      title: '打开 MixNote 文件',
      defaultPath: await inDocuments(''),
      filters: [{ name: 'MixNote', extensions: ['mixnote', 'mixboard', 'json'] }],
    });
    if (!selected) return null;
    const content = await readTextFile(selected as string);
    return { path: selected as string, content };
  }

  async saveAsFile(data: string, defaultPath?: string): Promise<string | null> {
    const path = await save({
      title: '保存 MixNote 文件',
      defaultPath: await inDocuments(defaultPath ?? DEFAULT_DOCUMENT_NAME),
      filters: [{ name: 'MixNote', extensions: ['mixnote'] }],
    });
    if (!path) return null;
    // The user confirmed this target in the dialog: overwrite.
    await this.writeDocumentFile(path, data, null);
    return path;
  }

  /** Atomic write (temp file + rename) on the native side; limited to vault boards and dialog-picked files. */
  async writeDocumentFile(path: string, data: string, base: string | null) {
    return invoke<{ version: string; otherVersion: string | null }>('write_document', { path, content: data, base });
  }

  async documentChanged(path: string, version: string): Promise<boolean> {
    return invoke<boolean>('document_changed', { path, version });
  }

  async readDocumentFile(path: string) {
    return invoke<{ content: string; version: string }>('read_document', { path });
  }

  async exportAsImage(canvas: HTMLCanvasElement, format: 'png', defaultPath?: string): Promise<string | null> {
    const targetPath = await save({
      title: '导出图片',
      defaultPath: await inDocuments(defaultPath ?? DEFAULT_EXPORT_NAME),
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!targetPath) return null;

    const blob = await canvasToBlob(canvas, `image/${format}`);
    if (!blob) return null;

    await writeFile(targetPath, new Uint8Array(await blob.arrayBuffer()));
    return targetPath;
  }

  async saveTextFile(data: string, defaultPath: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
    const targetPath = await save({
      title: `导出 ${filter.name}`,
      defaultPath: await inDocuments(defaultPath),
      filters: [filter],
    });
    if (!targetPath) return null;
    await writeTextFile(targetPath, data);
    return targetPath;
  }

  isDesktop() { return true; }
  isWeb() { return false; }
}
