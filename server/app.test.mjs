import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createApp, validateTarget } from './app.mjs';

let upstream, bridge, base, upstreamBase, wss;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.startsWith('/view')) { res.writeHead(206, { 'Content-Range': 'bytes 0-3/8', 'Content-Type': 'video/mp4' }); res.end('abcd'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), origin: req.headers.origin }));
  });
  wss = new WebSocketServer({ server: upstream });
  wss.on('connection', ws => ws.send(JSON.stringify({ type: 'status', data: { queue_remaining: 0 } })));
  await listen(upstream); upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
  bridge = createApp({ target: upstreamBase }).server; await listen(bridge); base = `http://127.0.0.1:${bridge.address().port}`;
});
after(async () => { wss.clients.forEach(client => client.terminate()); wss.close(); bridge.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise(r => bridge.close(r)), new Promise(r => upstream.close(r))]); });
test('validates explicit HTTP targets and rejects credentials and non-HTTP schemes', () => {
  assert.equal(validateTarget('http://example.test:8188/'), 'http://example.test:8188');
  for (const value of ['file:///etc/passwd', 'http://user:secret@localhost', 'http://localhost/#x', '']) assert.throws(() => validateTarget(value));
});
test('streams prompt bodies and preserves query strings', async () => {
  const response = await fetch(`${base}/comfy/prompt?x=1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{"prompt":{"1":{"inputs":{"seed":"18446744073709551615"}}}}' });
  const value = await response.json(); assert.equal(value.path, '/prompt?x=1'); assert.equal(value.origin, upstreamBase); assert.equal(JSON.parse(value.body).prompt['1'].inputs.seed, '18446744073709551615');
});
test('preserves partial media responses for video seeking', async () => {
  const response = await fetch(`${base}/comfy/view?filename=clip.mp4`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 0-3/8'); assert.equal(await response.text(), 'abcd');
});
test('rejects cross-origin access and invalid local Host headers', async () => {
  assert.equal((await fetch(`${base}/api/connection`, { method: 'PUT', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{"target":"http://example.test"}' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/comfy/queue`, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await (await fetch(`${base}/api/connection`)).json()).target, upstreamBase);
});
test('proxies ComfyUI WebSocket events', async () => {
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/comfy/ws?clientId=test`, { origin: base });
  const value = await new Promise((resolve, reject) => { socket.once('message', data => resolve(JSON.parse(data))); socket.once('error', reject); });
  assert.equal(value.type, 'status'); socket.close();
});
test('serves the public live adapter only with CORS for the configured ComfyUI origin', async () => {
  const good = await fetch(`${base}/integrations/companion-client.mjs`, { headers: { Origin: upstreamBase } });
  assert.equal(good.status, 200); assert.equal(good.headers.get('access-control-allow-origin'), upstreamBase);
  assert.match(await good.text(), /export async function launch/);
  const other = await fetch(`${base}/integrations/companion-client.mjs`, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${base}/api/connection`, { headers: { Origin: upstreamBase } })).status, 403);
});
