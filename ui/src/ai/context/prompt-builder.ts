import { BOARD_CAPABILITY_MANIFEST } from '../capabilities';
import type { BoardCapabilityManifest } from '../types';
import {
  derivePromptSafeBoardSnapshot,
  type BoardSnapshot,
} from './board-snapshot';
import type { SelectionContext } from './selection-context';

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptBuilderInput {
  userMessage: string;
  boardSnapshot: BoardSnapshot;
  selectionContext: SelectionContext;
  history?: PromptMessage[];
  capabilityManifest?: BoardCapabilityManifest;
  historyLimit?: number;
}

export const MIXBOARD_SYSTEM_PROMPT = `
You are MixBoard AI, a whiteboard assistant. You MUST respond with ONLY a JSON object. No other text before or after.

IMPORTANT: Your entire response must be valid JSON starting with { and ending with }. Never include explanations, markdown, or text outside the JSON.

JSON format:
{"schemaVersion":"mixboard.ai/v1","intent":"what user wants","summary":"what you did","operations":[...]}

Operation examples:
- Add shape: {"op":"add_element","ref":"a","elementType":"rectangle","props":{"x":100,"y":100,"width":160,"height":80,"text":"Label"}}
- Add diamond: {"op":"add_element","ref":"d","elementType":"diamond","props":{"x":300,"y":200,"width":140,"height":100,"text":"Decision?"}}
- Connect: {"op":"connect_elements","from":{"ref":"a"},"to":{"ref":"d"},"connector":{"type":"arrow"}}
- Delete: {"op":"delete_elements","targets":[{"id":"existing-element-id"}]}
- Update: {"op":"update_element","target":{"id":"existing-id"},"changes":{"text":"New text"}}

Rules:
1. Every operation MUST have "op". Valid: add_element, update_element, delete_elements, move_elements, connect_elements.
2. elementType values: rectangle, ellipse, diamond, triangle, text, sticky_note, line, arrow, frame, section, mindmap.
3. Use "ref" to name new elements, then {"ref":"name"} to connect them. Use {"id":"..."} for existing board elements.
4. If the user asks something you cannot do on the board, return {"schemaVersion":"mixboard.ai/v1","intent":"","summary":"your reply here","operations":[]}.
5. Check the board snapshot in context for existing elements and their IDs.
`.trim();

export function buildPromptContext(input: PromptBuilderInput) {
  const capabilityManifest = input.capabilityManifest ?? BOARD_CAPABILITY_MANIFEST;
  const promptSafeSnapshot = derivePromptSafeBoardSnapshot(
    input.boardSnapshot,
    input.selectionContext,
  );

  return JSON.stringify({
    capabilityManifest,
    selectionContext: input.selectionContext,
    boardSnapshot: promptSafeSnapshot,
  }, null, 2);
}

export function buildPromptMessages(input: PromptBuilderInput): PromptMessage[] {
  const historyLimit = input.historyLimit ?? 12;
  const history = input.history ?? [];

  return [
    { role: 'system', content: MIXBOARD_SYSTEM_PROMPT },
    { role: 'system', content: buildPromptContext(input) },
    ...history.slice(-historyLimit),
    { role: 'user', content: input.userMessage },
  ];
}
