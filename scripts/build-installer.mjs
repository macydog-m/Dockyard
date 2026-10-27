import { build, Platform, Arch } from 'electron-builder';
import path from 'node:path';
import { prepareRelease, writeChecksums } from './release-build.mjs';
import { root } from './version.mjs';
const { version, appDir, output, electronVersion } = await prepareRelease();
const icon = path.join(appDir, 'assets', 'icon.ico');
const files = await build({
  targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
  config: {
    appId: 'com.dockyard.desktop',
    productName: 'Dockyard',
    executableName: 'Dockyard',
    directories: { app: appDir, output },
    electronVersion,
    electronDist: path.join(root, 'node_modules/electron/dist'),
    asar: false,
    npmRebuild: false,
    files: ['**/*'],
    extraMetadata: { version, description: 'Local personal resources for AI', author: 'Dockyard contributors', license: 'MIT' },
    artifactName: 'Dockyard-' + version + '-${arch}.${ext}',
    win: { target: ['nsis', 'zip'], icon, signExecutable: false, requestedExecutionLevel: 'asInvoker' },
    nsis: {
      installerIcon: icon, uninstallerIcon: icon,
      oneClick: false, perMachine: false, allowElevation: false,
      allowToChangeInstallationDirectory: false,
      deleteAppDataOnUninstall: false, runAfterFinish: false,
      createDesktopShortcut: true, createStartMenuShortcut: true,
      installerLanguages: ['zh_CN', 'en_US'], language: '2052',
      artifactName: 'Dockyard-Setup-' + version + '-x64.exe',
    },
    publish: null,
  },
  publish: 'never',
});
await writeChecksums(output, files.filter(file => /\.(exe|zip|blockmap)$/i.test(file)));
console.log(JSON.stringify({ version, files }, null, 2));
