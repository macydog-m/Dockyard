import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, cp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
import { writeThirdPartyNotices } from '../../scripts/third-party-notices.mjs';
await import('../../scripts/check-notebook-assets.mjs');
const desktopPackage = JSON.parse(await readFile('package.json', 'utf8'));
const root = path.resolve('../..');
const output = process.env.DOCKYARD_BUILD_DIR ? path.resolve(process.env.DOCKYARD_BUILD_DIR) : path.resolve('dist');
if (process.env.DOCKYARD_BUILD_DIR) {
  const relative = path.relative(path.join(root, '.local/builds'), output);
  if (!/^desktop-[^/\\]+$/.test(relative)) throw new Error('Release build directory must be a fresh .local/builds/desktop-* directory.');
}
const out = file => path.join(output, file);
const inputs = new Set();
async function bundle(options) {
  const result = await build({ ...options, metafile: true });
  for (const input of Object.keys(result.metafile.inputs)) inputs.add(input);
}
await mkdir(out('ui'), { recursive: true });
for (const entry of ['main', 'preload', 'worker', 'runtime-check', 'capture-preload']) {
  await bundle({
    entryPoints: ['src/' + entry + '.ts'], outfile: out(entry + '.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'koffi'],
  });
}
await bundle({
  entryPoints: ['../../packages/mcp/src/index.ts'], outfile: out('mcp.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
await bundle({
  entryPoints: ['src/renderer/App.tsx'], outfile: out('ui/app.js'), bundle: true,
  platform: 'browser', format: 'iife', target: 'chrome140', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
await copyFile('src/renderer/index.html', out('ui/index.html'));
await copyFile('src/renderer/style.css', out('ui/style.css'));
await cp('src/renderer/assets', out('ui/assets'), { recursive: true });
await mkdir(out('assets'), { recursive: true });
for (const file of ['icon.png', 'icon.ico']) await copyFile('assets/' + file, out('assets/' + file));
await writeFile(out('package.json'), JSON.stringify({
  name: 'dockyard', version: desktopPackage.version, license: 'MIT', main: 'main.cjs', productName: 'Dockyard',
  dependencies: { koffi: desktopPackage.dependencies.koffi },
}, null, 2) + '\n', 'utf8');

await bundle({ entryPoints: ['src/renderer/capture.ts'], outfile: out('ui/capture.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome140', minify: true });
for (const file of ['capture.html', 'capture.css']) await copyFile('src/renderer/' + file, out('ui/' + file));

// Keep the N-API binary outside JS bundles and ship it in both offline packages.
// Windows locks loaded .node files. Leave an identical binary in place so a
// development rebuild does not require closing unrelated preview instances.
// A changed binary still goes through cp and reports any real sharing violation.
const nativeCopy = { recursive: true, filter: async (source, destination) => {
  if (!source.endsWith('.node')) return true;
  try { return !(await readFile(source)).equals(await readFile(destination)); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
} };

await cp(path.dirname(require.resolve('koffi')), out('node_modules/koffi'), nativeCopy);
const nativePackage = '@koromix/koffi-' + process.platform + '-' + process.arch;
await cp(path.dirname(require.resolve(nativePackage)), out('node_modules/' + nativePackage), nativeCopy);

for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(path.join(root, name), out(name));
await writeThirdPartyNotices(output, inputs, [path.dirname(require.resolve('koffi')), path.dirname(require.resolve(nativePackage))]);
