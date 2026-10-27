export type AnnotationKind = 'rect' | 'arrow';
export type LineWeight = 'thin' | 'medium' | 'thick';
export type AnnotationStyle = { color: string; weight: LineWeight };
export type Point = { x: number; y: number };
export type Annotation = Point & AnnotationStyle & { id: string; kind: AnnotationKind; endX: number; endY: number };
export type AnnotationHistory = { past: Annotation[][]; present: Annotation[]; future: Annotation[][] };
export type AnnotationPreferences = { rect: AnnotationStyle; arrow: AnnotationStyle; recent: string[] };
export const annotationStorageKey = 'dockyard-annotation-preferences-v1';
export const presetColors = ['#EF3038', '#F97316', '#FACC15', '#22C55E', '#3B82F6', '#A855F7', '#111111', '#FFFFFF'];
export const defaultStyle: AnnotationStyle = { color: '#EF3038', weight: 'medium' };
export function createAnnotationHistory(): AnnotationHistory { return { past: [], present: [], future: [] }; }
export function normalizeColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(hex) ? '#' + hex.toUpperCase() : null;
}
export function readAnnotationPreferences(raw: string | null): AnnotationPreferences {
  const defaults = { rect: { ...defaultStyle }, arrow: { ...defaultStyle }, recent: [] };
  try {
    const value = JSON.parse(raw ?? 'null');
    const style = (input: unknown): AnnotationStyle => {
      if (!input || typeof input !== 'object') return { ...defaultStyle };
      const candidate = input as Partial<AnnotationStyle>;
      return { color: typeof candidate.color === 'string' ? normalizeColor(candidate.color) ?? defaultStyle.color : defaultStyle.color,
        weight: ['thin', 'medium', 'thick'].includes(candidate.weight ?? '') ? candidate.weight! : 'medium' };
    };
    if (!value || typeof value !== 'object') return defaults;
    return { rect: style(value.rect), arrow: style(value.arrow), recent: Array.isArray(value.recent)
      ? [...new Set<string>(value.recent.filter((color: unknown) => typeof color === 'string').map(normalizeColor)
        .filter((color: string | null): color is string => !!color && !presetColors.includes(color)))].slice(0, 6) : [] };
  } catch { return defaults; }
}
export function commitAnnotations(history: AnnotationHistory, next: Annotation[]): AnnotationHistory {
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history;
  return { past: [...history.past, history.present].slice(-100), present: next, future: [] };
}
export function undoAnnotations(history: AnnotationHistory): AnnotationHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}
export function redoAnnotations(history: AnnotationHistory): AnnotationHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
export function strokeWidth(mark: AnnotationStyle, width: number, height: number): number {
  return Math.max(3, Math.min(width, height) / 150) * ({ thin: .6, medium: 1, thick: 1.8 }[mark.weight]);
}
export function handles(mark: Annotation): Point[] {
  return mark.kind === 'rect' ? [{ x: mark.x, y: mark.y }, { x: mark.endX, y: mark.y },
    { x: mark.endX, y: mark.endY }, { x: mark.x, y: mark.endY }]
    : [{ x: mark.x, y: mark.y }, { x: mark.endX, y: mark.endY }];
}
export function arrowHead(mark: Annotation, width: number, height: number): Point[] {
  const angle = Math.atan2(mark.endY - mark.y, mark.endX - mark.x);
  const head = Math.min(strokeWidth(mark, width, height) * 5, Math.hypot(mark.endX - mark.x, mark.endY - mark.y) * .45);
  return [{ x: mark.endX, y: mark.endY }, ...[-.5, .5].map(offset => ({
    x: mark.endX - head * Math.cos(angle + offset), y: mark.endY - head * Math.sin(angle + offset),
  }))];
}
function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fraction = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - a.x - dx * fraction, point.y - a.y - dy * fraction);
}
export function hitAnnotation(mark: Annotation, point: Point, tolerance: number, width: number, height: number): boolean {
  const margin = tolerance + strokeWidth(mark, width, height) / 2;
  if (mark.kind === 'rect') return point.x >= Math.min(mark.x, mark.endX) - margin && point.x <= Math.max(mark.x, mark.endX) + margin
    && point.y >= Math.min(mark.y, mark.endY) - margin && point.y <= Math.max(mark.y, mark.endY) + margin;
  const points = arrowHead(mark, width, height);
  return distanceToSegment(point, mark, { x: mark.endX, y: mark.endY }) <= margin
    || points.some((p, index) => distanceToSegment(point, p, points[(index + 1) % 3]) <= margin);
}
export function moveAnnotation(mark: Annotation, delta: Point, width: number, height: number): Annotation {
  const dx = Math.max(-Math.min(mark.x, mark.endX), Math.min(width - Math.max(mark.x, mark.endX), delta.x));
  const dy = Math.max(-Math.min(mark.y, mark.endY), Math.min(height - Math.max(mark.y, mark.endY), delta.y));
  return { ...mark, x: mark.x + dx, y: mark.y + dy, endX: mark.endX + dx, endY: mark.endY + dy };
}
export function resizeAnnotation(mark: Annotation, handle: number, point: Point): Annotation {
  if (mark.kind === 'arrow') return handle === 0 ? { ...mark, ...point } : { ...mark, endX: point.x, endY: point.y };
  return { ...mark, ...([0, 3].includes(handle) ? { x: point.x } : { endX: point.x }),
    ...([0, 1].includes(handle) ? { y: point.y } : { endY: point.y }) };
}
export function validAnnotation(mark: Annotation): boolean {
  return mark.kind === 'rect' ? Math.abs(mark.endX - mark.x) >= 3 && Math.abs(mark.endY - mark.y) >= 3
    : Math.hypot(mark.endX - mark.x, mark.endY - mark.y) >= 3;
}
export function paintAnnotations(ctx: CanvasRenderingContext2D, items: Annotation[], width: number, height: number): void {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const mark of items) {
    ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = strokeWidth(mark, width, height);
    if (mark.kind === 'rect') ctx.strokeRect(mark.x, mark.y, mark.endX - mark.x, mark.endY - mark.y);
    else {
      ctx.beginPath(); ctx.moveTo(mark.x, mark.y); ctx.lineTo(mark.endX, mark.endY); ctx.stroke();
      const head = arrowHead(mark, width, height);
      ctx.beginPath(); ctx.moveTo(head[0].x, head[0].y); ctx.lineTo(head[1].x, head[1].y); ctx.lineTo(head[2].x, head[2].y); ctx.closePath(); ctx.fill();
    }
  }
}
