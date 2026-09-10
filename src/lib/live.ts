import type { LiveSnapshot, Workflow } from '../types';
export function liveWorkflow(snapshot: LiveSnapshot): Workflow {
  return { name: snapshot.name, bindings: {}, warnings: [], prompt: Object.fromEntries(Object.entries(snapshot.nodes).map(([id, node]) => [id, { class_type: node.class_type, inputs: node.inputs, _meta: { title: node.title, mode: node.mode, inputErrors: node.inputErrors, routing: node.routing, inputSources: node.inputSources, outputSources: node.outputSources, scopeActive: node.scopeActive } }])) };
}
