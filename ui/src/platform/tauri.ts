import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { documentDir, join } from '@tauri-apps/api/path';
import type { PlatformBridge } from './index';

const DEFAULT_DOCUMENT_NAME = '未命名.mixboard';
const DEFAULT_EXPORT_NAME = 'mixboard-export.png';

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type);
  });
}

/**
 * Dialogs start in ~/Documents for bare file names. Without a directory the
 * panel opens in the process's working directory (often a temp folder).
 */
async function inDocuments(name: string) {
  if (name.startsWith('/')) return name;
  try {
    return await join(await documentDir(), name);
  } catch {
    return name;
  }
}

export class TauriBridge implements PlatformBridge {
  async saveFile(data: string, defaultPath?: string): Promise<string | null> {
    return this.saveAsFile(data, defaultPath);
  }

  async openFile(): Promise<{ path: string; content: string } | null> {
    const selected = await open({
      title: '打开 MixBoard 文件',
      defaultPath: await inDocuments(''),
      filters: [{ name: 'MixBoard', extensions: ['mixboard', 'json'] }],
    });
    if (!selected) return null;
    const content = await readTextFile(selected as string);
    return { path: selected as string, content };
  }

  async saveAsFile(data: string, defaultPath?: string): Promise<string | null> {
    const path = await save({
      title: '保存 MixBoard 文件',
      defaultPath: await inDocuments(defaultPath ?? DEFAULT_DOCUMENT_NAME),
      filters: [{ name: 'MixBoard', extensions: ['mixboard'] }],
    });
    if (!path) return null;
    await writeTextFile(path, data);
    return path;
  }

  async writeDocumentFile(path: string, data: string): Promise<void> {
    await writeTextFile(path, data);
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
