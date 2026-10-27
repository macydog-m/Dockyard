import { t, translateMessage as msg } from '../i18n';
import { colorRoleLabels, colorRoleUses, fontRoleLabels, type Component, type ColorRole } from '@dockyard/shared';

type Palette = Extract<Component, { type: 'palette' }>;
type Fonts = Extract<Component, { type: 'font' }>;
type Colors = Record<ColorRole, string>;
const base: Colors = {
  primary: '#E98C3A', secondary: '#556C60', accent: '#B75B32', background: '#F7F8F6', surface: '#FFFFFF',
  text: '#222A24', muted: '#626D64', border: '#D9DED8', onPrimary: '#241F18',
  success: '#26734D', warning: '#A86408', error: '#BD3434',
};
function palette(id: string, name: string, colors: Partial<Colors>, roles: ColorRole[] = ['primary', 'secondary', 'accent']): Palette {
  const values = { ...base, ...colors };
  return {
    schemaVersion: 1, revision: 1, enabled: true, type: 'palette', mode: 'design',
    id: 'palette-dockyard-' + id, name,
    entries: roles.map(role => ({
      key: role, name: msg(colorRoleLabels[role]), role, value: values[role], description: msg(colorRoleUses[role]),
      aliases: [], tags: [], metadata: {},
    })),
  };
}
function font(id: string, family: string, fallbacks: string[]): Fonts {
  return {
    schemaVersion: 1, revision: 1, enabled: true, type: 'font', mode: 'single',
    id: 'font-dockyard-' + id, name: family,
    entries: [{
      key: 'body', name: msg(fontRoleLabels.body), role: 'body', family, fallbacks, weight: 400, size: 16, lineHeight: 1.7,
      source: { type: 'system' }, aliases: [], tags: [], metadata: {},
    }],
  };
}

export const getPalettePresets = (): Palette[] => [
  palette('warm', t("暖橙"), {}, ['primary', 'secondary', 'accent', 'background', 'text']),
  palette('forest', t("森林绿"), {
    primary: '#226245', secondary: '#5C7666', accent: '#BA6437', background: '#F5F8F4',
    text: '#20392A', muted: '#5B6D60', border: '#D7E2D8', onPrimary: '#FFFFFF',
  }),
  palette('ocean', t("海岸蓝"), {
    primary: '#235EA8', secondary: '#49767D', accent: '#BE663A', background: '#F4F7FB',
    text: '#1F3046', muted: '#5D6D82', border: '#D5DFEC', onPrimary: '#FFFFFF',
  }),
  palette('ink', t("黑白墨色"), {
    primary: '#25262A', secondary: '#606269', accent: '#AD4F35', background: '#F6F6F5',
    text: '#222326', muted: '#66676D', border: '#DADBDD', onPrimary: '#FFFFFF',
  }, ['primary', 'secondary']),
  palette('plum', t("暮色紫"), {
    primary: '#6F478D', secondary: '#6E687D', accent: '#B75271', background: '#F8F5FA',
    text: '#362941', muted: '#75667F', border: '#E2D9E8', onPrimary: '#FFFFFF',
  }, ['primary', 'secondary', 'accent', 'background']),
  palette('sand', t("沙色"), {
    primary: '#805735', secondary: '#64715A', accent: '#A24836', background: '#FAF6EE', surface: '#FFFCF6',
    text: '#3E352B', muted: '#7A6C5D', border: '#E6DACB', onPrimary: '#FFFFFF',
  }, ['primary', 'secondary', 'accent', 'background']),
];
export const getFontPresets = (): Fonts[] => [
  font('yahei', 'Microsoft YaHei', ['Segoe UI', 'sans-serif']),
  font('segoe', 'Segoe UI', ['Microsoft YaHei', 'sans-serif']),
  font('arial', 'Arial', ['Microsoft YaHei', 'sans-serif']),
  font('georgia', 'Georgia', ['Microsoft YaHei', 'serif']),
  font('system', 'system-ui', ['Microsoft YaHei', 'sans-serif']),
];
