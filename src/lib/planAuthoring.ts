export type PlanEdit =
  | { type: 'rename'; index: number; id: string }
  | { type: 'duplicate' | 'add' | 'remove' | 'chapter-add'; index: number }
  | { type: 'move'; index: number; direction: number }
  | { type: 'chapter-update'; index: number; chapter_id: string; title: string; text: string }
  | { type: 'chapter-remove'; index: number; chapter_id: string };
