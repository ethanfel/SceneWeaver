import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverH3 } from '../public/integrations/h3-discovery.mjs';
import * as planCore from '../e2e/fixtures/h3-native/h3_chain_plan_core.mjs';

const origin = 'http://comfy.test';
const assetPath = '/extensions/h3/h3_project_asset_manager.js';
const studioPath = '/extensions/h3/h3_chain_plan_studio.js';
const imports = `import './h3_project_ownership.mjs?v=not-a-release'; import './h3_project_asset_editor_core.mjs'; import './h3_project_asset_sync_core.mjs';`;
test('scene authoring requires native function and limit exports independently of project writes', async () => {
  const env = environment({ sources: { [studioPath]: `import './h3_chain_plan_core.mjs?v=installed';` }, exports: planCore });
  const supported = await discoverH3(env.api, env.options);
  assert.equal(supported.planAuthoring.renamePlanShot, planCore.renamePlanShot);
  assert.equal(supported.planSettings, true);
  assert.equal(supported.diagnostics.checks.find(item => item.id === 'durationRounding').status, 'unavailable');
  assert.equal(supported.diagnostics.checks.find(item => item.id === 'planAuthoring').status, 'available');
  const importModule = env.options.importModule;
  env.options.importModule = async url => ({ ...await importModule(url), duplicateShot: undefined });
  const missing = await discoverH3(env.api, env.options);
  assert.equal(missing.planAuthoring, undefined); assert.equal(typeof missing.ownershipOptions, 'function');
});

test('missing advanced setting exports leave scene structure available', async () => {
  const env = environment({ sources: { [studioPath]: `import './h3_chain_plan_core.mjs';` }, exports: { ...planCore, normalizeChapterResolution: undefined } });
  const result = await discoverH3(env.api, env.options);
  assert.equal(typeof result.planAuthoring.renamePlanShot, 'function'); assert.equal(result.planSettings, undefined);
  assert.equal(result.diagnostics.checks.find(item => item.id === 'planSettings').status, 'unavailable');
});
function environment(overrides = {}) {
  const sources = { [assetPath]: imports, [studioPath]: `import './h3_working_branches.mjs'; working_branch_id; base_revision: '/minimax_h3_context_loop/editorial'`, ...overrides.sources };
  const calls = [];
  return {
    calls,
    api: { async fetchApi(path) {
      calls.push(path);
      return { ok: true, async json() { return path === '/extensions' ? overrides.paths || [assetPath, studioPath] : { system: { comfyui_version: '0.34.0', required_frontend_version: '1.51.9' } }; } };
    } },
    options: { baseUrl: origin, readText: async url => { const path = new URL(url).pathname; if (!(path in sources)) throw new Error(); return sources[path]; }, importModule: async url => {
      const path = new URL(url).pathname;
      if (path.includes(overrides.fail || 'no-matching-failure')) throw new Error();
      return {
        projectMutationOptions() {}, projectAudioTrackBindings() {}, serializedProjectAssetCatalog() {}, publishProjectAssetCatalogChanged() {},
        workingBranchId() {}, branchRequestPath() {}, ...(overrides.exports || {}),
      };
    } },
  };
}

test('reports native helper evidence without treating cache keys or required frontend as installed versions', async () => {
  const env = environment(), result = await discoverH3(env.api, env.options);
  assert.equal(typeof result.ownershipOptions, 'function');
  assert.equal(result.workingBranches, true);
  assert.equal(result.finalCut, true);
  assert.equal(result.diagnostics.comfyVersion, '0.34.0');
  assert.equal(result.diagnostics.h3Version, '');
  assert.equal(result.diagnostics.frontendVersion, '');
  assert.equal(result.diagnostics.checks.find(item => item.id === 'finalCut').status, 'inferred');
  assert.deepEqual(env.calls.sort(), ['/extensions', '/system_stats']);
});

test('one failed optional module does not erase unrelated integrations', async () => {
  const env = environment({ fail: 'sync_core' }), result = await discoverH3(env.api, env.options);
  assert.equal(result.publishCatalog, undefined);
  assert.equal(typeof result.ownershipOptions, 'function');
  assert.equal(typeof result.audioTracks.projectAudioTrackBindings, 'function');
  assert.equal(result.workingBranches, true);
  assert.equal(result.diagnostics.checks.find(item => item.id === 'catalog').status, 'unavailable');
});

test('source markers alone cannot claim a native helper export exists', async () => {
  const env = environment({ exports: { workingBranchId: null, projectMutationOptions: true } });
  const result = await discoverH3(env.api, env.options);
  assert.equal(result.workingBranches, undefined);
  assert.equal(result.ownershipOptions, undefined);
  assert.equal(typeof result.audioTracks.projectAudioTrackBindings, 'function');
});

test('duplicate H3 installations never mix mutation helper modules', async () => {
  const env = environment({ paths: [assetPath, '/extensions/other/h3_project_asset_manager.js', studioPath] });
  let imported = false; env.options.importModule = async () => { imported = true; return {}; };
  const result = await discoverH3(env.api, env.options);
  assert.equal(imported, false);
  assert.match(result.diagnostics.checks.find(item => item.id === 'discovery').detail, /Multiple H3/);
});

test('does not mix a Studio from another extension root or import off-server scripts', async () => {
  const env = environment({ paths: [assetPath, '/extensions/other/h3_chain_plan_studio.js', 'https://other.test/extensions/h3/h3_chain_plan_studio.js'] });
  const result = await discoverH3(env.api, env.options);
  assert.equal(result.workingBranches, undefined);
  assert.equal(result.finalCut, undefined);
  assert.equal(typeof result.ownershipOptions, 'function');
});

test('extension-list failure is visible while ordinary native workflow functions remain independent', async () => {
  const env = environment(); env.api.fetchApi = async () => ({ ok: false });
  const result = await discoverH3(env.api, env.options);
  assert.equal(result.diagnostics.checks.find(item => item.id === 'discovery').status, 'unavailable');
  assert.equal(result.ownershipOptions, undefined);
});

test('generation discovery requires the actual native queue exports independently of branch helpers', async () => {
  const path = '/extensions/h3/h3_chain_top_level_requeue.js';
  const env = environment({ paths: [assetPath, studioPath, path], sources: { [path]: `import './h3_chain_top_level_requeue_coordinator.mjs';` }, exports: { runBeforeQueuedHooks() {}, submitWithPromptIdentity() {} } });
  assert.equal(typeof (await discoverH3(env.api, env.options)).generationHooks.runBeforeQueuedHooks, 'function');
  const original = env.options.importModule;
  env.options.importModule = async url => ({ ...await original(url), runBeforeQueuedHooks: undefined });
  const missing = await discoverH3(env.api, env.options);
  assert.equal(missing.generationHooks, undefined); assert.equal(typeof missing.ownershipOptions, 'function');
});
