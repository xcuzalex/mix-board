import type { PlatformBridge } from './index';

const DEFAULT_DOCUMENT_NAME = '未命名.mixboard';
const DEFAULT_EXPORT_NAME = 'mixboard-export.png';

function getDownloadFileName(defaultPath: string | undefined, fallback: string) {
  if (!defaultPath) return fallback;
  const segments = defaultPath.split(/[/\\]/);
  return segments[segments.length - 1] || fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type);
  });
}

export class WebBridge implements PlatformBridge {
  async saveFile(data: string, defaultPath?: string): Promise<string | null> {
    const blob = new Blob([data], { type: 'application/json' });
    const fileName = getDownloadFileName(defaultPath, DEFAULT_DOCUMENT_NAME);
    downloadBlob(blob, fileName);
    return fileName;
  }

  async openFile(): Promise<{ path: string; content: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.mixboard,.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return resolve(null);
        const content = await file.text();
        resolve({ path: file.name, content });
      };
      input.click();
    });
  }

  async saveAsFile(data: string, defaultPath?: string): Promise<string | null> {
    return this.saveFile(data, defaultPath);
  }

  async exportAsImage(canvas: HTMLCanvasElement, format: 'png', defaultPath?: string): Promise<string | null> {
    const blob = await canvasToBlob(canvas, `image/${format}`);
    if (!blob) return null;

    const fileName = getDownloadFileName(defaultPath, DEFAULT_EXPORT_NAME);
    downloadBlob(blob, fileName);
    return fileName;
  }

  isDesktop() { return false; }
  isWeb() { return true; }
}
