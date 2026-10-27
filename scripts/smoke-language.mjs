import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Existing smoke selectors use Chinese. Pin their isolated profile independently of the OS.
export async function setSmokeLanguage(dataDir, language = 'zh-CN') {
  const directory = path.join(dataDir, 'desktop');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'language.json'), JSON.stringify({ language }) + '\n', 'utf8');
}
