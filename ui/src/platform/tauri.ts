import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import type { PlatformBridge, VaultBridge, VaultEntry, VaultStatus } from './index';

const DEFAULT_DOCUMENT_NAME = '未命名.mixboard';
const DEFAULT_EXPORT_NAME = 'mixboard-export.png';

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type);
  });
}

const tauriVault: VaultBridge = {
  status: () => invoke<VaultStatus>('vault_status'),
  pickFolder: () => invoke<VaultStatus | null>('vault_pick_folder'),
  useICloud: () => invoke<VaultStatus>('vault_use_icloud'),
  openRecent: (path) => invoke<VaultStatus>('vault_open_recent', { path }),
  forgetRecent: (path) => invoke<VaultStatus>('vault_forget_recent', { path }),
  useLocalDrafts: () => invoke<VaultStatus>('vault_use_local_drafts'),
  setLastBoard: (path) => invoke<void>('vault_set_last_board', { path }),
  list: () => invoke<VaultEntry[]>('vault_list'),
  setFavorite: (path, favorite) => invoke<void>('vault_set_favorite', { path, favorite }),
  createBoard: (dir, content) => invoke<string>('vault_create_board', { dir, content }),
  createFolder: (dir) => invoke<string>('vault_create_folder', { dir }),
  rename: (path, name) => invoke<string>('vault_rename', { path, name }),
  moveToTrash: (path) => invoke<void>('vault_trash', { path }),
};

export class TauriBridge implements PlatformBridge {
  readonly vault = tauriVault;

  async saveFile(data: string, defaultPath?: string): Promise<string | null> {
    return this.saveAsFile(data, defaultPath);
  }

  async openFile(): Promise<{ path: string; content: string } | null> {
    const selected = await open({
      filters: [{ name: 'MixBoard', extensions: ['mixboard', 'json'] }],
    });
    if (!selected) return null;
    const content = await readTextFile(selected as string);
    return { path: selected as string, content };
  }

  async saveAsFile(data: string, defaultPath?: string): Promise<string | null> {
    const path = await save({
      title: '保存 MixBoard 文件',
      defaultPath: defaultPath ?? DEFAULT_DOCUMENT_NAME,
      filters: [{ name: 'MixBoard', extensions: ['mixboard'] }],
    });
    if (!path) return null;
    await writeTextFile(path, data);
    return path;
  }

  async writeDocumentFile(path: string, data: string): Promise<void> {
    await writeTextFile(path, data);
  }

  async readDocumentFile(path: string): Promise<string> {
    return readTextFile(path);
  }

  async exportAsImage(canvas: HTMLCanvasElement, format: 'png', defaultPath?: string): Promise<string | null> {
    const targetPath = await save({
      title: '导出图片',
      defaultPath: defaultPath ?? DEFAULT_EXPORT_NAME,
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
      defaultPath,
      filters: [filter],
    });
    if (!targetPath) return null;
    await writeTextFile(targetPath, data);
    return targetPath;
  }

  isDesktop() { return true; }
  isWeb() { return false; }
}
