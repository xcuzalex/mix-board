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

export interface MixBoardDocument {
  type: 'mixboard';
  version: number;
  source: string;
  elements: Element[];
  appState: AppState;
  files: Record<string, EmbeddedFile>;
}

export function createDocument(): MixBoardDocument {
  return {
    type: 'mixboard',
    version: 1,
    source: 'MixBoard/0.1.0',
    elements: [],
    appState: {
      viewBackgroundColor: '#ffffff',
      gridEnabled: false,
      gridSize: 20,
    },
    files: {},
  };
}
