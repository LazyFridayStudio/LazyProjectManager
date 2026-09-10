import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { renderCssCustomProperties } from './src/tokens/render-css-custom-properties.js';

const TOKENS_MODULE_ID = 'virtual:lpm-tokens.css';

/**
 * Serves the design tokens as a stylesheet generated from the TypeScript
 * constants.
 *
 * Generating it here rather than writing a file means the CSS and the constants
 * cannot drift, and there is no build-order dependency to get wrong — no step
 * that has to run before the bundle, and no generated file to accidentally edit
 * or commit.
 */
function designTokensStylesheet(): Plugin {
  const resolvedId = `\0${TOKENS_MODULE_ID}`;

  return {
    name: 'lpm-design-tokens',
    resolveId: (id) => (id === TOKENS_MODULE_ID ? resolvedId : undefined),
    load: (id) => (id === resolvedId ? renderCssCustomProperties() : undefined),
  };
}

export default defineConfig({
  plugins: [react(), designTokensStylesheet()],
  server: {
    port: 5173,
    /**
     * In development the server runs on its own port, so `/api` is proxied to
     * keep the browser on a single origin. In production both are served from
     * the same hostname and no proxy is involved.
     */
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
