import { t, translateMessage as msg, getLocale } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { notebookSchema, type Notebook, type Note } from '../notebook-model';

export function NotebookIcon({ name }: { name: string }) {
  return <img className="notebook-icon" src={'./assets/notebook/' + name + '.svg'} alt="" draggable={false} />;
}
const icon = (name: string) => <NotebookIcon name={name} />;
const title = (note: Note) => note.title.trim() || t("未命名笔记");
const time = (date: string) => {
  const value = new Date(date);
  if (Date.now() - value.getTime() < 60000) return t("刚刚");
  return value.toLocaleString(getLocale(), { ...(value.toDateString() === new Date().toDateString() ? {} : { month: 'numeric', day: 'numeric' }), hour: '2-digit', minute: '2-digit' });
};
type View = 'notes' | 'canvas';
type Point = { x: number; y: number };
type Gesture = { kind: 'pan' | 'note' | 'link'; start: Point; origin: Point; id?: string; moved: boolean };

export function NotebookPanel({ workspaceId, workspaceName, view, changeView, close }: {
  workspaceId: string; workspaceName: string; view: View | null; changeView: (view: View) => void; close: () => void;
}) {
  const [data, setData] = useState<Notebook>();
  const current = useRef<Notebook | undefined>(undefined);
  const [status, setStatus] = useState('正在读取…');
  const [failure, setFailure] = useState('');
  const sequence = useRef(0);
  const alive = useRef(true);
  const draftKey = 'dockyard-notebook-draft-' + workspaceId;
  const [selected, setSelected] = useState<string>();
  const [selectedLink, setSelectedLink] = useState<string>();
  const [menu, setMenu] = useState(false);
  const [undo, setUndo] = useState<{ note: Note; links: Notebook['links'] }>();
  const [mode, setMode] = useState<'select' | 'pan'>('select');
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [drag, setDrag] = useState<{ id: string; point: Point }>();
  const [connecting, setConnecting] = useState<string>();
  const [endpoint, setEndpoint] = useState<Point>();
  const gesture = useRef<Gesture | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  async function persist(value: Notebook) {
    const request = ++sequence.current;
    setStatus("正在保存…"); setFailure('');
    try { localStorage.setItem(draftKey, JSON.stringify(value)); } catch { /* The file write below remains authoritative. */ }
    try {
      const reply = await window.dockyard.saveNotebook(workspaceId, value);
      if (request !== sequence.current) return;
      if (!reply.ok) throw new Error(reply.message);
      try { localStorage.removeItem(draftKey); } catch { /* File is already saved. */ }
      if (alive.current) { setStatus("已自动保存"); setFailure(''); }
    } catch (error) {
      if (alive.current && request === sequence.current) { setStatus("尚未保存"); setFailure(String(error instanceof Error ? error.message : error)); }
    }
  }
  async function load() {
    setFailure('');
    try {
      const reply = await window.dockyard.notebook(workspaceId);
      if (!reply.ok) throw new Error(reply.message);
      if (!alive.current) return;
      let value = reply.value, recovered = false;
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) { const parsed = notebookSchema.safeParse(JSON.parse(raw)); if (parsed.success) { value = parsed.data; recovered = true; } }
      } catch { /* Ignore malformed recovery data, keeping the validated file. */ }
      current.current = value; setData(value); setSelected(value.notes[0]?.id); setStatus("已自动保存");
      if (recovered) void persist(value);
    } catch (error) { if (alive.current) { setFailure(error instanceof Error ? error.message : String(error)); setStatus("读取失败"); } }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [workspaceId]);
  useEffect(() => { setMenu(false); setConnecting(undefined); setEndpoint(undefined); setSelectedLink(undefined); }, [view]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (view && event.key === 'Escape' && (menu || connecting || selectedLink)) {
        event.preventDefault(); event.stopImmediatePropagation();
        setMenu(false); setConnecting(undefined); setEndpoint(undefined); setSelectedLink(undefined);
      }
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [view, menu, connecting, selectedLink]);
  function commit(value: Notebook) {
    const parsed = notebookSchema.safeParse(value);
    if (!parsed.success) { setFailure(parsed.error.issues[0]?.message ?? '无法保存'); return; }
    current.current = parsed.data; setData(parsed.data); void persist(parsed.data);
  }
  function updateNote(id: string, patch: Partial<Note>) {
    const value = current.current;
    if (value) commit({ ...value, notes: value.notes.map(note => note.id === id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note) });
  }
  function newNote() {
    const value = current.current;
    if (!value) return;
    const rect = stage.current?.getBoundingClientRect();
    const note: Note = { id: crypto.randomUUID(), title: '', body: '', updatedAt: new Date().toISOString(),
      x: rect ? Math.round((rect.width / 2 - camera.x) / camera.zoom - 155) : value.notes.length === 0 ? 64 : 690 + Math.floor((value.notes.length - 1) / 2) * 360,
      y: rect ? Math.round((rect.height / 2 - camera.y) / camera.zoom - 95) : value.notes.length === 0 ? 172 : value.notes.length % 2 ? 56 : 336 };
    commit({ ...value, notes: [...value.notes, note] }); setSelected(note.id); setMenu(false); setSelectedLink(undefined);
    if (view === 'notes') requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.note-editor>input')?.focus());
  }
  function removeNote() {
    const value = current.current, note = value?.notes.find(item => item.id === selected);
    if (!value || !note) return;
    setUndo({ note, links: value.links.filter(link => link.source === note.id || link.target === note.id) });
    commit({ ...value, notes: value.notes.filter(item => item.id !== note.id), links: value.links.filter(link => link.source !== note.id && link.target !== note.id) });
    setSelected(value.notes.find(item => item.id !== note.id)?.id); setMenu(false); setConnecting(undefined);
  }
  function restoreNote() {
    const value = current.current;
    if (!value || !undo) return;
    const ids = new Set([...value.notes.map(note => note.id), undo.note.id]);
    commit({ ...value, notes: [...value.notes, undo.note], links: [...value.links, ...undo.links.filter(link => ids.has(link.source) && ids.has(link.target))] });
    setSelected(undo.note.id); setUndo(undefined);
  }
  function connect(source: string, target: string) {
    const value = current.current;
    setConnecting(undefined); setEndpoint(undefined);
    if (!value || source === target || value.links.some(link => [link.source, link.target].includes(source) && [link.source, link.target].includes(target))) return;
    const link = { id: crypto.randomUUID(), source, target, label: '' };
    commit({ ...value, links: [...value.links, link] }); setSelectedLink(link.id);
  }
  function world(point: Point): Point {
    const rect = stage.current!.getBoundingClientRect();
    return { x: (point.x - rect.left - camera.x) / camera.zoom, y: (point.y - rect.top - camera.y) / camera.zoom };
  }
  function start(event: React.PointerEvent, kind: Gesture['kind'], id?: string) {
    if (event.button !== 0 || !data) return;
    event.preventDefault(); event.stopPropagation();
    const note = data.notes.find(item => item.id === id);
    if (id) { setSelected(id); setSelectedLink(undefined); }
    gesture.current = { kind, id, start: { x: event.clientX, y: event.clientY }, origin: kind === 'note' && note ? { x: note.x, y: note.y } : { x: camera.x, y: camera.y }, moved: false };
    if (kind === 'link') { setConnecting(id); setEndpoint(world({ x: event.clientX, y: event.clientY })); }
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: React.PointerEvent) {
    const action = gesture.current;
    if (!action) { if (connecting) setEndpoint(world({ x: event.clientX, y: event.clientY })); return; }
    const dx = event.clientX - action.start.x, dy = event.clientY - action.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) action.moved = true;
    if (action.kind === 'pan') setCamera({ ...camera, x: action.origin.x + dx, y: action.origin.y + dy });
    else if (action.kind === 'note') setDrag({ id: action.id!, point: { x: Math.max(-100000, Math.min(100000, action.origin.x + dx / camera.zoom)), y: Math.max(-100000, Math.min(100000, action.origin.y + dy / camera.zoom)) } });
    else setEndpoint(world({ x: event.clientX, y: event.clientY }));
  }
  function end(event: React.PointerEvent) {
    const action = gesture.current;
    gesture.current = undefined;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
    if (!action) return;
    suppressClick.current = action.moved;
    if (action.kind === 'note' && drag && action.moved) updateNote(drag.id, drag.point);
    if (action.kind === 'link' && action.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId;
      if (target) connect(action.id!, target); else { setConnecting(undefined); setEndpoint(undefined); }
    }
    setDrag(undefined);
  }
  function zoom(next: number) {
    const rect = stage.current?.getBoundingClientRect(); if (!rect) return;
    const value = Math.max(.25, Math.min(2, next));
    setCamera({ x: rect.width / 2 - (rect.width / 2 - camera.x) * value / camera.zoom, y: rect.height / 2 - (rect.height / 2 - camera.y) * value / camera.zoom, zoom: value });
  }
  function fit() {
    const rect = stage.current?.getBoundingClientRect(); if (!rect || !data?.notes.length) { setCamera({ x: 0, y: 0, zoom: 1 }); return; }
    const minX = Math.min(...data.notes.map(note => note.x)), minY = Math.min(...data.notes.map(note => note.y));
    const width = Math.max(...data.notes.map(note => note.x + 310)) - minX, height = Math.max(...data.notes.map(note => note.y + 190)) - minY;
    const scale = Math.max(.25, Math.min(1, (rect.width - 100) / width, (rect.height - 100) / height));
    setCamera({ zoom: scale, x: (rect.width - width * scale) / 2 - minX * scale, y: (rect.height - height * scale) / 2 - minY * scale });
  }
  if (!view) return null;
  const canvas = view === 'canvas';
  const note = data?.notes.find(item => item.id === selected);
  const link = data?.links.find(item => item.id === selectedLink);
  const count = (id: string) => data?.links.filter(item => item.source === id || item.target === id).length ?? 0;
  const position = (item: Note) => drag?.id === item.id ? drag.point : item;
  const tabs = <div className="notebook-tabs" role="tablist" aria-label={t("笔记视图")}>
    <button role="tab" aria-selected={!canvas} onClick={() => changeView('notes')}>{icon(canvas ? 'canvasimgNotebookPen1' : 'noteimgNotebookPen1')}{t("快速记事")}</button>
    <button role="tab" aria-selected={canvas} onClick={() => changeView('canvas')}>{icon(canvas ? 'canvasimgWorkflow' : 'noteimgWorkflow')}{t("连线画布")}</button>
  </div>;
  const add = <button className="notebook-add" disabled={!data || data.notes.length >= 200} onClick={newNote}>{icon('noteimgPlus')}{t("新建笔记")}</button>;
  const more = <div className="notebook-menu-wrap" onClick={event => event.stopPropagation()}><button className="icon-button" aria-label={t("笔记操作")} aria-expanded={menu} onClick={() => setMenu(!menu)}>{icon('noteimgIcon')}</button>{menu && <div className="notebook-menu"><button disabled={!note} onClick={removeNote}>{t("删除笔记")}</button></div>}</div>;
  const saveStatus = <span className="notebook-save" role="status">{!failure && status === '已自动保存' && icon('noteimgCheck')}{msg(status)}</span>;
  return <section className={'popover notebook-panel ' + (canvas ? 'notebook-canvas' : 'notebook-quick')} aria-label={canvas ? t("连线画布") : t("记事本")}>
    <header className="notebook-heading">{icon('noteimgNotebookPen')}<h2>{t("记事本")}</h2><span>{canvas ? workspaceName : t("{0} 篇笔记", [data?.notes.length ?? 0])}</span>{canvas && <>{tabs}<button onClick={() => changeView('notes')}>{icon('canvasimgMinimize2')}{t("收起画布")}</button></>}<button className="icon-button" aria-label={t("关闭记事本")} onClick={close}>{icon('noteimgIcon1')}</button></header>
    {failure && <div className="notebook-error" role="alert">{msg(failure)}<button onClick={() => current.current ? void persist(current.current) : void load()}>{t("重试")}</button></div>}
    {undo && <div className="notebook-undo">{t("笔记已删除")}<button className="text-button" onClick={restoreNote}>{t("撤销删除")}</button></div>}
    {!canvas ? <>
      <div className="notebook-quick-tools">{tabs}{add}</div>
      {note ? <div className="note-editor">
        <div className="note-editor-status">{saveStatus}{more}</div>
        <input aria-label={t("笔记标题")} placeholder={t("未命名笔记")} maxLength={200} value={note.title} onChange={event => updateNote(note.id, { title: event.target.value })} />
        <textarea aria-label={t("笔记正文")} placeholder={t("写下此刻的想法…")} maxLength={10000} value={note.body} onChange={event => updateNote(note.id, { body: event.target.value })} />
        <footer><span>{t("直接输入，随写随存")}</span><button className="text-button" onClick={() => changeView('canvas')}>{icon('noteimgGitBranch')}{count(note.id)} {t("条连线 · 在画布中查看")}{icon('noteimgArrowUpRight')}</button></footer>
      </div> : <div className="notebook-empty">{data ? t("记下第一个想法，再用连线整理它们。") : msg(status)}</div>}
      <div className="note-list-heading"><strong>{t("全部笔记")}</strong><span>{t("最近编辑")}</span></div>
      <div className="note-list">{data?.notes.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => <button key={item.id} className={'note-list-item' + (item.id === selected ? ' selected' : '')} aria-pressed={item.id === selected} onClick={() => { setSelected(item.id); setMenu(false); }}><span><strong>{title(item)}</strong>{item.id === selected && <small>{t("编辑中")}</small>}<time>{time(item.updatedAt)}</time></span><p>{item.body.split('\n')[0] || t("还没有正文")}</p></button>)}</div>
      <footer className="notebook-local"><span>{workspaceName} · {data?.notes.length ?? 0} {t("篇笔记")}</span><span>{t("保存在你的电脑")}</span></footer>
    </> : <>
      <div className="notebook-canvas-tools">{add}<span>{data?.notes.length ?? 0} {t("篇笔记 ·")} {data?.links.length ?? 0} {t("条连线")}</span><span className="notebook-sync">{t("与快速记事同步 ·")} {saveStatus}</span><button className="icon-button" aria-label={t("重置画布视图")} onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>{icon('canvasimgIcon')}</button></div>
      <div className={'notebook-stage ' + (mode === 'pan' ? 'panning' : '')} ref={stage} onPointerDown={event => { if (!(event.target as HTMLElement).closest('button,input,[data-note-id],.notebook-link-editor')) { setSelectedLink(undefined); if (connecting) { setConnecting(undefined); setEndpoint(undefined); } start(event, 'pan'); } }} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { gesture.current = undefined; setDrag(undefined); setConnecting(undefined); setEndpoint(undefined); }}>
        <div className="notebook-world" style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}>
          <img className="notebook-dots" src="./assets/notebook/canvasimg3.svg" alt="" draggable={false} />
          <svg className="note-connections" width="1080" height="536" aria-label={t("笔记连线")}>{data?.links.map(item => {
            const from = data.notes.find(n => n.id === item.source)!, to = data.notes.find(n => n.id === item.target)!;
            const a = position(from), b = position(to), right = b.x >= a.x;
            const x1 = a.x + (right ? 310 : 0), y1 = a.y + 95, x2 = b.x + (right ? 0 : 310), y2 = b.y + 95;
            const bend = Math.max(80, Math.abs(x2 - x1) / 2);
            const d = `M${x1},${y1} C${x1 + (right ? bend : -bend)},${y1} ${x2 - (right ? bend : -bend)},${y2} ${x2},${y2}`;
            return <g key={item.id} className={selectedLink === item.id ? 'selected' : ''} onPointerDown={event => event.stopPropagation()} onClick={() => { setSelectedLink(item.id); setConnecting(undefined); }} role="button" tabIndex={0} aria-label={t("编辑连线：") + title(from) + ' → ' + title(to)} onKeyDown={event => { if (event.key === 'Enter') setSelectedLink(item.id); }}><path className="connection-hit" d={d} /><path className="connection-line" d={d} />{item.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 10} textAnchor="middle">{item.label}</text>}</g>;
          })}{connecting && endpoint && note && <path className="connection-line pending" d={`M${position(note).x + 310},${position(note).y + 95} L${endpoint.x},${endpoint.y}`} />}</svg>
          {data?.notes.map(item => { const point = position(item); return <article key={item.id} data-note-id={item.id} className={'canvas-note' + (selected === item.id ? ' selected' : '')} style={{ left: point.x, top: point.y }} tabIndex={0} aria-label={t("画布笔记：") + title(item)} onPointerDown={event => { if (!(event.target as HTMLElement).closest('button')) start(event, mode === 'pan' ? 'pan' : 'note', item.id); }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (connecting) connect(connecting, item.id); else { setSelected(item.id); setSelectedLink(undefined); } }} onDoubleClick={() => { setSelected(item.id); changeView('notes'); }} onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter') { if (connecting) connect(connecting, item.id); else { setSelected(item.id); changeView('notes'); } }
            const delta: Record<string, Point> = { ArrowLeft: { x: -10, y: 0 }, ArrowRight: { x: 10, y: 0 }, ArrowUp: { x: 0, y: -10 }, ArrowDown: { x: 0, y: 10 } };
            if (delta[event.key]) { event.preventDefault(); updateNote(item.id, { x: item.x + delta[event.key].x, y: item.y + delta[event.key].y }); }
          }}>
            {selected === item.id && <div className="canvas-note-actions" onPointerDown={event => event.stopPropagation()}><button onClick={() => changeView('notes')}>{icon('canvasimgPencil')}{t("编辑")}</button><button aria-pressed={connecting === item.id} onClick={event => { event.stopPropagation(); setConnecting(connecting ? undefined : item.id); }}>{icon('canvasimgGitBranch')}{t("连线")}</button>{more}</div>}
            <h3>{icon('canvasimgStickyNote')}{title(item)}</h3><p>{item.body || t("双击卡片，写下你的想法。")}</p><footer><time>{time(item.updatedAt)}</time><span>{selected === item.id && t("已选中 · ")}{count(item.id)} {t("条连线")}</span></footer>
            {(['left', 'right', 'top', 'bottom'] as const).map(side => <button key={side} className={'note-port ' + side} aria-label={t("从 {0} {1}连接", [title(item), side])} onPointerDown={event => start(event, 'link', item.id)} onClick={event => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } if (connecting && connecting !== item.id) connect(connecting, item.id); else setConnecting(item.id); }}>{icon(selected === item.id && side !== 'right' ? 'canvasimg1' : 'canvasimg')}</button>)}
          </article>; })}
        </div>
        {!data?.notes.length && <div className="canvas-empty">{t("新建笔记，把想法连起来。")}</div>}
        <div className="canvas-hint">{icon('canvasimgCircleDot')}{connecting ? t("点击另一篇笔记完成连线，点击空白处取消") : t("拖动卡片边缘的连接点，连接另一篇笔记")}</div>
        <div className="canvas-navigation"><button aria-label={t("选择工具")} aria-pressed={mode === 'select'} onClick={() => setMode('select')}>{icon('canvasimgMousePointer2')}</button><button aria-label={t("平移工具")} aria-pressed={mode === 'pan'} onClick={() => setMode('pan')}>{icon('canvasimgHand')}</button></div>
        {link && <div className="notebook-link-editor" onPointerDown={event => event.stopPropagation()}><input aria-label={t("关系说明")} maxLength={120} placeholder={t("添加关系说明")} value={link.label} onChange={event => { const value = current.current!; commit({ ...value, links: value.links.map(item => item.id === link.id ? { ...item, label: event.target.value } : item) }); }} /><button onClick={() => { const value = current.current!; commit({ ...value, links: value.links.filter(item => item.id !== link.id) }); setSelectedLink(undefined); }}>{t("删除连线")}</button></div>}
      </div>
      <footer className="notebook-canvas-footer"><span>{note ? t("已选中「{0}」 · 双击卡片编辑", [title(note)]) : t("拖动空白处平移画布")}</span><button aria-label={t("缩小画布")} onClick={() => zoom(camera.zoom - .1)}>{icon('canvasimgMinus')}</button><output aria-label={t("画布缩放")}>{Math.round(camera.zoom * 100)}%</output><button aria-label={t("放大画布")} onClick={() => zoom(camera.zoom + .1)}>{icon('canvasimgPlus')}</button><i /><button onClick={fit}>{icon('canvasimgScan')}{t("适应画布")}</button></footer>
    </>}
  </section>;
}
