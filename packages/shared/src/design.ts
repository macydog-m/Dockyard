import { z } from 'zod';
import { configIdSchema, namedMetadataShape, resourceKeySchema, sourceSchema } from './identifiers.js';

export const colorRoles = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border', 'onPrimary', 'success', 'warning', 'error'] as const;
export const colorRoleSchema = z.enum(colorRoles);
export type ColorRole = z.infer<typeof colorRoleSchema>;
export const colorRoleLabels: Record<ColorRole, string> = {
  primary: '主色', secondary: '辅助色', accent: '强调色', background: '页面背景色', surface: '内容背景色',
  text: '主要文字色', muted: '次要文字色', border: '边框色', onPrimary: '主色上的文字色',
  success: '成功色', warning: '警告色', error: '错误色',
};
export const colorRoleUses: Record<ColorRole, string> = {
  primary: '主要按钮、选中状态和品牌元素', secondary: '次要操作和辅助区域', accent: '重点信息、标签和局部点缀',
  background: '整个页面的背景', surface: '卡片、弹窗和内容区域', text: '标题和正文', muted: '描述、说明和提示',
  border: '分隔线和输入框边框', onPrimary: '主按钮等区域内的文字', success: '成功反馈', warning: '提醒和警告', error: '错误反馈',
};
export const fontRoles = ['heading', 'body', 'code'] as const;
export const fontRoleLabels = { heading: '标题字体', body: '正文字体', code: '代码字体' };
// Family names are data, never arbitrary CSS declarations.
export const fontFamilySchema = z.string().trim().min(1).max(128).regex(/^[\p{L}\p{N} _.-]+$/u);
export const fontSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('system') }).strict(),
  z.object({ type: z.literal('file'), path: sourceSchema.shape.path }).strict(),
  z.object({ type: z.literal('web'), url: z.string().max(2048).url().refine(value => {
    const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  }, 'Use an HTTP(S) stylesheet URL.') }).strict(),
]);
export const fontEntrySchema = z.object({
  ...namedMetadataShape, key: resourceKeySchema.refine(value => value.toLowerCase() !== '$scheme', 'Reserved scheme reference.'),
  role: z.enum(fontRoles), family: fontFamilySchema,
  fallbacks: z.array(fontFamilySchema).max(8).default(['sans-serif']),
  weight: z.number().int().min(100).max(900).default(400),
  size: z.number().min(8).max(96).optional(), lineHeight: z.number().min(1).max(3).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  source: fontSourceSchema.default({ type: 'system' }),
}).strict();
export type FontEntry = z.infer<typeof fontEntrySchema>;
export const designDefaultsSchema = z.object({ paletteId: configIdSchema.optional(), fontId: configIdSchema.optional() }).strict();
export type DesignDefaults = z.infer<typeof designDefaultsSchema>;
const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded']);
export function fontStack(font: Pick<FontEntry, 'family' | 'fallbacks'>): string {
  return [font.family, ...font.fallbacks].map(name => genericFamilies.has(name) ? name : '"' + name + '"').join(', ');
}
type PaletteLike = { entries: { key: string; value: string; role?: ColorRole }[] };
type FontLike = { entries: FontEntry[] };
function cssString(value: string) { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, ' '); }
export function designCss(palette?: PaletteLike, fonts?: FontLike): string {
  const declarations: string[] = [];
  for (const entry of palette?.entries ?? []) {
    const key = entry.role === 'onPrimary' ? 'on-primary' : entry.role ?? entry.key;
    if (/^[a-z][a-z0-9-]*$/i.test(key)) declarations.push('  --color-' + key + ': ' + entry.value.toUpperCase() + ';');
  }
  const loads: string[] = [];
  const webUrls = new Set<string>();
  for (const font of fonts?.entries ?? []) {
    if (font.source.type === 'web') webUrls.add(font.source.url);
    if (font.source.type === 'file') {
      const filename = font.role + '-' + font.source.path.split(/[\\/]/).at(-1)!;
      loads.push('/* Copy this role\'s referenced font file to the path below before using this CSS. */\n@font-face {\n  font-family: "' + font.family + '";\n  src: url("./fonts/' + cssString(encodeURIComponent(filename)) + '");\n  font-weight: ' + font.weight + ';\n  font-display: swap;\n}');
    }
    declarations.push('  --font-' + font.role + ': ' + fontStack(font) + ';', '  --font-' + font.role + '-weight: ' + font.weight + ';');
    if (font.size !== undefined) declarations.push('  --font-' + font.role + '-size: ' + font.size + 'px;');
    if (font.color !== undefined) declarations.push('  --font-' + font.role + '-color: ' + font.color.toUpperCase() + ';');
    if (font.lineHeight !== undefined) declarations.push('  --font-' + font.role + '-line-height: ' + font.lineHeight + ';');
  }
  const body = fonts?.entries.find(font => font.role === 'body');
  if (body && !fonts?.entries.some(font => font.role === 'heading')) {
    declarations.push('  --font-heading: ' + fontStack(body) + ';', '  --font-heading-weight: 600;',
      '  --font-heading-size: 30px;', '  --font-heading-line-height: 1.3;');
    if (body.color !== undefined) declarations.push('  --font-heading-color: ' + body.color.toUpperCase() + ';');
  }
  return [...Array.from(webUrls, url => '@import url("' + cssString(url) + '");'), ...loads, ':root {\n' + declarations.join('\n') + '\n}'].join('\n\n');
}

export function fontAiGuide(fonts: { name: string }, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return locale === 'en' ? 'Please use the font ' + JSON.stringify(fonts.name) + ' from Dockyard.'
    : '请使用 Dockyard 中的字体 ' + JSON.stringify(fonts.name) + '。';
}

export function paletteAiGuide(palette: { name: string }, ref?: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return locale === 'en' ? 'Please use the palette ' + JSON.stringify(ref ?? palette.name) + ' from Dockyard.'
    : '请使用 Dockyard 中的颜色组合 ' + JSON.stringify(ref ?? palette.name) + '。';
}
export function colorAiGuide(color: { name: string }, ref?: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return locale === 'en' ? 'Please use the color ' + JSON.stringify(ref ?? color.name) + ' from Dockyard.'
    : '请使用 Dockyard 中的颜色 ' + JSON.stringify(ref ?? color.name) + '。';
}
