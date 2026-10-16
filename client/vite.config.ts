import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true, allowedHosts: true, port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:5174', '/uploads': 'http://localhost:5174', '/socket.io': { target: 'http://localhost:5174', ws: true } } },
  preview: { host: true, port: 4173, allowedHosts: true }
});
