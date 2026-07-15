import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = new URL('.', import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  if (mode === 'test-core') {
    return {
      build: {
        outDir: resolve(__dirname, '../../.cache/loader-test-core'),
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: resolve(__dirname, 'test/core-harness.ts'),
          formats: ['es'],
          fileName: () => 'core-harness.js',
        },
        rollupOptions: {
          output: {
            entryFileNames: 'core-harness.js',
          },
        },
      },
    };
  }

  if (mode === 'classic') {
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          input: resolve(__dirname, 'src/classic.ts'),
          output: {
            format: 'iife' as const,
            entryFileNames: 'panda-chat-widget-loader.js',
            dir: resolve(__dirname, 'dist'),
          },
        },
      },
    };
  }

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
  };
});
