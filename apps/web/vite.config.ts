import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // A cloudflared quick tunnel for showing the dev build on other devices.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      // 127.0.0.1, not localhost: the API listens on IPv4 only, and Node tries ::1 first, which costs ~2 s per request.
      '/api': 'http://127.0.0.1:8787',
    },
    // The recipe generator and the review page save the library often; the game picks it up on the next dev start, not with a reload mid-play.
    watch: { ignored: ['**/packages/core/src/library/recipes.json'] },
  },
  worker: {
    format: 'es',
  },
});
