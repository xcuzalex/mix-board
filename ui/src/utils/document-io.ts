import { getLinearBounds } from '../canvas/linear';
import { Renderer } from '../canvas/renderer';
import { Viewport } from '../canvas/viewport';
import { getPlatform } from '../platform';
import { useDocumentStore } from '../store/document';
import { useVaultStore } from '../store/vault';
import type { AppState, EmbeddedFile } from '../types/document';
import type { Element, LinearElement, MindmapElement } from '../types/element';
import { isUnchangedSince, saveToDocumentFile } from './autosave';
import { canvasTheme, isDefaultBackground } from '../canvas/canvas-theme';
import { flushPendingCanvasInteractionState } from './canvas-interaction-flush';
import { boardToMarkdown } from './markdown-export';
import { getLayoutBounds, layoutMindmapNodes, measureMindmapNodeWith } from '../canvas/render/mindmap-layout';

const DEFAULT_DOCUMENT_NAME = '未命名.mixnote';
const DEFAULT_EXPORT_NAME = 'mixnote-export.png';

function getElementBounds(element: Element, elements: Element[]) {
  if (element.type === 'line' || element.type === 'arrow') {
    return getLinearBounds(element as LinearElement, elements);
  }
  if (element.type === 'mindmap') {
    // A mindmap's declared box doesn't reflect its laid-out tree; measure the real layout.
    const ctx = document.createElement('canvas').getContext('2d');
    const bounds = ctx
      ? getLayoutBounds(layoutMindmapNodes(element as MindmapElement, (n) => measureMindmapNodeWith(ctx, n)))
      : null;
    if (bounds) {
      // Leave room for the count badges drawn on node edges.
      return { x: bounds.x - 12, y: bounds.y - 12, width: bounds.width + 24, height: bounds.height + 24 };
    }
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

export function serializeDocument(
  elements: Element[],
  appState: AppState,
  files: Record<string, EmbeddedFile>,
) {
  // Only images still on the board are written; deleted ones drop out of the file.
  const usedFiles: Record<string, EmbeddedFile> = {};
  for (const el of elements) {
    if (el.type === 'image' && files[el.fileId]) usedFiles[el.fileId] = files[el.fileId];
  }
  const doc = {
    type: 'mixnote',
    version: 1,
    source: 'MixNote/0.1.0',
    elements,
    appState,
    files: usedFiles,
  };
  // Pretty-print text-only boards (readable, diffable); keep image boards compact.
  return Object.keys(usedFiles).length > 0 ? JSON.stringify(doc) : JSON.stringify(doc, null, 2);
}

function getFileName(path: string | null | undefined, fallback: string) {
  if (!path) return fallback;
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] || fallback;
}

function replaceExtension(path: string, extension: string) {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return path.replace(/\.[^.]+$/u, normalizedExtension);
}

function getSuggestedDocumentPath(path: string | null) {
  return path ?? DEFAULT_DOCUMENT_NAME;
}

function getSuggestedExportPath(path: string | null) {
  if (!path) return DEFAULT_EXPORT_NAME;
  return /\.[^.]+$/u.test(path) ? replaceExtension(path, '.png') : `${path}.png`;
}

/** Bounding box of everything on the board (mindmaps by their laid-out tree). */
function getBoardBounds(elements: Element[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const bounds = getElementBounds(element, elements);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  return { minX, minY, maxX, maxY };
}

/** On-screen page colour: the default page follows the current theme. */
export function boardBackground(appState: AppState) {
  return isDefaultBackground(appState.viewBackgroundColor) ? canvasTheme.background : appState.viewBackgroundColor;
}

/**
 * Renders the whole board scaled to fit `width` × `height` (CSS px) for a
 * library thumbnail. Small boards are never enlarged past 100%. Returns null
 * for an empty board.
 */
export function renderBoardThumbnail(elements: Element[], appState: AppState, width: number, height: number) {
  if (elements.length === 0) return null;
  const { minX, minY, maxX, maxY } = getBoardBounds(elements);
  const padding = 16;
  const boardWidth = Math.max(maxX - minX, 1);
  const boardHeight = Math.max(maxY - minY, 1);
  const zoom = Math.min(1, (width - padding * 2) / boardWidth, (height - padding * 2) / boardHeight);
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const viewport = new Viewport();
  viewport.update(
    width / 2 - (minX + boardWidth / 2) * zoom,
    height / 2 - (minY + boardHeight / 2) * zoom,
    zoom,
  );
  const renderer = new Renderer(ctx, viewport);
  renderer.backgroundDots = false;
  renderer.setSize(width, height);
  renderer.renderSceneLayer(elements, boardBackground(appState), false, 20);
  return canvas;
}

function createExportCanvas(elements: Element[], backgroundColor: string) {
  if (elements.length === 0) return null;
  const { minX, minY, maxX, maxY } = getBoardBounds(elements);

  const padding = 40;
  const width = Math.max(maxX - minX + padding * 2, 1);
  const height = Math.max(maxY - minY + padding * 2, 1);
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const viewport = new Viewport();
  viewport.update(padding - minX, padding - minY, 1);
  const renderer = new Renderer(ctx, viewport);
  renderer.backgroundDots = false;
  renderer.setSize(width, height);
  // Scene layer only: render() would also run the overlay pass, which clears
  // the same canvas to transparent (the live app uses two canvases).
  renderer.renderSceneLayer(elements, backgroundColor, false, 20);

  return canvas;
}

export function getDocumentDisplayName(path: string | null) {
  const fileName = getFileName(path, DEFAULT_DOCUMENT_NAME);
  return fileName.replace(/\.(?:mixnote|mixboard)$/iu, '');
}

export async function saveCurrentDocument() {
  flushPendingCanvasInteractionState();
  const { elements, appState, files, filePath } = useDocumentStore.getState();
  const platform = await getPlatform();

  // Desktop boards with a file (or an open vault to land in) save in place, no dialog.
  if (platform.isDesktop() && (filePath || useVaultStore.getState().vault)) {
    return (await saveToDocumentFile()) ? useDocumentStore.getState().filePath : null;
  }

  const path = await platform.saveFile(
    serializeDocument(elements, appState, files),
    getSuggestedDocumentPath(filePath),
  );

  if (path) {
    // Edits made while the dialog was open still need saving.
    const unchanged = isUnchangedSince({ elements, appState, files, filePath });
    useDocumentStore.setState(unchanged ? { filePath: path, isDirty: false } : { filePath: path });
  }

  return path;
}

/** Exports the board's notes as a Markdown document (reading order). */
export async function exportCurrentBoardAsMarkdown() {
  flushPendingCanvasInteractionState();
  const { elements, filePath } = useDocumentStore.getState();
  const title = getDocumentDisplayName(filePath);
  const markdown = boardToMarkdown(elements, title);
  const suggested = filePath && /\.[^.]+$/u.test(filePath) ? replaceExtension(filePath, '.md') : `${title}.md`;
  const platform = await getPlatform();
  return platform.saveTextFile(markdown, suggested, { name: 'Markdown', extensions: ['md'] });
}

export async function exportCurrentBoardAsImage() {
  flushPendingCanvasInteractionState();
  const { elements, appState, filePath } = useDocumentStore.getState();
  // Match the screen: the default page colour follows the current theme.
  const canvas = createExportCanvas(elements, boardBackground(appState));
  if (!canvas) return null;

  const platform = await getPlatform();
  return platform.exportAsImage(canvas, 'png', getSuggestedExportPath(filePath));
}
