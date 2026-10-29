import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { rollup } from 'rollup';
import { format } from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = (await readFile(root + 'VERSION', 'utf8')).trim();
const output = root + 'web/static/kp.js';
const wrapper = `(function (root, factory) {
  'use strict';
  var plugin = factory();
  if (typeof module === 'object' && module.exports) { module.exports = plugin; }
  else if (root.Lampa && !root.kinolampInstalled) {
    root.kinolampInstalled = true;
    plugin.install(root.Lampa, root.jQuery || root.$, root);
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
`;
const bundle = await rollup({
  input: root + 'web/plugin/index.js',
  // Every source function stays in the artifact and must pass coverage checks.
  treeshake: false,
  plugins: [
    {
      name: 'inline-local-assets',
      async load(id) {
        if (!/\.(css|svg)$/.test(id)) return null;
        let source = await readFile(id, 'utf8');
        if (id.endsWith('.svg'))
          source = source.replace('<svg ', '<svg width="48" height="48" ');
        return 'export default ' + JSON.stringify(source) + ';';
      }
    }
  ],
  onwarn(warning) {
    throw new Error(warning.message);
  }
});
try {
  const { output: chunks } = await bundle.generate({
    format: 'iife',
    name: 'plugin',
    exports: 'default',
    generatedCode: 'es5'
  });
  const source = await format(
    `/* Kinolamp ${version} — MIT. Generated from web/plugin/index.js; edit sources and run make build-plugin. */\n` +
      wrapper +
      chunks[0].code +
      '\nreturn plugin;\n});\n',
    { parser: 'babel', singleQuote: true, trailingComma: 'none' }
  );
  if (process.argv.includes('--check')) {
    if (source !== (await readFile(output, 'utf8'))) {
      throw new Error(
        'kp.js is stale. Run make build-plugin and commit the generated file.'
      );
    }
    console.log('Plugin bundle matches its sources.');
  } else {
    await writeFile(output, source);
    console.log('Built web/static/kp.js');
  }
} finally {
  await bundle.close();
}
