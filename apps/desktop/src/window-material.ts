import { nativeTheme, type BrowserWindow, type Rectangle } from 'electron';
import { release } from 'node:os';
import { z } from 'zod';
import { setWindowsAccent, updateWindowsGlassBounds, disposeWindowsGlass } from './win32-accent';

// The renderer describes visible surfaces only. Never accept arbitrary native regions.
export const surfacesSchema = z.array(z.object({
  x: z.number().int().min(0).max(1100),
  y: z.number().int().min(0).max(1200),
  width: z.number().int().min(1).max(1100),
  height: z.number().int().min(1).max(1200),
  radius: z.number().int().min(0).max(24),
}).strict()).min(1).max(4);
type Surface = z.infer<typeof surfacesSchema>[number];

export function roundedRegions(surfaces: Surface[], width: number, height: number): Rectangle[] {
  return surfaces.flatMap(surface => {
    const w = Math.min(surface.width, width - surface.x);
    const h = Math.min(surface.height, height - surface.y);
    if (w <= 0 || h <= 0) return [];
    const r = Math.min(surface.radius, Math.floor(w / 2), Math.floor(h / 2));
    const rows: Rectangle[] = [];
    for (let y = 0; y < h; y++) {
      const edge = Math.min(y, h - 1 - y);
      const inset = edge < r ? Math.ceil(r - Math.sqrt(r * r - (r - edge - .5) ** 2)) : 0;
      const previous = rows.at(-1);
      if (previous && previous.x === surface.x + inset && previous.width === w - inset * 2) previous.height++;
      else rows.push({ x: surface.x + inset, y: surface.y + y, width: w - inset * 2, height: 1 });
    }
    return rows;
  });
}

export type MaterialBackend = 'system' | 'accent' | 'transparent';
export function getWindowMaterialBackend(platform: string = process.platform, version: string = release()): MaterialBackend {
  const build = Number(version.split('.')[2]);
  if (platform !== 'win32') return 'transparent';
  // Electron's system Acrylic paints outside the CSS corners on this frameless
  // window, even with roundedCorners enabled. Clip the composition visual on
  // Windows 11 as well, so the desktop remains untouched outside the 14 DIP rim.
  if (build >= 17763) return 'accent';
  return 'transparent';
}

/** One window owns both content and a clipped HostBackdropBrush on Windows
 * 10/11, with a transparent fallback. The system backend is retained for probes. */
export function installWindowMaterial(window: BrowserWindow, backend = getWindowMaterialBackend()) {
  let mode: 'acrylic' | 'translucent' | 'solid' = 'solid';
  let failed = false;
  let nativeEnabled: boolean | undefined;
  let nativeDark: boolean | undefined;
  const apply = (force = false) => {
    if (window.isDestroyed()) return mode;
    const previous = mode;
    const reduced = nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors;
    const fallback = reduced || backend === 'system' ? 'solid' : 'translucent';
    const enabled = !reduced;
    const dark = nativeTheme.shouldUseDarkColors;
    mode = enabled && backend !== 'transparent' && !failed ? 'acrylic' : fallback;
    if (backend !== 'transparent' && !failed && (force || enabled !== nativeEnabled || (enabled && dark !== nativeDark))) {
      try {
        if (backend === 'system') window.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
        else if (enabled || nativeEnabled) setWindowsAccent(window, enabled);
        nativeEnabled = enabled;
        nativeDark = dark;
      } catch (error) {
        failed = true;
        mode = fallback;
        console.warn('Dockyard window material unavailable:', error);
      }
    }
    if (backend === 'accent' && nativeEnabled && !failed) {
      try { updateWindowsGlassBounds(window); }
      catch (error) {
        failed = true;
        try { setWindowsAccent(window, false); } catch { /* Fall back to transparent content. */ }
        mode = fallback;
        console.warn('Dockyard window glass bounds unavailable:', error);
      }
    }
    if (mode !== previous) window.webContents.send('dockyard:material', mode);
    return mode;
  };
  const updateTheme = () => apply();
  const refresh = () => apply(true);
  nativeTheme.on('updated', updateTheme);
  window.on('show', refresh);
  window.on('restore', refresh);
  if (backend === 'accent') {
    window.hookWindowMessage(0x031e, refresh); // WM_DWMCOMPOSITIONCHANGED
    window.hookWindowMessage(0x001a, updateTheme); // WM_SETTINGCHANGE
    window.hookWindowMessage(0x02e0, updateTheme); // WM_DPICHANGED
    window.on('resize', updateTheme);
  }
  window.on('closed', () => {
    nativeTheme.removeListener('updated', updateTheme);
    if (backend === 'accent') disposeWindowsGlass(window);
  });
  apply();
  return (value: unknown) => {
    if (!surfacesSchema.safeParse(value).success) return mode;
    return apply();
  };
}
