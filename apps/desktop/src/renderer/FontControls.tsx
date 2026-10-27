import { t } from '../i18n';
import React, { useEffect, useState } from 'react';
import { TextAa, TextB, TextT, ArrowCounterClockwise } from '@phosphor-icons/react';
import type { FontEntry } from '@dockyard/shared';

export function FontControls({ entry, change, disabled, fallbackColor = '#222A24' }: {
  entry: FontEntry; change: (patch: Partial<FontEntry>) => void; disabled?: boolean; fallbackColor?: string;
}) {
  const [size, setSize] = useState(String(entry.size ?? 16));
  useEffect(() => setSize(String(entry.size ?? 16)), [entry.size, entry.key]);
  return <fieldset className="font-controls" disabled={disabled} aria-label={t("常用字体设置")}>
    <label className="font-size-control" title={t("字号（8–96 px）")}><TextAa size={19} aria-hidden="true" />
      <input aria-label={t("字号")} type="number" min={8} max={96} step="any" required value={size} onChange={event => {
        setSize(event.target.value);
        const value = event.target.valueAsNumber;
        if (Number.isFinite(value) && value >= 8 && value <= 96) change({ size: value });
      }} onBlur={() => setSize(String(entry.size ?? 16))} /><span>px</span>
    </label>
    <span className="divider" />
    <button type="button" className="icon-button" aria-label={t("加粗")} title={entry.weight >= 600 ? t("取消加粗") : t("加粗")} aria-pressed={entry.weight >= 600} onClick={() => change({ weight: entry.weight >= 600 ? 400 : 700 })}><TextB size={19} weight="bold" /></button>
    <label className="font-color-control" title={t("文字颜色 · ") + (entry.color ?? t("跟随配色"))}>
      <TextT size={19} aria-hidden="true" /><span className="font-color-line" style={{ background: entry.color ?? fallbackColor }} />
      <input type="color" aria-label={t("文字颜色")} value={entry.color ?? fallbackColor} onChange={event => change({ color: event.target.value.toUpperCase() })} />
    </label>
    <button type="button" className="icon-button" aria-label={t("文字颜色跟随配色")} title={t("文字颜色跟随配色")} disabled={disabled || !entry.color} onClick={() => change({ color: undefined })}><ArrowCounterClockwise size={16} /></button>
  </fieldset>;
}
