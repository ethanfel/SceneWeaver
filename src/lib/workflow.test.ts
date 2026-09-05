import { describe, expect, it } from 'vitest';
import { importWorkflow, parseJSON, setInput, validatePrompt } from './workflow';
import { effectiveRunName, h3Frames, planProblems, rawFrames, readPlan, timecode } from './h3';
import type { Schemas, UiWorkflow } from '../types';
import starter from '../../public/examples/h3-starter.api.json';
import starterSchemas from '../../public/examples/h3-schemas.json';

const schemas: Schemas = {
  Source: { input: { required: { seed: ['INT', { control_after_generate: true }], steps: ['INT'], label: ['STRING'] } }, output: ['IMAGE'] },
  Output: { input: { required: { image: ['IMAGE'], path: ['STRING'] } }, output: [], output_node: true },
};
const graph: UiWorkflow = {
  version: .4, groups: [{ title: 'Preserve me', bounding: [1, 2, 3, 4] }], extra: { user: 'metadata' },
  nodes: [
    { id: 1, type: 'Source', pos: [120, 40], widgets_values: ['18446744073709551615', 'fixed', 20, 'original'], outputs: [{ type: 'IMAGE' }] },
    { id: 2, type: 'Reroute', inputs: [{ name: '', type: 'IMAGE', link: 1 }] },
    { id: 3, type: 'Output', widgets_values: ['renders/movie'], inputs: [{ name: 'image', type: 'IMAGE', link: 2 }] },
    { id: 4, type: 'Source', mode: 2, widgets_values: [9, 'fixed', 2, 'muted'] },
  ], links: [[1, 1, 0, 2, 0, 'IMAGE'], [2, 2, 0, 3, 0, 'IMAGE']],
};
describe('workflow execution contract', () => {
  it('converts widgets, skips seed controls, resolves reroutes, and excludes muted nodes', () => {
    const workflow = importWorkflow(graph, 'test', schemas);
    expect(workflow.prompt['1'].inputs).toEqual({ seed: '18446744073709551615', steps: 20, label: 'original' });
    expect(workflow.prompt['3'].inputs.image).toEqual(['1', 0]);
    expect(Object.keys(workflow.prompt)).toEqual(['1', '3']);
    expect(validatePrompt(workflow.prompt, schemas)).toEqual([]);
  });
  it('updates the correct original widget without changing canvas layout or disabled nodes', () => {
    const changed = setInput(importWorkflow(graph, 'test', schemas), '1', 'steps', 32);
    expect(changed.prompt['1'].inputs.steps).toBe(32);
    expect(changed.source?.nodes[0].widgets_values).toEqual(['18446744073709551615', 'fixed', 32, 'original']);
    expect(changed.source?.nodes[0].pos).toEqual([120, 40]);
    expect(changed.source?.nodes[3]).toEqual(graph.nodes[3]);
    expect(changed.source?.groups).toEqual(graph.groups);
    expect(graph.nodes[0].widgets_values).toEqual(['18446744073709551615', 'fixed', 20, 'original']);
  });
  it('refuses ambiguous frontend widgets instead of guessing input positions', () => {
    const custom = structuredClone(graph); (custom.nodes[0].widgets_values as unknown[]).push('extension-widget');
    expect(() => importWorkflow(custom, 'test', schemas)).toThrow('unrecognized saved widgets');
  });
  it('refuses unknown subgraphs and missing schemas', () => {
    expect(() => importWorkflow(graph, 'test', {})).toThrow('Connect');
    const custom = structuredClone(graph); custom.nodes[0].type = 'subgraph-uuid';
    expect(() => importWorkflow(custom, 'test', schemas)).toThrow('no installed schema');
  });
  it('preserves core image-upload widgets and H3 asset binding placeholders', () => {
    const image: UiWorkflow = { nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['reference.png', 'image', null, null, null] }], links: [] };
    const workflow = importWorkflow(image, 'image', { LoadImage: { input: { required: { image: [['reference.png'], { image_upload: true }] } }, output: ['IMAGE', 'MASK'] } });
    expect(workflow.prompt['1'].inputs).toEqual({ image: 'reference.png' });
    expect(setInput(workflow, '1', 'image', 'replacement.png').source?.nodes[0].widgets_values).toEqual(['replacement.png', 'image', null, null, null]);
  });
  it('resolves Get/Set and reports ambiguous buses', () => {
    const bus = structuredClone(graph);
    bus.nodes[1] = { id: 2, type: 'SetNode', inputs: [{ name: 'anything', link: 1 }], widgets_values: ['image'] };
    bus.nodes.push({ id: 5, type: 'GetNode', widgets_values: ['image'] }); bus.links[1][1] = 5;
    expect(importWorkflow(bus, 'bus', schemas).prompt['3'].inputs.image).toEqual(['1', 0]);
    bus.nodes.push({ id: 6, type: 'SetNode', widgets_values: ['image'] });
    expect(() => importWorkflow(bus, 'bus', schemas)).toThrow('exactly one Set');
  });
  it('finds missing inputs and broken output connections before submission', () => {
    expect(validatePrompt({ '1': { class_type: 'Output', inputs: { image: ['404', 0] } } }, schemas)).toEqual(['1.path: required input is missing.', '1.image: source node 404 is missing.']);
  });
  it('round-trips a project bundle using its original editable canvas', () => {
    const edited = setInput(importWorkflow(graph, 'test', schemas), '3', 'path', 'new/path');
    const loaded = importWorkflow({ sceneweaver: 1, name: edited.name, workflow: edited.source }, 'upload', schemas);
    expect(loaded.prompt).toEqual(edited.prompt);
    expect(loaded.source).toEqual(edited.source);
  });
  it('preserves uint64 values when parsing JSON', () => {
    expect(parseJSON('{"seed":18446744073709551615,"small":20}')).toEqual({ seed: '18446744073709551615', small: 20 });
  });
  it('bundles a complete H3 starter with valid connections and explicit review', () => {
    const workflow = importWorkflow(starter, 'starter', starterSchemas as unknown as Schemas);
    expect(validatePrompt(workflow.prompt, starterSchemas as unknown as Schemas)).toEqual([]);
    expect(workflow.prompt['1944'].inputs.enabled).toBe(true);
    expect(planProblems(readPlan(workflow.prompt['1700'].inputs.plan_json), workflow.prompt['1700'].inputs)).toEqual([]);
  });
});
describe('H3 scene plans', () => {
  it('rounds durations onto the H3 17k+5 frame grid', () => {
    expect(h3Frames(5)).toBe(124); expect(h3Frames(10)).toBe(243); expect(h3Frames(15)).toBe(362);
    expect(timecode(124 / 24)).toBe('00:00:05:04');
  });
  it('honors shot > plan > node duration precedence', () => {
    const plan = { defaults: { duration_seconds: 10 }, shots: [] };
    expect(rawFrames({ length: 56, duration_seconds: 15 }, plan, {})).toBe(56);
    expect(rawFrames({ duration_seconds: 5 }, plan, {})).toBe(124);
    expect(rawFrames({}, plan, { default_duration_seconds: 15 })).toBe(243);
  });
  it('retains unknown scene data and validates duplicate IDs, frames, and seeds', () => {
    const plan = readPlan('{"shots":[{"id":"a","prompt":"one","length":120,"seed":"18446744073709551616","future":{"a":1}},{"id":"a","prompt":"two"}]}');
    expect(plan.shots[0].future).toEqual({ a: 1 });
    expect(planProblems(plan, {})).toHaveLength(3);
  });
  it('uses the connected project asset owner run name', () => {
    expect(effectiveRunName({ '1': { class_type: 'MiniMaxH3ChainPlan', inputs: { run_name: 'fallback', project_assets: ['2', 0] } }, '2': { class_type: 'MiniMaxH3ProjectAssetManager', inputs: { run_name: 'actual' } } }, '1')).toBe('actual');
  });
});
