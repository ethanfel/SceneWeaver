import { test, expect } from 'vitest';
import { readPlan, rawFrames, h3Frames } from './h3';

test('displays native scene shorthand and default precedence without changing the source', () => {
  const source = { duration_seconds: 8, steps: 14, defaults: { steps: 7 }, shots: ['First scene', { id: 'next', prompt: ['Next'], custom: true }] };
  const before = JSON.stringify(source), plan = readPlan(source);
  expect(plan.shots[0].prompt).toBe('First scene'); expect(plan.shots[1].custom).toBe(true);
  expect(plan.defaults).toEqual({ duration_seconds: 8, steps: 7 }); expect(rawFrames(plan.shots[0], plan, {})).toBe(h3Frames(8));
  expect(JSON.stringify(source)).toBe(before); expect(readPlan('["bare scene"]').shots[0].prompt).toBe('bare scene');
  expect(() => readPlan('{"shots":[null]}')).toThrow(); expect(() => readPlan('{"shots":[[]]}')).toThrow();
});
