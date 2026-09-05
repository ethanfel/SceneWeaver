// No ComfyUI globals: the consistency rules are shared by the live adapter tests.
export const PROTOCOL = 'sceneweaver.live.v1';
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validateEdits(snapshot, command) {
  if (command.binding !== snapshot.binding) throw new Error('The ComfyUI workflow tab changed. Return to the attached tab or attach again.');
  if (command.revision !== snapshot.revision) throw new Error('ComfyUI changed since this draft was read. Refresh and resolve the changes before applying.');
  if (!Array.isArray(command.edits) || !command.edits.length || command.edits.length > 200) throw new Error('Send between 1 and 200 widget edits.');
  const keys = new Set();
  for (const edit of command.edits) {
    const key = `${edit.node}:${edit.widget}`;
    if (keys.has(key)) throw new Error('A widget was edited twice in the same request.');
    keys.add(key);
    const node = snapshot.nodes[edit.node];
    if (!node || !node.editable.includes(edit.widget)) throw new Error(`Widget ${key} is not editable through the companion.`);
    if (!same(node.inputs[edit.widget], edit.before)) throw new Error(`Widget ${key} changed in ComfyUI.`);
    if (!['string', 'number', 'boolean'].includes(typeof edit.after) || typeof edit.after === 'number' && !Number.isFinite(edit.after)) throw new Error(`Widget ${key} needs a finite scalar value.`);
  }
  return command.edits;
}
export function diffInputs(base, draft) {
  const edits = [];
  for (const [id, node] of Object.entries(draft.prompt)) {
    const original = base.nodes[id];
    if (!original) continue;
    for (const key of original.editable) if (!same(original.inputs[key], node.inputs[key])) {
      edits.push({ node: id, widget: key, before: original.inputs[key], after: node.inputs[key] });
    }
  }
  return edits;
}
export function rebaseDraft(base, next, draft) {
  if (base.binding !== next.binding) return { conflicts: ['Workflow tab changed'], draft };
  const edits = diffInputs(base, draft), conflicts = [];
  const prompt = Object.fromEntries(Object.entries(next.nodes).map(([id, node]) => [id, { class_type: node.class_type, inputs: { ...node.inputs }, _meta: { title: node.title, mode: node.mode } }]));
  for (const edit of edits) {
    const remote = next.nodes[edit.node];
    if (!remote?.editable.includes(edit.widget) || !same(remote.inputs[edit.widget], edit.before) && !same(remote.inputs[edit.widget], edit.after)) conflicts.push(`${edit.node}.${edit.widget}`);
    else prompt[edit.node].inputs[edit.widget] = edit.after;
  }
  return { conflicts, draft: conflicts.length ? draft : { ...draft, prompt } };
}
