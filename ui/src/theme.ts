/**
 * App theme (light / dark / system). Applies the effective theme to
 * <html data-theme="..."> so the Tailwind `dark:` custom-variant and the
 * CSS tokens in styles.css take effect. (P0.D)
 */
export type Theme = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'mixboard-theme';

export function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveEffectiveTheme(theme: Theme): EffectiveTheme {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

/** Sets <html data-theme="light|dark"> for the given preference. */
export function applyTheme(theme: Theme): EffectiveTheme {
  const effective = resolveEffectiveTheme(theme);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = effective;
  }
  return effective;
}

export function loadStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // ignore storage access errors (private mode, etc.)
  }
  return 'system';
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

/**
 * Keeps the effective theme in sync with the OS when preference is 'system'.
 * Returns an unsubscribe function. `onChange` is called with the new effective theme.
 */
export function watchSystemTheme(getTheme: () => Theme, onChange: (effective: EffectiveTheme) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getTheme() === 'system') {
      onChange(applyTheme('system'));
    }
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
