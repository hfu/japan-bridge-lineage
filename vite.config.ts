import { defineConfig } from 'vite';

// GitHub Pages serves this repo from docs/ on main -- build straight there
// instead of the default dist/, and set `base` to the repo name since this
// is a project site (https://hfu.github.io/japan-bridge-lineage/), not a
// user/org root site.
export default defineConfig({
  base: '/japan-bridge-lineage/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
});
