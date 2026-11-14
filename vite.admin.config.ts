import { defineConfig } from 'vite';

/** Builds the relay admin console (admin/index.html) into dist-admin/, which the relay serves at /admin. */
export default defineConfig({ root: 'admin', base: './', build: { outDir: '../dist-admin', emptyOutDir: true } });
