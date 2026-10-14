import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { z } from 'zod';
import { Store } from './store';
import { runJob } from './pipeline';
import { compose } from './imaging';
import { exportPsd } from './exports';
import { MODEL_IDS, safeError } from './models';
import { modelSettings } from './config';
import type { Job, Operation, OriginalItem, ProjectPatch } from '../shared/types';
import { findFreePosition, generationObstacles, GENERATION_SPACE } from '../shared/placement';

const store = new Store(path.resolve(process.env.DATA_DIR ?? '.data'));
await store.initialize();
const app = express();
const jobQueue: Job[] = [];
let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  try { while (jobQueue.length) await runJob(store, jobQueue.shift()!); }
  finally { processing = false; }
}
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use('/api/assets', express.static(store.assetDirectory, { immutable: true, maxAge: '1y', dotfiles: 'deny' }));

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const viewport = point.extend({ scale: z.number().min(0.15).max(3) });
const asset = z.object({ id: z.uuid(), url: z.string().regex(/^\/api\/assets\/[a-f0-9-]{36}\.png$/), width: z.number().positive(), height: z.number().positive() });
const placedLayer = z.object({ id: z.uuid(), name: z.string(), role: z.enum(['text','subject','decoration','panel','background']), asset,
  x: z.number().finite(), y: z.number().finite(), scale: z.number().positive().max(100), z: z.number().finite(), visible: z.boolean(), locked: z.boolean() });
const baseItem = point.extend({ id: z.uuid(), title: z.string(), width: z.number().positive().max(12000), height: z.number().positive().max(12000), createdAt: z.string() });
const item = z.discriminatedUnion('kind', [
  baseItem.extend({ kind: z.literal('original'), asset, source: z.enum(['generated','uploaded']), prompt: z.string().optional() }),
  baseItem.extend({ kind: z.literal('layer-group'), sourceId: z.uuid(), backgroundDescription: z.string(), layers: z.array(placedLayer), expanded: z.boolean() }),
  baseItem.extend({ kind: z.literal('variant'), sourceId: z.uuid(), presetId: z.string(), layers: z.array(placedLayer), expanded:z.boolean().optional() }),
]);

app.get('/api/health', (_req, res) => {
  const { configured, provider, baseUrl, imageFormat, editEncoding, paths, error } = modelSettings();
  res.json({ ready: true, configured, provider, baseUrl, models: MODEL_IDS, imageFormat, editEncoding, paths, configurationError: error });
});
app.get('/api/project', (_req, res) => res.json(store.getProject()));
app.put('/api/project', async (req, res) => {
  const patch = z.object({ items: z.array(item).max(300).optional(), deleteIds: z.array(z.uuid()).optional(), viewport: viewport.optional() }).parse(req.body);
  res.json(await store.patchProject(patch as ProjectPatch));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) throw new Error('请选择图片文件。');
  const metadata = await sharp(req.file.buffer).metadata().catch(() => { throw new Error('无法读取这张图片，请换一张 PNG、JPG 或 WebP 图片。'); });
  if (!['png','jpeg','webp'].includes(metadata.format ?? '')) throw new Error('支持 PNG、JPG 和 WebP 图片。');
  const position = point.parse({ x: Number(req.body.x ?? 120), y: Number(req.body.y ?? 100) });
  const asset = await store.saveAsset(req.file.buffer);
  const original: OriginalItem = { id: randomUUID(), kind: 'original', title: req.file.originalname, source: 'uploaded',
    asset, width: asset.width, height: asset.height, ...position, createdAt: new Date().toISOString() };
  await store.patchProject({ items: [original] });
  res.status(201).json(original);
});

function active(operation: Job['operation'], sourceId?: string) {
  return [...store.jobs.values()].find(job => job.operation === operation && job.sourceId === sourceId && ['queued','running'].includes(job.status));
}
async function launch(operation: Operation, request: Record<string, unknown>, res: express.Response) {
  if (operation !== 'generate') {
    const source = store.getItem(request.sourceId as string);
    if (!source || source.kind !== 'original') {
      res.status(400).json({ error: '请选择对应的原图或图层组。' }); return;
    }
    const existing = active(operation, request.sourceId as string);
    if (existing) { res.status(202).json(existing); return; }
  }
  if (operation === 'generate') {
    request = { ...request, position: findFreePosition(point.parse(request.position), GENERATION_SPACE,
      generationObstacles(store.getProject().items, [...store.jobs.values()])) };
  }
  const job = await store.createJob(operation, request);
  if (processing) await store.updateJob(job.id, { stage: '等待当前任务完成' });
  res.status(202).json(job);
  jobQueue.push(job);
  void processQueue().catch(error => console.error(`Task persistence error: ${safeError(error)}`));
}
app.post('/api/generate', async (req, res) => {
  const body = z.object({ prompt: z.string().trim().min(1).max(16000), position: point }).parse(req.body);
  await launch('generate', body, res);
});
app.post('/api/decompose', async (req, res) => {
  const body = z.object({ sourceId: z.uuid(), mode: z.enum(['auto','custom']).default('auto'),
    instructions: z.string().trim().max(8000).optional() }).superRefine((value,ctx)=>{
      if(value.mode==='custom' && !value.instructions) ctx.addIssue({code:'custom',path:['instructions'],message:'请填写拆分要求。'});
    }).parse(req.body);
  await launch('decompose', body, res);
});
app.post('/api/rearrange', (_req,res) => res.status(410).json({error:'重排功能已移除，请直接编辑图层组。'}));
app.get('/api/jobs', (_req, res) => res.json([...store.jobs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)));
app.get('/api/jobs/:id', (req, res) => {
  const job = store.jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: '任务不存在。' }); return; }
  res.json(job);
});
app.post('/api/jobs/:id/retry', async (req, res) => {
  const job = store.jobs.get(req.params.id);
  if(job?.operation === 'rearrange') { res.status(410).json({error:'历史重排任务不再执行。'}); return; }
  if (!job || job.status !== 'failed') { res.status(400).json({ error: '这个任务无需重试。' }); return; }
  await launch(job.operation, job.request, res);
});
app.get('/api/export/:id', async (req, res) => {
  const target = store.getItem(req.params.id);
  if (!target) { res.status(404).json({ error: '画板不存在。' }); return; }
  const format = z.enum(['png','psd']).parse(req.query.format ?? 'png');
  if(format==='psd' && target.kind==='original') { res.status(400).json({error:'请先拆分图层，再导出 PSD。'}); return; }
  const buffer = format==='psd' && target.kind!=='original' ? await exportPsd(store,target)
    : target.kind === 'original' ? await store.readAsset(target.asset) : await compose(store,target.width,target.height,target.layers);
  res.setHeader('Content-Type',format==='psd'?'image/vnd.adobe.photoshop':'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${target.kind}-${target.width}x${target.height}.${format}"`);
  res.send(buffer);
});
app.get('/api/export/:id/layers/:layerId', async (req,res)=>{
  const target=store.getItem(req.params.id);
  const layer=target && target.kind!=='original' ? target.layers.find(l=>l.id===req.params.layerId) : undefined;
  if(!layer) {res.status(404).json({error:'找不到这个图层素材。'});return;}
  res.setHeader('Content-Type','image/png');
  res.setHeader('Content-Disposition',`attachment; filename="layer-${layer.id}.png"`);
  res.send(await store.readAsset(layer.asset));
});

if (existsSync(path.resolve('dist/index.html'))) {
  app.use(express.static(path.resolve('dist')));
  app.get('/', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
}
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.find(issue=>issue.code==='custom')?.message ?? '输入数据不完整或格式不正确，请检查后重试。' }); return; }
  if (error instanceof multer.MulterError) { res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '图片请控制在 25 MB 内。' : '图片上传失败，请重试。' }); return; }
  res.status(500).json({ error: safeError(error) });
});

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, '127.0.0.1', () => console.log(`Ming API ready: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(`API server: ${safeError(error)}`); process.exit(1); });
