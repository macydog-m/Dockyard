import { t, translateMessage as msg, getLocale, setLocale, type LanguagePreference } from '../i18n';
import type { LanguageSettings } from '../language';
import React, { useEffect, useRef, useState } from 'react';
import { Folder, FileText, List, Palette, Plus, DotsSixVertical, DotsThree, CaretDown, Eyedropper, Crop, Check, CheckCircle, WarningCircle, Desktop, X, ArrowLeft, ArrowsClockwise, PlugsConnected, Power, Copy, FloppyDisk, TextAa, PencilSimple, Trash, SlidersHorizontal } from '@phosphor-icons/react';
import { ScreenshotEditor } from './ScreenshotEditor';
import { createAnnotationHistory } from './annotations';
import { DesignLibrary, DesignEditor } from './DesignSettings';
import { designCss, fontAiGuide, paletteAiGuide, colorAiGuide, configurationVisibility, isResourceVisible, type ResourceVisibility } from '@dockyard/shared';
import { ColorPanel } from './ColorPanel';
import { ConfigurationPanel } from './ConfigurationPanel';
import { useConfigurationAutosave } from './useConfigurationAutosave';
import { WorkspaceBinding } from './WorkspaceBinding';
import { NotebookPanel, NotebookIcon } from './Notebook';
import { useWindowSurfaces } from './useWindowSurfaces';
import { ToolbarSettings, toolbarItems, toolbarStorageKey, readHiddenTools, type ToolbarItemId } from './ToolbarSettings';
import { createRoot } from 'react-dom/client';
import type { Component, PaletteEntry } from '@dockyard/shared';
import type { DesktopApi, DockState, ComponentInfo, Diagnosis, Progress, Reply, Theme } from '../contracts';
declare global { interface Window { dockyard: DesktopApi } }
import type { ConnectionPlan } from '../codex-connection';
import { agentClients, agentInstructions, createAgentConfig, type AgentClientId } from '../agent-config';
const api = window.dockyard;
document.title = api.isDevelopment ? 'Dockyard · DEV' : 'Dockyard';
const labels = { folder: '文件夹', file: '文件', palette: '色板', instruction: '规则', font: '字体', configuration: '配置' };
const sectionLabels = { ...labels, folder: '素材' };
const resourceTypes: Component['type'][] = ['folder', 'file', 'instruction', 'palette', 'font', 'configuration'];
const glyphs = { folder: <Folder size={21} />, file: <FileText size={21} />, palette: <Palette size={21} />, instruction: <List size={21} />, font: <TextAa size={21} />, configuration: <List size={21} /> };
const statusNames: Record<string, string> = {
  ready: '已就绪', available: '文件可用', missing: '文件已移走', inaccessible: '无法访问',
  not_file: '路径不是文件', INDEX_NOT_READY: '尚未建立索引', INDEX_STALE: '需要刷新',
  INDEX_INVALID: '索引需要修复', INDEX_PARTIAL: '部分文件未能扫描', INDEX_REFRESH_FAILED: '上次刷新失败',
};
const errors: Record<string, string> = {
  INDEX_REFRESH_FAILED: '配置已保存，但文件夹扫描失败。请检查路径或访问权限，再点击刷新。',
  CONFIG_INVALID: '配置无效。请检查必填字段、重复的引用名，以及色值格式。',
  DATA_BUSY: '资源配置正在更新，请稍后重试。',
  DATA_UNAVAILABLE: '无法访问数据目录，请检查权限后重试。',
  LEGACY_DATA: '检测到旧版数据，请先使用迁移工具迁移到新目录。',
  WORKER_UNAVAILABLE: '后台服务已停止，请在“更多”中点击“重启软件”。',
};
function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok && reply.message === 'Remove this resource from its configurations before deleting it.') throw new Error(t('此资源被配置引用，请先在配置中移除引用。'));
  if (!reply.ok) throw new Error(msg(errors[reply.code] ?? reply.message));
  return reply.value;
}
function time(value?: string) { return value ? new Date(value).toLocaleString(getLocale(), { hour12: false }) : t("尚未检查"); }
function makeId(kind: string) { return kind + '-' + crypto.randomUUID().slice(0, 8); }
function split(value: string) { return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean); }

function Dialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); close(); }} aria-label={title}>
    <div className="dialog-head"><h2>{title}</h2><button className="icon-button" aria-label={t("关闭编辑")} onClick={close}><X size={18} /></button></div>
    {children}
  </dialog>;
}

function Editor({ initial, initialType, close, save, busy, errorMessage, components, progress }: {
  initialType?: Component['type']; components: Component[]; progress?: Progress; initial?: Component; errorMessage: string; close: () => void; save: (component: Component) => Promise<boolean>; busy: boolean;
}) {
  const [draftId] = useState(initial?.id ?? makeId('resource'));
  const rawType = initial?.type ?? initialType ?? 'folder';
  const type = rawType === 'font' || rawType === 'configuration' ? 'instruction' : rawType;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial && 'source' in initial ? initial.source.path : '');
  const [key, setKey] = useState(initial && 'key' in initial ? initial.key : '');
  const [content, setContent] = useState(initial?.type === 'instruction' ? initial.content : '');
  const [entries, setEntries] = useState<PaletteEntry[]>(initial?.type === 'palette' ? initial.entries : [{
    key: 'warm-orange', name: t("暖橙色"), value: '#E98C3A', aliases: [], tags: [], metadata: {},
  }]);
  const [error, setError] = useState('');
  async function pick() {
    try {
      const selected = unwrap(await api.pickSource(type === 'folder' ? 'folder' : 'file'));
      if (selected) {
        setSource(selected);
        const basename = selected.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
        if (!name) setName(basename);
        if (!key) setKey(/^(\d+)(?=[_\- .]|$)/.exec(basename)?.[1] ?? '');
      }
    } catch (error) { setError((error as Error).message); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (type === 'instruction' && new TextEncoder().encode(content).length > 16 * 1024) {
      setError(t("规则正文最多 16 KiB，请缩短后保存。")); return;
    }
    if (type === 'palette' && new Set(entries.map(entry => entry.key.trim().toLowerCase())).size !== entries.length) {
      setError(t("颜色引用名重复，请为每个颜色使用不同的引用名。")); return;
    }
    const id = draftId;
    const base = { schemaVersion: 1 as const, revision: initial?.revision ?? 1, id, type, name: name.trim(), description, enabled: initial?.enabled ?? true };
    const metadata = initial && 'metadata' in initial ? initial.metadata : {};
    const named = { key: key.trim() || id, aliases: initial && 'aliases' in initial ? initial.aliases : [], tags: initial && 'tags' in initial ? initial.tags : [], metadata };
    let component: Component;
    if (type === 'folder') component = { ...base, type, source: { path: source }, overrides: initial?.type === 'folder' ? initial.overrides : [] };
    else if (type === 'file') component = { ...base, ...named, type, source: { path: source } };
    else if (type === 'palette') component = { ...base, type, entries };
    else component = { ...base, ...named, type, content };
    if (await save(component)) close();
  }
  return <Dialog title={(initial ? t("编辑") : t("添加")) + msg(sectionLabels[type])} close={() => { if (!busy) close(); }}>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>{t("名称")}<input autoFocus required maxLength={256} value={name} onChange={event => setName(event.target.value)} placeholder={{ folder: t("例如：二维特效素材"), file: t("例如：设计参考文件"), instruction: t("例如：通用开发规范"), palette: t("例如：品牌配色") }[type]} /></label>
        {components.some(item => item.id !== draftId && item.name.trim().toLowerCase() === name.trim().toLowerCase()) && <p className="issue-note">{t("已有同名资源。建议补充区别，避免按名称引用时需要消歧。")}</p>}
        {type === 'palette' && <label>{t("简介")} <span className="optional">{t("可选")}</span><input maxLength={4096} value={description} onChange={event => setDescription(event.target.value)} placeholder={t("帮助你和 AI 了解这里有什么")} /></label>}
        {(type === 'folder' || type === 'file') && <label>{t("来源路径")}<div className="input-action"><input required value={source} onChange={event => setSource(event.target.value)} placeholder={type === 'folder' ? t("选择本地素材文件夹") : t("选择本地文件")} /><button type="button" onClick={pick}>{t("浏览…")}</button></div></label>}
        {type === 'instruction' && <label>{t("规则正文")}<textarea required rows={7} value={content} onChange={event => setContent(event.target.value)} placeholder={t("写下规则正文，保存后可一键复制…")} /><small>{t("最多 16 KiB。")}</small></label>}
        {type === 'palette' && <div className="palette-editor">
          <div className="section-title"><h3>{t("颜色")}</h3><span>{entries.length} {t("个")}</span></div>
          {entries.map((entry, index) => <div className="color-editor" key={index}>
            <input type="color" aria-label={t("颜色选择 ") + (index + 1)} value={/^#[0-9a-f]{6}$/i.test(entry.value) ? entry.value : '#000000'} onChange={event => setEntries(entries.map((value, i) => i === index ? { ...value, value: event.target.value.toUpperCase() } : value))} />
            <div className="color-fields">
              <input required aria-label={t("颜色名称 ") + (index + 1)} placeholder={t("颜色名称")} value={entry.name} onChange={event => setEntries(entries.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} />
              <input required aria-label={t("色值 ") + (index + 1)} pattern="#[0-9a-fA-F]{6}" placeholder="#E98C3A" value={entry.value} onChange={event => setEntries(entries.map((value, i) => i === index ? { ...value, value: event.target.value.toUpperCase() } : value))} />
              <input required aria-label={t("颜色引用名 ") + (index + 1)} placeholder={t("引用名")} value={entry.key} onChange={event => setEntries(entries.map((value, i) => i === index ? { ...value, key: event.target.value } : value))} />
              <input aria-label={t("颜色别名 ") + (index + 1)} placeholder={t("别名，用逗号分隔")} value={entry.aliases.join('，')} onChange={event => setEntries(entries.map((value, i) => i === index ? { ...value, aliases: split(event.target.value) } : value))} />
            </div>
            <button type="button" className="icon-button" aria-label={t("移除颜色 ") + (index + 1)} onClick={() => setEntries(entries.filter((_, i) => i !== index))}><X size={18} /></button>
          </div>)}
          <button type="button" className="text-button" disabled={entries.length >= 1024} onClick={() => setEntries([...entries, { key: makeId('color'), name: '', value: '#E98C3A', aliases: [], tags: [], metadata: {} }])}>{t("＋ 添加颜色")}</button>
        </div>}
        {type === 'folder' && <p className="form-note">{t("添加时建立文件索引。原文件保留在原位置，之后可手动刷新。")}</p>}
      </fieldset>
      {busy && <p className="progress" role="status"><span className="spinner" />{t("正在保存…")}{progress && t(" 已发现 {0} 个文件 · {1} 个目录", [progress.files, progress.directories])}</p>}
      {(error || errorMessage) && <p className="error" role="alert">{error || errorMessage}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={close}>{t("取消")}</button><button className="primary" disabled={busy}>{busy ? t("正在保存…") : t("保存资源")}</button></div>
    </form>
  </Dialog>;
}

function App({ initialTheme, initialLanguage }: { initialTheme: Theme; initialLanguage: LanguageSettings }) {
  const [language, setLanguage] = useState(initialLanguage);
  const [changingLanguage, setChangingLanguage] = useState(false);
  async function changeLanguage(preference: LanguagePreference) {
    if (changingLanguage || busy) return;
    setChangingLanguage(true);
    try {
      const next = unwrap(await api.setLanguage(preference));
      setLocale(next.locale);
      document.documentElement.lang = next.locale;
      setLanguage(next);
      setNotice(''); setError('');
    } catch (error) { setError((error as Error).message); }
    finally { setChangingLanguage(false); }
  }
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const changingTheme = useRef(false);
  async function toggleTheme() {
    if (changingTheme.current) return;
    changingTheme.current = true;
    try {
      const next = unwrap(await api.setTheme(theme === 'dark' ? 'light' : 'dark'));
      document.documentElement.dataset.theme = next;
      setTheme(next);
    } catch (error) { setError((error as Error).message); }
    finally { changingTheme.current = false; }
  }
  const [state, setState] = useState<DockState>();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<Progress>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ initial?: Component; type?: Component['type']; workspaceId?: string; designMode?: boolean; applyOnSave?: boolean }>();
  const [workspaceDialog, setWorkspaceDialog] = useState<'create' | 'rename'>();
  const [workspaceName, setWorkspaceName] = useState('');
  const [remove, setRemove] = useState<Component>();
  const [query, setQuery] = useState('');
  const [diagnosis, setDiagnosis] = useState<Diagnosis>();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [connectionPlan, setConnectionPlan] = useState<ConnectionPlan>();
  const [connectionAgent, setConnectionAgent] = useState<AgentClientId>('codex');
  const [view, setView] = useState<'library' | 'workspace'>('workspace');
  const [showLabels, setShowLabels] = useState(() => localStorage.getItem('dockyard-toolbar-labels') === 'true');
  const [hiddenTools, setHiddenTools] = useState(readHiddenTools);
  const visible = (id: ToolbarItemId) => !hiddenTools.includes(id);
  const hasResources = toolbarItems.some(item => item.group === 'resources' && visible(item.id));
  const hasUtilities = toolbarItems.some(item => item.group === 'utilities' && visible(item.id));
  const toolbarWidth = Math.max(320, 606 - toolbarItems.filter(item => !visible(item.id)).reduce((total, item) => total + item.width, 0) - (hasResources ? 0 : 10) - (hasUtilities ? 0 : 10));
  function changeHiddenTools(next: ToolbarItemId[]) {
    try { localStorage.setItem(toolbarStorageKey, JSON.stringify(next)); setHiddenTools(next); }
    catch { setError(t("无法保存工具栏设置，请重试。")); }
  }
  const [panel, setPanel] = useState<'workspace' | 'resources' | 'color' | 'more' | 'screenshot' | 'fonts' | 'notes' | 'canvas' | 'configuration' | null>(null);
  const [configurationDirty, setConfigurationDirty] = useState(false);
  const [kind, setKind] = useState<Component['type'] | 'all'>('all');
  const [color, setColor] = useState('#E98C3A');
  const [capture, setCapture] = useState<{ dataUrl: string; width: number; height: number }>();
  const [annotationHistory, setAnnotationHistory] = useState(createAnnotationHistory);
  const shell = useRef<HTMLDivElement>(null);
  useWindowSurfaces(shell);
  const modal = !!(editor || workspaceDialog || remove || connectionPlan);
  async function reload() {
    const next = unwrap(await api.state()); setState(next);
    setSelected(current => next.components.some(item => item.component.id === current) ? current : undefined);
    return next;
  }
  const configurationAutosave = useConfigurationAutosave(reload);
  useEffect(() => { reload().catch(error => setError(error.message)); return api.onProgress(setProgress); }, []);
  useEffect(() => {
    if (!state) return;
    const saved = localStorage.getItem('dockyard-color-' + state.activeWorkspaceId);
    setColor(saved && /^#[0-9A-F]{6}$/i.test(saved) ? saved : '#E98C3A');
  }, [state?.activeWorkspaceId]);
  function changeColor(value: string) {
    setColor(value);
    if (state) localStorage.setItem('dockyard-color-' + state.activeWorkspaceId, value);
  }
  useEffect(() => {
    // The native surface shrinks too; invisible desktop-sized windows never remain behind.
    if (panel === 'canvas') { void api.resize(718, 1096, false); return; }
    const barHeight = showLabels ? 94 : 62;
    const height = modal ? 760 : panel === 'configuration' ? 780 : panel === 'notes' ? 659 : panel === 'color' ? 820 : panel === 'resources' ? 778 : panel === 'fonts' ? 860 : panel === 'more' ? (showDiagnostics ? 790 : capture ? 660 : 590) : panel === 'screenshot' ? 780 : panel ? 430 : error || notice || busy ? barHeight + 48 : barHeight;
    void api.resize(height + (panel || modal ? (showLabels ? 32 : 0) : 0), panel === 'notes' ? Math.max(676, toolbarWidth) : panel || modal ? 736 : toolbarWidth, !panel && !modal);
  }, [modal, panel, error, notice, busy, showLabels, toolbarWidth, showDiagnostics, capture]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => api.onBlur(() => { if (!modal && !busy && panel !== 'notes' && panel !== 'canvas' && panel !== 'configuration' && panel !== 'screenshot') { setPanel(null); setNotice(''); } }), [modal, busy, panel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]') && !modal && !busy) { setPanel(null); setError(''); setNotice(''); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [modal, busy]);
  async function run(label: string, operation: () => Promise<Reply>, done = t("已保存")) {
    if (busy) return false;
    setBusy(label); setError(''); setNotice(''); setProgress(undefined);
    try { await configurationAutosave.flush(); unwrap(await operation()); await reload(); setNotice(done); return true; }
    catch (error) { setError((error as Error).message); await reload().catch(() => {}); return false; }
    finally { setBusy(''); setProgress(undefined); }
  }
  function removeResource(value: Component) {
    if (value.type === 'palette' && value.mode !== 'design') {
      void run(t("正在删除色板"), () => api.remove(value.id), t("色板已删除"));
    } else {
      setError(''); setRemove(value);
    }
  }
  function copyRule(rule: Component) {
    if (rule.type === 'instruction') return run(t("正在复制规则"), () => api.copyText(rule.content), t("规则正文已复制"));
  }
  async function restartApp() {
    if (busy) return;
    setBusy(t("正在重启软件")); setError(''); setNotice(''); setProgress(undefined);
    try { await configurationAutosave.flush(); unwrap(await api.restartApp()); }
    catch (error) { setError((error as Error).message); setBusy(''); }
  }
  const workspace = state?.workspaces.find(item => item.id === state.activeWorkspaceId);
  const chosen = new Set(workspace?.componentIds);
  const paused = new Set(workspace?.disabledComponentIds);
  let managed = new Set<string>(), effectiveVisibility: ResourceVisibility = new Map();
  try { if (workspace) ({ managed, visible: effectiveVisibility } = configurationVisibility(workspace, state?.components.map(item => item.component) ?? [])); } catch { /* Keep configuration management available for repairs. */ }
  const scoped = state?.components.filter(({ component }) =>
    (kind === 'all' || component.type === kind) && (view === 'library' || chosen.has(component.id) || managed.has(component.id))) ?? [];
  const filtered = scoped.filter(({ component }) => (component.name + ' ' + msg(sectionLabels[component.type])).toLowerCase().includes(query.toLowerCase()));
  const current = filtered.find(item => item.component.id === selected);
  const component = current?.component;
  const panelLabel = view === 'library' ? t("我的资源") : kind === 'all' ? t("资源") : msg(labels[kind]);
  const resourceCount = (kind === 'all' ? resourceTypes : [kind]).map(type => ({ type, count: scoped.filter(item => item.component.type === type).length }))
    .filter(item => kind !== 'all' || item.count > 0)
    .map(({ type, count }) => t('{0} 个{1}', [count, type === 'palette' ? t('色卡') : getLocale() === 'en' ? msg(labels[type]).toLowerCase() : msg(labels[type])])).join(getLocale() === 'en' ? ', ' : '、');
  async function toggleResource(value: Component, enabled: boolean) {
    if (!workspace || busy) return;
    const target = workspace.id;
    const previous = state!;
    const disabled = new Set(workspace.disabledComponentIds);
    enabled ? disabled.delete(value.id) : disabled.add(value.id);
    setState({ ...previous,
      workspaces: previous.workspaces.map(item => item.id === target ? { ...item, componentIds: [...new Set([...item.componentIds, value.id])], disabledComponentIds: [...disabled] } : item),
      components: previous.components.map(item => item.component.id === value.id && enabled ? { ...item, component: { ...item.component, enabled: true } } : item),
    });
    const success = await run(t("正在保存资源状态"), async () => {
      if (!chosen.has(value.id)) await makeQueryable(value, target);
      if (enabled && !value.enabled) unwrap(await api.save({ ...value, enabled: true }));
      return api.setResourceEnabled(target, value.id, enabled);
    }, enabled ? t("资源已启用") : t("资源已暂停"));
    if (!success) { setState(previous); await reload().catch(() => {}); }
  }
  function toggleMembership(value: Component, included: boolean) {
    if (!workspace || busy) return;
    const ids = new Set(workspace.componentIds);
    included ? ids.add(value.id) : ids.delete(value.id);
    const previous = state!;
    setState({ ...previous, workspaces: previous.workspaces.map(item => item.id === workspace.id ? { ...item, componentIds: [...ids], disabledComponentIds: item.disabledComponentIds?.filter(id => ids.has(id)) } : item) });
    void run(t("正在保存工作区资源"), () => api.select(workspace.id, [...ids]), included ? t("已添加到工作区") : t("已从工作区移除")).then(async success => { if (!success) { setState(previous); await reload().catch(() => {}); } });
  }
  function editResource(value: Component) {
    if (value.type === 'configuration') {
      if (!chosen.has(value.id) || !value.enabled || paused.has(value.id)) { setError(t('请先将配置组件加入当前工作区并启用。')); return; }
      setSelected(value.id); setPanel('configuration'); return;
    }
    if (value.type === 'font' || (value.type === 'palette' && value.mode === 'design')) editDesign(value);
    else { setError(''); setEditor({ initial: value }); }
  }
  const palettes = state?.components.map(item => item.component).filter((c): c is Extract<Component, { type: 'palette' }> => c.type === 'palette') ?? [];
  const defaultPalette = palettes.find(value => value.id === workspace?.design?.paletteId);
  const defaultFonts = state?.components.map(item => item.component).find((value): value is Extract<Component, { type: 'font' }> => value.type === 'font' && value.id === workspace?.design?.fontId);
  function newDesign(type: 'palette' | 'font') { setError(''); setEditor({ type, designMode: true, workspaceId: workspace?.id, applyOnSave: true }); }
  function editDesign(value: Component, applyOnSave = false) {
    setError(''); setEditor({ initial: value, type: value.type, designMode: true,
      ...(applyOnSave ? { workspaceId: workspace?.id, applyOnSave: true } : {}) });
  }
  async function chooseDesign(value: Extract<Component, { type: 'palette' | 'font' }>) {
    if (!workspace) return;
    const target = workspace.id;
    const success = await run(t("正在使用") + (value.type === 'palette' ? t("色彩组合") : t("字体")), async () => {
      if (!state?.components.some(item => item.component.id === value.id)) {
        const saved = await api.save(value); if (!saved.ok) return saved;
      }
      const latest = unwrap(await api.state());
      const targetWorkspace = latest.workspaces.find(item => item.id === target);
      if (!targetWorkspace) throw new Error(t("目标工作区不存在，请重新选择工作区。"));
      const scope = configurationVisibility(targetWorkspace, latest.components.map(item => item.component));
      if (scope.managed.has(value.id) && !isResourceVisible(scope.visible, value.id + '::$scheme')) throw new Error(t('请先在配置中启用此资源或选择完整方案。'));
      return api.setDesign(target, { ...targetWorkspace.design, [value.type === 'palette' ? 'paletteId' : 'fontId']: value.id });
    }, t("已使用：") + value.name);
    if (success && value.type === 'palette') {
      const primary = value.entries.find(entry => entry.role === 'primary') ?? value.entries[0];
      if (primary) changeColor(primary.value.toUpperCase());
    }
  }
  function openDesign(type: 'palette' | 'font') { toggle(type === 'palette' ? 'color' : 'fonts'); }
  async function saveFontSettings(value: Extract<Component, { type: 'font' }>) {
    if (!workspace) return false;
    const target = workspace.id;
    return run(t("正在保存字体设置"), async () => {
      const saved = await api.save(value);
      if (!saved.ok) return saved;
      const latest = unwrap(await api.state());
      const targetWorkspace = latest.workspaces.find(item => item.id === target);
      if (!targetWorkspace) throw new Error(t("目标工作区不存在，请重新选择工作区。"));
      return api.select(target, [...new Set([...targetWorkspace.componentIds, value.id])]);
    }, t("字体设置已保存"));
  }
  async function makeQueryable(value: Component, target: string, requiredRef?: string) {
    if (!state?.components.some(item => item.component.id === value.id)) unwrap(await api.save(value));
    const latest = unwrap(await api.state());
    const targetWorkspace = latest.workspaces.find(item => item.id === target);
    if (!targetWorkspace) throw new Error(t("目标工作区不存在，请重新选择工作区。"));
    if (targetWorkspace.disabledComponentIds?.includes(value.id)) throw new Error(t("资源已暂停，请先勾选启用。"));
    const ids = [...new Set([...targetWorkspace.componentIds, value.id])];
    const components = latest.components.map(item => item.component);
    const { visible } = configurationVisibility({ ...targetWorkspace, componentIds: ids }, components);
    if (requiredRef && !isResourceVisible(visible, requiredRef)) throw new Error(t('请先在配置中启用此资源或选择完整方案。'));
    if (!targetWorkspace.componentIds.includes(value.id)) unwrap(await api.select(target, ids));
    return { components, ids: [...visible.keys()] };
  }
  function nameIsAmbiguous(name: string, queryable: { components: Component[]; ids: string[] }) {
    const matches = (value: { name: string; aliases?: string[] }) =>
      [value.name, ...(value.aliases ?? [])].some(item => item.trim().toLowerCase() === name.trim().toLowerCase());
    let count = 0;
    for (const component of queryable.components.filter(item => item.enabled && queryable.ids.includes(item.id))) {
      if (component.type === 'font' || (component.type === 'palette' && component.mode === 'design')) {
        if (matches(component)) count++;
      }
      if (component.type === 'palette' || component.type === 'font') count += component.entries.filter(matches).length;
      else if (component.type === 'file' || component.type === 'instruction') { if (matches(component)) count++; }
    }
    return count > 1;
  }
  async function copyDesignGuide(value: Extract<Component, { type: 'font' | 'palette' }>) {
    if (!workspace || !value.enabled) return;
    const target = workspace.id;
    const label = value.type === 'font' ? t("字体") : t("颜色组合");
    await run(t("正在复制") + label, async () => {
      const queryable = await makeQueryable(value, target, value.id + '::$scheme');
      const text = value.type === 'font' ? fontAiGuide(value, getLocale()) : paletteAiGuide(value, nameIsAmbiguous(value.name, queryable) ? value.id : undefined, getLocale());
      return api.copyText(text);
    }, label + t("指引已复制，可粘贴给 AI"));
  }
  async function copyColorGuide(name: string, owner?: Extract<Component, { type: 'palette' }>, selectedEntry?: PaletteEntry) {
    if (!workspace) return;
    const target = workspace.id;
    await run(t("正在复制颜色"), async () => {
      let palette = owner;
      let entry = selectedEntry;
      if (!palette?.enabled || !entry || (name && name !== entry.name)) {
        const existing = palette?.enabled && palette.mode !== 'design' ? palette : palettes.find(item => item.enabled && item.mode !== 'design');
        entry = { key: makeId('color'), name: name || t("颜色 ") + color, value: color, aliases: [], tags: [], metadata: {} };
        palette = existing ? { ...existing, entries: [...existing.entries, entry] } : {
          schemaVersion: 1, revision: 1, id: makeId('palette'), name: t("我的色板"), type: 'palette', mode: 'swatches', enabled: true, entries: [entry],
        };
        unwrap(await api.save(palette));
      }
      const ref = palette.id + '::' + entry!.key;
      const queryable = await makeQueryable(palette, target, ref);
      return api.copyText(colorAiGuide(entry!, nameIsAmbiguous(entry!.name, queryable) ? ref : undefined, getLocale()));
    }, t("颜色指引已复制，可粘贴给 AI"));
  }
  function copyDesignCss(text: string) { void run(t("正在复制 CSS"), () => api.copyText(text), t("CSS 已复制")); }
  function toggle(next: typeof panel) {
    if (configurationDirty && next !== 'configuration') { setError(t('请先保存或撤销配置修改。')); setPanel('configuration'); return; }
    setPanel(panel === next ? null : next); setError(''); setNotice('');
  }
  function resources(type: typeof kind = 'all', scope: typeof view = 'workspace') {
    if (configurationDirty) { setError(t('请先保存或撤销配置修改。')); setPanel('configuration'); return; }
    setKind(type); setQuery(''); setSelected(undefined); setView(scope); setPanel('resources');
  }
  function addResource(type: Component['type']) {
    if (type === 'configuration') { setPanel('configuration'); return; }
    setError('');
    setEditor({ type, workspaceId: state?.activeWorkspaceId });
  }
  async function saveResource(value: Component) {
    const target = editor?.workspaceId;
    const applyOnSave = editor?.applyOnSave;
    const success = await run(t("正在保存") + msg(sectionLabels[value.type]), async () => {
      const saved = await api.save(value);
      if (!saved.ok || !target) return saved;
      const latest = unwrap(await api.state());
      const targetWorkspace = latest.workspaces.find(item => item.id === target);
      if (applyOnSave && targetWorkspace) {
        const result = await api.setDesign(target, { ...targetWorkspace.design, [value.type === 'palette' ? 'paletteId' : 'fontId']: value.id });
        if (!result.ok) throw new Error(t("方案已保存，但使用失败。请在方案列表中双击使用。"));
        return result;
      }
      const ids = targetWorkspace?.componentIds;
      if (!ids) throw new Error(t("资源已保存，但目标工作区不存在。请在我的资源中重新选择。"));
      const joined = await api.select(target, [...new Set([...ids, value.id])]);
      if (!joined.ok) throw new Error(t("资源已保存，但加入组合失败。可重试保存，或在我的资源中勾选。"));
      return joined;
    }, applyOnSave ? t("已保存并使用") : t("资源已保存"));
    if (success) {
      setSelected(value.id); setQuery('');
      if (applyOnSave && value.type === 'palette') {
        const primary = value.entries.find(entry => entry.role === 'primary') ?? value.entries[0];
        if (primary) changeColor(primary.value.toUpperCase());
      }
    }
    return success;
  }
  async function screenTool(mode: 'color' | 'screenshot') {
    if (busy) return;
    setBusy(mode === 'color' ? t("正在屏幕取色") : t("正在框选截图")); setError(''); setNotice(''); setPanel(null);
    try {
      const result = unwrap(await api.capture(mode));
      if (result?.kind === 'color') { changeColor(result.value); setPanel('color'); setNotice(t("已更新当前色")); }
      if (result?.kind === 'screenshot') {
        setCapture(result); setAnnotationHistory(createAnnotationHistory()); setPanel('screenshot'); setBusy(t("正在缓存并复制截图"));
        const failures: string[] = [];
        // Copy first so a slow disk or unavailable workspace never prevents pasting.
        for (const action of ['copy', 'resource'] as const) {
          try { unwrap(await api.screenshotAction(action)); }
          catch (e) { failures.push((action === 'copy' ? t("复制失败：") : t("缓存或工作区登记失败：")) + (e as Error).message); }
        }
        await reload().catch(e => failures.push(t("资源列表刷新失败：") + (e as Error).message));
        if (failures.length) { setError(failures.join('；')); setPanel('screenshot'); }
        else { setPanel('screenshot'); setNotice(t("截图已缓存并复制，可直接粘贴或继续标注")); }
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }
  async function saveColor(name: string, paletteId?: string) {
    const existing = palettes.find(p => p.id === paletteId);
    const entry: PaletteEntry = { key: makeId('color'), name, value: color, aliases: [], tags: [], metadata: {} };
    const palette: Component = existing ? { ...existing, entries: [...existing.entries, entry] } : {
      schemaVersion: 1, revision: 1, id: makeId('palette'), name: t("我的色板"), type: 'palette', enabled: true, entries: [entry],
    };
    return run(t("正在保存颜色"), async () => {
      unwrap(await api.save(palette));
      if (workspace) await makeQueryable(palette, workspace.id);
      return { ok: true, value: palette };
    }, t("颜色已保存到色板"));
  }
  async function screenshotAction(action: 'copy' | 'save' | 'resource', dataUrl?: string) {
    let message = '';
    const success = await run(t("正在处理截图"), async () => {
      const result = await api.screenshotAction(action, dataUrl);
      if (result.ok) message = result.value ? msg(result.value) : t("已取消保存");
      return result;
    }, '');
    if (success) setNotice(message);
  }
  async function refresh(id: string) {
    let message = t("索引已更新");
    const success = await run(t("正在扫描文件夹"), async () => {
      const result = await api.refresh(id);
      if (result.ok) {
        const report = result.value;
        message = report.status === 'ready' ? t("扫描完成，共 ") + report.files + t(" 个文件")
          : report.status === 'partial' ? t("扫描完成，") + report.errors + t(" 项未能读取")
          : t("刷新失败，已保留上次索引。请检查来源路径和访问权限。");
      }
      return result;
    }, '');
    if (success) setNotice(message);
  }
  const glassTone = editor ? editor.initial?.type ?? editor.type ?? 'folder'
    : workspaceDialog ? 'workspace' : connectionPlan ? 'more' : remove ? remove.type
    : panel === 'resources' ? kind : panel ?? 'idle';
  return <div className={'shell' + (modal ? ' has-modal' : '') + (showLabels ? ' show-tool-labels' : '') + (panel === 'canvas' ? ' has-notebook-canvas' : '')} data-glass-tone={glassTone} ref={shell} onPointerDown={e => { if (e.target === e.currentTarget && !modal && !busy && panel !== 'notes' && panel !== 'canvas') setPanel(null); }}>
    <div className="dock-bar" style={{ width: toolbarWidth - 16 }} role="toolbar" aria-label={t("Dockyard 小组件")}>
      <div className="drag-handle" title={t("拖动小组件")}><DotsSixVertical size={17} /></div>
      <button type="button" className="dock-brand" aria-label={theme === 'dark' ? t("切换到白天模式") : t("切换到黑夜模式")} title={`${api.isDevelopment ? `${t('开发版')} · ` : ''}${theme === 'dark' ? t("切换到白天模式") : t("切换到黑夜模式")}`} onClick={() => void toggleTheme()}>{api.isDevelopment ? <span className="development-mark" aria-hidden="true">DEV</span> : <img src="../assets/icon.png" alt="" aria-hidden="true" draggable={false} width={28} height={28} />}</button>
      <button className={'workspace-trigger ' + (panel === 'workspace' ? 'active' : '')} aria-label={t("预设工作区")} aria-expanded={panel === 'workspace'} disabled={!state || !!busy} onClick={() => toggle('workspace')} title={workspace?.name}><Desktop size={18} /><span>{workspace?.name ?? t("载入中")}</span><CaretDown size={13} /></button>
      {visible('configuration') && <button className={'tool-button configuration-trigger ' + (panel === 'configuration' ? 'active' : '')} aria-label={t('配置')} title={t('配置')} aria-expanded={panel === 'configuration'} disabled={!workspace || !!busy} onClick={() => toggle('configuration')}><SlidersHorizontal size={21} /><span className="tool-label">{t('配置')}</span></button>}
      {hasResources && <span className="divider" />}
      {visible('notes') && <button className={'tool-button ' + (panel === 'notes' ? 'active' : '')} aria-label={t("记事本")} title={t("记事本")} aria-expanded={panel === 'notes' || panel === 'canvas'} disabled={!workspace || !!busy} onClick={() => toggle('notes')}><NotebookIcon name="noteimgNotebookPen" /><span className="tool-label">{t("记事本")}</span></button>}
      {hasUtilities && <span className="divider" />}
      {visible('fonts') && <button className={'tool-button ' + (panel === 'fonts' ? 'active' : '')} aria-label={t("字体")} title={t("字体 · ") + (defaultFonts?.name ?? t("未选择"))} aria-expanded={panel === 'fonts'} disabled={!state || !!busy} onClick={() => openDesign('font')}>{glyphs.font}<span className="tool-label">{t("字体")}</span></button>}
      {visible('color') && <button className={'current-color ' + (panel === 'color' ? 'active' : '')} aria-label={t("当前色与色盘")} title={t("颜色 · ") + (defaultPalette?.name ?? t("选色与色彩组合"))} aria-expanded={panel === 'color'} disabled={!state || !!busy} onClick={() => toggle('color')}><span className="color-dot" style={{ background: color }} /><code>{color}</code><CaretDown size={12} /></button>}
      {visible('eyedropper') && <button className="tool-button" aria-label={t("屏幕吸色器")} title={t("屏幕吸色器")} disabled={!!busy} onClick={() => void screenTool('color')}><Eyedropper size={21} /><span className="tool-label">{t("吸色")}</span></button>}
      {visible('screenshot') && <button className={'tool-button ' + (panel === 'screenshot' ? 'active' : '')} aria-label={t("截图")} aria-expanded={panel === 'screenshot'} title={panel === 'screenshot' ? t("关闭") + t("截图") + t("面板") : t("框选截图")} disabled={!!busy} onClick={() => panel === 'screenshot' ? toggle('screenshot') : void screenTool('screenshot')}><Crop size={21} /><span className="tool-label">{t("截图")}</span></button>}
      {(hasResources || hasUtilities) && <span className="divider" />}
      <button className={'tool-button ' + (panel === 'more' ? 'active' : '')} aria-label={t("更多")} title={t("设置")} aria-expanded={panel === 'more'} onClick={() => toggle('more')}><DotsThree size={24} weight="bold" /><span className="tool-label">{t("更多")}</span></button>
      <button className="label-toggle" role="switch" aria-checked={showLabels} aria-label={t("显示工具标签")} onClick={() => setShowLabels(value => { localStorage.setItem('dockyard-toolbar-labels', String(!value)); return !value; })}>{t("标签")}<span className="switch-track"><span /></span></button>
    </div>
    {(busy || error || notice) && <div className={'feedback ' + (error ? 'has-error' : '')} aria-live="polite">{busy ? <span className="progress"><span className="spinner" />{busy}{progress && t(" · {0} 个文件", [progress.files])}</span> : error ? <><WarningCircle className="feedback-symbol" size={17} aria-hidden="true" /><span role="alert">{error}</span></> : <><CheckCircle className="feedback-symbol" size={17} aria-hidden="true" /><span>{notice}</span></>}{!busy && <button aria-label={t("关闭提示")} className="icon-button" onClick={() => { setError(''); setNotice(''); }}><X size={14} /></button>}</div>}
    {workspace && <NotebookPanel key={'notebook-' + workspace.id} workspaceId={workspace.id} workspaceName={workspace.name} view={panel === 'notes' || panel === 'canvas' ? panel : null} changeView={setPanel} close={() => setPanel(null)} />}
    {workspace && <ConfigurationPanel key={'configuration-' + workspace.id} workspace={workspace} components={state?.components.map(item => item.component) ?? []} visible={panel === 'configuration'} busy={!!busy} run={run} close={() => setPanel(null)} autosave={configurationAutosave} dirty={configurationDirty} dirtyChanged={setConfigurationDirty} selected={selected} select={setSelected} manage={() => resources('all', 'library')} />}
    {panel === 'workspace' && <section className="popover workspace-popover" aria-label={t("预设工作区面板")}>
      <div className="panel-heading"><h2>{t("预设工作区")}</h2></div>
      <div className="workspace-list">{state?.workspaces.map(item => <button key={item.id} className={'workspace-row ' + (item.id === state.activeWorkspaceId ? 'chosen' : '')} disabled={!!busy} onClick={() => void run(t("正在切换工作区"), () => api.switchWorkspace(item.id), t("工作区已切换"))}>
        <span className="workspace-check">{item.id === state.activeWorkspaceId && <Check size={18} />}</span><Desktop size={24} /><span><strong>{item.name}</strong><small>{item.componentIds.length} {t("个资源组件")}</small></span></button>)}</div>
      <button className="inline-add workspace-add" disabled={!!busy} onClick={() => { setWorkspaceName(''); setWorkspaceDialog('create'); }}><Plus size={18} />{t("新建工作区")}</button>

      {workspace && <WorkspaceBinding key={workspace.id} workspaceId={workspace.id} />}
      <div className="popover-foot"><button disabled={!!busy || !workspace} onClick={() => { setWorkspaceName(workspace!.name); setWorkspaceDialog('rename'); }}>{t("重命名")}</button><button onClick={() => resources('all', 'library')}>{t("管理资源")}</button></div>
    </section>}
    {panel === 'resources' && <section className="popover resources-popover" aria-label={t("资源面板")}>
      <div className="panel-heading"><h2>{panelLabel}</h2><button className="icon-button" aria-label={t("关闭") + panelLabel + t("面板")} onClick={() => setPanel(null)}><X size={18} /></button></div>
      <div className="resource-workspace"><Desktop size={16} /><strong>{workspace?.name}</strong><span>{t("工作区 ·")} {workspace?.componentIds.length ?? 0} {t("个资源组件")}</span><small>{view === 'library' ? t("勾选加入当前工作区") : t("勾选启用资源")}</small></div>
      <div className="list-toolbar"><input className="filter" type="search" aria-label={t("筛选资源")} placeholder={t("搜索名称…")} value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className={'dock-panel' + (!scoped.length ? ' is-empty' : '')}>
        <section className="resource-section">
          <div className="resource-list">
            {!filtered.length && query && <div className="empty"><h3>{t("没有匹配的资源")}</h3><button onClick={() => setQuery('')}>{t("清除搜索")}</button></div>}
            {(kind === 'all' ? resourceTypes : [kind]).map(type => {
              const items = filtered.filter(item => item.component.type === type);
              if (!items.length && query) return null;
              return <section className="resource-group" key={type} aria-label={msg(sectionLabels[type])}>
                <div className="resource-group-heading"><h3>{msg(labels[type])} <span>{items.length}</span></h3><button className="small-button" disabled={!state || !!busy} onClick={() => addResource(type)}><Plus size={14} />{t("添加")}{msg(sectionLabels[type])}</button></div>
                {items.map(item => {
                  const value = item.component;
                  const inspected = current?.component.id === value.id;
                  const controlled = managed.has(value.id);
                  const enabled = value.enabled && !paused.has(value.id) && (!controlled || effectiveVisibility.has(value.id));
                  return <article key={value.id} data-resource-id={value.id} className={'resource-row' + (inspected ? ' selected' : '') + (!enabled && chosen.has(value.id) ? ' paused' : '')}>
                    <button className="resource-button" aria-pressed={inspected} onClick={() => setSelected(value.id)}>
                      <span className={'resource-icon ' + value.type}>{value.type === 'palette' ? <span className="resource-swatches">{value.entries.slice(0, 3).map(entry => <i key={entry.key} style={{ background: entry.value }} />)}</span> : glyphs[value.type]}</span>
                      <span className="resource-title"><strong>{value.name}</strong><small>{msg(labels[value.type])} · {item.count === null ? t("待建立索引") : item.count + (value.type === 'palette' ? t(" 个颜色") : value.type === 'instruction' ? t(" 条规则") : value.type === 'configuration' ? t(' 个配置') : value.type === 'font' ? t(" 个字体用途") : t(" 个文件"))}</small></span>
                      <span className={'status ' + (!['ready', 'available'].includes(item.status) ? 'warning' : '')}>{controlled ? !enabled ? t('配置中已关闭') : effectiveVisibility.get(value.id) !== null ? t('仅所选资源可用') : t('已启用') : !enabled && chosen.has(value.id) ? t("已暂停") : msg(statusNames[item.status] ?? item.status)}</span>
                    </button>
                    {controlled && view !== 'library' ? <div className="resource-membership"><span>{t('由配置控制')}</span><button disabled={!!busy} onClick={() => toggle('configuration')}>{t('在配置中调整')}</button></div> : <div className="resource-membership"><label><input type="checkbox" aria-label={t("选择 ") + value.name} title={view === 'library' ? t("加入工作区") : t("启用资源")} disabled={!!busy} checked={view === 'library' ? chosen.has(value.id) : enabled}
                      onChange={event => view === 'library' ? toggleMembership(value, event.target.checked) : void toggleResource(value, event.target.checked)} /><span>{view === 'library' ? (chosen.has(value.id) ? t("已加入工作区") : t("加入工作区")) : enabled ? t("已启用") : t("未启用")}</span></label><span>{controlled ? t('由配置控制') : chosen.has(value.id) ? workspace?.name : t("未加入")}</span></div>}
                    {(inspected || value.type === 'instruction') && <div className="resource-actions">
                      {value.type === 'instruction' && <button className="icon-button rule-copy" aria-label={t("复制正文：") + value.name} title={t("复制正文")} disabled={!!busy} onClick={() => void copyRule(value)}><Copy size={15} /></button>}
                      {inspected && <>
                        {(value.type === 'font' || (value.type === 'palette' && value.mode === 'design')) && <button className="icon-button" aria-label={t("复制 CSS")} title={t("复制 CSS")} disabled={!!busy} onClick={() => copyDesignCss(value.type === 'font' ? designCss(undefined, value) : designCss(value))}><Copy size={15} /></button>}
                        <button className="icon-button" aria-label={t("编辑资源")} title={t("编辑")} disabled={!!busy} onClick={() => editResource(value)}><PencilSimple size={15} /></button>
                        <button className="icon-button danger" aria-label={t("删除资源")} title={t("删除")} disabled={!!busy} onClick={() => removeResource(value)}><Trash size={15} /></button>
                        {value.type === 'folder' && <button className="icon-button" aria-label={t("刷新索引")} title={t("刷新索引")} disabled={!!busy} onClick={() => void refresh(value.id)}><ArrowsClockwise size={15} /></button>}
                      </>}
                    </div>}
                  </article>;
                })}
                {!items.length && <div className="resource-empty"><Folder size={16} /><span>{t("暂无")}{msg(sectionLabels[type])}{t("，添加后可在此启用。")}</span></div>}
              </section>;
            })}
          </div>

        </section>
        {scoped.length > 0 && <aside className="detail" aria-label={t("预览")}>
          <span className="detail-type">{t("预览")}</span>
          {component && current ? <>
            <div className={'detail-icon resource-icon ' + component.type}>{glyphs[component.type]}</div>
            <h2>{component.name}</h2>{component.description && <p className="description">{component.description}</p>}
            {'source' in component && <div className="detail-block"><label>{t("来源")}</label><p className="path">{component.source.path}</p></div>}
            {component.type === 'palette' && <div className="swatches">{component.entries.slice(0, 8).map(entry => <div key={entry.key}><span style={{ background: entry.value }} /><strong>{entry.name}</strong><code>{entry.value.toUpperCase()}</code></div>)}{component.entries.length > 8 && <small>{t("还有")} {component.entries.length - 8} {t("个颜色 · 编辑查看")}</small>}</div>}
            {component.type === 'font' && <div className="font-summary">{component.entries.map(entry => <p key={entry.key}><strong>{entry.name}</strong><span>{entry.family} · {entry.weight}</span></p>)}</div>}
            {component.type === 'instruction' && <div className="rule-preview">{component.content}</div>}
            <div className="detail-block"><label>{t("状态")}</label><p className={!['ready', 'available'].includes(current.status) ? 'warning-text' : ''}>{!component.enabled || paused.has(component.id) ? t("已暂停") : msg(statusNames[current.status] ?? current.status)}</p>{component.type === 'folder' && <small>{t("上次索引：")}{time(current.builtAt)}{current.errors ? ' · ' + current.errors + t(" 项未能读取") : ''}{current.skipped ? t(" · 跳过 ") + current.skipped + t(" 项") : ''}</small>}</div>
            {!['ready', 'available'].includes(current.status) && <p className="issue-note">{t("检查来源是否仍在原位置、是否有访问权限。文件夹修复后请刷新索引。")}</p>}
          </> : <div className="detail-placeholder"><p>{t("选择一个资源查看预览")}</p></div>}
        </aside>}
      </div>
      <div className="resource-footer"><span>{t("当前有")} {resourceCount || t("0 个资源")}</span><span>{t("保存在你的电脑")}</span></div>
    </section>}
    {(panel === 'color' || panel === 'fonts') && <DesignLibrary key={panel} type={panel === 'color' ? 'palette' : 'font'} components={state?.components.map(item => item.component) ?? []} workspace={workspace} busy={!!busy}
      create={newDesign} edit={value => editDesign(value, !state?.components.some(item => item.component.id === value.id))} remove={removeResource}
      enable={(value, enabled) => void toggleResource(value, enabled)} choose={value => void chooseDesign(value)} defaults={design => { if (workspace) void run(t("正在保存默认方案"), () => api.setDesign(workspace.id, design), t("当前工作区的设计方案已更新")); }}
      saveFonts={saveFontSettings} copy={copyDesignCss} copyGuide={value => void copyDesignGuide(value)} close={() => setPanel(null)}
      picker={panel === 'color' ? previewPalette => <ColorPanel value={color} change={changeColor} palettes={palettes.filter(item => chosen.has(item.id) && item.enabled && !paused.has(item.id) && item.mode !== 'design')} previewPalette={previewPalette}
        busy={!!busy} save={saveColor} manage={id => { setError(''); const palette = palettes.find(p => p.id === id); setEditor({ initial: palette, type: 'palette' }); }}
        remove={removeResource}
        copy={() => void run(t("正在复制"), () => api.copyText(color), t("色值已复制"))} copyAi={(name, owner, entry) => void copyColorGuide(name, owner, entry)} /> : undefined} />}
    {panel === 'screenshot' && capture && <section className="popover screenshot-popover" aria-label={t("截图预览")}>
      <div className="panel-heading"><h2>{t("截图")}</h2><span className="muted">{capture.width} × {capture.height} px</span><button className="small-button" disabled={!!busy} onClick={() => void screenTool('screenshot')}><Crop size={16} />{t("重新截图")}</button><button className="icon-button" aria-label={t("关闭") + t("截图") + t("面板")} disabled={!!busy} onClick={() => toggle('screenshot')}><X size={18} /></button></div>
      <ScreenshotEditor capture={capture} history={annotationHistory} change={setAnnotationHistory} busy={!!busy} action={(action, dataUrl) => void screenshotAction(action, dataUrl)} />
    </section>}
    {panel === 'more' && <section className="popover more-popover" aria-label={t("更多面板")}>
      <div className="panel-heading"><h2>{t("设置")}</h2><span className="muted">{t("你的资源，随时待命")}</span></div>
      <label className="language-setting"><span>{t('语言 / Language')}</span><select aria-label="Language / 语言" value={language.preference} disabled={changingLanguage || !!busy} onChange={event => void changeLanguage(event.target.value as LanguagePreference)}>
        <option value="system">{t('跟随系统')}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
      </select></label>
      <ToolbarSettings hidden={hiddenTools} change={changeHiddenTools} />
      <div className="more-actions"><button disabled={!!busy} onClick={() => void restartApp()} title={t("开发版会先构建最新代码，再重新启动 Dockyard")}><ArrowsClockwise size={19} />{t("重启软件")}</button></div>
      {capture && <button className="recent-capture" disabled={!!busy} onClick={() => setPanel('screenshot')}><img src={capture.dataUrl} alt="" /><span>{t("最近截图")}<small>{capture.width} × {capture.height} {t("px · 预览、另存或重新复制")}</small></span></button>}
      <section className="connection">
        <div className="connection-icon"><PlugsConnected size={22} /></div><div className="connection-copy"><strong>{t("在 Agent 中使用")}</strong><p>{diagnosis ? (diagnosis.selfTest === 'passed' ? t("本地自检通过") : t("本地自检未通过")) + t(" · 检查于 ") + time(diagnosis.checkedAt) : t("连接 Codex、Claude、Antigravity 或 Cursor，按需调用本地资源。")}</p></div>
        <button className="primary" disabled={!!busy} onClick={() => void run(t("正在检查连接配置"), async () => {
          const reply = await api.connectionPlan(); if (reply.ok) setConnectionPlan(reply.value); return reply;
        }, '')}>{t("连接 Agent")}</button>
        <button disabled={!!busy} onClick={async () => {
          setShowDiagnostics(true);
          await run(t("正在运行本地自检"), async () => {
            const reply = await api.diagnose();
            if (reply.ok) setDiagnosis(reply.value);
            return reply;
          }, t("检查完成"));
        }}>{t("检查连接")}</button><button className="icon-button" aria-label={t("显示连接详情")} onClick={() => setShowDiagnostics(!showDiagnostics)}>{showDiagnostics ? '−' : '+'}</button>
      </section>
      {showDiagnostics && <div className="diagnostic-details">
        <p><strong>{t("Codex 配置：")}</strong>{diagnosis ? ({ matching: t("启动程序、参数与环境匹配"), other: t("已配置，但启动方式不同或已停用"), missing: t("尚未配置 Dockyard"), unavailable: t("暂时无法检查 Codex 配置") }[diagnosis.registration]) : t("尚未检查")}</p>
        <p><strong>{t("本地查询自检：")}</strong>{diagnosis ? diagnosis.selfTest === 'passed' ? t("通过") : t("失败") : t("尚未检查")}</p>
        <p>{diagnosis?.message ? msg(diagnosis.message) : t("自检只检查独立查询进程，不代表 Agent 当前会话已连接。")}</p>
        <small>{t("配置完成后，在所选 Agent 中刷新 MCP 或开启新会话，并确认 dockyard 工具可用。")}</small>
        <p className="data-location">{t("数据目录：")}{state?.dataDir}</p>
      </div>}

      <div className="popover-foot"><span className="muted">{t("保存在你的电脑 · 默认置顶")}</span><button disabled={!!busy} className="danger" onClick={() => void api.close()}><Power size={16} />{t("退出 Dockyard")}</button></div>
    </section>}
    {connectionPlan && <Dialog title={t("连接 Agent")} close={() => { if (!busy) setConnectionPlan(undefined); }}>
      <label className="agent-setting">{t("选择 Agent")}<select aria-label={t("选择 Agent")} disabled={!!busy} value={connectionAgent} onChange={event => { setConnectionAgent(event.target.value as AgentClientId); setError(''); }}>
        {agentClients.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select></label>
      {connectionAgent === 'codex' ? <>
      <p className="connection-summary">{msg(connectionPlan.message)}</p>
      <p className="form-note">{t("仅更新名为 dockyard 的服务。操作前保留完整配置备份；其他 MCP 服务由 Codex CLI 保留。")}</p>
      {connectionPlan.status === 'conflict' && connectionPlan.current && <div className="connection-config"><strong>{t("当前配置")}</strong>
        <pre>{JSON.stringify(connectionPlan.current, null, 2)}</pre>
      </div>}
      <p className="form-note path">{t("资源数据目录：")}{connectionPlan.desired.args.at(-1)}</p><details className="connection-config" open={connectionPlan.status === 'unavailable' || connectionPlan.status === 'conflict'}><summary>{t("配置详情与手动复制")}</summary>
        <textarea aria-label={t("可复制的 Codex 配置")} readOnly rows={7} value={connectionPlan.manualConfig} onFocus={event => event.currentTarget.select()} />
        <small className="path">{t("配置文件：")}{connectionPlan.configPath}</small>
      </details>
      {connectionPlan.status === 'unavailable' && <p className="issue-note">{t("安装或更新 Codex 后重新打开 Dockyard；也可复制上方内容合并到配置文件。已有同名条目时请替换该条目，不要重复添加。")}</p>}
      {connectionPlan.status === 'matching' && <p className="success">{t("配置已匹配。请在 Codex 中重新启动 MCP 或开启新会话，再尝试“查看我的资源”或“查找暖橙色”。")}</p>}
      {connectionPlan.backup && <div className="backup-note"><p className="form-note path">{t("恢复备份：")}{connectionPlan.backup.path}</p>
        {connectionPlan.backup.restorable ? <button disabled={!!busy} onClick={() => void run(t("正在恢复连接前的配置"), async () => {
          const reply = await api.restoreConnection(connectionPlan.backup!.id);
          if (reply.ok) { setConnectionPlan(reply.value); setDiagnosis(undefined); } return reply;
        }, t("已恢复连接前的配置"))}>{t("恢复连接前的配置")}</button> : <p className="form-note">{t("备份已保留；当前配置有后续变化或已恢复，自动恢复不可用。")}</p>}
      </div>}
      </> : <>
        <p className="connection-summary">{t(agentInstructions[connectionAgent])}</p>
        <div className="connection-config"><textarea aria-label={t("可复制的 Agent 配置")} readOnly rows={10} value={createAgentConfig(connectionAgent, connectionPlan.desired)} onFocus={event => event.currentTarget.select()} /></div>
        <p className="form-note">{t("保留已有服务，将 dockyard 条目合并到 mcpServers；已有同名条目时替换该条目。")}</p>
        <p className="form-note">{t("在 Agent 中确认 dockyard 提供 get、search、context，然后尝试“查看我的资源”。")}</p>
      </>}
      {diagnosis && <p className={diagnosis.selfTest === 'passed' ? 'success' : 'error'}>{t("最近本地自检：")}{diagnosis.selfTest === 'passed' ? t("通过") : t("失败")} · {time(diagnosis.checkedAt)}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {connectionAgent === 'codex' ? <button disabled={!!busy} onClick={() => void run(t("正在重新检查配置"), async () => { const reply = await api.connectionPlan(); if (reply.ok) setConnectionPlan(reply.value); return reply; }, '')}>{t("重新检查")}</button>
          : <button disabled={!!busy} onClick={() => void run(t("正在运行本地自检"), async () => { const reply = await api.diagnose(); if (reply.ok) setDiagnosis(reply.value); return reply; }, t("检查完成"))}>{t("本地自检")}</button>}
        <button disabled={!!busy} onClick={() => setConnectionPlan(undefined)}>{t("关闭")}</button>
        {connectionAgent !== 'codex' ? <button className="primary" disabled={!!busy} onClick={() => void run(t("正在复制"), () => api.copyText(createAgentConfig(connectionAgent, connectionPlan.desired)), t("配置已复制"))}><Copy size={16} />{t("复制配置")}</button>
          : connectionPlan.status !== 'unavailable' && <button className="primary" disabled={!!busy} onClick={() => void run(t("正在配置并自检"), async () => {
          const reply = await api.connectCodex(connectionPlan.token, connectionPlan.status === 'conflict');
          if (reply.ok) { setConnectionPlan(reply.value.plan); setDiagnosis(reply.value.diagnosis); setShowDiagnostics(true); } return reply;
        }, t("连接配置已检查，请在 Codex 中重新发现工具"))}>{busy ? t("正在处理…") : connectionPlan.status === 'conflict' ? t("备份并替换配置") : connectionPlan.status === 'matching' ? t("保留配置并自检") : t("添加连接并自检")}</button>}
      </div>
    </Dialog>}
    {editor && (editor.type === 'font' || editor.initial?.type === 'font' || editor.designMode || (editor.initial?.type === 'palette' && editor.initial.mode === 'design')) ? <Dialog title={(editor.initial ? t("编辑") : t("新建")) + (editor.type === 'font' || editor.initial?.type === 'font' ? t("字体") : t("色彩组合"))} close={() => { if (!busy) setEditor(undefined); }}>
      <DesignEditor initial={editor.initial?.type === 'palette' || editor.initial?.type === 'font' ? editor.initial : undefined}
        type={editor.type === 'font' || editor.initial?.type === 'font' ? 'font' : 'palette'} palette={defaultPalette} fonts={defaultFonts}
        components={state?.components.map(item => item.component) ?? []} busy={!!busy} errorMessage={error} save={saveResource} close={() => setEditor(undefined)}
        pick={async () => unwrap(await api.pickSource('file'))} copy={copyDesignCss} saveLabel={editor.applyOnSave ? t("保存并使用") : t("保存方案")} currentColor={color} />
    </Dialog> : editor && <Editor initialType={editor.type} initial={editor.initial} components={state?.components.map(item => item.component) ?? []} progress={progress} errorMessage={error} busy={!!busy} close={() => setEditor(undefined)} save={saveResource} />}
    {workspaceDialog && <Dialog title={workspaceDialog === 'create' ? t("新建工作区") : t("重命名工作区")} close={() => { if (!busy) setWorkspaceDialog(undefined); }}>
      <form onSubmit={async event => {
        event.preventDefault();
        const success = await run(t("正在保存工作区"), () => workspaceDialog === 'create' ? api.createWorkspace(workspaceName) : api.renameWorkspace(state!.activeWorkspaceId, workspaceName), workspaceDialog === 'create' ? t("工作区已创建，可在预设列表切换") : t("工作区名称已更新"));
        if (success) setWorkspaceDialog(undefined);
      }}><label>{t("工作区名称")}<input autoFocus required maxLength={256} disabled={!!busy} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} /></label><p className="form-note">{t("未绑定的查询跟随全局工作区；固定绑定的查询保持原工作区。")}</p>{error && <p className="error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" disabled={!!busy} onClick={() => setWorkspaceDialog(undefined)}>{t("取消")}</button><button className="primary" disabled={!!busy}>{t("保存工作区")}</button></div></form>
    </Dialog>}
    {remove && <Dialog title={t("移除资源")} close={() => { if (!busy) setRemove(undefined); }}>
      <p>{t("将“")}{remove.name}{t("”从 My Dock 和所有工作区移除。原始文件会保留。")}</p>
      {error && <p className="error" role="alert">{error}</p>}<div className="dialog-actions"><button disabled={!!busy} onClick={() => setRemove(undefined)}>{t("取消")}</button><button className="danger-button" disabled={!!busy} onClick={async () => { if (await run(t("正在移除资源"), () => api.remove(remove.id), t("已移除，原始文件保留"))) setRemove(undefined); }}>{t("确认移除")}</button></div>
    </Dialog>}
    {(editor || workspaceDialog || remove) && error && <div className="modal-error" role="alert">{error}</div>}
  </div>;
}
// Resolve the persisted native preference before the first React paint.
void Promise.all([api.getTheme(), api.getLanguage()]).then(([themeReply, languageReply]) => {
  const language = unwrap(languageReply);
  setLocale(language.locale);
  document.documentElement.lang = language.locale;
  const theme = unwrap(themeReply);
  document.documentElement.dataset.theme = theme;
  createRoot(document.getElementById('root')!).render(<App initialTheme={theme} initialLanguage={language} />);
}).catch(() => {
  document.getElementById('root')!.textContent = t("界面加载失败，请重新打开 Dockyard。");
});
