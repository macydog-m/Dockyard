import { t, translateMessage as msg } from '../i18n';
import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Copy, PencilSimple, Trash, Check } from '@phosphor-icons/react';
import {
  componentSchema, colorRoles, colorRoleLabels, colorRoleUses, fontRoleLabels, fontStack, designCss,
  type Component, type PaletteEntry, type FontEntry, type ColorRole, type DesignDefaults, type Workspace,
} from '@dockyard/shared';

import { getPalettePresets, getFontPresets } from './DesignPresets';
import { FontControls } from './FontControls';

type Palette = Extract<Component, { type: 'palette' }>;
type Fonts = Extract<Component, { type: 'font' }>;
const initialColors: Record<ColorRole, string> = {
  primary: '#E98C3A', secondary: '#556C60', accent: '#B75B32', background: '#F7F8F6', surface: '#FFFFFF',
  text: '#222A24', muted: '#626D64', border: '#D9DED8', onPrimary: '#241F18', success: '#26734D', warning: '#A86408', error: '#BD3434',
};
function colorEntry(role: ColorRole): PaletteEntry {
  return { key: role, name: msg(colorRoleLabels[role]), role, value: initialColors[role], description: msg(colorRoleUses[role]), aliases: [], tags: [], metadata: {} };
}
function fontEntry(role: FontEntry['role']): FontEntry {
  return { key: role, name: msg(fontRoleLabels[role]), role, family: role === 'code' ? 'Consolas' : 'Microsoft YaHei',
    fallbacks: role === 'code' ? ['monospace'] : ['Segoe UI', 'sans-serif'], weight: role === 'heading' ? 600 : 400,
    size: role === 'heading' ? 30 : role === 'code' ? 14 : 16, lineHeight: role === 'heading' ? 1.3 : 1.7,
    source: { type: 'system' }, aliases: [], tags: [], metadata: {} };
}
function newComponent(type: 'palette' | 'font'): Palette | Fonts {
  const base = { schemaVersion: 1 as const, revision: 1, id: type + '-' + crypto.randomUUID().slice(0, 8), name: '', description: '', enabled: true };
  return type === 'palette' ? { ...base, type, mode: 'design', entries: [colorEntry('primary'), colorEntry('secondary')] }
    : { ...base, type, mode: 'single', entries: [fontEntry('body')] };
}

export function DesignPreview({ palette, fonts }: { palette?: Palette; fonts?: Fonts }) {
  const [pressed, setPressed] = useState(false);
  const colors = { ...initialColors,
    ...(palette?.entries[0] ? { primary: palette.entries[0].value } : {}),
    ...(palette?.entries[1] ? { secondary: palette.entries[1].value } : {}),
    ...(palette?.entries[2] ? { accent: palette.entries[2].value } : {}),
    ...Object.fromEntries((palette?.entries ?? []).filter(entry => entry.role).map(entry => [entry.role, entry.value])) };
  const font = (role: FontEntry['role']) => {
    const exact = fonts?.entries.find(entry => entry.role === role);
    const body = fonts?.entries.find(entry => entry.role === 'body');
    return exact ?? (role === 'heading' && body ? { ...body, role, weight: 600, size: 30, lineHeight: 1.3 } : fontEntry(role));
  };
  const style = (role: FontEntry['role']): React.CSSProperties => {
    const entry = font(role);
    return { fontFamily: fontStack(entry), fontWeight: entry.weight, fontSize: entry.size ?? 16, lineHeight: entry.lineHeight ?? 1.7 };
  };
  return <div className="design-preview" aria-label={t("网页设计预览")} style={{ background: colors.background, color: colors.text, ...style('body') }}>
    <span className="design-preview-label" style={{ color: colors.muted }}>{t("网页样例 · Live preview")}</span>
    <h2 style={{ ...style('heading'), color: font('heading').color ?? colors.text }}>{t("让想法，成为网页。")}</h2>
    <p style={{ color: font('body').color ?? colors.muted }}>{t("这是一段正文与说明文字。看看标题、颜色和字体搭配起来的效果。")}</p>
    <div className="design-preview-buttons">
      <button type="button" onClick={() => setPressed(!pressed)} style={{ background: colors.primary, color: colors.onPrimary, borderColor: colors.primary, fontFamily: fontStack(font('body')) }}>{pressed ? <><Check size={16} />{t("已完成")}</> : t("主要操作")}</button>
      <button type="button" onClick={() => setPressed(false)} style={{ background: colors.surface, color: colors.secondary, borderColor: colors.border, fontFamily: fontStack(font('body')) }}>{t("辅助操作")}</button>
    </div>
    <div className="design-preview-card" style={{ background: colors.surface, borderColor: colors.border }}>
      <span style={{ color: colors.accent, fontSize: 12 }}>{t("内容区域")}</span>
      <strong style={{ display: 'block', color: font('body').color ?? colors.text }}>{t("好的设计，从统一的细节开始")}</strong>
      <p style={{ color: font('body').color ?? colors.muted }}>Typography, color and a clear hierarchy.</p>
      {fonts?.entries.some(entry => entry.role === 'code') && <code style={{ ...style('code'), color: font('code').color ?? colors.secondary }}>const design = 'your style';</code>}
    </div>
  </div>;
}

export function DesignEditor({ initial, type, palette, fonts, components, busy, errorMessage, save, close, pick, copy, saveLabel = t("保存方案"), currentColor = initialColors.primary }: {
  initial?: Palette | Fonts; type: 'palette' | 'font'; palette?: Palette; fonts?: Fonts; components: Component[];
  busy: boolean; errorMessage: string; save: (component: Component) => Promise<boolean>; close: () => void;
  pick: () => Promise<string | null>; copy: (text: string) => void; saveLabel?: string; currentColor?: string;
}) {
  const [draft, setDraft] = useState<Palette | Fonts>(() => initial ?? newComponent(type));
  const [tab, setTab] = useState<'config' | 'preview'>('config');
  const [error, setError] = useState('');
  const [fallbackText, setFallbackText] = useState<Record<string, string>>(() => Object.fromEntries(
    (initial?.type === 'font' ? initial.entries : [fontEntry('heading'), fontEntry('body')]).map(entry => [entry.role, entry.fallbacks.join(', ')])));
  useEffect(() => { setError(''); }, [draft, fallbackText]);
  function updateColor(index: number, changes: Partial<PaletteEntry>) {
    if (draft.type === 'palette') setDraft({ ...draft, entries: draft.entries.map((entry, i) => i === index ? { ...entry, ...changes } : entry) });
  }
  function updateFont(index: number, changes: Partial<FontEntry>) {
    if (draft.type === 'font') setDraft({ ...draft, entries: draft.entries.map((entry, i) => i === index ? { ...entry, ...changes } : entry) });
  }
  function candidate() {
    const value = { ...draft, name: draft.name.trim() || (draft.type === 'font' && draft.mode === 'single' ? draft.entries[0].family.trim() : ''),
      ...(draft.type === 'font' ? { entries: draft.entries.map(entry => ({ ...entry, family: entry.family.trim(),
        fallbacks: (fallbackText[entry.role] ?? '').split(/[,，]/).map(value => value.trim()).filter(Boolean) })) } : {}) };
    const parsed = componentSchema.safeParse(value);
    if (!parsed.success) { setError(draft.type === 'palette' ? t("请检查组合名称、颜色名称和 HEX 色值，组合需包含 1–9 个颜色。") : t("请检查字体名称、备用字体、字重与加载来源。")); setTab('config'); return; }
    setError(''); return parsed.data;
  }
  function setFontPairing(pairing: boolean) {
    if (draft.type !== 'font') return;
    const body = draft.entries.find(entry => entry.role === 'body')!;
    const heading = draft.entries.find(entry => entry.role === 'heading') ?? { ...fontEntry('heading'), family: body.family, fallbacks: body.fallbacks, source: body.source };
    setDraft({ ...draft, mode: pairing ? 'pairing' : 'single', entries: pairing ? [heading, body, ...draft.entries.filter(entry => entry.role === 'code')] : [body] });
    setFallbackText({ ...fallbackText, heading: fallbackText.heading ?? fallbackText.body ?? 'sans-serif' });
  }
  const previewFonts = draft.type === 'font' ? { ...draft, entries: draft.entries.map(entry => ({
    ...entry, fallbacks: (fallbackText[entry.role] ?? '').split(/[,，]/).map(value => value.trim()).filter(Boolean),
  })) } : fonts;
  return <form className="design-editor" onSubmit={async event => { event.preventDefault(); const value = candidate(); if (value && await save(value)) close(); }}>
    <div className="design-editor-scroll"><fieldset disabled={busy}>
      <label>{draft.type === 'font' && draft.mode === 'single' ? <>{t("显示名称")}<span className="optional">{t("可选")}</span></> : t("名称")}<input autoFocus required={!(draft.type === 'font' && draft.mode === 'single')} maxLength={256} value={draft.name} placeholder={draft.type === 'font' && draft.mode === 'single' ? t("留空时使用字体名称") : type === 'palette' ? t("例如：品牌橙色") : t("例如：简洁阅读")} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      {components.some(value => value.id !== draft.id && value.name.trim().toLowerCase() === draft.name.trim().toLowerCase()) && <p className="issue-note">{t("已有同名资源。建议补充区别，避免按名称引用时需要消歧。")}</p>}
      <label>{t("简介")} <span className="optional">{t("可选")}</span><input maxLength={4096} value={draft.description ?? ''} placeholder={t("适合什么网页、如何使用…")} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <div className="design-tabs" role="tablist" aria-label={t("方案编辑视图")}>{(['config', 'preview'] as const).map(value => <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{value === 'config' ? t("配置") : t("预览")}</button>)}</div>
      {tab === 'config' && <div className="design-fields" role="tabpanel" aria-label={t("方案配置")}>
        {draft.type === 'palette' && <>
          <div className="design-colors">{draft.entries.map((entry, index) => <div className="design-color-row" key={entry.key}>
            <input type="color" aria-label={t("选择") + entry.name} value={/^#[0-9a-f]{6}$/i.test(entry.value) ? entry.value : '#000000'} onChange={event => updateColor(index, { value: event.target.value.toUpperCase() })} />
            <div className="design-color-meta">
              <input aria-label={t("颜色名称 ") + (index + 1)} required maxLength={256} value={entry.name} onChange={event => updateColor(index, { name: event.target.value })} />
              <select aria-label={t("颜色用途 ") + (index + 1)} value={entry.role ?? ''} onChange={event => updateColor(index, { role: (event.target.value || undefined) as ColorRole | undefined })}>
                <option value="">{t("用途（可选）")}</option>{colorRoles.filter(role => role === entry.role || !draft.entries.some(item => item.role === role)).map(role => <option key={role} value={role}>{msg(colorRoleLabels[role])}</option>)}
              </select>
            </div>
            <input id={'design-color-' + index} aria-label={entry.name + ' HEX'} maxLength={7} pattern="#[0-9a-fA-F]{6}" required value={entry.value} onChange={event => updateColor(index, { value: event.target.value.toUpperCase() })} />
            <button type="button" className="icon-button" aria-label={t("移除") + entry.name} disabled={draft.entries.length <= 1} onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, i) => i !== index) })}><Trash size={15} /></button>
          </div>)}</div>
          <div className="design-color-add"><span>{draft.entries.length} / 9</span><button type="button" disabled={draft.entries.length >= 9} onClick={() => {
            let number = draft.entries.length + 1;
            while (draft.entries.some(entry => entry.name === t("颜色 ") + number)) number++;
            setDraft({ ...draft, entries: [...draft.entries, { key: 'color-' + crypto.randomUUID().slice(0, 8), name: t("颜色 ") + number,
              value: currentColor, aliases: [], tags: [], metadata: {} }] });
          }}><Plus size={15} />{t("添加颜色")}</button></div>
        </>}
        {draft.type === 'font' && <>
          <label className="design-pairing-toggle"><input type="checkbox" checked={draft.mode !== 'single'} onChange={event => setFontPairing(event.target.checked)} />{t("分别设置标题、正文")}</label>
          <datalist id="design-font-families">{['Microsoft YaHei', 'Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Consolas', 'system-ui', 'sans-serif', 'serif', 'monospace'].map(value => <option key={value} value={value} />)}</datalist>
          {draft.entries.map((entry, index) => <section className="design-font-fields" key={entry.key}>
            <div className="section-title"><h3>{draft.mode === 'single' ? t("字体属性") : msg(fontRoleLabels[entry.role])}</h3>{entry.role === 'code' && <button type="button" className="text-button" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, i) => i !== index) })}>{t("移除")}</button>}</div>
            <FontControls entry={entry} change={patch => updateFont(index, patch)} disabled={busy} />
            <div className="design-font-grid">
              <label>{t("字体名称")}<input list="design-font-families" aria-label={msg(fontRoleLabels[entry.role]) + t("名称")} required maxLength={128} value={entry.family} onChange={event => updateFont(index, { family: event.target.value })} /></label>
              <label>{t("字重")}<select aria-label={msg(fontRoleLabels[entry.role]) + t("字重")} value={entry.weight} onChange={event => updateFont(index, { weight: Number(event.target.value) })}>{[100, 200, 300, 400, 500, 600, 700, 800, 900, entry.weight].filter((weight, i, all) => all.indexOf(weight) === i).sort((a, b) => a - b).map(weight => <option key={weight} value={weight}>{weight}</option>)}</select></label>
              <label>{t("字号（px）")}<input type="number" aria-label={msg(fontRoleLabels[entry.role]) + t("字号")} min={8} max={96} step="any" required value={entry.size ?? (entry.role === 'heading' ? 30 : 16)} onChange={event => updateFont(index, { size: event.target.valueAsNumber })} /></label>
              <label>{t("行高")}<input type="number" aria-label={msg(fontRoleLabels[entry.role]) + t("行高")} min={1} max={3} step="0.1" required value={entry.lineHeight ?? 1.7} onChange={event => updateFont(index, { lineHeight: event.target.valueAsNumber })} /></label>
            </div>
            <label>{t("备用字体")}<input aria-label={msg(fontRoleLabels[entry.role]) + t("备用字体")} maxLength={1024} placeholder={t("用逗号分隔，例如：Segoe UI, sans-serif")} value={fallbackText[entry.role] ?? ''} onChange={event => setFallbackText({ ...fallbackText, [entry.role]: event.target.value })} /></label>
            <label>{t("加载来源")}<select aria-label={msg(fontRoleLabels[entry.role]) + t("来源")} value={entry.source.type} onChange={event => updateFont(index, { source: event.target.value === 'system' ? { type: 'system' } : event.target.value === 'file' ? { type: 'file', path: '' } : { type: 'web', url: '' } })}><option value="system">{t("系统字体")}</option><option value="file">{t("本地字体文件")}</option><option value="web">{t("网页字体样式链接")}</option></select></label>
            {entry.source.type === 'file' && <label>{t("字体文件")}<div className="input-action"><input aria-label={msg(fontRoleLabels[entry.role]) + t("文件路径")} required value={entry.source.path} onChange={event => updateFont(index, { source: { type: 'file', path: event.target.value } })} /><button type="button" onClick={async () => { try { const source = await pick(); if (source) updateFont(index, { source: { type: 'file', path: source } }); } catch { setError(t("无法选择字体文件，请重试。")); } }}>{t("浏览…")}</button></div><small>{t("生成网页时，将此字体文件放入网页的 fonts 目录。")}</small></label>}
            {entry.source.type === 'web' && <label>{t("样式链接")}<input type="url" aria-label={msg(fontRoleLabels[entry.role]) + t("样式链接")} required maxLength={2048} placeholder="https://…/fonts.css" value={entry.source.url} onChange={event => updateFont(index, { source: { type: 'web', url: event.target.value } })} /><small>{t("填写字体提供方给出的 CSS 样式链接。")}</small></label>}
          </section>)}
          {draft.mode !== 'single' && !draft.entries.some(entry => entry.role === 'code') && <button type="button" className="inline-add" onClick={() => { setDraft({ ...draft, entries: [...draft.entries, fontEntry('code')] }); setFallbackText({ ...fallbackText, code: 'monospace' }); }}><Plus size={16} />{t("添加代码字体")}</button>}
        </>}
      </div>}
      {tab === 'preview' && <div className="design-editor-preview" role="tabpanel" aria-label={t("方案预览")}><DesignPreview palette={draft.type === 'palette' ? draft : palette} fonts={previewFonts} /><p className="form-note">{t("预览搭配当前工作区的另一套方案。字体使用此电脑可用的字体；加载来源会随方案保存。")}</p></div>}
    </fieldset></div>
    {(error || errorMessage) && <p className="error" role="alert">{error || errorMessage}</p>}
    <div className="dialog-actions"><button type="button" disabled={busy} onClick={close}>{t("取消")}</button><button type="button" disabled={busy} onClick={() => { const value = candidate(); if (value?.type === 'palette') copy(designCss(value)); if (value?.type === 'font') copy(designCss(undefined, value)); }}><Copy size={15} />{t("复制 CSS")}</button><button className="primary" disabled={busy}>{busy ? t("正在保存…") : saveLabel}</button></div>
  </form>;
}

export function DesignLibrary({ type, components, workspace, busy, create, edit, remove, choose, enable, defaults, copy, copyGuide, close, picker, saveFonts }: {
  type: 'palette' | 'font'; components: Component[]; workspace?: Workspace; busy: boolean; create: (type: 'palette' | 'font') => void;
  edit: (component: Palette | Fonts) => void; remove: (component: Component) => void;
  enable: (value: Palette | Fonts, enabled: boolean) => void; choose: (value: Palette | Fonts) => void; defaults: (value: DesignDefaults) => void; copy: (text: string) => void; copyGuide: (component: Palette | Fonts) => void; close: () => void;
  picker?: (palette?: Palette) => React.ReactNode;
  saveFonts: (fonts: Fonts) => Promise<boolean>;
}) {
  const [inspectedId, setInspectedId] = useState<string>();
  const [actionId, setActionId] = useState<string>();
  const [query, setQuery] = useState('');
  const [fontDrafts, setFontDrafts] = useState<Record<string, Fonts>>({});
  const [fontRole, setFontRole] = useState<FontEntry['role']>('body');
  const list = useRef<HTMLDivElement>(null);
  const label = type === 'palette' ? t("色彩组合") : t("字体");
  const panelLabel = type === 'palette' ? t("颜色") : label;
  const palettes = components.filter((value): value is Palette => value.type === 'palette' && value.mode === 'design');
  const fonts = components.filter((value): value is Fonts => value.type === 'font');
  const selectedPalette = palettes.find(value => value.id === workspace?.design?.paletteId);
  const selectedFonts = fonts.find(value => value.id === workspace?.design?.fontId);
  const appliedId = type === 'palette' ? workspace?.design?.paletteId : workspace?.design?.fontId;
  const registeredIds = new Set(components.map(item => item.id));
  const presets = type === 'palette' ? getPalettePresets() : getFontPresets();
  const selectedIds = new Set(workspace?.componentIds);
  const disabledIds = new Set(workspace?.disabledComponentIds);
  const savedItems = (type === 'palette' ? palettes : fonts).filter(item => selectedIds.has(item.id));
  const presetIds = new Set(presets.map(item => item.id));
  // Using a preset replaces it in its original slot instead of moving it into a saved-items group.
  const allItems = [
    ...presets.flatMap(preset => {
      const saved = components.find(item => item.id === preset.id);
      return !saved ? [preset] : savedItems.filter(item => item.id === preset.id);
    }),
    ...savedItems.filter(item => !presetIds.has(item.id)),
  ];
  const items = allItems.filter(item => (item.name + ' ' + (item.type === 'font' ? item.entries.map(entry => entry.family).join(' ') : '')).toLowerCase().includes(query.toLowerCase()));
  const inspected = allItems.find(item => item.id === inspectedId) ?? allItems.find(item => item.id === appliedId) ?? allItems[0];
  const applied = allItems.find(item => item.id === appliedId);
  const previewPalette = inspected?.type === 'palette' ? inspected : selectedPalette;
  const previewFonts = inspected?.type === 'font' ? fontDrafts[inspected.id] ?? inspected : selectedFonts;
  const fontDirty = inspected?.type === 'font' && !!fontDrafts[inspected.id];
  const previewEntry = previewFonts?.entries.find(entry => entry.role === fontRole) ?? previewFonts?.entries[0];
  function updatePreviewFont(patch: Partial<FontEntry>) {
    if (!previewFonts || !previewEntry) return;
    const next = { ...previewFonts, entries: previewFonts.entries.map(entry => entry.key === previewEntry.key ? { ...entry, ...patch } : entry) };
    setFontDrafts(current => ({ ...current, [next.id]: next }));
  }
  function clearFontDraft(id: string) { setFontDrafts(current => { const next = { ...current }; delete next[id]; return next; }); }
  useEffect(() => { setInspectedId(appliedId); setActionId(undefined); setQuery(''); setFontDrafts({}); setFontRole('body'); if (list.current) list.current.scrollTop = 0; }, [workspace?.id, type]);
  useEffect(() => { setInspectedId(appliedId); }, [appliedId]);
  async function use(item: Palette | Fonts) {
    if (busy || !item.enabled || disabledIds.has(item.id) || !workspace) return;
    const draft = item.type === 'font' ? fontDrafts[item.id] : undefined;
    if (draft) {
      if (!await saveFonts(draft)) return;
      clearFontDraft(item.id);
    }
    setInspectedId(item.id);
    if (appliedId !== item.id) choose(draft ?? item);
  }
  return <section className={'popover design-popover ' + (picker ? 'color-workspace' : 'font-library')} aria-label={panelLabel + t("面板")}>
    <div className="panel-heading">
      <div className="design-title"><h2>{panelLabel}</h2></div>
      <span className="design-current" title={applied?.name}>{applied && !disabledIds.has(applied.id) ? <><Check size={14} />{t("使用中：")}{applied.name}</> : t("未选择")}</span>
      {!picker && <button disabled={busy || (!previewPalette && !previewFonts)} className="small-button" onClick={() => copy(designCss(previewPalette, previewFonts))}><Copy size={15} />{t("复制 CSS")}</button>}
      <button className="icon-button" aria-label={t("关闭") + panelLabel + t("面板")} onClick={close}><X size={18} /></button>
    </div>
    <div className="design-scroll">
    <div className={picker ? 'color-workspace-grid' : ''}>
      <div className="design-library-column">
        <div className="design-choice-toolbar">
          {!picker && <small>{workspace?.name ?? t("当前工作区")}</small>}
          <input type="search" aria-label={t("筛选") + label} placeholder={t("搜索名称…")} value={query} onChange={event => setQuery(event.target.value)} />
          {picker && <button className="add-scheme" disabled={busy || !workspace} onClick={() => create(type)}><Plus size={16} />{t(type === 'palette' ? '添加色彩组合' : '添加字体')}</button>}
        </div>
        {picker && <div className="scheme-list-heading"><strong>{t("色彩组合 ·")} {allItems.length}</strong><span>{t("勾选启用 · 点击预览")}</span></div>}
        <div className="design-choice-list" ref={list} aria-label={label + t("列表")}>
          {!picker && <button className="design-inline-create" disabled={busy || !workspace} onClick={() => create(type)}><Plus size={20} /><strong>{t(type === 'palette' ? '添加色彩组合' : '添加字体')}</strong></button>}
          {items.map(item => <article className={'design-scheme-row' + (inspected?.id === item.id ? ' inspecting' : '') + (appliedId === item.id ? ' applied' : '')} key={item.id} data-scheme-id={item.id}>
            <label className="scheme-enabled"><input className="design-resource-enabled" type="checkbox" aria-label={t("启用 ") + item.name} title={t("启用资源")} disabled={busy || !workspace} checked={item.enabled && !disabledIds.has(item.id)} onChange={event => enable(item, event.target.checked)} /><span>{item.enabled && !disabledIds.has(item.id) ? t("已启用") : t("未启用")}</span></label>
            <button className="design-scheme-open" aria-label={t('预览{0}：{1}', [label, item.name])} aria-pressed={appliedId === item.id} disabled={busy} onClick={() => { setInspectedId(item.id); setActionId(item.id); }} onDoubleClick={() => use(item)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); use(item); } }}>
              <strong><span>{item.name}</span>{appliedId === item.id && <span className="design-selected" aria-label={t("当前使用")}><Check size={14} /></span>}{!item.enabled && <small className="muted">{t("已停用")}</small>}{!registeredIds.has(item.id) && <small className="design-preset-label">{t("内置")}</small>}</strong>
              {item.type === 'palette'
                ? <span className="design-mini-swatches">{item.entries.slice(0, 9).map(entry => <span key={entry.key} style={{ background: entry.value }} title={entry.name} />)}</span>
                : <><span className="design-font-specimen" style={{ fontFamily: fontStack(item.entries.find(entry => entry.role === 'body') ?? item.entries[0]) }}>{t("Aa 字体预览")}</span>{item.entries.length > 1 && <small>{item.entries.map(entry => entry.family).filter((family, i, families) => families.indexOf(family) === i).join(' / ')}</small>}</>}
            </button>
            <div className="design-scheme-actions">
              <small>{inspected?.id === item.id && appliedId !== item.id ? t("预览中") : ''}</small>
              <button hidden={inspectedId !== item.id || actionId !== item.id} className="icon-button" aria-label={t("编辑方案：") + item.name} title={t("编辑")} disabled={busy} onClick={() => { const draft = item.type === 'font' ? fontDrafts[item.id] : undefined; clearFontDraft(item.id); edit(draft ?? item); }}><PencilSimple size={14} /></button>
              <button className="icon-button" aria-label={(item.type === 'font' ? t("复制字体指引：") : t("复制颜色组合指引：")) + item.name} title={t("复制给 AI")} disabled={busy || !workspace || !item.enabled || disabledIds.has(item.id)} onClick={async () => {
                const draft = item.type === 'font' ? fontDrafts[item.id] : undefined;
                if (draft) { if (!await saveFonts(draft)) return; clearFontDraft(item.id); }
                copyGuide(draft ?? item);
              }}><Copy size={14} /></button>
              <button className="icon-button" aria-label={t("删除方案：") + item.name} title={t("删除")} disabled={busy} hidden={inspectedId !== item.id || actionId !== item.id || !registeredIds.has(item.id)} onClick={() => remove(item)}><Trash size={14} /></button>
            </div>
          </article>)}
        </div>
        {!!query && !items.length && <p className="form-note">{t("没有找到匹配的")}{label}{t("，可以直接添加。")}</p>}
        <div className={'design-choice-foot' + (picker ? ' color-choice-foot' : '')}>
          <span>{t(type === 'palette' ? '当前有 {0} 个色卡' : '当前有 {0} 个字体', [allItems.length])}</span>
          {appliedId && <button className="text-button" disabled={busy} onClick={() => defaults({ ...workspace?.design, [type === 'palette' ? 'paletteId' : 'fontId']: undefined })}>{t("取消使用")}</button>}
        </div>
      </div>
    </div>
    {type === 'font' && <div className="design-preview-head"><strong>{inspected?.id && inspected.id !== appliedId ? t("预览此") + label : t("网页预览")}</strong><small>{previewPalette?.name ?? t("示例配色")} · {previewFonts?.name ?? t("示例字体")}</small></div>}
    {type === 'font' && previewFonts && previewEntry && <div className="font-quick-settings">
      {previewFonts.entries.length > 1 && <select aria-label={t("设置字体用途")} value={previewEntry.role} onChange={event => setFontRole(event.target.value as FontEntry['role'])}>{previewFonts.entries.map(entry => <option key={entry.key} value={entry.role}>{msg(fontRoleLabels[entry.role])}</option>)}</select>}
      <FontControls entry={previewEntry} disabled={busy || !workspace} change={updatePreviewFont} fallbackColor={previewPalette?.entries.find(entry => entry.role === 'text')?.value} />
      <div className="font-quick-actions"><small>{fontDirty ? t("未保存") : t("即时预览")}</small>
        {fontDirty && <button className="text-button" disabled={busy} onClick={() => clearFontDraft(previewFonts.id)}>{t("还原")}</button>}
        <button className="small-button" disabled={busy || !workspace || !fontDirty} onClick={async () => { if (await saveFonts(previewFonts)) clearFontDraft(previewFonts.id); }}>{t("保存设置")}</button>
      </div>
    </div>}
    {type === 'font' && <DesignPreview key={inspected?.id} palette={previewPalette} fonts={previewFonts} />}
    {picker && <div className="color-picker-column">{picker(previewPalette)}</div>}
    {type === 'font' && <p className="form-note">{t("修改后保存到当前字体。预览使用此电脑可用的字体。")}</p>}
    </div>
    {picker && <div className="color-panel-footer"><span>{t('当前有 {0} 个色卡', [allItems.length])}</span><button disabled={busy || (!previewPalette && !previewFonts)} onClick={() => copy(designCss(previewPalette, previewFonts))}><Copy size={15} />{t("复制 CSS")}</button></div>}
  </section>;
}
