import { t } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Copy, PencilSimple, Trash } from '@phosphor-icons/react';
import type { Component, PaletteEntry } from '@dockyard/shared';
export function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return '#' + [f(5), f(3), f(1)].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function hexToHsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  let h = d === 0 ? 0 : v === r ? (g - b) / d : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60) + 360) % 360;
  return { h, s: v === 0 ? 0 : d / v, v };
}
export function ColorPanel({ value, change, palettes, save, manage, remove, copy, copyAi, busy, previewPalette }: {
  value: string; change: (value: string) => void; palettes: Extract<Component, { type: 'palette' }>[];
  save: (name: string, paletteId?: string) => Promise<boolean>; manage: (id?: string) => void; remove: (palette: Extract<Component, { type: 'palette' }>) => void; copy: () => void; copyAi: (name: string, palette?: Extract<Component, { type: 'palette' }>, entry?: PaletteEntry) => void; busy: boolean; previewPalette?: Extract<Component, { type: 'palette' }>;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hex, setHex] = useState(value);
  const [paletteId, setPaletteId] = useState(palettes[0]?.id ?? '');
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState<{ paletteId: string; key: string }>();
  const area = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  useEffect(() => { setHex(value); if (value !== last.current) setHsv(hexToHsv(value)); last.current = value; }, [value]);
  const palette = palettes.find(p => p.id === paletteId) ?? palettes[0];
  const sources = [previewPalette, palette].filter((item): item is Extract<Component, { type: 'palette' }> => !!item);
  const selectedOwner = sources.find(item => item.id === selectedColor?.paletteId && item.entries.some(entry => entry.key === selectedColor.key && entry.value.toUpperCase() === value));
  const copyOwner = selectedOwner ?? sources.find(item => item.entries.some(entry => entry.value.toUpperCase() === value));
  const copyEntry = copyOwner?.entries.find(entry => (selectedOwner ? entry.key === selectedColor?.key : entry.value.toUpperCase() === value));
  function selectColor(owner: Extract<Component, { type: 'palette' }>, entry: PaletteEntry) {
    setSelectedColor({ paletteId: owner.id, key: entry.key }); change(entry.value.toUpperCase());
  }
  function update(next: typeof hsv) { setSelectedColor(undefined); setHsv(next); const color = hsvToHex(next.h, next.s, next.v); last.current = color; setHex(color); change(color); }
  function point(e: React.PointerEvent) {
    const rect = area.current!.getBoundingClientRect();
    update({ ...hsv, s: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), v: 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) });
  }
  return <div className="color-picker"><div className="color-picker-controls">
    <div className="panel-heading"><h3>{t("选色")}</h3><button className="small-button" disabled={busy} onClick={() => copyAi(name.trim(), copyOwner, copyEntry)} title={t("复制给 AI")}><Copy size={16} />{t("复制给 AI")}</button></div>
    <div ref={area} className="color-plane" aria-label={t("拖动选择饱和度和亮度")} style={{ backgroundColor: hsvToHex(hsv.h, 1, 1) }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); point(e); }} onPointerMove={e => { if (e.buttons === 1) point(e); }}>
      <span className="color-cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
    </div>
    <input className="hue-slider" type="range" min="0" max="359" step="1" aria-label={t("色相")} value={hsv.h} onChange={e => update({ ...hsv, h: Number(e.target.value) })} />
    <div className="color-values"><span className="large-swatch" style={{ background: value }} /><label>HEX<span className="color-hex-copy"><input aria-label={t("当前色 HEX")} value={hex} maxLength={7} onChange={e => { const text = e.target.value.toUpperCase(); setSelectedColor(undefined); setHex(text); if (/^#[0-9A-F]{6}$/.test(text)) change(text); }} onBlur={() => setHex(value)} /><button className="icon-button" aria-label={t("复制色值")} title={t("复制 HEX")} disabled={busy} onClick={copy}><Copy size={13} /></button></span></label><span className="rgb-value">RGB<br />{[1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)).join(', ')}</span></div>
    <div className="sv-sliders"><label>{t("饱和度")}<input type="range" min="0" max="100" aria-label={t("饱和度")} value={hsv.s * 100} onChange={e => update({ ...hsv, s: Number(e.target.value) / 100 })} /></label><label>{t("亮度")}<input type="range" min="0" max="100" aria-label={t("亮度")} value={hsv.v * 100} onChange={e => update({ ...hsv, v: Number(e.target.value) / 100 })} /></label></div>
    {previewPalette && <div className="scheme-pick-colors">
      <div className="scheme-pick-heading"><span>{previewPalette.name}</span></div>
      <div className="saved-colors">{previewPalette.entries.map(entry => <button key={entry.key} disabled={busy}
        aria-label={t("选取") + entry.name + ' ' + entry.value} title={entry.name + ' · ' + entry.value}
        className={entry.value.toUpperCase() === value ? 'chosen-color' : ''} style={{ background: entry.value }}
        onClick={() => selectColor(previewPalette, entry)} />)}</div>
    </div>}
    </div><div className="color-picker-save"><h3>{t("已保存色板")}</h3>
    <div className="palette-heading"><label htmlFor="palette-choice">{t("已保存色板")}</label><select id="palette-choice" value={palette?.id ?? ''} onChange={e => setPaletteId(e.target.value)}>{!palettes.length && <option value="">{t("新建色板")}</option>}{palettes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="tool-button" aria-label={t("管理色板")} title={t("编辑色板")} disabled={busy} onClick={() => manage(palette?.id)}><PencilSimple size={18} /></button><button className="tool-button" aria-label={t("删除色板")} title={t("删除色板")} disabled={busy || !palette} onClick={() => { if (palette) remove(palette); }}><Trash size={18} /></button></div>
    <div className="saved-colors">{palette?.entries.map(entry => <button key={entry.key} aria-label={`${entry.name} ${entry.value}`} title={`${entry.name} · ${entry.value}`} className={entry.value.toUpperCase() === value ? 'chosen-color' : ''} style={{ background: entry.value }} onClick={() => selectColor(palette, entry)} />)}{!palette?.entries.length && <p className="muted">{t("把当前色保存下来，随时再次使用。")}</p>}</div>
    <div className="save-color"><input aria-label={t("保存颜色名称")} placeholder={t("颜色名称（可选）")} maxLength={256} value={name} onChange={e => setName(e.target.value)} /><button disabled={busy || (palette?.entries.length ?? 0) >= 1024} className="primary" onClick={() => void save(name.trim() || t("颜色 ") + value, palette?.id).then(ok => { if (ok) setName(''); })}>{t("保存到色板")}</button></div>
  </div></div>;
}
