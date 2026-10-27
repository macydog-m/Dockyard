import { english } from './en';

export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = Locale | 'system';
export type MessageKey = keyof typeof english;
let locale: Locale = 'zh-CN';

export function resolveLocale(language: string): Locale {
  return /^zh(?:[-_]|$)/i.test(language) ? 'zh-CN' : 'en';
}
export function setLocale(value: Locale): void { locale = value; }
export function getLocale(): Locale { return locale; }

export function t(key: MessageKey, values: readonly (string | number)[] = []): string {
  const message = locale === 'en' ? english[key] : key;
  // Replace only the template, never placeholder text (resource names may contain braces).
  return message.replace(/\{(\d+)\}/g, (token, index: string) => String(values[Number(index)] ?? token));
}

// For system messages crossing IPC, or role labels stored by Shared. Never use on user content.
export function translateMessage(message: string): string {
  return Object.hasOwn(english, message) ? t(message as MessageKey) : message;
}
