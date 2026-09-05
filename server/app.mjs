import express from 'express';
import http from 'node:http';
import httpProxy from 'http-proxy';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pkg from '../package.json' with { type: 'json' };

export function validateTarget(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTP(S) ComfyUI URL without credentials, query, or fragment.');
  return url.href.replace(/\/+$/, '');
}
export function createApp({ target = 'http://127.0.0.1:8188', webOrigin = 'http://127.0.0.1:5173' } = {}) {
  let currentTarget = validateTarget(target);
  const app = express(), server = http.createServer(app);
  app.disable('x-powered-by');
  // Only the public browser adapter is readable from the configured ComfyUI
  // origin. API access keeps the local-interface guard below.
  app.use('/integrations', (req, res, next) => {
    if (req.headers.origin === new URL(currentTarget).origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
    next();
  }, express.static(resolve(fileURLToPath(new URL('..', import.meta.url)), 'public/integrations')));
  const permitted = req => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
    const origin = req.headers.origin;
    return !origin || origin === `http://${host}` || origin === `https://${host}` || origin === webOrigin;
  };
  app.use((req, res, next) => {
    if (!permitted(req)) return res.status(403).json({ error: 'SceneWeaver accepts requests from its local interface only.' });
    next();
  });
  const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true, proxyTimeout: 120000 });
  proxy.on('error', (_error, _req, res) => {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot reach ComfyUI. Check the server address and that ComfyUI is running.' }));
    } else res?.destroy();
  });
  // ComfyUI checks Origin on local connections. The local application guard above
  // authenticates the browser origin; the upstream sees its own canonical origin.
  proxy.on('proxyReq', proxyReq => proxyReq.setHeader('origin', new URL(currentTarget).origin));
  proxy.on('proxyReqWs', proxyReq => proxyReq.setHeader('origin', new URL(currentTarget).origin));
  app.use('/comfy', (req, res) => proxy.web(req, res, { target: currentTarget }));
  app.use('/api', express.json({ limit: '1mb' }));
  app.get('/api/connection', (_req, res) => res.json({ target: currentTarget }));
  app.put('/api/connection', (req, res) => {
    try {
      currentTarget = validateTarget(req.body?.target);
      res.json({ target: currentTarget });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.get('/api/health', (_req, res) => res.json({ app: 'SceneWeaver', version: pkg.version }));
  const dist = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Unknown endpoint.' });
    res.sendFile(resolve(dist, 'index.html'));
  });
  server.on('upgrade', (req, socket, head) => {
    if (!permitted(req) || !req.url.startsWith('/comfy/ws?')) { socket.destroy(); return; }
    req.url = req.url.slice('/comfy'.length);
    proxy.ws(req, socket, head, { target: currentTarget });
  });
  server.on('close', () => proxy.close());
  return { app, server };
}
