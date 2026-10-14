import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, CheckCircle2, CircleAlert, Download, ImagePlus, Layers3, LoaderCircle, Maximize, Minus, Plus, Redo2, RotateCcw, Sparkles, Trash2, Undo2, Upload, X, ListTodo } from 'lucide-react';
import { CanvasBoard } from './components/CanvasBoard';
import { BoardLabel } from './components/BoardLabel';
import { GenerationPlaceholder } from './components/GenerationPlaceholder';
import { LayerList } from './components/LayerList';
import { api, downloadItem, downloadLayer, request } from './api';
import { EMPTY_PROJECT, type CanvasItem, type Job, type Point, type Operation, type PlacedLayer, type Project, type ProjectPatch, type Viewport } from '../shared/types';
import { fitViewport, itemBounds, screenToWorld, zoomAt } from '../shared/geometry';
import { findFreePosition, generationObstacles, GENERATION_SPACE } from '../shared/placement';

type Edit = { before: CanvasItem; after: CanvasItem | null };

export default function App() {
  const [project, setProject] = useState<Project>(structuredClone(EMPTY_PROJECT));
  const projectRef = useRef(project);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('ming-dismissed-jobs') ?? '[]')));
  const [prompt, setPrompt] = useState(() => localStorage.getItem('ming-draft-prompt') ?? '');
  useEffect(() => { localStorage.setItem('ming-draft-prompt',prompt); },[prompt]);
  const [uploading, setUploading] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [saving, setSaving] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [bounds, setBounds] = useState({ width: window.innerWidth, height: Math.max(400, window.innerHeight - 76) });
  const canvas = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveError = useRef<string | null>(null);
  const undoStack = useRef<Edit[]>([]), redoStack = useRef<Edit[]>([]);
  const finishedJobs = useRef(new Set<string>());
  const appliedResultIds = useRef(new Set<string>());
  const boundsRef = useRef(bounds); boundsRef.current = bounds;
  const selected = project.items.find(item => item.id === selectedId);
  const editing = selected && selected.kind !== 'original' ? selected : undefined;
  editingRef.current = editing?.id ?? null;

  const notify = useCallback((message: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 8500 : 3500);
  }, []);
  const setLocalProject = useCallback((next: Project) => { projectRef.current = next; setProject(next); }, []);
  const save = useCallback((patch: ProjectPatch) => {
    setSaving(value => value + 1);
    const task = saveQueue.current.catch(() => undefined).then(() => api.save(patch)).then(() => { saveError.current = null; });
    saveQueue.current = task;
    void task.catch(error => { saveError.current = error.message; notify(`保存失败：${error.message}`, true); }).finally(() => setSaving(value => value - 1));
  }, [notify]);
  const mergeItems = useCallback((items: CanvasItem[]) => {
    const existing = projectRef.current.items;
    const map = new Map(items.map(item => [item.id, item]));
    const next = existing.map(item => { const replacement = map.get(item.id); map.delete(item.id); return replacement ?? item; });
    next.push(...map.values());
    setLocalProject({ ...projectRef.current, items: next });
  }, [setLocalProject]);
  const changeItem = useCallback((next: CanvasItem, before?: CanvasItem) => {
    const previous = before ?? projectRef.current.items.find(item => item.id === next.id);
    if (!previous || JSON.stringify(previous) === JSON.stringify(next)) return;
    undoStack.current.push({ before: structuredClone(previous), after: structuredClone(next) });
    undoStack.current = undoStack.current.slice(-40); redoStack.current = [];
    setHistoryTick(tick => tick + 1); mergeItems([next]); save({ items: [next] });
  }, [mergeItems, save]);
  const history = useCallback((redo: boolean) => {
    const edit = (redo ? redoStack : undoStack).current.pop(); if (!edit) return;
    (redo ? undoStack : redoStack).current.push(edit);
    const target = structuredClone(redo ? edit.after : edit.before);
    if (target) {
      mergeItems([target]); save({ items: [target] });
      if (!edit.after) { setSelectedId(target.id); setActiveLayerId(null); }
    } else {
      setLocalProject({ ...projectRef.current, items: projectRef.current.items.filter(item => item.id !== edit.before.id) });
      save({ deleteIds: [edit.before.id] });
      setSelectedId(id => id === edit.before.id ? null : id); setActiveLayerId(null);
    }
    setHistoryTick(tick => tick + 1);
  }, [mergeItems, save, setLocalProject]);
  const deleteItem = useCallback((id: string) => {
    const item = projectRef.current.items.find(item => item.id === id); if (!item) return;
    undoStack.current.push({ before: structuredClone(item), after: null });
    undoStack.current = undoStack.current.slice(-40); redoStack.current = [];
    setLocalProject({ ...projectRef.current, items: projectRef.current.items.filter(item => item.id !== id) });
    save({ deleteIds: [id] }); setSelectedId(null); setActiveLayerId(null); setHistoryTick(tick => tick + 1);
    notify('已从画布删除，可撤销恢复。');
  }, [notify, save, setLocalProject]);
  const changeViewport = useCallback((viewport: Viewport) => {
    setLocalProject({ ...projectRef.current, viewport });
    if (viewportTimer.current) clearTimeout(viewportTimer.current);
    viewportTimer.current = setTimeout(() => save({ viewport: projectRef.current.viewport }), 450);
  }, [save, setLocalProject]);
  const fit = useCallback(() => changeViewport(fitViewport(projectRef.current.items, boundsRef.current.width, boundsRef.current.height)), [changeViewport]);

  const initialize = useCallback(async () => {
    setBootError('');
    try {
      const [stored, tasks, health] = await Promise.all([api.project(), api.jobs(), request<{ configured: boolean }>('/api/health')]);
      setLocalProject(stored); setJobs(tasks.filter(job=>job.operation!=='rearrange')); setConfigured(health.configured);
      finishedJobs.current = new Set(tasks.filter(job => ['failed','succeeded'].includes(job.status)).map(job => job.id));
      appliedResultIds.current = new Set([...stored.items.map(item => item.id), ...tasks.flatMap(job => job.result?.items.map(item => item.id) ?? [])]);
      setReady(true);
    } catch (error) { setBootError((error as Error).message); }
  }, [setLocalProject]);
  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setBounds({ width: rect.width, height: rect.height });
    });
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!ready) return;
    let canceled = false, polling = false;
    async function poll() {
      if (polling) return; polling = true;
      try {
        const tasks = (await api.jobs()).filter(job=>job.operation!=='rearrange'); if (canceled) return;
        setJobs(tasks);
        const fresh = tasks.flatMap(job => job.result?.items ?? []).filter(item => !appliedResultIds.current.has(item.id));
        if (fresh.length) {
          const unique = [...new Map(fresh.map(item => [item.id, item])).values()];
          unique.forEach(item => appliedResultIds.current.add(item.id));
          mergeItems(unique);
          if (!editingRef.current) { setSelectedId(unique.at(-1)!.id); fit(); }
        }
        for (const job of tasks) {
          if (['failed','succeeded'].includes(job.status) && !finishedJobs.current.has(job.id)) {
            finishedJobs.current.add(job.id);
            if (job.status === 'failed') { notify(job.error ?? '操作失败，请重试。', true); setTasksOpen(true); }
            else notify(job.stage);
          }
        }
      } catch { /* Keep the existing canvas while a local server restarts. */ }
      finally { polling = false; }
    }
    const timer = setInterval(() => void poll(), 1400);
    return () => { canceled = true; clearInterval(timer); };
  }, [ready, mergeItems, notify, fit]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelectedId(null); setActiveLayerId(null); setTasksOpen(false); }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); deleteItem(selectedId); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [history, selectedId, deleteItem]);
  useEffect(() => { localStorage.setItem('ming-dismissed-jobs', JSON.stringify([...dismissed])); }, [dismissed]);

  const activeJobs = jobs.filter(job => ['queued','running'].includes(job.status));
  const visibleJobs = jobs.filter(job => !dismissed.has(job.id));
  const failedJobs = visibleJobs.filter(job => job.status === 'failed');
  const generating = activeJobs.some(job => job.operation === 'generate');
  const selectedJob = activeJobs.find(job => job.sourceId === selectedId);
  const activeLayer = editing?.layers.find(layer => layer.id === activeLayerId);

  function select(id: string | null) {
    setSelectedId(id);
    if (id !== selectedId) setActiveLayerId(null);
  }
  function newPosition(): Point {
    return screenToWorld({ x: Math.max(80, bounds.width / 2 - 180), y: Math.max(80, bounds.height / 2 - 210) }, projectRef.current.viewport);
  }
  async function uploadFiles(files: File[], position?: Point) {
    setUploading(true);
    try {
      const accepted = files.filter(file => /\.(png|jpe?g|webp)$/i.test(file.name));
      if (!accepted.length) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
      await saveQueue.current.catch(() => undefined);
      for (const [index, file] of accepted.entries()) {
        const at = position ?? newPosition();
        const original = await api.upload(file, { x: at.x + index * 40, y: at.y + index * 40 });
        mergeItems([original]); select(original.id);
      }
      if (!position) fit();
      notify(`${accepted.length === 1 ? '图片' : `${accepted.length} 张图片`}已放到画布，点击即可拆层。`);
    } catch (error) { notify((error as Error).message, true); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function start(operation: Operation, body: unknown) {
    try {
      await saveQueue.current;
      const job = await api.start(operation, body);
      setJobs(current => [job, ...current.filter(task => task.id !== job.id)]);
      setTasksOpen(false);
      return job;
    } catch (error) { notify((error as Error).message, true); }
  }
  async function generate() {
    if (!prompt.trim() || generating || !ready) return;
    const position = findFreePosition(newPosition(), GENERATION_SPACE, generationObstacles(projectRef.current.items, jobs));
    const job = await start('generate', { prompt: prompt.trim(), position });
    if (job?.position) revealGeneration(job.position);
  }
  function revealGeneration(position: Point) {
    const view = projectRef.current.viewport;
    const availableWidth = Math.max(200, bounds.width - (editing ? 330 : 64));
    const availableHeight = Math.max(150, bounds.height - 260);
    const scale = Math.max(0.15, Math.min(view.scale, availableWidth / GENERATION_SPACE.width, availableHeight / GENERATION_SPACE.height));
    const left = view.x + position.x * scale, top = view.y + position.y * scale;
    const nextLeft = Math.max(24, Math.min(left, availableWidth + 24 - GENERATION_SPACE.width * scale));
    const nextTop = Math.max(40, Math.min(top, availableHeight + 40 - GENERATION_SPACE.height * scale));
    if (scale !== view.scale || left !== nextLeft || top !== nextTop) {
      changeViewport({ x: view.x + nextLeft - left, y: view.y + nextTop - top, scale });
    }
  }
  async function retry(job: Job) {
    try {
      const task = await api.retry(job.id);
      setDismissed(ids => new Set([...ids, job.id]));
      setJobs(current => [task, ...current.filter(old => old.id !== task.id)]);
      if (task.operation === 'generate' && task.position) revealGeneration(task.position);
    } catch (error) { notify((error as Error).message, true); }
  }
  async function download(format: 'png' | 'psd' = 'png', layer?:PlacedLayer) {
    if (!selected) return; setExporting(true);
    try {
      await saveQueue.current;
      if (saveError.current) throw new Error('修改尚未保存，请检查本地服务后重试。');
      const item=projectRef.current.items.find(item=>item.id===selected.id)!;
      if(layer) await downloadLayer(item,layer); else await downloadItem(item,format);
      notify(layer?'素材已导出':`${format.toUpperCase()} 已导出`);
    } catch (error) { notify((error as Error).message, true); }
    finally { setExporting(false); }
  }
  const toolbar = selected ? (() => {
    const box = itemBounds(selected), view = project.viewport;
    const groupTop=view.y+selected.y*view.scale;
    const top=groupTop-58>=15?groupTop-58:groupTop+box.height*view.scale+12;
    const workspaceTop=canvas.current?.getBoundingClientRect().top ?? 76;
    const composerTop=canvas.current?.querySelector('.composer')?.getBoundingClientRect().top ?? workspaceTop+bounds.height-170;
    const maxTop=Math.max(15,composerTop-workspaceTop-56);
    return { left: Math.max(16, Math.min(bounds.width - 375, view.x + (selected.x + box.width / 2) * view.scale - 155)),
      top: Math.max(15, Math.min(maxTop, top)) };
  })() : null;

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark"><Layers3 size={22} /></span>
        <div className="brand-copy"><strong>拆画</strong><small>cryozerolabs</small></div>
        <nav className="brand-links" aria-label="cryozerolabs 链接">
          <a href="https://x.com/cryozerolabs" target="_blank" rel="noopener noreferrer" aria-label="cryozerolabs 的 X" title="X · cryozerolabs">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.49h2.039L6.487 3.24H4.3l13.31 17.403Z" /></svg>
          </a>
          <a href="https://github.com/cryozerolabs/chaihua" target="_blank" rel="noopener noreferrer" aria-label="拆画的 GitHub 仓库" title="GitHub · 拆画">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.558 21.922c.563.104.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.79-1.508-3.79-1.508-.512-1.3-1.25-1.645-1.25-1.645-1.022-.7.078-.686.078-.686 1.13.08 1.724 1.16 1.724 1.16 1.005 1.724 2.637 1.226 3.28.938.102-.728.394-1.226.716-1.509-2.498-.284-5.124-1.25-5.124-5.562 0-1.23.44-2.234 1.16-3.022-.116-.284-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.154A10.78 10.78 0 0 1 12 6.177c.956.004 1.918.129 2.816.379 2.147-1.457 3.09-1.154 3.09-1.154.615 1.55.229 2.696.113 2.98.722.788 1.158 1.792 1.158 3.022 0 4.324-2.63 5.275-5.136 5.553.404.348.764 1.034.764 2.084 0 1.504-.014 2.718-.014 3.088 0 .3.203.651.774.54A11.25 11.25 0 0 0 12 .75Z" /></svg>
          </a>
        </nav>
      </div>
      <div className="header-actions">
        <span className={`connection-label ${!configured ? 'warning' : ''}`}><span />{configured ? '本地工作台' : '模型尚未配置'}</span>
        <div className="history-buttons" data-history={historyTick}><button className="icon-button" title="撤销 ⌘Z" aria-label="撤销" disabled={!undoStack.current.length} onClick={() => history(false)}><Undo2 size={18} /></button><button className="icon-button" title="重做 ⇧⌘Z" aria-label="重做" disabled={!redoStack.current.length} onClick={() => history(true)}><Redo2 size={18} /></button></div>
        <button className={`task-button ${tasksOpen ? 'active' : ''}`} onClick={() => setTasksOpen(open => !open)}><ListTodo size={17} />任务{activeJobs.length > 0 && <span className="task-count">{activeJobs.length}</span>}{!activeJobs.length && failedJobs.length > 0 && <span className="failure-dot" />}</button>
      </div>
    </header>
    <main ref={canvas} className="canvas-workspace"
      style={{ backgroundSize: `${24 * project.viewport.scale}px ${24 * project.viewport.scale}px`, backgroundPosition: `${project.viewport.x}px ${project.viewport.y}px` }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingFiles(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingFiles(false); }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); setDraggingFiles(false);
        const rect = canvas.current!.getBoundingClientRect();
        void uploadFiles([...event.dataTransfer.files], screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, projectRef.current.viewport));
      }}>
      <CanvasBoard project={project} width={bounds.width} height={bounds.height} selectedId={selectedId} editingId={editing?.id ?? null}
        activeLayerId={activeLayerId} onSelect={select} onSelectLayer={setActiveLayerId} onChangeItem={changeItem} onViewport={changeViewport} />
      <div className="board-labels">{project.items.map(item=><BoardLabel key={item.id} item={item} viewport={project.viewport}
        onSelect={select} onPreview={item=>mergeItems([item])} onCommit={changeItem}/>)}
        {activeJobs.filter(job=>job.operation==='generate').map(job=><GenerationPlaceholder key={job.id} job={job} viewport={project.viewport}/>)}
      </div>
      {!project.items.length && !generating && <div className="empty-state">
        <div className="empty-illustration"><div className="illustration-card back"><Layers3 size={28} /></div><div className="illustration-card front"><ImagePlus size={34} /><i /><i /></div><div className="illustration-mini" /></div>
        <h1>从一张图片开始</h1><p>描述你想要的图片，或把已有图片拖到画布上。</p>
        <div className="flow-hints"><span><ImagePlus size={15} />原图</span><span className="hint-arrow">→</span><span><Layers3 size={15} />拆分图层</span><span className="hint-arrow">→</span><span><Layers3 size={15} />编辑图层</span><span className="hint-arrow">→</span><span><Download size={15} />导出</span></div>
        {bootError && <div className="boot-error"><span>{bootError}</span><button onClick={() => void initialize()}>重新连接</button></div>}
      </div>}
      {draggingFiles && <div className="drop-overlay"><Upload size={36} /><strong>松开鼠标，图片就会放到这里</strong><span>PNG · JPG · WebP</span></div>}
      {selected && toolbar && <div className="floating-toolbar" style={toolbar}>
        {selected.kind === 'original' && <button className="toolbar-primary" disabled={Boolean(selectedJob)} onClick={() => void start('decompose', { sourceId: selected.id, mode: 'auto' })}>{selectedJob ? <LoaderCircle className="spin" size={16} /> : <Layers3 size={16} />} {selectedJob ? '正在拆层' : '拆分图层'}</button>}
        {selected.kind !== 'original' && <>
          <button disabled={exporting} onClick={() => void download('png')}><Download size={16} />导出 PNG</button>
          <button disabled={exporting} onClick={() => void download('psd')}><Download size={16} />导出 PSD</button>
        </>}
        {selected.kind === 'original' && <><span className="toolbar-divider" /><button disabled={exporting} onClick={() => void download()}><Download size={16} />下载原图</button></>}
        <span className="toolbar-divider" /><button aria-label={`删除${selected.kind === 'original' ? '原图' : selected.kind === 'layer-group' ? '图层组' : '画板'}`} title="删除，可撤销恢复" onClick={() => deleteItem(selected.id)}><Trash2 size={16} />删除</button>
      </div>}
      {selectedJob && <div className="selection-progress"><LoaderCircle size={15} className="spin" />{selectedJob.stage}</div>}
      {editing && <aside className="layer-inspector">
        <div className="inspector-heading"><span><Layers3 size={16} />图层组</span><button className="icon-button" aria-label="关闭图层编辑" onClick={() => { setSelectedId(null); setActiveLayerId(null); }}><X size={16} /></button></div>
        <p>画布内拖动素材，标题栏移动整组。拖动下方列表调整层级，上方图层显示在前面。</p>
        <LayerList item={editing} selectedId={activeLayerId} exporting={exporting} onSelect={setActiveLayerId}
          onChange={changeItem} onDownload={layer => void download('png', layer)} />
        {activeLayer && <div className="layer-details"><span>位置 {Math.round(activeLayer.x)}, {Math.round(activeLayer.y)}</span><span>缩放 {Math.round(activeLayer.scale * 100)}%</span></div>}
      </aside>}
      {tasksOpen && <aside className="tasks-panel">
        <div className="inspector-heading"><span>任务记录</span><button className="icon-button" aria-label="关闭任务记录" onClick={() => setTasksOpen(false)}><X size={17} /></button></div>
        {!visibleJobs.length && <p className="no-tasks">生成图片和拆层任务会显示在这里。</p>}
        {visibleJobs.slice(0, 10).map(job => <div className={`task-row ${job.status}`} key={job.id}>
          <div className="task-state-icon">{job.status === 'failed' ? <CircleAlert size={17} /> : job.status === 'succeeded' ? <CheckCircle2 size={17} /> : <LoaderCircle size={17} className="spin" />}</div>
          <div className="task-description"><strong>{job.operation === 'generate' ? '生成图片' : '拆分图层'}</strong><span>{job.error ?? job.stage}</span>{job.status === 'failed' && <button className="retry-button" onClick={() => void retry(job)}><RotateCcw size={13} />重试这一步</button>}</div>
          {['failed','succeeded'].includes(job.status) && <button className="icon-button" title="隐藏记录" aria-label="隐藏任务记录" onClick={() => setDismissed(ids => new Set([...ids, job.id]))}><X size={14} /></button>}
        </div>)}
      </aside>}
      <div className="canvas-navigation"><button className="icon-button" title="缩小" aria-label="缩小" onClick={() => changeViewport(zoomAt(project.viewport, { x: bounds.width / 2, y: bounds.height / 2 }, project.viewport.scale / 1.15))}><Minus size={16} /></button><button className="zoom-value" onClick={() => changeViewport(zoomAt(project.viewport, { x: bounds.width / 2, y: bounds.height / 2 }, 1))}>{Math.round(project.viewport.scale * 100)}%</button><button className="icon-button" title="放大" aria-label="放大" onClick={() => changeViewport(zoomAt(project.viewport, { x: bounds.width / 2, y: bounds.height / 2 }, project.viewport.scale * 1.15))}><Plus size={16} /></button><span /><button className="icon-button" title="适合全部内容" aria-label="适合全部内容" onClick={fit}><Maximize size={16} /></button></div>
      <div className="canvas-save-status">{saving ? <><LoaderCircle size={11} className="spin" />保存中</> : <><Check size={12} />已保存到本地</>}<span>滚轮缩放 · 空白处拖动平移</span></div>
      <form className="composer" onSubmit={event => { event.preventDefault(); void generate(); }}>
        <div className="composer-text"><Sparkles size={19} /><textarea aria-label="图片需求" value={prompt} onChange={event => setPrompt(event.target.value)} rows={2}
          placeholder="描述你想要的图片，例如：一张秋日音乐节海报，橙色背景、人物插画，标题是「城市回响」……"
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void generate(); } }} /></div>
        <div className="composer-bottom"><button type="button" className="upload-button" disabled={uploading || !ready} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}{uploading ? '导入中' : '上传图片'}</button><span>Enter 生成 · Shift + Enter 换行</span><button className="generate-button" type="submit" disabled={!prompt.trim() || generating || !ready}>{generating ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} />}{generating ? '生成中' : '生成图片'}</button></div>
      </form>
      <div className="model-credit">Powered by Ming Design · Ming Layer · Ling-VL</div>
      <input ref={fileInput} className="hidden-input" type="file" accept=".png,.jpg,.jpeg,.webp" multiple onChange={event => { if (event.target.files) void uploadFiles([...event.target.files]); }} />
    </main>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span>{toast.message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
