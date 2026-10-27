import { t } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Cursor, Rectangle, ArrowUpRight, ArrowCounterClockwise, ArrowClockwise, Trash, Check } from '@phosphor-icons/react';
import { annotationStorageKey, presetColors, readAnnotationPreferences, normalizeColor, commitAnnotations, undoAnnotations,
  redoAnnotations, handles, hitAnnotation, moveAnnotation, resizeAnnotation, validAnnotation, paintAnnotations,
  type Annotation, type AnnotationHistory, type AnnotationKind, type AnnotationStyle, type AnnotationPreferences, type Point } from './annotations';

type Gesture = { mode: 'draw' | 'move' | 'resize'; original: Annotation; current: Annotation; start: Point; handle: number; pointerId: number };
const colorNames = ['红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '黑色', '白色'] as const;
export function ScreenshotEditor({ capture, history, change, busy, action }: {
  capture: { dataUrl: string; width: number; height: number }; history: AnnotationHistory;
  change: (history: AnnotationHistory) => void; busy: boolean;
  action: (action: 'copy' | 'save' | 'resource', dataUrl: string) => void;
}) {
  const marks = history.present;
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const picture = useRef<HTMLImageElement | undefined>(undefined);
  const gesture = useRef<Gesture | null>(null);
  const latestMarks = useRef(marks); latestMarks.current = marks;
  const [tool, setTool] = useState<AnnotationKind | 'select'>('rect');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [preferences, setPreferences] = useState(() => {
    try { return readAnnotationPreferences(localStorage.getItem(annotationStorageKey)); }
    catch { return readAnnotationPreferences(null); }
  });
  const [storageError, setStorageError] = useState(false);
  const [moreColors, setMoreColors] = useState(false);
  const [customColor, setCustomColor] = useState(preferences.rect.color);
  const selected = marks.find(mark => mark.id === selectedId);
  const style = selected ?? preferences[tool === 'arrow' ? 'arrow' : 'rect'];
  const editable = !!selected || tool !== 'select';
  const scale = Math.min(1, 580 / capture.width, 290 / capture.height);
  function displayScale() { return (canvas.current?.getBoundingClientRect().width || capture.width * scale) / capture.width; }
  function paint(items: Annotation[]) {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !picture.current) return;
    ctx.clearRect(0, 0, capture.width, capture.height);
    ctx.drawImage(picture.current, 0, 0);
    paintAnnotations(ctx, items, capture.width, capture.height);
  }
  function paintSelection(mark?: Annotation) {
    const ctx = overlay.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, capture.width, capture.height);
    if (!mark) return;
    const unit = 1 / displayScale(), points = handles(mark);
    ctx.save(); ctx.lineWidth = unit; ctx.setLineDash([4 * unit, 4 * unit]);
    // Two contrasting strokes stay visible on both dark and light screenshots.
    for (const [color, offset] of [['#FFFFFF', 0], ['#111111', 4 * unit]] as const) {
      ctx.strokeStyle = color; ctx.lineDashOffset = offset;
      if (mark.kind === 'rect') ctx.strokeRect(mark.x, mark.y, mark.endX - mark.x, mark.endY - mark.y);
      else { ctx.beginPath(); ctx.moveTo(mark.x, mark.y); ctx.lineTo(mark.endX, mark.endY); ctx.stroke(); }
    }
    ctx.setLineDash([]); ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#111111';
    for (const point of points) {
      ctx.fillRect(point.x - 4 * unit, point.y - 4 * unit, 8 * unit, 8 * unit);
      ctx.strokeRect(point.x - 4 * unit, point.y - 4 * unit, 8 * unit, 8 * unit);
    }
    ctx.restore();
  }
  useEffect(() => {
    let cancelled = false; setReady(false); setSelectedId(null); gesture.current = null; picture.current = undefined;
    const img = new Image();
    img.onload = () => { if (!cancelled) { picture.current = img; paint(latestMarks.current); setReady(true); } };
    img.src = capture.dataUrl;
    return () => { cancelled = true; };
  }, [capture]);
  useEffect(() => { paint(marks); paintSelection(selected); }, [marks, selectedId, ready]);
  useEffect(() => {
    const observer = new ResizeObserver(() => paintSelection(selected));
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [selected, capture]);
  useEffect(() => { setCustomColor(style.color); }, [style.color, selectedId, tool]);
  useEffect(() => { if (busy) cancelGesture(); }, [busy]);
  function savePreferences(next: AnnotationPreferences) {
    setPreferences(next);
    try { localStorage.setItem(annotationStorageKey, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }
  function updateStyle(patch: Partial<AnnotationStyle>, rememberCustom = false) {
    if (busy || !editable) return;
    let next = preferences;
    if (selected) change(commitAnnotations(history, marks.map(mark => mark.id === selected.id ? { ...mark, ...patch } : mark)));
    else { const kind = tool === 'arrow' ? 'arrow' : 'rect'; next = { ...next, [kind]: { ...next[kind], ...patch } }; }
    if (rememberCustom && patch.color && !presetColors.includes(patch.color)) {
      next = { ...next, recent: [patch.color, ...next.recent.filter(color => color !== patch.color)].slice(0, 6) };
    }
    if (next !== preferences) savePreferences(next);
  }
  function chooseTool(next: typeof tool) { cancelGesture(); setTool(next); setSelectedId(null); setMoreColors(false); }
  function travel(direction: 'undo' | 'redo') {
    cancelGesture(); setSelectedId(null); setMoreColors(false);
    change(direction === 'undo' ? undoAnnotations(history) : redoAnnotations(history));
    canvas.current?.focus({ preventScroll: true });
  }
  function removeSelected() {
    if (!selected) return;
    change(commitAnnotations(history, marks.filter(mark => mark.id !== selected.id))); setSelectedId(null);
    canvas.current?.focus({ preventScroll: true });
  }
  function applyCustomColor() {
    const color = normalizeColor(customColor);
    if (!color) return;
    updateStyle({ color }, true); setMoreColors(false); canvas.current?.focus({ preventScroll: true });
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(capture.width, (event.clientX - rect.left) * capture.width / rect.width)),
      y: Math.max(0, Math.min(capture.height, (event.clientY - rect.top) * capture.height / rect.height)) };
  }
  function cancelGesture() {
    const active = gesture.current; gesture.current = null;
    if (active && canvas.current?.hasPointerCapture(active.pointerId)) canvas.current.releasePointerCapture(active.pointerId);
    paint(marks); paintSelection(selected);
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (busy || !ready || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.currentTarget.focus();
    const start = point(event);
    let original: Annotation, mode: Gesture['mode'] = 'draw', handle = -1;
    if (tool === 'select') {
      if (selected) handle = handles(selected).findIndex(p => Math.hypot(start.x - p.x, start.y - p.y) <= 8 / displayScale());
      const hit = handle >= 0 ? selected : [...marks].reverse().find(mark => hitAnnotation(mark, start, 6 / displayScale(), capture.width, capture.height));
      setSelectedId(hit?.id ?? null);
      if (!hit) return;
      original = hit; mode = handle >= 0 ? 'resize' : 'move';
    } else original = { id: crypto.randomUUID(), kind: tool, ...preferences[tool], ...start, endX: start.x, endY: start.y };
    gesture.current = { mode, original, current: original, start, handle, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const p = point(event);
    active.current = active.mode === 'draw' ? { ...active.original, endX: p.x, endY: p.y }
      : active.mode === 'resize' ? resizeAnnotation(active.original, active.handle, p)
        : moveAnnotation(active.original, { x: p.x - active.start.x, y: p.y - active.start.y }, capture.width, capture.height);
    paint(active.mode === 'draw' ? [...marks, active.current] : marks.map(mark => mark.id === active.original.id ? active.current : mark));
    paintSelection(active.mode === 'draw' ? undefined : active.current);
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    pointerMove(event); gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (validAnnotation(active.current)) change(commitAnnotations(history, active.mode === 'draw' ? [...marks, active.current]
      : marks.map(mark => mark.id === active.original.id ? active.current : mark)));
    else { paint(marks); paintSelection(selected); }
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (busy) return;
    if (event.key === 'Escape' && (gesture.current || selected || moreColors)) {
      event.preventDefault(); event.stopPropagation(); cancelGesture(); setSelectedId(null); setMoreColors(false); return;
    }
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable=true]')) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); travel(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
    } else if (['Delete', 'Backspace'].includes(event.key) && selected) { event.preventDefault(); removeSelected(); }
  }
  function exportImage(kind: 'copy' | 'save' | 'resource') {
    cancelGesture(); paint(marks);
    if (canvas.current) action(kind, canvas.current.toDataURL());
  }
  function swatch(color: string, label: string, recent = false) {
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    const dark = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 155;
    return <button key={color} type="button" className="annotation-swatch" aria-label={label + ' ' + color} title={label + ' ' + color}
      aria-pressed={editable && style.color === color} disabled={busy || !editable}
      style={{ background: color, color: dark ? '#FFFFFF' : '#111111' }} onClick={() => updateStyle({ color }, recent)}>
      {editable && style.color === color && <Check size={15} weight="bold" />}
    </button>;
  }
  return <div className="screenshot-editor" onKeyDown={onKeyDown}>
    <div className="annotation-tools" role="toolbar" aria-label={t("截图标注工具")}>
      <button aria-pressed={tool === 'select'} disabled={busy} onClick={() => chooseTool('select')}><Cursor size={16} />{t("选择标注")}</button>
      <button aria-pressed={tool === 'rect'} disabled={busy} onClick={() => chooseTool('rect')}><Rectangle size={16} />{t("矩形框")}</button>
      <button aria-pressed={tool === 'arrow'} disabled={busy} onClick={() => chooseTool('arrow')}><ArrowUpRight size={16} />{t("箭头")}</button>
      <span className="annotation-tools-spacer" />
      <button className="icon-button" aria-label={t("撤销")} title={t("撤销") + ' (Ctrl+Z)'} disabled={busy || !history.past.length} onClick={() => travel('undo')}><ArrowCounterClockwise size={17} /></button>
      <button className="icon-button" aria-label={t("重做")} title={t("重做") + ' (Ctrl+Shift+Z)'} disabled={busy || !history.future.length} onClick={() => travel('redo')}><ArrowClockwise size={17} /></button>
      <button className="icon-button" aria-label={t("删除选中标注")} title={t("删除选中标注") + ' (Delete)'} disabled={busy || !selected} onClick={removeSelected}><Trash size={17} /></button>
      <button disabled={busy || !marks.length} onClick={() => { change(commitAnnotations(history, [])); setSelectedId(null); }}>{t("清空标注")}</button>
    </div>
    <div className="annotation-style" role="group" aria-label={t("标注样式")}>
      <div className="annotation-style-heading">
        <span className="annotation-context" aria-live="polite">{selected ? t(selected.kind === 'rect' ? "已选中矩形框" : "已选中箭头")
          : t(tool === 'select' ? "点击标注以修改" : tool === 'rect' ? "新建矩形框" : "新建箭头")}</span>
        <div className="annotation-weights" role="group" aria-label={t("线条粗细")}>
          <span className="muted">{t("线条粗细")}</span>
          {(['thin', 'medium', 'thick'] as const).map((weight, index) => <button key={weight} disabled={busy || !editable}
            aria-pressed={editable && style.weight === weight} onClick={() => updateStyle({ weight })}>{t((['细', '中', '粗'] as const)[index])}</button>)}
        </div>
      </div>
      <div className="annotation-colors" role="group" aria-label={t("标注颜色")}>
        {presetColors.map((color, index) => swatch(color, t(colorNames[index])))}
        <button className="annotation-more" aria-expanded={moreColors} disabled={busy || !editable} onClick={() => { setCustomColor(style.color); setMoreColors(!moreColors); }}>{t("更多颜色")}</button>
        <span className="annotation-current-color" aria-label={t("当前标注颜色")} style={{ background: style.color }} />
        <code>{editable ? style.color : '—'}</code>
      </div>
      {preferences.recent.length > 0 && <div className="annotation-colors annotation-recent" role="group" aria-label={t("最近使用的标注颜色")}>
        <span className="muted">{t("最近使用")}</span>{preferences.recent.map(color => swatch(color, t("自定义颜色"), true))}
      </div>}
      {moreColors && <div className="annotation-custom" role="group" aria-label={t("自定义标注颜色")}>
        <input type="color" aria-label={t("选择自定义标注颜色")} disabled={busy} value={normalizeColor(customColor) ?? style.color} onChange={event => setCustomColor(event.target.value.toUpperCase())} />
        <label>HEX<input aria-label={t("标注颜色 HEX")} disabled={busy} value={customColor} maxLength={7} spellCheck={false}
          aria-invalid={!normalizeColor(customColor)} onChange={event => setCustomColor(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyCustomColor(); } }} /></label>
        <button disabled={busy || !normalizeColor(customColor)} onClick={applyCustomColor}>{t("应用颜色")}</button>
        <button disabled={busy} onClick={() => setMoreColors(false)}>{t("取消")}</button>
      </div>}
    </div>
    {storageError && <p className="form-note" role="status">{t("标注设置暂时无法保存，下次打开可能恢复默认。")}</p>}
    <div className="capture-preview"><div className="annotation-stage" style={{ width: capture.width * scale, aspectRatio: `${capture.width} / ${capture.height}` }}>
      <canvas ref={canvas} width={capture.width} height={capture.height} aria-label={t("截图标注画布")} data-ready={ready}
        tabIndex={0} style={{ cursor: tool === 'select' ? selected ? 'move' : 'default' : 'crosshair' }}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelGesture}
        onLostPointerCapture={() => { if (gesture.current) cancelGesture(); }} />
      <canvas ref={overlay} className="annotation-selection" width={capture.width} height={capture.height} aria-hidden="true" />
    </div></div>
    <p className="annotation-hint muted">{t(tool === 'select' ? "拖动标注移动 · 拖动手柄调整 · Delete 删除" : "拖动绘制 · 选择工具可修改已有标注")}</p>
    <div className="popover-foot">
      <button disabled={busy || !ready} onClick={() => exportImage('save')}>{t("保存图片")}</button>
      <button disabled={busy || !ready} onClick={() => exportImage('resource')}>{t("加入当前工作区")}</button>
      <button disabled={busy || !ready} className="primary" onClick={() => exportImage('copy')}>{t("复制图片")}</button>
    </div>
    <p className="muted">{t("原图已自动复制；添加标注后点击“复制图片”，同时更新缓存。")}</p>
  </div>;
}
