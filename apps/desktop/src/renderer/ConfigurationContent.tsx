import React, { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { componentSchema, configurationComponentSchema, type Component, type ConfigItem, type ConfigurationComponent } from '@dockyard/shared';
import { t } from '../i18n';

export function ConfigurationContent({ item, source, component, components, busy, close, save, remove }: {
  item?: ConfigItem; source?: Component; component?: ConfigurationComponent; components: Component[]; busy: boolean; close: () => void;
  save: (definition: ConfigurationComponent, content?: Component) => Promise<boolean>;
  remove?: () => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [contentId] = useState(source?.id ?? 'content-' + crypto.randomUUID().slice(0, 8));
  const [configurationId] = useState(component?.id ?? 'configuration-' + crypto.randomUUID().slice(0, 8));
  type Control = 'folder' | 'file' | 'instruction' | 'existing' | 'toggle' | 'checkbox' | 'slider' | 'number' | 'text' | 'color' | 'select';
  const [type, setType] = useState<Control>(source?.type === 'folder' || source?.type === 'file' || source?.type === 'instruction' ? source.type
    : item && !item.kind.startsWith('resource') ? item.control as Control : item ? 'existing' : 'toggle');
  const [reference, setReference] = useState('');
  const [name, setName] = useState(item?.label ?? source?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [instructions, setInstructions] = useState(item?.aiInstructions ?? '');
  const [defaultValue, setDefaultValue] = useState<string | number | boolean>(item?.default ?? false);
  const [minimum, setMinimum] = useState(item?.kind === 'number' ? item.min ?? 0 : 0);
  const [maximum, setMaximum] = useState(item?.kind === 'number' ? item.max ?? 100 : 100);
  const [step, setStep] = useState(item?.kind === 'number' ? item.step ?? 1 : 1);
  const [options, setOptions] = useState(item?.kind === 'select' ? item.options.map(value => value.label).join('\n') : '');
  const [deleting, setDeleting] = useState(false);
  const [body, setBody] = useState(source?.type === 'instruction' ? source.content : source && 'source' in source ? source.source.path : '');
  const [error, setError] = useState('');
  const editableContent = ['folder', 'file', 'instruction'].includes(type);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  async function pick() {
    const result = await window.dockyard.pickSource(type === 'folder' ? 'folder' : 'file');
    if (!result.ok) setError(result.message);
    else if (result.value) {
      setBody(result.value);
      if (!name) setName(result.value.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    try {
      let content: Component | undefined;
      if (editableContent && type !== 'existing') {
        const base = { schemaVersion: 1, revision: source?.revision ?? 1, id: contentId, enabled: true, name: name.trim() };
        content = componentSchema.parse(source
          ? { ...source, ...(source.type === 'instruction' ? { content: body } : { source: { path: body } }) }
          : type === 'instruction' ? { ...base, type, key: contentId, content: body }
          : type === 'file' ? { ...base, type, key: contentId, source: { path: body } }
          : { ...base, type, source: { path: body } });
        if (source && JSON.stringify(content) === JSON.stringify(source)) content = undefined;
      }
      let nextItem: unknown = item ? { ...item, label: name.trim(), description, aiInstructions: instructions } : {
        key: 'content-' + crypto.randomUUID().slice(0, 8), label: name.trim(), description,
        aiInstructions: instructions, kind: 'resource', control: 'toggle', target: type === 'existing' ? reference : contentId, default: true,
      };
      const base = { key: item?.key ?? 'item-' + crypto.randomUUID().slice(0, 8), label: name.trim(), description, aiInstructions: instructions };
      if (type === 'toggle' || type === 'checkbox') nextItem = { ...base, kind: 'boolean', control: type, default: Boolean(defaultValue) };
      if (type === 'slider' || type === 'number') nextItem = { ...base, kind: 'number', control: type, default: Number(defaultValue), min: minimum, max: maximum, step };
      if (type === 'text' || type === 'color') nextItem = { ...base, kind: 'text', control: type, default: String(defaultValue) };
      if (type === 'select') {
        const choices = options.split('\n').map(label => label.trim()).filter(Boolean).map(label => ({
          label, value: item?.kind === 'select' ? item.options.find(option => option.label === label)?.value ?? label : label,
        }));
        nextItem = { ...base, kind: 'select', control: 'select', options: choices, default: String(defaultValue) || choices[0]?.value };
      }
      const definition = configurationComponentSchema.parse(component
        ? { ...component, items: item ? component.items.map(value => value.key === item.key ? nextItem : value) : [...component.items, nextItem] }
        : { schemaVersion: 1, id: configurationId, name: t('我的配置'), type: 'configuration', items: [nextItem] });
      if (await save(definition, content)) close();
      else setError(t('未完成保存，内容已保留。请检查提示后重试。'));
    } catch { setError(t('请检查名称、默认值、范围和选项。')); }
  }
  return <dialog ref={dialog} className="configuration-content-dialog" aria-label={item ? t('编辑组件') : t('添加组件')}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={submit}>
      <div className="dialog-head"><h2>{item ? t('编辑组件') : t('添加组件')}</h2><div className="configuration-actions">
        <button className="primary" disabled={busy}>{t('保存')}</button><button type="button" className="icon-button" aria-label={t('关闭编辑')} disabled={busy} onClick={close}><X size={18} /></button>
      </div></div>
      <fieldset disabled={busy}>
        {!item && <label>{t('组件类型')}<select aria-label={t('组件类型')} value={type} onChange={event => {
          const next = event.target.value as Control; setType(next); setBody('');
          setDefaultValue(next === 'toggle' || next === 'checkbox' ? false : next === 'slider' || next === 'number' ? 0 : next === 'color' ? '#000000' : '');
        }}>
          <option value="toggle">{t('开关')}</option><option value="slider">{t('滑块')}</option><option value="color">{t('颜色选取')}</option><option value="checkbox">{t('复选框')}</option>
          <option value="number">{t('数值输入')}</option><option value="select">{t('下拉选择')}</option><option value="text">{t('文本输入')}</option>
          <option value="folder">{t('文件夹位置')}</option><option value="file">{t('文件位置')}</option><option value="instruction">{t('文本规则')}</option><option value="existing">{t('已有资源')}</option>
        </select></label>}
        {type === 'existing' && !item && <label>{t('选择资源')}<select aria-label={t('选择资源')} required value={reference} onChange={event => {
          setReference(event.target.value); if (!name) setName(components.find(value => value.id === event.target.value)?.name ?? '');
        }}><option value="">{t('选择资源')}</option>{components.filter(value => value.type !== 'configuration').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
        <label>{t('名称')}<input autoFocus required maxLength={128} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>{t('项目说明')}<textarea rows={3} maxLength={1024} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <label>{t('给 AI 的说明')}<textarea rows={3} maxLength={1024} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
        {(type === 'toggle' || type === 'checkbox') && <label>{t('默认启用')}<input type="checkbox" checked={Boolean(defaultValue)} onChange={event => setDefaultValue(event.target.checked)} /></label>}
        {(type === 'slider' || type === 'number') && <>
          <label>{t('最小值')}<input required type="number" step="any" value={minimum} onChange={event => setMinimum(event.target.valueAsNumber)} /></label>
          <label>{t('最大值')}<input required type="number" step="any" value={maximum} onChange={event => setMaximum(event.target.valueAsNumber)} /></label>
          <label>{t('步长')}<input required type="number" step="any" value={step} onChange={event => setStep(event.target.valueAsNumber)} /></label>
          <label>{t('默认值')}<input required type="number" step={step} min={minimum} max={maximum} value={String(defaultValue)} onChange={event => setDefaultValue(event.target.value)} /></label>
        </>}
        {(type === 'text' || type === 'color') && <label>{t('默认值')}<input type={type === 'color' ? 'color' : 'text'} maxLength={4096} value={String(defaultValue)} onChange={event => setDefaultValue(event.target.value)} /></label>}
        {type === 'select' && <>
          <label>{t('选项（每行一个）')}<textarea required rows={4} value={options} onChange={event => setOptions(event.target.value)} /></label>
          <label>{t('默认值')}<select value={String(defaultValue)} onChange={event => setDefaultValue(event.target.value)}><option value="">{t('使用第一个选项')}</option>{options.split('\n').map(value => value.trim()).filter(Boolean).map((label, index) => {
            const value = item?.kind === 'select' ? item.options.find(option => option.label === label)?.value ?? label : label;
            return <option key={index} value={value}>{label}</option>;
          })}</select></label>
        </>}
        {editableContent && type !== 'existing' && (type === 'instruction'
          ? <label>{t('文本规则')}<textarea aria-label={t('文本规则')} required rows={8} value={body} onChange={event => setBody(event.target.value)} /><small>{t('最多 16 KiB。')}</small></label>
          : <label>{type === 'folder' ? t('文件夹位置') : t('文件位置')}<div className="input-action"><input aria-label={type === 'folder' ? t('文件夹位置') : t('文件位置')} required value={body} onChange={event => setBody(event.target.value)} /><button type="button" onClick={() => void pick()}>{t('浏览…')}</button></div></label>)}
        {source && <p className="form-note">{t('内容由引用它的配置共享，开关状态按工作区保存。')}</p>}
      </fieldset>
      {remove && <div className="configuration-actions">{deleting ? <><span>{t('确认删除这个组件？')}</span><button type="button" disabled={busy} onClick={async () => { if (await remove()) close(); }}>{t('确认删除')}</button><button type="button" disabled={busy} onClick={() => setDeleting(false)}>{t('取消')}</button></> : <button type="button" disabled={busy} onClick={() => setDeleting(true)}>{t('删除组件')}</button>}</div>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </dialog>;
}
