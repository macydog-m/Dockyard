import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Resolve package roots from actual esbuild inputs, not the entire development tree.
export async function writeThirdPartyNotices(output, inputs, externalPackages) {
  const directories = new Set(externalPackages);
  for (const input of inputs) {
    const absolute = path.resolve(input);
    const marker = path.sep + 'node_modules' + path.sep;
    const index = absolute.lastIndexOf(marker);
    if (index < 0) continue;
    const tail = absolute.slice(index + marker.length).split(path.sep);
    directories.add(path.join(absolute.slice(0, index + marker.length), ...tail.slice(0, tail[0].startsWith('@') ? 2 : 1)));
  }
  const sections = ['Third-party software included in this Dockyard build.\nElectron/Chromium notices are also shipped with the runtime.\n'];
  for (const directory of [...directories].sort()) {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    let licenseDirectory = directory;
    let names = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name)).sort();
    // Koffi publishes its platform binary separately, under the same MIT license.
    if (!names.length && pkg.name.startsWith('@koromix/koffi-') && pkg.license === 'MIT') {
      licenseDirectory = path.resolve(directory, '../../koffi');
      const parent = JSON.parse(await readFile(path.join(licenseDirectory, 'package.json'), 'utf8'));
      if (parent.version !== pkg.version || parent.license !== pkg.license) throw new Error('Koffi license/version mismatch.');
      names = ['LICENSE.txt'];
    }
    if (!names.length) throw new Error('Missing third-party license text: ' + pkg.name);
    sections.push(`\n=== ${pkg.name}@${pkg.version} (${pkg.license ?? 'see license text'}) ===\n`);
    for (const name of names) sections.push(`\n--- ${name} ---\n` + await readFile(path.join(licenseDirectory, name), 'utf8'));
  }
  await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.txt'), sections.join('\n') + '\n', 'utf8');
}
