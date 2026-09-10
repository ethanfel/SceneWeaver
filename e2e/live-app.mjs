import { api } from '/scripts/api.js';
const starter = await (await fetch('/test/starter')).json();
const graph = { id: 'live-workflow-uuid', _nodes: [], links: {}, change() {}, beforeChange() {}, afterChange() {}, setDirtyCanvas() {}, serialize() { return { id: this.id, nodes: this._nodes.map(node => ({ id: node.id, type: node.type, widgets_values: node.widgets.map(w => w.value) })), links: [] }; } };
let linkId = 0;
for (const [id, value] of Object.entries(starter)) {
  const node = { id, type: value.class_type, title: value._meta?.title || value.class_type, graph, widgets: [], inputs: [] };
  for (const [name, input] of Object.entries(value.inputs)) {
    if (Array.isArray(input) && input.length === 2 && typeof input[1] === 'number') { const link = ++linkId; graph.links[link] = { origin_id: input[0], origin_slot: input[1] }; node.inputs.push({ name, link }); }
    else if (['string', 'number', 'boolean'].includes(typeof input)) node.widgets.push({ name, value: input, callback() { window.nativeCallbacks++; } });
  }
  graph._nodes.push(node);
}
const manager = { id: '9000', type: 'MiniMaxH3ProjectAssetManager', graph, widgets: [{ name: 'run_name', value: 'sceneweaver_first_film' }, { name: 'catalog_json', value: '{}' }], inputs: [] };
graph._nodes.push(manager);
const workflow = { path: 'workflows/Live unsaved.json', filename: 'Live unsaved.json', isPersisted: true, isTemporary: false, isModified: true, activeState: null,
  changeTracker: { prepareForSave() { workflow.activeState = graph.serialize(); } } };
window.nativeCallbacks = 0;
export const app = {
  graph, canvas: { graph, selectNode(node) { window.focusedNode = node.id; }, centerOnNode() {} },
  extensionManager: { workflow: { activeWorkflow: workflow, async saveWorkflow(target) { window.savedWorkflow = structuredClone({ path: target.path, graph: target.activeState }); target.isModified = false; } } },
  async graphToPrompt(current = this.graph) {
    const output = {};
    for (const node of current._nodes) {
      const inputs = {};
      for (const widget of node.widgets) inputs[widget.name] = widget.serializeValue ? await widget.serializeValue(node) : widget.value;
      for (const input of node.inputs) { const link = current.links[input.link]; inputs[input.name] = [String(link.origin_id), link.origin_slot]; }
      output[String(node.id)] = { class_type: node.type, inputs };
    }
    return { output, workflow: current.serialize() };
  },
  async queuePrompt() {
    const prompt = Object.fromEntries(graph._nodes.map(node => [node.id, { class_type: node.type, inputs: { ...Object.fromEntries(node.widgets.map(w => [w.name, w.value])), ...Object.fromEntries(node.inputs.map(input => { const link = graph.links[input.link]; return [input.name, [link.origin_id, link.origin_slot]]; })) } }]));
    const response = await api.fetchApi('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: 'native-comfy-client', extra_data: { native_queue_hook: true } }) });
    return response.ok;
  },
};
window.testComfy = app;
