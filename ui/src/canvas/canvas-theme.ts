/**
 * Canvas-surface colors that follow the app theme (P0.D increment 2).
 *
 * Canvas is drawn on a 2D context and can't use CSS `dark:` utilities, so these
 * colors live in a tiny mutable module that the app updates when the effective
 * theme changes; the renderer and element factory read from it.
 *
 * Only the *default* page background follows the theme — a document that has an
 * explicit (non-default) viewBackgroundColor keeps it, so saved content is never
 * recolored. Likewise only NEW elements pick up the themed default foreground;
 * existing elements keep their stored colors.
 */
import type { EffectiveTheme } from '../theme';

interface CanvasThemeColors {
  /** Page background used when the document background is the default white. */
  background: string;
  /** Grid line color. */
  grid: string;
  /** Default foreground (text / freedraw) for newly created elements. */
  foreground: string;
  /** Dot-grid backdrop color. */
  dot: string;
}

const THEMES: Record<EffectiveTheme, CanvasThemeColors> = {
  light: { background: '#ffffff', grid: '#E8E8E8', foreground: '#1B1B1F', dot: 'rgba(30, 41, 59, 0.24)' },
  dark: { background: '#1b1b1f', grid: '#2e2e36', foreground: '#E6E6EA', dot: 'rgba(255, 255, 255, 0.14)' },
};

export const canvasTheme: CanvasThemeColors = { ...THEMES.light };

export function setCanvasTheme(effective: EffectiveTheme) {
  Object.assign(canvasTheme, THEMES[effective]);
}

/** Whether a document background is the default white (and may follow the theme). */
export function isDefaultBackground(color: string): boolean {
  return /^#(fff|ffffff)$/i.test(color.trim());
}
