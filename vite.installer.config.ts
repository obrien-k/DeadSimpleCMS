import { defineConfig } from 'vite';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The installer SITE build — distinct from vite.config.ts, which is the library
// build of the vendored /admin/ bundle. This emits an HTML app that we publish
// to this repo's own GitHub Pages (deployed via Actions, not a branch: the
// source is TS that must be built, and a branch deploy would run the output
// through Jekyll).
//
// root is installer/ so index.html lands at the site ROOT (dist-site/index.html
// → served at /DeadSimpleCMS/). That matters: the installer fetches its two
// payloads with same-origin ./bundle.js and ./admin-template.html, which only
// resolve if the page and the payloads share a directory. base './' keeps
// built assets relative so the page works under the project-pages path.
const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: dir('installer'),
  base: './',
  build: {
    outDir: dir('dist-site'),
    emptyOutDir: true,
    target: 'es2022',
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  plugins: [
    {
      // The two payloads the installer writes into a user's repo, served beside
      // it so it always installs the version it shipped with. Requires the
      // library build (dist/bundle.js) to have run first — see build:installer.
      name: 'copy-install-payloads',
      closeBundle() {
        copyFileSync(dir('dist/bundle.js'), dir('dist-site/bundle.js'));
        copyFileSync(dir('admin/index.html'), dir('dist-site/admin-template.html'));
      },
    },
  ],
});
