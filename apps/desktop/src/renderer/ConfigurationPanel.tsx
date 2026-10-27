import React, { useId, useState } from 'react';
import { Plus, Trash, X } from '@phosphor-icons/react';
import {
  getConfigurationState, configurationComponentSchema, initialConfigurationState, resolveConfigurationValues,
  type Component, type Workspace, type ConfigurationValues, type ConfigurationAction, type ConfigItem, type ConfigurationComponent,
} from '@dockyard/shared';
import { t } from '../i18n';
import type { Reply } from '../contracts';
import type { ConfigurationAutosave } from './useConfigurationAutosave';
import { ConfigurationContent } from './ConfigurationContent';

type Run = (message: string, operation: () => Promise<Reply>, success: string) => Promise<boolean>;
function SingleChoice({ label, options, value, disabled, change }: {
  label: string; options: { id: string; name: string }[]; value: string; disabled: boolean; change: (id: string) => void;
}) {
  const name = useId();
  return <fieldset className="configuration-choices" disabled={disabled}>
    <legend>{label}</legend>
    <div className="configuration-choice-list">{options.map(option => <label className="configuration-choice" key={option.id}>
      <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => change(option.id)} />
      <span>{option.name}</span>
    </label>)}</div>
  </fieldset>;
}
function Items({ items, values, change, components, workspace, disabled = false, resume, canResume = false, edit }: {
  items: ConfigItem[]; values: ConfigurationValues; change: (key: string, value: string | number | boolean | null) => void;
  components: Component[]; workspace: Workspace; disabled?: boolean;
  resume?: (id: string) => void; canResume?: boolean;
  edit?: (item: ConfigItem, source?: Component) => void;
}) {
  const groupId = useId();
  return <fieldset className="configuration-fields" disabled={disabled}>{items.map(item => {
    const target = item.kind === 'resource' ? item.target : item.kind === 'resource-select' ? item.options.find(option => option.value === values[item.key])?.target : undefined;
    const source = target && components.find(component => component.id === target.split('::')[0]);
    const paused = source && (!source.enabled || workspace.disabledComponentIds?.includes(source.id));
    const isToggle = item.kind === 'boolean' || item.kind === 'resource';
    const content = source && (source.type === 'instruction' ? source.content : source.type === 'folder' || source.type === 'file' ? source.source.path : undefined);
    const hasDetails = !!target || !!item.description || !!edit;
    const detailsId = hasDetails ? groupId + '-' + item.key + '-details' : undefined;
    return <div key={item.key} className={'configuration-field' + (item.kind.startsWith('resource') ? ' configuration-reference' : '')
      + (isToggle ? ' configuration-toggle' : '') + (item.kind === 'number' ? ' configuration-number' : '')
      + (item.kind === 'select' || item.kind === 'resource-select' ? ' configuration-select' : '') + (hasDetails ? ' configuration-has-details' : '')}>
      <label className="configuration-field-control"><span>{item.label}{item.kind === 'number' && item.control === 'slider' && <output>{String(values[item.key])}</output>}</span>
        {item.kind === 'boolean' || item.kind === 'resource'
          ? <input aria-label={item.label} aria-describedby={detailsId} type="checkbox" role={item.control === 'toggle' ? 'switch' : undefined} checked={values[item.key] === true} onChange={e => change(item.key, e.target.checked)} />
          : item.kind === 'select' || item.kind === 'resource-select'
            ? <select aria-label={item.label} aria-describedby={detailsId} value={String(values[item.key] ?? '')} onChange={e => change(item.key, e.target.value || null)}>
              {item.kind === 'resource-select' && <option value="">{t('不使用')}</option>}
              {item.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            : item.kind === 'number'
              ? <input aria-label={item.label} aria-describedby={detailsId} type={item.control === 'slider' ? 'range' : 'number'} min={item.min} max={item.max} step={item.step ?? 'any'} value={String(values[item.key])} onChange={e => change(item.key, e.target.value === '' ? '' : Number(e.target.value))} />
              : <input aria-label={item.label} aria-describedby={detailsId} type={item.control === 'color' ? 'color' : 'text'} maxLength={4096} value={String(values[item.key])} onChange={e => change(item.key, e.target.value)} />}
      </label>
      {hasDetails && <div className="configuration-field-details" id={detailsId}>
        {target && <small className={paused || !source ? 'warning-text' : ''}>{source ? source.name : t('引用的资源不存在')}{target.includes('::') ? ' · ' + target.split('::')[1] : ''}{paused ? ' · ' + t('资源已暂停，启用后生效') : ''}</small>}
        {item.description && <small>{item.description}</small>}
        {content && <small className="configuration-content-preview">{content}</small>}
        {edit && <button type="button" aria-label={t('编辑组件：{0}', [item.label])} onClick={() => edit(item, source || undefined)}>{t('编辑组件')}</button>}
        {paused && source?.enabled && resume && <button type="button" disabled={!canResume} onClick={() => resume(source.id)}>{t('取消资源暂停')}</button>}
      </div>}
    </div>;
  })}</fieldset>;
}

export function ConfigurationPanel({ workspace, components, visible, busy, run, close, selected, select, autosave }: {
  workspace: Workspace; components: Component[]; visible: boolean; busy: boolean; run: Run; close: () => void;
  dirty: boolean; dirtyChanged: (value: boolean) => void; manage: () => void;
  selected?: string; select: (id: string) => void; autosave: ConfigurationAutosave;
}) {
  const available = components.filter((value): value is ConfigurationComponent => value.type === 'configuration' && value.enabled
    && workspace.componentIds.includes(value.id) && !workspace.disabledComponentIds?.includes(value.id));
  const component = available.find(value => value.id === selected) ?? available[0];
  const state = component ? getConfigurationState(workspace.configurations, component.id) ?? initialConfigurationState() : undefined;
  const current = state?.presets.find(value => value.id === state.activePresetId);
  const definition = component && current ? { ...component, items: current.items ?? component.items } : undefined;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editor, setEditor] = useState<{ item?: ConfigItem; source?: Component }>();
  const draft = component && current ? autosave.draft(workspace.id, component.id, current.id) : undefined;
  let initial: ConfigurationValues = {}, valid = true;
  try { if (definition && current) initial = resolveConfigurationValues(definition.items, current.values); } catch { valid = false; }
  const values = draft?.values ?? initial;
  try { if (definition) resolveConfigurationValues(definition.items, values); } catch { valid = false; }
  const options = available.flatMap(value => (getConfigurationState(workspace.configurations, value.id) ?? initialConfigurationState()).presets.map(preset => ({
    id: JSON.stringify([value.id, preset.id]), name: preset.id === 'default' && preset.name === 'Default' ? value.name : preset.name,
  })));
  async function action(target: ConfigurationComponent, operation: ConfigurationAction) {
    return run(t('正在保存配置'), async () => {
      await autosave.flush();
      if (operation.type !== 'switchPreset' && component && current && autosave.draft(workspace.id, component.id, current.id)) return { ok: false, code: 'DATA_BUSY', message: t('请先处理未保存的修改。') };
      const latest = await window.dockyard.state(); if (!latest.ok) return latest;
      const updated = latest.value.workspaces.find(value => value.id === workspace.id)!;
      return window.dockyard.updateConfiguration(workspace.id, target.id, updated.revision, target.revision, operation);
    }, t('配置已保存'));
  }
  async function saveItems(items: ConfigItem[], content?: Component) {
    if (!component || !current) return false;
    return run(t('正在保存配置'), async () => {
      await autosave.flush();
      if (autosave.draft(workspace.id, component.id, current.id)) return { ok: false, code: 'DATA_BUSY', message: t('请先处理未保存的修改。') };
      if (content) { const result = await window.dockyard.save(content); if (!result.ok) return result; }
      const latest = await window.dockyard.state(); if (!latest.ok) return latest;
      const updated = latest.value.workspaces.find(value => value.id === workspace.id)!;
      const savedPreset = (getConfigurationState(updated.configurations, component.id) ?? initialConfigurationState()).presets.find(value => value.id === current.id);
      if (!savedPreset || JSON.stringify(savedPreset.items ?? component.items) !== JSON.stringify(definition!.items)) {
        return { ok: false, code: 'DATA_BUSY', message: t('配置已变化，草稿已保留。请撤销后重新编辑。') };
      }
      return window.dockyard.updateConfiguration(workspace.id, component.id, updated.revision, component.revision, { type: 'saveItems', id: current.id, items });
    }, t('配置已保存'));
  }
  return <section hidden={!visible} className="popover configuration-popover" aria-label={t('配置面板')}>
    <div className="panel-heading"><h2>{t('配置')} · {workspace.name}</h2><button className="icon-button" aria-label={t('关闭')} onClick={close}><X size={18} /></button></div>
    <div className="configuration-body">
      <div className="configuration-presets">
        <SingleChoice label={t('当前预设')} options={options} value={component && current ? JSON.stringify([component.id, current.id]) : ''} disabled={busy} change={id => {
          const [componentId, presetId] = JSON.parse(id) as [string, string];
          const target = available.find(value => value.id === componentId)!;
          void action(target, { type: 'switchPreset', id: presetId }).then(ok => { if (ok) { select(componentId); setEditor(undefined); setDeleting(false); } });
        }} />
        <button className="icon-button" aria-label={t('新建预设')} title={t('新建预设')} disabled={busy || (state?.presets.length ?? 0) >= 32} onClick={() => { setAdding(!adding); setDeleting(false); }}><Plus size={18} /></button>
        <button className="icon-button" aria-label={t('删除当前预设')} title={t('删除当前预设')} disabled={busy || !current} onClick={() => { setDeleting(!deleting); setAdding(false); }}><Trash size={18} /></button>
        <button disabled={busy || !component} onClick={() => component && void run(t('正在复制'), () => window.dockyard.copyText(t('请使用 Dockyard 中的配置 {0}。', [JSON.stringify(component.id + '::$current')])), t('配置引用已复制'))}>{t('复制给 AI')}</button>
      </div>
      {adding && <form className="configuration-presets" onSubmit={async event => {
        event.preventDefault(); if (!name.trim() || busy) return;
        let ok: boolean;
        if (component) ok = await action(component, { type: 'createPreset', id: 'preset-' + crypto.randomUUID().slice(0, 8), name: name.trim(), ...(copy && current ? { copyFrom: current.id } : { items: [] }) });
        else {
          const id = 'configuration-' + crypto.randomUUID().slice(0, 8);
          ok = await run(t('正在保存配置'), async () => {
            const latest = await window.dockyard.state(); if (!latest.ok) return latest;
            const updated = latest.value.workspaces.find(value => value.id === workspace.id)!;
            return window.dockyard.importConfiguration(workspace.id, updated.revision, configurationComponentSchema.parse({ schemaVersion: 1, id, name: name.trim(), type: 'configuration', items: [] }));
          }, t('配置已保存'));
          if (ok) select(id);
        }
        if (ok) { setAdding(false); setName(''); setCopy(false); }
      }}>
        <input autoFocus required aria-label={t('预设名称')} placeholder={t('预设名称')} maxLength={128} value={name} onChange={event => setName(event.target.value)} disabled={busy} />
        {current && <label><input type="checkbox" checked={copy} disabled={busy} onChange={event => setCopy(event.target.checked)} />{t('复制当前预设')}</label>}
        <button disabled={busy || !name.trim()}>{t('新建预设')}</button><button type="button" disabled={busy} onClick={() => setAdding(false)}>{t('取消')}</button>
      </form>}
      {deleting && component && current && <div className="configuration-actions"><span>{t('确认删除预设「{0}」？', [options.find(value => value.id === JSON.stringify([component.id, current.id]))?.name ?? current.name])}</span>
        <button disabled={busy} onClick={async () => {
          const ok = state!.presets.length > 1 ? await action(component, { type: 'deletePreset', id: current.id }) : await run(t('正在保存配置'), async () => {
            await autosave.flush();
            if (autosave.draft(workspace.id, component.id, current.id)) return { ok: false, code: 'DATA_BUSY', message: t('请先处理未保存的修改。') };
            const latest = await window.dockyard.state(); if (!latest.ok) return latest;
            const updated = latest.value.workspaces.find(value => value.id === workspace.id)!;
            return window.dockyard.select(workspace.id, updated.componentIds.filter(id => id !== component.id));
          }, t('配置已保存'));
          if (ok) { setDeleting(false); setEditor(undefined); }
        }}>{t('确认删除')}</button><button disabled={busy} onClick={() => setDeleting(false)}>{t('取消')}</button>
      </div>}
      {definition && current && <>
        <div className="configuration-actions"><button className="primary" disabled={busy || definition.items.length >= 64} onClick={() => setEditor({})}><Plus size={16} />{t('添加组件')}</button>
          <small role="status">{draft?.error ? t('自动保存失败，草稿已保留') : !valid ? t('请检查类型、范围、步长和选择项。') : draft ? t('正在保存配置') : t('已自动保存')}</small>
          {draft && (draft.error || !valid) && <button disabled={busy} onClick={() => autosave.discard(workspace.id, component.id, current.id)}>{t('撤销修改')}</button>}
          {draft?.error && <button disabled={busy} onClick={() => autosave.retry(workspace.id, component.id, current.id)}>{t('重试保存')}</button>}
          {draft?.error && <small role="alert">{draft.error}</small>}
        </div>
        {definition.items.length === 0 && <p className="empty">{t('预设还是空的，添加组件开始搭建。')}</p>}
        <Items items={definition.items} values={values} components={components} workspace={workspace} disabled={busy} canResume={!busy}
          edit={(item, source) => setEditor({ item, source })}
          resume={id => void run(t('正在保存资源状态'), () => window.dockyard.setResourceEnabled(workspace.id, id, true), t('资源已启用'))}
          change={(key, value) => autosave.change(workspace, definition, current.id, initial, key, value)} />
      </>}
      {!component && <p className="empty">{t('新建一个预设，再添加你需要的组件。')}</p>}
    </div>
    {editor && definition && current && <ConfigurationContent key={component.id + current.id} {...editor} component={definition} components={components} busy={busy} close={() => setEditor(undefined)}
      remove={editor.item ? async () => saveItems(definition.items.filter(value => value.key !== editor.item!.key)) : undefined}
      save={(next, content) => saveItems(next.items, content)} />}
  </section>;
}
