import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandSession } from '../public/integrations/command-session.mjs';

const command = { action: 'queue', binding: 'film:tab', revision: 1, plan: '1', project: 'film', branch_id: 'main' };

test('an accepted action ID never executes twice, including after its receipt was evicted', async () => {
  let calls = 0;
  const session = createCommandSession({ async command() { calls++; return { queued: true }; } }, () => {}, { limit: 1 });
  await session.execute('first', command);
  await session.execute('second', command);
  const repeated = await session.execute('first', command);
  assert.match(repeated.error, /already accepted/); assert.equal(calls, 2);
  assert.equal(session.recent().length, 1);
});

test('status and snapshot reads remain available while an action is running', async () => {
  let finish;
  const published = [];
  const session = createCommandSession({ async command(input) { if (input.action === 'snapshot') return { snapshot: {} }; return new Promise(resolve => { finish = resolve; }); } }, receipt => published.push(receipt));
  const running = session.execute('work', command);
  assert.equal(session.processing, true);
  assert.equal((await session.execute('status', { action: 'command-status', request_id: 'work' })).result.data.status, 'running');
  assert.ok((await session.execute('read', { action: 'snapshot' })).result.snapshot);
  assert.equal((await session.execute('another', command)).outcome, 'rejected');
  finish({ queued: true }); await running;
  assert.deepEqual(published.map(receipt => receipt.status), ['running', 'succeeded']);
  assert.equal(session.processing, false);
  assert.equal((await session.execute('check', { action: 'command-status', request_id: 'work' })).result.data.status, 'succeeded');
});

test('receipts distinguish rejected validation, uncertain execution and partially synchronized results', async () => {
  const session = createCommandSession({ async command(input) {
    if (input.test === 'validation') throw Object.assign(new Error('Wrong graph'), { outcome: 'rejected' });
    if (input.test === 'network') throw new Error('Connection lost after submission');
    return { warning: 'Saved on the server; graph changed before synchronization.' };
  } });
  assert.equal((await session.execute('validation', { ...command, test: 'validation' })).receipt.status, 'rejected');
  assert.equal((await session.execute('network', { ...command, test: 'network' })).receipt.status, 'uncertain');
  assert.equal((await session.execute('partial', command)).receipt.status, 'partial');
});

test('receipts retain scope but exclude prompts, private proofs, files and result payloads', async () => {
  const session = createCommandSession({ async command() { return { data: { private: 'result-secret' } }; } });
  await session.execute('id', { ...command, proof: 'private-proof', prompt: 'private-prompt', file: 'private-file' });
  const receipts = session.recent();
  assert.equal(receipts[0].project, 'film'); assert.equal(receipts[0].branch, 'main');
  assert.doesNotMatch(JSON.stringify(receipts), /private|result-secret/);
  assert.equal((await session.execute('query', { action: 'command-status', request_id: 'missing' })).result.data, null);
});

test('session capacity prevents unbounded ID storage without discarding replay protection', async () => {
  let calls = 0;
  const session = createCommandSession({ async command() { calls++; return {}; } }, () => {}, { maxIds: 1 });
  await session.execute('one', command);
  assert.equal((await session.execute('two', command)).outcome, 'rejected');
  assert.equal(calls, 1);
});
