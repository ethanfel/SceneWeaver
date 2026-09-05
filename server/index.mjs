import { existsSync } from 'node:fs';
import { createApp } from './app.mjs';
if (existsSync('.env')) process.loadEnvFile('.env');
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const port = Number(process.env.PORT || 4310);
const { server } = createApp({ target: process.env.COMFYUI_URL, webOrigin: process.env.SCENEWEAVER_WEB_ORIGIN });
server.listen(port, '127.0.0.1', () => console.log(`SceneWeaver http://127.0.0.1:${port} → ${process.env.COMFYUI_URL || 'http://127.0.0.1:8188'}`));
