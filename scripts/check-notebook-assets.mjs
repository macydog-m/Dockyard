import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A release must not silently include an added or changed SVG without its
// provenance entry. This is an integrity check, not a legal determination.
const directory = fileURLToPath(new URL('../apps/desktop/src/renderer/assets/notebook/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8'));
const svgFiles = (await readdir(directory)).filter(file => file.endsWith('.svg')).sort();
const entries = manifest.files.map(item => item.file).sort();
if (JSON.stringify(svgFiles) !== JSON.stringify(entries)) throw new Error('Notebook SVG inventory and sources.json differ.');
for (const entry of manifest.files) {
  if (!/^[A-Za-z0-9]+\.svg$/.test(entry.file)) throw new Error('Invalid notebook asset filename.');
  const bytes = await readFile(path.join(directory, entry.file));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Notebook SVG changed without a provenance review: ' + entry.file);
  if (!entry.license || !entry.source) throw new Error('Missing notebook asset provenance.');
}
for (const name of ['lucide', 'phosphor', 'dockyard']) {
  const license = await readFile(path.join(directory, 'LICENSES', name + '.txt'), 'utf8');
  if (!license.includes('Copyright') || !license.includes('Permission')) throw new Error('Incomplete notebook license: ' + name);
}
console.log('Notebook assets: ' + svgFiles.length + ' SVGs verified with source records and license texts.');
