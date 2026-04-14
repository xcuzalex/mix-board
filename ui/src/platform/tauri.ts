import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { PlatformBridge } from './index';

const DEFAULT_DOCUMENT_NAME = '未命名.mixboard';
const DEFAULT_EXPORT_NAME = 'mixboard-export.png';

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type);
  });
}

export class TauriBridge implements PlatformBridge {
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

  isDesktop() { return true; }
  isWeb() { return false; }
}
