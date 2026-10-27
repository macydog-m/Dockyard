import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Theme } from './contracts';

// A desktop preference, separate from workspaces and resource metadata.
export function readTheme(directory: string): Theme {
  try {
    const saved = JSON.parse(readFileSync(path.join(directory, 'theme.json'), 'utf8'));
    return saved?.theme === 'dark' ? 'dark' : 'light';
  } catch { return 'light'; }
}

export function writeTheme(directory: string, theme: Theme): void {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'theme.json');
  // Tiny synchronous atomic write: rapid toggles and quitting cannot race a save.
  writeFileSync(file + '.tmp', JSON.stringify({ theme }) + '\n', 'utf8');
  renameSync(file + '.tmp', file);
}
