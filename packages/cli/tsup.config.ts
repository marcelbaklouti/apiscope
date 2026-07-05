import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  shims: true
})
