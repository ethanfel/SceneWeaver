import { resolvePlanBinding } from './binding-core.mjs';

export const PROMPT_SCHEMA_EXPORTS = ['analyzeH3Prompt', 'ensureH3Structure', 'insertH3Section'];
export const PROMPT_COMPLETION_EXPORTS = ['promptCompletionQuery', 'promptCompletionItems', 'applyPromptCompletion'];

// These are pure browser helpers. No filesystem, graph callbacks or queue work
// occurs here. Do not use the native first-match graph walk for reference binding.
export function inspectPromptDraft(modules, core, nodes, planId, planText, request) {
  if (!modules || !core) throw new Error('Native H3 prompt tools are unavailable. Refresh ComfyUI after updating H3.');
  const plan = core.parsePlanJson(planText), index = request?.index;
  if (!Number.isInteger(index) || index < 0 || index >= plan.shots.length) throw new Error('The prompt scene is outside this Plan.');
  const value = request.value;
  if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('Prompt text must be a string of at most 2 million characters.');
  const mode = request.mode ?? 'auto';
  if (!modules.schema.H3_MODES.some(item => item.id === mode)) throw new Error('Choose an installed H3 prompt schema.');
  const duration = Number(request.duration), finalShot = Number(request.finalShot);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(finalShot) || finalShot < 1 || finalShot > 99) throw new Error('Alignment needs a positive duration and a final shot from 1 to 99.');
  let records = [], referenceMode = null;
  let referenceScope = 'Project aliases unavailable. Scheduled and native reference wiring is not checked in this workspace.';
  const binding = resolvePlanBinding(nodes, planId);
  const manager = binding.method === 'connection' && binding.status === 'bound' ? nodes[binding.managerId] : null;
  if (manager && modules.references) {
    try {
      const catalog = JSON.parse(manager.inputs.catalog_json);
      if (catalog.project === binding.project && Array.isArray(catalog.assets)) {
        const shared = core.sharedPrompt(plan).text;
        const nativeNode = { type: 'MiniMaxH3ProjectAssetManager', widgets: Object.entries(manager.inputs).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([name, value]) => ({ name, value })) };
        const native = modules.references.projectAssetReferenceRecords(nativeNode, [shared, value].filter(Boolean).join('\n\n'));
        // Native records contain cyclic live-node references: only transfer
        // authoring metadata, never graph objects or asset filesystem paths.
        const fields = ['token', 'nativeToken', 'semanticToken', 'tag', 'label', 'kind', 'active', 'nativeActive', 'semanticActive', 'semanticOnly', 'supportsSemantic'];
        records = native.map(record => Object.fromEntries(fields.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])));
        referenceMode = 'tagged';
        referenceScope = `Project aliases from connected Carousel #${binding.managerId}. Scheduled and separately wired native references are not checked.`;
      }
    } catch { /* A stale/invalid catalog cannot supply aliases. Schema tools remain usable. */ }
  }
  const options = { duration, finalShot, connectedReferences: records.filter(record => record.nativeActive) };
  const analysis = modules.schema.analyzeH3Prompt(value, mode, options);
  // Native reference warnings require a complete binding inventory, which the
  // project-alias catalog is not. Preserve them separately with their scope.
  const referenceProblems = analysis.problems.filter(problem => problem.code === 'reference');
  analysis.problems = analysis.problems.filter(problem => problem.code !== 'reference');
  const query = modules.completion.promptCompletionQuery(value, request.caret ?? value.length, { manual: Boolean(request.manual), records });
  const items = modules.completion.promptCompletionItems(query, records, { referenceMode, text: value, mode, limit: 40 });
  let proposal = null;
  switch (request.operation ?? 'inspect') {
    case 'inspect': break;
    case 'structure': proposal = modules.schema.ensureH3Structure(value, mode, options); break;
    case 'section':
      if (!analysis.required.includes(request.section)) throw new Error('That section does not belong to this schema.');
      proposal = modules.schema.insertH3Section(value, request.section, mode); break;
    case 'complete': {
      // Recompute from current text/caret; never accept arbitrary client snippets.
      const item = items[request.item];
      if (!Number.isInteger(request.item) || !item) throw new Error('That completion is no longer available.');
      proposal = modules.completion.applyPromptCompletion(value, query, item, { appendSpace: true }); break;
    }
    default: throw new Error('Unsupported prompt tool operation.');
  }
  return { modes: modules.schema.H3_MODES, analysis, referenceProblems, referenceScope, references: records, tokens: modules.rich.tokenizeRichPrompt(value, records), items, proposal };
}
