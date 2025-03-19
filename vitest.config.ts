import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.{idea,git,cache,output,temp}/**', '**/test/**'],
    },
    alias: {
      '@core': '/src/core',
      '@infrastructure': '/src/infrastructure',
      '@presentation': '/src/presentation',
    },
  },
});