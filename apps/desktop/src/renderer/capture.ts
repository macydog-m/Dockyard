import { t, setLocale, type Locale } from '../i18n';
export {};
declare global { interface Window { captureTools: {
  onFrame(callback: (frame: { session: number; locale: Locale; mode: 'color' | 'screenshot'; pixels: Uint8Array; width: number; height: number }) => void): () => void;
  onReset(callback: () => void): () => void;
  ready(session: number, viewport: { width: number; height: number }): Promise<void>;
  select(session: number, rect: { x: number; y: number; width: number; height: number }): Promise<boolean>;
  cancel(session: number): Promise<void>;
} } }
const canvas = document.querySelector('canvas')!;
const context = canvas.getContext('2d', { willReadFrequently: true })!;
const hint = document.getElementById('hint')!;
const selection = document.getElementById('selection')!;
let frame: { session: number; mode: 'color' | 'screenshot'; width: number; height: number } | undefined;
let start: { x: number; y: number } | undefined;
let ready = false;
let submitting = false;
window.captureTools.onReset(() => {
  ready = false; submitting = false; start = undefined; frame = undefined;
  canvas.width = 1; canvas.height = 1;
  selection.style.display = 'none'; hint.textContent = ''; document.body.dataset.ready = '';
});
window.captureTools.onFrame(async value => {
  setLocale(value.locale);
  document.documentElement.lang = value.locale;
  document.title = value.locale === 'en' ? 'Dockyard screen tools' : 'Dockyard 屏幕工具';
  ready = false; submitting = false; start = undefined;
  selection.style.display = 'none'; document.body.dataset.ready = '';
  hint.style.left = '18px'; hint.style.top = '18px';
  frame = { session: value.session, mode: value.mode, width: value.width, height: value.height };
  // Windows NativeImage bitmap is BGRA. Convert once, retaining only the canvas pixels.
  const data = context.createImageData(value.width, value.height);
  const source = value.pixels;
  for (let i = 0; i < source.length; i += 4) {
    data.data[i] = source[i + 2]; data.data[i + 1] = source[i + 1];
    data.data[i + 2] = source[i]; data.data[i + 3] = source[i + 3];
  }
  canvas.width = value.width; canvas.height = value.height;
  context.putImageData(data, 0, 0);
  hint.textContent = value.mode === 'color' ? t("点击像素取色 · Esc 取消") : t("拖动框选截图 · Esc / 右键取消");
  // A loaded HTML page is not a painted screen. Acknowledge only after compositing.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (frame?.session !== value.session) return;
  ready = true; document.body.dataset.ready = String(value.session);
  await window.captureTools.ready(value.session, { width: innerWidth, height: innerHeight });
});
function point(event: PointerEvent) { return { x: Math.max(0, Math.min(innerWidth - 1, event.clientX)), y: Math.max(0, Math.min(innerHeight - 1, event.clientY)) }; }
function rectangle(end: { x: number; y: number }) { return { x: Math.min(start!.x, end.x), y: Math.min(start!.y, end.y), width: Math.abs(start!.x - end.x), height: Math.abs(start!.y - end.y) }; }
window.addEventListener('keydown', e => { if (e.key === 'Escape') if (frame) void window.captureTools.cancel(frame.session); });
window.addEventListener('contextmenu', e => { e.preventDefault(); if (frame) void window.captureTools.cancel(frame.session); });
canvas.addEventListener('pointerdown', e => {
  if (!ready || submitting || e.button !== 0) return;
  start = point(e); canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!ready || !frame) return;
  const p = point(e);
  hint.style.left = Math.max(8, Math.min(innerWidth - 280, p.x + 22)) + 'px';
  hint.style.top = Math.max(8, Math.min(innerHeight - 80, p.y + 22)) + 'px';
  if (frame.mode === 'color') {
    const pixel = context.getImageData(Math.floor(p.x * canvas.width / innerWidth), Math.floor(p.y * canvas.height / innerHeight), 1, 1).data;
    const hex = '#' + [...pixel].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    hint.textContent = hex + t("\n点击取色 · Esc 取消");
  } else if (start) {
    const rect = rectangle(p); selection.style.display = 'block';
    Object.assign(selection.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    hint.textContent = Math.round(rect.width * canvas.width / innerWidth) + ' × ' + Math.round(rect.height * canvas.height / innerHeight) + t(" px\n松开完成 · Esc 取消");
  }
});
canvas.addEventListener('pointerup', async e => {
  if (!ready || !start || submitting || e.button !== 0) return;
  const p = point(e);
  const rect = frame?.mode === 'color' ? { ...p, width: 1, height: 1 } : rectangle(p);
  start = undefined;
  if (rect.width < 1 || rect.height < 1) { selection.style.display = 'none'; return; }
  submitting = true;
  const ok = await window.captureTools.select(frame!.session, rect);
  if (!ok) { submitting = false; selection.style.display = 'none'; hint.textContent = t("请选择有效区域 · Esc 取消"); }
});
