import { t, translateMessage as msg } from '../i18n';
import React from 'react';
import { TextAa, Notebook, Palette, Eyedropper, Crop, SlidersHorizontal } from '@phosphor-icons/react';

export const toolbarItems = [
  { id: 'configuration', name: '配置', Icon: SlidersHorizontal, width: 35, group: 'configuration' },
  { id: 'notes', name: '记事本', Icon: Notebook, width: 35, group: 'resources' },
  { id: 'fonts', name: '字体', Icon: TextAa, width: 35, group: 'utilities' },
  { id: 'color', name: '颜色', Icon: Palette, width: 113, group: 'utilities' },
  { id: 'eyedropper', name: '吸色', Icon: Eyedropper, width: 35, group: 'utilities' },
  { id: 'screenshot', name: '截图', Icon: Crop, width: 35, group: 'utilities' },
] as const;
export type ToolbarItemId = typeof toolbarItems[number]['id'];
export const toolbarStorageKey = 'dockyard-hidden-tools';
export function readHiddenTools(): ToolbarItemId[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(toolbarStorageKey) ?? '[]');
    return Array.isArray(saved) ? toolbarItems.filter(item => saved.includes(item.id)).map(item => item.id) : [];
  } catch { return []; }
}
export function ToolbarSettings({ hidden, change }: { hidden: ToolbarItemId[]; change: (hidden: ToolbarItemId[]) => void }) {
  return <section className="toolbar-settings" aria-label={t("工具栏组件")}>
    <div className="section-title"><h3>{t("工具栏组件")}</h3><button className="text-button" disabled={!hidden.length} onClick={() => change([])}>{t("全部显示")}</button></div>
    <div className="toolbar-settings-grid">{toolbarItems.map(({ id, name, Icon }) => <button key={id} role="switch" aria-label={t("显示") + msg(name)} aria-checked={!hidden.includes(id)} onClick={() => change(hidden.includes(id) ? hidden.filter(value => value !== id) : [...hidden, id])}>
      <Icon size={18} /><span>{msg(name)}</span><span className="switch-track" aria-hidden="true"><span /></span>
    </button>)}</div>
    <p className="form-note">{t("隐藏后工具条自动收短，资源与笔记仍保留。")}</p>
  </section>;
}
