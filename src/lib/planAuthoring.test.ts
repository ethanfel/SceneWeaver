import { test, expect } from 'vitest';
import { readPlan, rawFrames, h3Frames, planProblems } from './h3';
import { canonicalSceneId } from './planAuthoring';

test('displays native scene shorthand and default precedence without changing the source', () => {
  const source = { duration_seconds: 8, steps: 14, defaults: { steps: 7 }, shots: ['First scene', { id: 'next', prompt: ['Next'], custom: true }] };
  const before = JSON.stringify(source), plan = readPlan(source);
  expect(plan.shots[0].prompt).toBe('First scene'); expect(plan.shots[1].custom).toBe(true);
  expect(plan.defaults).toEqual({ duration_seconds: 8, steps: 7 }); expect(rawFrames(plan.shots[0], plan, {})).toBe(h3Frames(8));
  expect(JSON.stringify(source)).toBe(before); expect(readPlan('["bare scene"]').shots[0].prompt).toBe('bare scene');
  expect(() => readPlan('{"shots":[null]}')).toThrow(); expect(() => readPlan('{"shots":[[]]}')).toThrow();
});

test('duration display matches Python grid rounding and ignores unsupported default frame aliases', () => {
  for (const [seconds, expected] of [[1, 39], [6, 158], [12, 294], [0.208333333375, 5], [90 / 24 + 1e-12, 90], [(90 + 1e-7) / 24, 107], [(3592 + 1e-7) / 24, 3609]]) expect(h3Frames(seconds)).toBe(expected);
  const plan = { defaults: { frames: 209, length: 260, duration_seconds: 6 }, shots: [{ prompt: 'one' }] };
  expect(rawFrames(plan.shots[0], plan, { default_duration_seconds: 12 })).toBe(158);
  expect(rawFrames({ length: 209, duration_seconds: 12 }, plan, {})).toBe(209);
  expect(planProblems({ shots: [{ prompt: 'one', duration_seconds: 0 }] }, {})).toContain('Scene 1: duration must be a finite positive number.');
});

test('chapter marker lookup follows normalized H3 scene IDs without rewriting the authored identity', () => {
  expect(canonicalSceneId(' .New scene!- ', 0)).toBe('New_scene');
  expect(canonicalSceneId('', 1)).toBe('clip_0002');
  expect(canonicalSceneId('a'.repeat(120), 0)).toHaveLength(96);
});
