import type { BrowserWindow } from 'electron';
import type { TypeObject } from 'koffi';
import path from 'node:path';

type Pointer = unknown;
type NativeType = string | TypeObject | ReturnType<typeof import('koffi').out>;
const windows = new WeakMap<BrowserWindow, Glass>();
let ffi: ReturnType<typeof createFFI> | undefined;
let dispatcher: Pointer;

// Windows Runtime interfaces are queried before using their SDK-defined vtables.
// All methods run synchronously on Electron's main STA; the renderer supplies no
// native pointers, DLL paths or COM interface identifiers.
function createFFI() {
  const k: typeof import('koffi') = require('koffi');
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const user32 = k.load(path.join(system32, 'user32.dll'));
  const combase = k.load(path.join(system32, 'combase.dll'));
  const core = k.load(path.join(system32, 'CoreMessaging.dll'));
  const vector = k.struct({ x: 'float', y: 'float' });
  const rectangle = k.struct({ left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const accent = k.struct({ state: 'int32', flags: 'uint32', color: 'uint32', animation: 'int32' });
  const attributes = k.struct({ attribute: 'int32', data: k.pointer(accent), size: 'size_t' });
  const options = k.struct({ size: 'uint32', thread: 'int32', apartment: 'int32' });
  const outPointer = k.out(k.pointer('void *'));
  const prototypes = new Map<string, TypeObject>();
  const checked = (result: number, operation: string) => {
    if (result < 0) throw new Error(`${operation}: HRESULT 0x${(result >>> 0).toString(16)}`);
  };
  const invoke = (object: Pointer, slot: number, types: NativeType[], args: unknown[], check = true) => {
    const table = k.decode(object, 'void *');
    const method = k.decode(table, slot * k.sizeof('void *'), 'void *');
    const signature = types.map(type => typeof type === 'string' ? type : 'name' in type ? type.name : 'outPointer').join(',');
    let prototype = prototypes.get(signature);
    if (!prototype) {
      prototype = k.proto('__stdcall', 'int32', ['void *', ...types]);
      prototypes.set(signature, prototype);
    }
    const result: number = k.call(method, prototype, object, ...args);
    if (check) checked(result, `Composition method ${slot}`);
    return result;
  };
  const query = (object: Pointer, id: string, refs: Pointer[]) => {
    const bytes = Buffer.from(id.replaceAll('-', ''), 'hex');
    bytes.subarray(0, 4).reverse(); bytes.subarray(4, 6).reverse(); bytes.subarray(6, 8).reverse();
    return create(object, 0, ['void *'], [bytes], refs); // IUnknown::QueryInterface
  };
  const create = (object: Pointer, slot: number, types: NativeType[], args: unknown[], refs: Pointer[]) => {
    const output: Pointer[] = [null];
    invoke(object, slot, [...types, outPointer], [...args, output]);
    if (!output[0]) throw new Error('Windows returned an empty composition interface.');
    refs.push(output[0]);
    return output[0];
  };
  return { k, vector, outPointer, checked, invoke, query, create,
    release: (object: Pointer) => invoke(object, 2, [], [], false), // IUnknown::Release returns ULONG.
    queue: core.func('__stdcall', 'CreateDispatcherQueueController', 'int32', [options, outPointer]),
    createString: combase.func('__stdcall', 'WindowsCreateString', 'int32', ['str16', 'uint32', outPointer]),
    deleteString: combase.func('__stdcall', 'WindowsDeleteString', 'int32', ['void *']),
    activate: combase.func('__stdcall', 'RoActivateInstance', 'int32', ['void *', outPointer]),
    clientRect: user32.func('__stdcall', 'GetClientRect', 'int', ['uintptr_t', k.out(k.pointer(rectangle))]),
    dpi: user32.func('__stdcall', 'GetDpiForWindow', 'uint32', ['uintptr_t']),
    accent: user32.func('__stdcall', 'SetWindowCompositionAttribute', 'int', ['uintptr_t', k.pointer(attributes)]),
    attributesSize: k.sizeof(attributes),
  };
}

type Glass = { refs: Pointer[]; target: Pointer; visual: Pointer; rounded: Pointer; width: number; height: number; dpi: number; enabled: boolean };
function hwnd(window: BrowserWindow) {
  const handle = window.getNativeWindowHandle();
  return handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE();
}
function policy(window: BrowserWindow, enabled: boolean) {
  const native = ffi!;
  // ACCENT_ENABLE_HOSTBACKDROP = 5 enables the brush, without painting a full
  // rectangular Acrylic backdrop outside our clipped composition visual.
  if (!native.accent(hwnd(window), { attribute: 19,
    data: { state: enabled ? 5 : 0, flags: 0, color: 0, animation: 0 }, size: native.attributesSize })) {
    throw new Error('Windows rejected the host backdrop policy.');
  }
}
function createGlass(window: BrowserWindow): Glass {
  const native = ffi ||= createFFI();
  if (!dispatcher) {
    const output: Pointer[] = [null];
    native.checked(native.queue({ size: 12, thread: 2, apartment: 2 }, output), 'CreateDispatcherQueueController');
    // Keep the current-thread dispatcher for the process lifetime. Window
    // targets and visuals have independent, explicitly released references.
    dispatcher = output[0];
  }
  const refs: Pointer[] = [];
  try {
    const name = 'Windows.UI.Composition.Compositor', text: Pointer[] = [null], instance: Pointer[] = [null];
    native.checked(native.createString(name, name.length, text), 'WindowsCreateString');
    try { native.checked(native.activate(text[0], instance), 'RoActivateInstance'); }
    finally { native.deleteString(text[0]); }
    refs.push(instance[0]);
    const query = (object: Pointer, id: string) => native.query(object, id, refs);
    const create = (object: Pointer, slot: number, types: NativeType[] = [], args: unknown[] = []) => native.create(object, slot, types, args, refs);
    const compositor = query(instance[0], 'b403ca50-7f8c-4e83-985f-cc45060036d8'); // ICompositor
    const interop = query(compositor, '29e691fa-4567-4dca-b319-d0f207eb6807'); // ICompositorDesktopInterop
    const desktop = create(interop, 3, ['uintptr_t', 'int'], [hwnd(window), 0]); // CreateDesktopWindowTarget, below content
    const target = query(desktop, 'a1bea8ba-d726-4663-8129-6b5e7927ffa6'); // ICompositionTarget
    const sprite = create(compositor, 22); // ICompositor::CreateSpriteVisual
    const visual = query(sprite, '117e202d-a859-4c89-873b-c2aa566788e3'); // IVisual
    const compositor3 = query(compositor, 'c9dd8ef0-6eb1-4e3c-a658-675d9c64d4ab');
    const backdrop = create(compositor3, 6); // ICompositor3::CreateHostBackdropBrush
    const brush = query(backdrop, 'ab0d7608-30c0-40e9-b568-b60a6bd1fb46'); // ICompositionBrush
    native.invoke(sprite, 7, ['void *'], [brush]); // ISpriteVisual::put_Brush
    const compositor5 = query(compositor, '48ea31ad-7fcd-4076-a79c-90cc4b852c9b');
    const rounded = create(compositor5, 20); // ICompositor5::CreateRoundedRectangleGeometry
    const geometry = query(rounded, 'e985217c-6a17-4207-abd8-5fd3dd612a9d'); // ICompositionGeometry
    const compositor6 = query(compositor, '7a38b2bd-cec8-4eeb-830f-d8d07aedebc3');
    const geometricClip = create(compositor6, 7, ['void *'], [geometry]); // CreateGeometricClipWithGeometry
    const clip = query(geometricClip, '1ccd2a52-cfc7-4ace-9983-146bb8eb6a3c'); // ICompositionClip
    native.invoke(visual, 15, ['void *'], [clip]); // IVisual::put_Clip
    return { refs, target, visual, rounded, width: 0, height: 0, dpi: 0, enabled: false };
  } catch (error) {
    for (const reference of refs.reverse()) native.release(reference);
    throw error;
  }
}

export function updateWindowsGlassBounds(window: BrowserWindow): void {
  const glass = windows.get(window);
  if (!glass || !ffi || window.isDestroyed()) return;
  const handle = hwnd(window), rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!ffi.clientRect(handle, rect)) throw new Error('Windows glass client rectangle unavailable.');
  const width = rect.right - rect.left, height = rect.bottom - rect.top, dpi: number = ffi.dpi(handle);
  if (!dpi || !width || !height || (glass.width === width && glass.height === height && glass.dpi === dpi)) return;
  const size = { x: width, y: height }, radius = Math.min(14 * dpi / 96, width / 2, height / 2);
  ffi.invoke(glass.rounded, 7, [ffi.vector], [{ x: radius, y: radius }]); // put_CornerRadius
  ffi.invoke(glass.rounded, 11, [ffi.vector], [size]); // put_Size
  ffi.invoke(glass.visual, 36, [ffi.vector], [size]); // IVisual::put_Size
  Object.assign(glass, { width, height, dpi });
}

export function setWindowsAccent(window: BrowserWindow, enabled: boolean): void {
  let glass = windows.get(window);
  if (!glass && !enabled) return;
  if (!glass) {
    glass = createGlass(window);
    windows.set(window, glass);
  }
  try {
    policy(window, enabled);
    updateWindowsGlassBounds(window);
    ffi!.invoke(glass.target, 7, ['void *'], [enabled ? glass.visual : null]); // put_Root
    glass.enabled = enabled;
  } catch (error) {
    try { ffi!.invoke(glass.target, 7, ['void *'], [null]); policy(window, false); } catch { /* Keep the original diagnostic. */ }
    disposeWindowsGlass(window);
    throw error;
  }
}

export function disposeWindowsGlass(window: BrowserWindow): void {
  const glass = windows.get(window);
  if (!glass || !ffi) return;
  windows.delete(window);
  try { ffi.invoke(glass.target, 7, ['void *'], [null]); }
  catch (error) { console.warn('Dockyard glass target already unavailable:', error); }
  for (const reference of glass.refs.reverse()) ffi.release(reference);
}