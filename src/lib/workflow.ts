import type { ApiNode, InputSpec, Link, NodeSchema, Prompt, Schemas, UiNode, UiWorkflow, Value, Workflow } from '../types';

export function parseJSON(text: string): unknown {
  return JSON.parse(text, function (_key, value, context?: { source?: string }) {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (context?.source) return context.source;
      throw new Error('This JSON contains an integer too large to read exactly. Quote large seeds as strings.');
    }
    return value;
  });
}
export const isLink = (value: unknown): value is Link => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]) && value[1] >= 0;
export const nodeTitle = (id: string, node: ApiNode) => node._meta?.title || `${node.class_type.replace(/^MiniMaxH3/, 'H3 ').replace(/([a-z])([A-Z])/g, '$1 $2')} · ${id}`;
export function inputSpecs(schema?: NodeSchema): [string, InputSpec][] {
  if (!schema) return [];
  return (['required', 'optional'] as const).flatMap(group => {
    const fields = schema.input[group] || {};
    return (schema.input_order?.[group] || Object.keys(fields)).filter(key => fields[key]).map(key => [key, fields[key]] as [string, InputSpec]);
  });
}
const isWidget = ([kind, options]: InputSpec) => !options?.forceInput && (Array.isArray(kind) || ['INT', 'FLOAT', 'BOOLEAN', 'STRING', 'COMBO'].includes(kind));
const virtual = (node: UiNode) => ['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode', 'SetNode', 'GetNode'].includes(node.type);

export function importWorkflow(raw: unknown, name: string, schemas: Schemas): Workflow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Choose a ComfyUI workflow JSON or API export.');
  const object = raw as Record<string, unknown>;
  if (object.sceneweaver === 1) return importWorkflow(object.workflow, String(object.name || name), schemas);
  if (!Array.isArray(object.nodes)) {
    const data = object.prompt && typeof object.prompt === 'object' ? object.prompt : raw;
    const prompt = structuredClone(data) as Prompt;
    if (!Object.keys(prompt).length || Object.values(prompt).some(node => !node || typeof node.class_type !== 'string' || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs))) throw new Error('This file is not an API prompt or a ComfyUI canvas workflow.');
    return { name, prompt, bindings: {}, warnings: [] };
  }
  if (!Object.keys(schemas).length) throw new Error('Connect to ComfyUI before importing a canvas workflow, or import an API export. Node schemas are required to read its widgets correctly.');
  const source = structuredClone(raw) as UiWorkflow;
  const nodes = new Map(source.nodes.map(node => [String(node.id), node]));
  const links = new Map((source.links || []).map(link => [link[0], link]));
  const prompt: Prompt = {};
  const bindings: Workflow['bindings'] = {};
  const warnings: string[] = [];
  const resolve = (id: string, slot: number, seen = new Set<string>()): Value | undefined => {
    const key = `${id}:${slot}`;
    if (seen.has(key)) throw new Error(`Cyclic virtual connection at node ${id}. Export API format from ComfyUI.`);
    seen.add(key);
    const node = nodes.get(id);
    if (!node) throw new Error(`Connection refers to missing node ${id}.`);
    if (node.mode === 2) return undefined;
    const through = (input?: { link?: number | null }) => {
      const link = input?.link == null ? undefined : links.get(input.link);
      return link ? resolve(String(link[1]), link[2], seen) : undefined;
    };
    if (node.type === 'PrimitiveNode') return Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;
    if (node.type === 'GetNode') {
      const label = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;
      const setters = source.nodes.filter(n => n.type === 'SetNode' && n.mode !== 2 && Array.isArray(n.widgets_values) && n.widgets_values[0] === label);
      if (setters.length !== 1) throw new Error(`Get node ${id} needs exactly one Set node for “${label}”.`);
      return resolve(String(setters[0].id), 0, seen);
    }
    if (node.type === 'Reroute' || node.type === 'SetNode') return through(node.inputs?.[0]);
    if (node.mode === 4) {
      const type = node.outputs?.[slot]?.type || schemas[node.type]?.output?.[slot];
      const candidates = node.inputs?.filter(input => input.link != null && (input.type === type || input.type === '*')) || [];
      if (candidates.length !== 1) throw new Error(`Bypassed node ${id} has ambiguous routing. Export API format from ComfyUI to preserve its behavior.`);
      return through(candidates[0]);
    }
    return [id, slot];
  };
  for (const node of source.nodes) {
    if (virtual(node) || node.mode === 2 || node.mode === 4) continue;
    const id = String(node.id), schema = schemas[node.type];
    if (!schema) throw new Error(`Node ${id} (${node.type}) has no installed schema. Install its node pack, or export this workflow in API format from ComfyUI. Subgraphs and frontend-only extensions must be exported by ComfyUI.`);
    const inputs: ApiNode['inputs'] = {};
    bindings[id] = {};
    let index = 0;
    const values = node.widgets_values || [];
    for (const [key, spec] of inputSpecs(schema)) {
      if (!isWidget(spec)) continue;
      const address = Array.isArray(values) ? index : key;
      const value = (values as Record<string | number, Value>)[address];
      if (value !== undefined) inputs[key] = value;
      else if (spec[1]?.default !== undefined) {
        inputs[key] = spec[1]!.default!;
        warnings.push(`${node.title || node.type}: ${key} uses the installed node's default (not saved in this workflow).`);
      }
      bindings[id][key] = address;
      index++;
      if (spec[1]?.control_after_generate) {
        const control = Array.isArray(values) ? values[index] : undefined;
        if (['fixed', 'increment', 'decrement', 'randomize'].includes(String(control))) {
          if (control !== 'fixed') warnings.push(`${node.title || node.type}: “${control}” seed control is held fixed in SceneWeaver. Change the seed explicitly when needed.`);
          index++;
        }
      }
    }
    // Core LoadImage serializes its upload button after the image selector.
    // H3 asset binding controls may append null presentation-only placeholders.
    const uploadTail = node.type === 'LoadImage' && Array.isArray(values) && values[index] === 'image' && values.slice(index + 1).every(value => value === null);
    if (Array.isArray(values) && values.length > index && !uploadTail) throw new Error(`Node ${id} (${node.type}) has ${values.length - index} unrecognized saved widgets. Export API format from ComfyUI to avoid shifting input values.`);
    for (const input of node.inputs || []) {
      if (input.link == null) continue;
      const link = links.get(input.link);
      if (!link) throw new Error(`Missing link ${input.link} at ${node.type}.${input.name}.`);
      const resolved = resolve(String(link[1]), link[2]);
      if (resolved === undefined) delete inputs[input.name];
      else inputs[input.name] = resolved;
    }
    prompt[id] = { class_type: node.type, inputs, _meta: { title: node.title || node.type } };
  }
  return { name, prompt, source, bindings, warnings: [...new Set(warnings)] };
}

export function setInput(workflow: Workflow, id: string, key: string, value: Value): Workflow {
  const node = workflow.prompt[id];
  if (!node) return workflow;
  const next = { ...workflow, prompt: { ...workflow.prompt, [id]: { ...node, inputs: { ...node.inputs, [key]: value } } } };
  const address = workflow.bindings[id]?.[key];
  if (workflow.source && address !== undefined && !isLink(value)) {
    next.source = { ...workflow.source, nodes: workflow.source.nodes.map(n => {
      if (String(n.id) !== id) return n;
      const values = structuredClone(n.widgets_values || []);
      (values as Record<string | number, Value>)[address] = value;
      return { ...n, widgets_values: values };
    }) };
  }
  return next;
}

export function validatePrompt(prompt: Prompt, schemas: Schemas): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(prompt)) {
    const schema = schemas[node.class_type];
    if (Object.keys(schemas).length && !schema) errors.push(`${id}: ${node.class_type} is not installed.`);
    for (const key of Object.keys(schema?.input.required || {})) {
      if (!(key in node.inputs)) errors.push(`${id}.${key}: required input is missing.`);
    }
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isLink(value)) {
        const upstream = prompt[value[0]];
        if (!upstream) errors.push(`${id}.${key}: source node ${value[0]} is missing.`);
        else if (schemas[upstream.class_type]?.output && value[1] >= schemas[upstream.class_type].output!.length) errors.push(`${id}.${key}: output ${value[1]} does not exist.`);
      }
      if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${id}.${key}: enter a finite number.`);
    }
  }
  if (!Object.keys(prompt).length) errors.push('The workflow is empty.');
  return errors;
}

export function downloadJSON(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
