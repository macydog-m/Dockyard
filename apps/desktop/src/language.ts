import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveLocale, type LanguagePreference, type Locale } from './i18n';

export type LanguageSettings = { preference: LanguagePreference; locale: Locale };
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'zh-CN' || value === 'en';
}
export function readLanguage(directory: string, systemLanguage: string): LanguageSettings {
  let preference: LanguagePreference = 'system';
  try {
    const saved = JSON.parse(readFileSync(path.join(directory, 'language.json'), 'utf8'));
    if (isLanguagePreference(saved?.language)) preference = saved.language;
  } catch { /* Missing or malformed preferences fall back to the system language. */ }
  return { preference, locale: preference === 'system' ? resolveLocale(systemLanguage) : preference };
}
export function writeLanguage(directory: string, language: LanguagePreference): void {
  if (!isLanguagePreference(language)) throw new Error('Invalid language preference.');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'language.json');
  writeFileSync(file + '.tmp', JSON.stringify({ language }) + '\n', 'utf8');
  renameSync(file + '.tmp', file);
}
