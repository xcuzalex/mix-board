import { clearImageCache, loadImageToCache } from '../canvas/renderer';
import type { EmbeddedFile } from '../types/document';

function isImageEmbeddedFile(file: EmbeddedFile) {
  return file.mimeType.startsWith('image/') || file.dataURL.startsWith('data:image/');
}

export async function hydrateEmbeddedFiles(files: Record<string, EmbeddedFile>) {
  clearImageCache();

  const imageFiles = Object.values(files).filter(isImageEmbeddedFile);
  await Promise.all(
    imageFiles.map(async (file) => {
      try {
        await loadImageToCache(file.id, file.dataURL);
      } catch (error) {
        console.warn(`Failed to hydrate embedded file ${file.id}`, error);
      }
    }),
  );
}

export function queueHydrateEmbeddedFiles(files: Record<string, EmbeddedFile>) {
  void hydrateEmbeddedFiles(files);
}
