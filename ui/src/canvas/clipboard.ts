/**
 * System clipboard helpers for the canvas: what a paste carries (images, text,
 * or MixNote elements copied from a board) and decoding pasted images.
 */

/** Our own clipboard flavour, so a paste can tell board elements from other text. */
export const MIXNOTE_MIME = 'application/x-mixnote';

export interface ClipboardPayload {
  images: Blob[];
  text: string;
  /** The text came from copying MixNote elements (paste those instead). */
  fromBoard: boolean;
}

/**
 * Spreadsheets and word processors put a rendered picture next to the text
 * they copy: keep the text then. A copied web image comes as HTML holding
 * just an <img>, so its picture wins.
 */
function preferText(images: Blob[], text: string, html: string): Blob[] {
  return images.length && text.trim() && !/<img[\s>]/iu.test(html) ? [] : images;
}

/** Reads a paste event's DataTransfer. */
export function payloadFromDataTransfer(data: DataTransfer, lastCopiedText: string | null): ClipboardPayload {
  const images: Blob[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) images.push(file);
    }
  }
  const text = data.getData('text/plain');
  const fromBoard = data.types.includes(MIXNOTE_MIME) || (lastCopiedText !== null && text === lastCopiedText);
  return { images: preferText(images, text, data.getData('text/html')), text, fromBoard };
}

/** Reads the clipboard through the async API (context-menu paste, or no paste event). */
export async function readSystemClipboard(lastCopiedText: string | null): Promise<ClipboardPayload | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    const images: Blob[] = [];
    let text = '';
    let html = '';
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (imageType) images.push(await item.getType(imageType));
      if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
    }
    return { images: preferText(images, text, html), text, fromBoard: lastCopiedText !== null && text === lastCopiedText };
  } catch {
    return null;
  }
}

/** Longest side kept for embedded images (plenty for a canvas; Retina screenshots shrink a lot). */
const MAX_IMAGE_SIDE = 2048;
/** Images under this size are embedded as they are, unless too large in pixels. */
const KEEP_AS_IS_BYTES = 600 * 1024;

const readAsDataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error ?? new Error('read failed'));
  reader.readAsDataURL(blob);
});

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Decodes an image for embedding in a board. Boards store images inline, so
 * big ones are scaled down to MAX_IMAGE_SIDE and re-encoded (JPEG when opaque,
 * PNG when transparent) — a pasted Retina screenshot drops from ~8 MB to well
 * under 1 MB. Small images and animated GIFs / SVGs are kept untouched.
 */
export async function decodeImage(blob: Blob): Promise<{ dataURL: string; width: number; height: number; mimeType: string }> {
  const original = await readAsDataURL(blob);
  const img = new Image();
  // onload rather than img.decode(): decode() can stall in a hidden window.
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('decode failed'));
    img.src = original;
  });
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const mimeType = blob.type || 'image/png';
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  const keep = mimeType === 'image/gif' || mimeType === 'image/svg+xml' || (scale === 1 && blob.size <= KEEP_AS_IS_BYTES);
  if (keep) return { dataURL: original, width, height, mimeType };

  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { dataURL: original, width, height, mimeType };
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const transparent = mimeType !== 'image/jpeg' && hasTransparency(ctx, w, h);
  const type = transparent ? 'image/png' : 'image/jpeg';
  const encoded = canvas.toDataURL(type, 0.86);
  // Re-encoding a small-but-already-compact image can grow it: keep the smaller.
  if (scale === 1 && encoded.length >= original.length) return { dataURL: original, width, height, mimeType };
  return { dataURL: encoded, width: w, height: h, mimeType: type };
}

/** True when the event target is somewhere the user types (native copy/paste applies). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
