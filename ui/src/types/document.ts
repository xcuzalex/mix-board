import type { Element } from './element';

export interface AppState {
  viewBackgroundColor: string;
  gridEnabled: boolean;
  gridSize: number;
}

export interface EmbeddedFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export interface MixNoteDocument {
  /** 'mixboard' in files saved before the rename. */
  type: 'mixnote' | 'mixboard';
  version: number;
  source: string;
  elements: Element[];
  appState: AppState;
  files: Record<string, EmbeddedFile>;
}

export function createDocument(): MixNoteDocument {
  return {
    type: 'mixnote',
    version: 1,
    source: 'MixNote/0.1.0',
    elements: [],
    appState: {
      viewBackgroundColor: '#ffffff',
      gridEnabled: false,
      gridSize: 20,
    },
    files: {},
  };
}
