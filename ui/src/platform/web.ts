import type { PlatformBridge } from './index';

const DEFAULT_DOCUMENT_NAME = '未命名.mixnote';
const DEFAULT_EXPORT_NAME = 'mixnote-export.png';

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
  // Browsers can't keep access to a folder; the web build stays draft-based.
  readonly vault = null;

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
      input.accept = '.mixnote,.mixboard,.json';
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

  async writeDocumentFile(): Promise<{ version: string; otherVersion: string | null }> {
    // The web build only knows download names, never a writable path.
    throw new Error('Writing to a file path is not supported on the web');
  }

  async documentChanged(): Promise<boolean> {
    return false;
  }

  async readDocumentFile(): Promise<{ content: string; version: string }> {
    throw new Error('Reading a file path is not supported on the web');
  }

  async exportAsImage(canvas: HTMLCanvasElement, format: 'png', defaultPath?: string): Promise<string | null> {
    const blob = await canvasToBlob(canvas, `image/${format}`);
    if (!blob) return null;

    const fileName = getDownloadFileName(defaultPath, DEFAULT_EXPORT_NAME);
    downloadBlob(blob, fileName);
    return fileName;
  }

  async saveTextFile(data: string, defaultPath: string, _filter: { name: string; extensions: string[] }): Promise<string | null> {
    const fileName = getDownloadFileName(defaultPath, 'mixnote.md');
    downloadBlob(new Blob([data], { type: 'text/markdown;charset=utf-8' }), fileName);
    return fileName;
  }

  isDesktop() { return false; }
  isWeb() { return true; }
}
