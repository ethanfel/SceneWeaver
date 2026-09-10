import { effectiveInputs, isActiveNode, isConnection, resolvePlanBinding } from './binding-core.mjs';
import { planBranchSource } from './plan-source.mjs';

export function deliveryTargets(nodes) {
  return Object.entries(nodes).filter(([, node]) => node.class_type === 'MiniMaxH3ChainAssemble' && isActiveNode(node))
    .map(([id, node]) => ({ id, title: node.title || `H3 assembly #${id}` }));
}
export function deliveryConfiguration(snapshot, command) {
  const binding = resolvePlanBinding(snapshot.nodes, command.plan), branch = planBranchSource(snapshot.nodes, command.plan);
  if (binding.status !== 'bound' || binding.project !== command.project || branch.id !== command.branch_id) throw new Error('The delivery Plan, project or working branch changed.');
  const node = snapshot.nodes[command.target];
  if (!deliveryTargets(snapshot.nodes).some(item => item.id === command.target)) throw new Error('Select an active assembly node for its delivery settings.');
  const fields = ['audio_source', 'filename', 'audio_bitrate', 'copy_to_output', 'output_subfolder', 'blend_schedule', 'boundary_tone_match', 'color_stabilization'];
  const values = effectiveInputs(node), settings = {};
  for (const field of fields) {
    if (isConnection(values[field])) throw new Error(`Assembly ${field} is connected. Its delivery settings need a source adapter.`);
    if (values[field] !== undefined) settings[field] = values[field];
  }
  if (values.overwrite_existing) throw new Error('Turn off overwrite_existing before isolated delivery.');
  if (typeof command.filename !== 'string' || !command.filename.trim()) throw new Error('Give the delivery a filename. Native date tokens are supported.');
  settings.filename = command.filename.trim();
  if (!['plan', 'source', 'generated', 'none'].includes(command.audio_source)) throw new Error('Select the final audio source.');
  settings.audio_source = command.audio_source;
  return { target: command.target, settings, manager: binding.managerId };
}
