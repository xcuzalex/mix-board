import { isImageCachedOrLoading, loadImageToCache, retainImageCache } from '../canvas/renderer';
import type { EmbeddedFile } from '../types/document';

function isImageEmbeddedFile(file: EmbeddedFile) {
  return file.mimeType.startsWith('image/') || file.dataURL.startsWith('data:image/');
}

/**
 * Syncs the renderer's image cache with a document's embedded files. Runs on
 * load and on every undo / redo, so it is incremental: images whose file is no
 * longer in `files` are evicted, and only missing ones are decoded (the
 * renderer notifies its asset subscribers as each one lands).
 */
export async function hydrateEmbeddedFiles(files: Record<string, EmbeddedFile>) {
  const fileList = Object.values(files);
  retainImageCache(new Set([...Object.keys(files), ...fileList.map((file) => file.id)]));

  const missing = fileList.filter((file) => isImageEmbeddedFile(file) && !isImageCachedOrLoading(file.id));
  await Promise.all(
    missing.map(async (file) => {
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
