import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';
import { checkVersion, root } from './version.mjs';
import { writeChecksums } from './release-build.mjs';

const execute = promisify(execFile);
export async function buildPortable(sourceDirectory) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Portable packages require Windows x64.');
  const version = await checkVersion();
  const source = path.resolve(sourceDirectory || path.join(root, '.local/releases', version, 'win-unpacked'));
  const metadata = JSON.parse(await readFile(path.join(source, 'resources/app/package.json'), 'utf8'));
  if (metadata.name !== 'dockyard' || metadata.version !== version) throw new Error('Portable source must match the current Dockyard version.');
  for (const file of ['Dockyard.exe', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources/app/mcp.mjs', 'resources/app/LICENSE', 'resources/app/THIRD_PARTY_LICENSES.txt']) await access(path.join(source, file));
  const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  await access(compiler);
  const output = path.join(root, '.local/portable-releases', version);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output); // Never overwrite a reviewed package or user data.
  const folderName = 'Dockyard-Portable-' + version + '-x64';
  const directory = path.join(output, folderName);
  await mkdir(directory);
  await cp(source, path.join(directory, 'App'), { recursive: true, errorOnExist: true, force: false });
  await mkdir(path.join(directory, 'Data'));
  const staging = path.join(root, '.local/builds');
  await mkdir(staging, { recursive: true });
  const temporary = await mkdtemp(path.join(staging, 'portable-'));
  const assembly = path.join(temporary, 'AssemblyInfo.cs');
  const numericVersion = version.split('-')[0] + '.0';
  await writeFile(assembly, [
    'using System.Reflection;',
    '[assembly: AssemblyTitle("Dockyard Portable")]',
    '[assembly: AssemblyProduct("Dockyard Portable")]',
    '[assembly: AssemblyCompany("Dockyard contributors")]',
    '[assembly: AssemblyVersion("' + numericVersion + '")]',
    '[assembly: AssemblyFileVersion("' + numericVersion + '")]',
    '[assembly: AssemblyInformationalVersion("' + version + '")]',
  ].join('\n') + '\n', 'utf8');
  await execute(compiler, [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', '/codepage:65001',
    '/reference:System.Windows.Forms.dll',
    '/win32icon:' + path.join(source, 'resources/app/assets/icon.ico'),
    '/out:' + path.join(directory, 'Dockyard.exe'),
    path.join(root, 'scripts/portable-launcher.cs'), assembly,
  ], { windowsHide: true });
  const readme = [
    'Dockyard Portable ' + version + ' — Windows x64',
    '',
    '完整解压后，双击本目录的 Dockyard.exe。不要单独运行 App 内的程序。',
    '配置、索引、笔记、截图及界面偏好保存在本目录的 Data 文件夹。',
    '请解压到可写目录；不要放在 Program Files 或直接在压缩包内运行。',
    '升级：退出 Dockyard，将新包解压到新目录，再复制原来的整个 Data 文件夹。',
    '移动：退出程序后移动整个文件夹。外部素材使用绝对路径，移动素材后需重新选择或刷新。',
    '移动后请重新生成 Agent 连接配置；它们包含程序和数据目录的绝对路径。',
    '删除前备份 Data。删除整个绿色包会同时删除其中的数据。',
    '',
    'Extract the entire ZIP and run Dockyard.exe in this folder, not App/Dockyard.exe.',
    'All Dockyard data and Electron user state are stored in the adjacent Data folder.',
    'Use a writable folder. No installation, administrator access or separate Node.js is needed.',
    'The launcher uses the Windows-provided .NET Framework 4.x. The build is unsigned.',
    'For upgrades, quit Dockyard, extract the new package separately and copy your entire Data folder.',
    'After moving the package, regenerate agent connections. External asset paths remain absolute.',
    'Back up Data before deleting this folder.',
    '',
    'Application and third-party licenses: App/resources/app/, App/LICENSE.electron.txt and App/LICENSES.chromium.html.',
  ].join('\r\n') + '\r\n';
  await writeFile(path.join(directory, 'README.txt'), readme, 'utf8');
  const archive = path.join(output, folderName + '.zip');
  const sevenZip = await getPath7za();
  await execute(sevenZip, ['a', '-tzip', '-mx=5', archive, folderName], { cwd: output, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  await execute(sevenZip, ['t', archive], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  await writeChecksums(output, [archive]);
  const checksum = path.join(output, 'SHA256SUMS.txt');
  const portableChecksum = path.join(output, 'SHA256SUMS-Portable.txt');
  await cp(checksum, portableChecksum, { errorOnExist: true, force: false });
  return { version, source, directory, archive, checksum: portableChecksum };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--source')) throw new Error('Usage: node scripts/build-portable.mjs [--source WIN_UNPACKED_DIRECTORY]');
  console.log(JSON.stringify(await buildPortable(args[1]), null, 2));
}
