import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {
    '/api': 'http://127.0.0.1:4310',
    '/integrations': 'http://127.0.0.1:4310',
    '/comfy': { target: 'http://127.0.0.1:4310', ws: true },
  } },
});
