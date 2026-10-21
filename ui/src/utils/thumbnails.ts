import { useEffect, useState } from 'react';
import { loadImageToCache, releaseImages } from '../canvas/renderer';
import { getPlatform } from '../platform';
import { useDocumentStore } from '../store/document';
import { renderBoardThumbnail } from './document-io';
import { parseBoardFile, type Board } from './board-format';

// Library card previews. Boards are read from disk and drawn with the same
// renderer as the canvas, one at a time, and cached per (path, modified time)
// as object URLs, so reopening the library or scrolling back costs nothing.
// The board that is open is drawn from its live (possibly unsaved) state.

/** Card preview size in CSS pixels (the card is 4:3). */
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 240;

const cache = new Map<string, { key: string; url: string | null }>();
let queue: Promise<unknown> = Promise.resolve();

function parseBoard(json: string): Board | null {
  const parsed = parseBoardFile(json);
  return parsed.ok ? parsed.board : null;
}

async function renderToUrl(board: Board): Promise<string | null> {
  // Images must be decoded before drawing, or they render as placeholders.
  await Promise.all(
    Object.values(board.files)
      .filter((file) => file.dataURL?.startsWith('data:image/'))
      .map((file) => loadImageToCache(file.id, file.dataURL).catch(() => undefined)),
  );
  const canvas = renderBoardThumbnail(board.elements, board.appState, THUMB_WIDTH, THUMB_HEIGHT);
  // The image cache is shared with the canvas: let go of this board's images
  // unless the open board uses them too.
  const live = useDocumentStore.getState().files;
  releaseImages(Object.keys(board.files).filter((id) => !(id in live)));
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}

function remember(path: string, key: string, url: string | null) {
  const previous = cache.get(path);
  if (previous?.url && previous.url !== url) URL.revokeObjectURL(previous.url);
  cache.set(path, { key, url });
}

/** One render at a time keeps scrolling a big library smooth. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function loadThumbnail(path: string, modified: number): Promise<string | null> {
  const doc = useDocumentStore.getState();
  if (doc.filePath === path) {
    // The open board: draw what is on screen, not what was last saved.
    const live = { elements: doc.elements, appState: doc.appState, files: doc.files };
    return enqueue(async () => {
      const url = await renderToUrl(live);
      remember(path, `live:${Date.now()}`, url);
      return url;
    });
  }

  const key = String(modified);
  const cached = cache.get(path);
  if (cached?.key === key) return Promise.resolve(cached.url);
  return enqueue(async () => {
    const again = cache.get(path);
    if (again?.key === key) return again.url;
    const { content } = await (await getPlatform()).readDocumentFile(path);
    const board = parseBoard(content);
    const url = board ? await renderToUrl(board) : null;
    remember(path, key, url);
    return url;
  });
}

/**
 * Preview for a board card: undefined while loading (or not yet visible),
 * null for an empty / unreadable board, else an image URL.
 */
export function useBoardThumbnail(path: string, modified: number, visible: boolean) {
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${path}\n${modified}`;

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    loadThumbnail(path, modified).then(
      (url) => !cancelled && setState({ key, url }),
      () => !cancelled && setState({ key, url: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [path, modified, visible, key]);

  return state?.key === key ? state.url : undefined;
}
