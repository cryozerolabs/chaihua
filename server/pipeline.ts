import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DecomposeOptions, Job, LayerGroupItem, OriginalItem, PlacedLayer } from '../shared/types';
import { itemBounds } from '../shared/geometry';
import { findFreePosition, generationObstacles } from '../shared/placement';
import { askVision, generateImages, MODEL_IDS, safeError } from './models';
import { contactSheet, prepareLayer, visionImage } from './imaging';
import type { Store } from './store';

const foregroundRole = z.enum(['text', 'subject', 'decoration', 'panel']);
export const layerPlanSchema = z.object({
  layoutType: z.enum(['poster', 'asset-sheet']),
  backgroundDescription: z.string().min(1),
  foregroundLayers: z.array(z.object({
    name: z.string().min(1), role: foregroundRole, description: z.string().min(1),
  })).min(1),
});
type LayerPlan = z.infer<typeof layerPlanSchema>;
type LayerSpec = { name: string; role: PlacedLayer['role']; description: string };

export function decomposePrompt(plan: LayerPlan): string {
  const specs: LayerSpec[] = [...plan.foregroundLayers,
    { name: '背景', role: 'background', description: plan.backgroundDescription }];
  return `Decompose this image into ${specs.length} layers.
Number of layers: ${specs.length}
Use the following plan in FRONT-TO-BACK order:
${specs.map((layer, index) => `Layer ${index + 1}: ${layer.name} (${layer.role}) — ${layer.description}`).join('\n')}
Preserve the original appearance, readable text as image pixels, full objects with their associated details, canvas dimensions, and original positions. Every foreground layer must have transparent alpha=0 outside its contents.
The complete background is the LAST layer. Fill areas of the background hidden behind foreground objects. Return one image per actual layer, without an extra full composite or contact sheet.`;
}

export async function runJob(store: Store, job: Job) {
  const stage = (message: string) => store.updateJob(job.id, { status: 'running', stage: message });
  const progress = async (message: string) => { await stage(message); };
  try {
    if (job.operation === 'generate') {
      await stage('正在生成图片');
      const prompt = job.request.prompt as string;
      const [buffer] = await generateImages(MODEL_IDS.design, prompt, undefined, progress);
      const asset = await store.saveAsset(buffer);
      const original: OriginalItem = {
        id: randomUUID(), kind: 'original', title: '生成的图片', source: 'generated', prompt, asset,
        width: asset.width, height: asset.height, x: job.position?.x ?? 120, y: job.position?.y ?? 100,
        createdAt: new Date().toISOString(),
      };
      Object.assign(original, findFreePosition(original, itemBounds(original),
        generationObstacles(store.getProject().items, [...store.jobs.values()], job.id)));
      await store.patchProject({ items: [original] });
      await store.updateJob(job.id, { status: 'succeeded', stage: '原图已生成',
        result: { items: [original] }, position: { x: original.x, y: original.y } });
    } else if (job.operation === 'decompose') {
      const source = store.getItem(job.sourceId!);
      if (!source || source.kind !== 'original') throw new Error('找不到要拆分的原图。');
      const options: DecomposeOptions = job.request.mode === 'custom'
        ? { mode: 'custom', instructions: String(job.request.instructions ?? '').trim() }
        : { mode: 'auto' };
      if (options.mode === 'custom' && !options.instructions) throw new Error('请填写拆分要求。');
      await stage('正在分析图片');
      const original = await store.readAsset(source.asset);
      const preview = await visionImage(original);
      const plan = await askVision('layer_decomposition_plan', layerPlanSchema,
        `Inspect the original image and plan independently editable semantic layers. Decide the layer count from its content, with no fixed foreground-layer limit.
For a sheet of standalone assets, each independent object (such as a pumpkin, ghost, cat, hat, or bat) should have its own layer. For a poster, separate complete subjects, text blocks, and reusable visual elements. Keep attached details, facial features, outlines, and associated shadows with their object; do not split objects based on pixel gaps. Do not merge unrelated standalone objects merely to reduce the number of layers.
List foreground layers in FRONT-TO-BACK order. Use concise Chinese names, and describe each object's appearance and original location; distinguish repeated objects by location. Describe the complete background separately. Include all visible content; do not include a full composite as a layer.
${options.mode === 'custom' ? `Follow these user requirements when grouping and separating objects: ${options.instructions}` : 'Choose the grouping automatically from the visual content.'}`,
        [preview], progress);
      await store.updateJob(job.id, { request: { ...job.request, layerPlan: plan } });
      let specs: LayerSpec[] = [...plan.foregroundLayers,
        { name: '背景', role: 'background', description: plan.backgroundDescription }];
      await stage('正在拆分图层');
      let images = await generateImages(MODEL_IDS.layer, decomposePrompt(plan), original, progress);
      if (images.length < 2) throw new Error('Ming Layer 只返回了一张图片，尚未形成分层结果，请重试拆分。');
      if (images.length !== specs.length) {
        await stage('正在核对图层');
        const actualSchema = z.object({ images: z.array(z.object({
          index: z.number().int().min(1).max(images.length), name: z.string().min(1),
          role: z.enum(['text', 'subject', 'decoration', 'panel', 'background', 'composite']),
        })).min(2) }).superRefine((value, ctx) => {
          if (value.images.length !== images.length || new Set(value.images.map(image => image.index)).size !== images.length)
            ctx.addIssue({ code: 'custom', path: ['images'], message: '必须逐一标注每张返回图片，编号不得重复或遗漏。' });
          if (value.images.filter(image => image.role === 'background').length !== 1 || !value.images.some(image => !['background', 'composite'].includes(image.role)))
            ctx.addIssue({ code: 'custom', path: ['images'], message: '需要一个背景和至少一个前景图层。' });
        });
        const actual = await askVision('returned_layer_contents', actualSchema,
          `The first image is the original. The second is an indexed contact sheet of ${images.length} images actually returned by the layer model. Inspect every numbered image and give its actual Chinese name and role. The requested plan was: ${JSON.stringify(plan)}.
Return exactly one entry for every index from 1 to ${images.length}. Use composite only for an extra full reconstruction/reference image; use background for the complete background, and the other roles for actual foreground layers. If unrelated objects remain together, name that combined material honestly; do not claim it has been split. Do not assume the first or last image is a composite. List foreground layers in FRONT-TO-BACK order, followed by the background.`,
          [preview, await contactSheet(images)], progress);
        await store.updateJob(job.id, { request: { ...job.request, layerPlan: plan, returnedLayers: actual.images } });
        const entries = actual.images.filter(image => image.role !== 'composite');
        const ordered = [...entries.filter(image => image.role !== 'background'), ...entries.filter(image => image.role === 'background')];
        images = ordered.map(image => images[image.index - 1]);
        specs = ordered.map(image => ({ name: image.name, role: image.role as PlacedLayer['role'], description: '' }));
      }
      await stage(`正在准备 ${images.length} 个图层`);
      const layers: PlacedLayer[] = [];
      for (const [index, image] of images.entries()) {
        layers.push(await prepareLayer(store, image, specs[index].role,
          specs[index].name, images.length - index - 1, source.width, source.height));
      }
      const group: LayerGroupItem = {
        id: randomUUID(), kind: 'layer-group', title: '可编辑图层', sourceId: source.id,
        x: source.x + itemBounds(source).width + 80, y: source.y,
        width: source.width, height: source.height, layers, expanded: false, backgroundDescription: plan.backgroundDescription,
        createdAt: new Date().toISOString(),
      };
      Object.assign(group, findFreePosition(group, itemBounds(group), generationObstacles(store.getProject().items, [...store.jobs.values()])));
      await store.patchProject({ items: [group] });
      await store.updateJob(job.id, { status: 'succeeded', stage: `已拆出 ${layers.length} 个图层`, result: { items: [group] } });
    } else {
      throw new Error('重排功能已移除。');
    }
  } catch (error) {
    await store.updateJob(job.id, { status: 'failed', stage: '需要重试', error: safeError(error) });
    console.error(`[${job.operation}] ${safeError(error)}`);
  }
}
