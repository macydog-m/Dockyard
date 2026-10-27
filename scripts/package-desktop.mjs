import { packager } from '@electron/packager';
import path from 'node:path';
import { prepareRelease } from './release-build.mjs';
const { version, appDir, output, electronVersion } = await prepareRelease('directory-packages');
const paths = await packager({
  dir: appDir, out: output,
  icon: path.join(appDir, 'assets', 'icon.ico'),
  name: 'Dockyard', platform: 'win32', arch: 'x64', electronVersion,
  ...(process.env.DOCKYARD_ELECTRON_ZIP_DIR ? { electronZipDir: path.resolve(process.env.DOCKYARD_ELECTRON_ZIP_DIR) } : {}),
  asar: false, prune: false, overwrite: false, appVersion: version,
  executableName: 'Dockyard', win32metadata: { CompanyName: 'Dockyard', FileDescription: 'Dockyard Resource Manager', ProductName: 'Dockyard' },
});
console.log(JSON.stringify({ version, directories: paths, note: 'Local unsigned directory package; nothing was published.' }, null, 2));
