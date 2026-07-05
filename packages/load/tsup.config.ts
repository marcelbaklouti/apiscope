import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/worker.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  shims: true
})
