import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/testing/store-conformance.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  shims: true
})
