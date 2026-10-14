import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store';
import { layerPlanSchema, runJob } from '../server/pipeline';
import { askVision, generateImages } from '../server/models';
import type { DecomposeOptions } from '../shared/types';

vi.mock('../server/models', () => ({ askVision: vi.fn(), generateImages: vi.fn(),
  MODEL_IDS: { design: 'design', layer: 'layer', vision: 'vision' }, safeError: (error: Error) => error.message }));
let directory: string;
afterEach(async () => { vi.resetAllMocks(); if (directory) await rm(directory, { recursive: true, force: true }); });
const plan = { layoutType: 'asset-sheet' as const, backgroundDescription: '浅灰色背景',
  foregroundLayers: [{ name: '帽子与蝙蝠', role: 'decoration' as const, description: '左侧帽子和右侧蝙蝠' }] };
async function setup() {
  directory = await mkdtemp(path.join(tmpdir(), 'ming-vl-pipeline-'));
  const store = new Store(directory); await store.initialize();
  const width = 200, height = 100, data = Buffer.alloc(width * height * 4);
  for (const [left, top, w, h] of [[10, 10, 50, 70], [140, 20, 50, 60]])
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) {
      const offset = (y * width + x) * 4; data[offset] = 150; data[offset + 2] = 200; data[offset + 3] = 255;
    }
  const foreground = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const background = await sharp({ create: { width, height, channels: 4, background: '#eeeeee' } }).png().toBuffer();
  const asset = await store.saveAsset(background);
  const source = { id: randomUUID(), kind: 'original' as const, title: '素材板', asset,
    source: 'uploaded' as const, width, height, x: 80, y: 80, createdAt: '' };
  await store.patchProject({ items: [source] });
  vi.mocked(askVision).mockResolvedValue(plan);
  return { store, source, foreground, background };
}

describe('VL planned Ming Layer decomposition', () => {
  it.each([{ mode: 'auto' }, { mode: 'custom', instructions: '猫和帽子分开，所有星星放一层' }] as DecomposeOptions[])
    ('plans before image generation in $mode mode and never splits transparent gaps locally', async options => {
      const { store, source, foreground, background } = await setup();
      vi.mocked(generateImages).mockResolvedValue([foreground, background]);
      const job = await store.createJob('decompose', { sourceId: source.id, ...options }); await runJob(store, job);
      const completed = store.jobs.get(job.id)!; expect(completed.status).toBe('succeeded');
      const group = completed.result!.items[0]; if (group.kind !== 'layer-group') throw new Error('Missing group');
      expect(group.layers).toHaveLength(2); expect(group.layers[0].asset.width).toBeGreaterThan(170);
      expect(group.layers.map(layer => layer.name)).toEqual(['帽子与蝙蝠', '背景']);
      expect(group.layers.map(layer => layer.z)).toEqual([1, 0]); expect(group.layers[1].locked).toBe(true);
      expect(group.backgroundDescription).toBe(plan.backgroundDescription);
      expect(askVision).toHaveBeenCalledTimes(1); expect(generateImages).toHaveBeenCalledTimes(1);
      expect(vi.mocked(askVision).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(generateImages).mock.invocationCallOrder[0]);
      const [model, prompt, reference] = vi.mocked(generateImages).mock.calls[0];
      expect(model).toBe('layer'); expect(prompt).toContain('Decompose this image into 2 layers.');
      expect(prompt).toContain('Layer 1: 帽子与蝙蝠'); expect(reference!.equals(await store.readAsset(source.asset))).toBe(true);
      const instruction = vi.mocked(askVision).mock.calls[0][2];
      if (options.mode === 'custom') expect(instruction).toContain(options.instructions);
      else expect(instruction).toContain('Choose the grouping automatically');
      expect(completed.request).toMatchObject({ ...options, layerPlan: plan });
    });
  it('accepts a plan with more than five foreground layers and sends its explicit count', async () => {
    const { store, source, foreground, background } = await setup();
    const many = { ...plan, foregroundLayers: Array.from({ length: 28 }, (_, i) => ({ ...plan.foregroundLayers[0], name: `元素 ${i + 1}` })) };
    expect(layerPlanSchema.parse(many).foregroundLayers).toHaveLength(28);
    vi.mocked(askVision).mockResolvedValue(many);
    vi.mocked(generateImages).mockResolvedValue([...Array.from({ length: 28 }, () => foreground), background]);
    const job = await store.createJob('decompose', { sourceId: source.id }); await runJob(store, job);
    expect(store.jobs.get(job.id)!.status).toBe('succeeded');
    const group = store.jobs.get(job.id)!.result!.items[0]; if (group.kind !== 'layer-group') throw new Error('Missing group');
    expect(group.layers).toHaveLength(29); expect(vi.mocked(generateImages).mock.calls[0][1]).toContain('Number of layers: 29');
  });
  it.each([1, 3])('uses VL to identify an extra composite at index %s instead of blindly discarding an image', async compositeIndex => {
    const { store, source, foreground, background } = await setup();
    const images = compositeIndex === 1 ? [background, foreground, background] : [foreground, background, background];
    const foregroundIndex = compositeIndex === 1 ? 2 : 1, backgroundIndex = compositeIndex === 1 ? 3 : 2;
    vi.mocked(generateImages).mockResolvedValue(images);
    vi.mocked(askVision).mockResolvedValueOnce(plan).mockResolvedValueOnce({ images: [
      { index: compositeIndex, name: '合成预览', role: 'composite' },
      { index: backgroundIndex, name: '浅灰背景', role: 'background' },
      { index: foregroundIndex, name: '帽子与蝙蝠', role: 'decoration' },
    ] });
    const job = await store.createJob('decompose', { sourceId: source.id }); await runJob(store, job);
    const completed = store.jobs.get(job.id)!; expect(completed.status).toBe('succeeded');
    expect(askVision).toHaveBeenCalledTimes(2);
    expect(vi.mocked(askVision).mock.calls[1][0]).toBe('returned_layer_contents');
    expect(vi.mocked(askVision).mock.calls[1][3]).toHaveLength(2);
    const group = completed.result!.items[0]; if (group.kind !== 'layer-group') throw new Error('Missing group');
    expect(group.layers.map(layer => layer.name)).toEqual(['帽子与蝙蝠', '浅灰背景']);
    expect(group.layers[0].asset.width).toBeGreaterThan(170); expect(group.layers[1].locked).toBe(true);
  });
  it('validates every actual image index and prevents an unusable group after an incomplete inspection', async () => {
    const { store, source, foreground, background } = await setup();
    vi.mocked(generateImages).mockResolvedValue([foreground, background, background]);
    vi.mocked(askVision).mockImplementation(async (_name, schema) => schema.parse(_name === 'layer_decomposition_plan' ? plan : { images: [
      { index: 1, name: '素材', role: 'decoration' }, { index: 1, name: '背景', role: 'background' },
    ] }));
    const job = await store.createJob('decompose', { sourceId: source.id }); await runJob(store, job);
    expect(store.jobs.get(job.id)!.status).toBe('failed'); expect(store.getProject().items).toHaveLength(1);
  });
  it('stops before Ming Layer when the VL plan fails', async () => {
    const { store, source } = await setup(); vi.mocked(askVision).mockRejectedValue(new Error('Ling-VL 的方案字段不符合要求'));
    const job = await store.createJob('decompose', { sourceId: source.id }); await runJob(store, job);
    expect(store.jobs.get(job.id)!.status).toBe('failed'); expect(generateImages).not.toHaveBeenCalled();
  });
  it('reports a single-image response without adding an unusable group', async () => {
    const { store, source, background } = await setup(); vi.mocked(generateImages).mockResolvedValue([background]);
    const job = await store.createJob('decompose', { sourceId: source.id }); await runJob(store, job);
    expect(store.jobs.get(job.id)!.error).toContain('只返回了一张图片'); expect(store.getProject().items).toHaveLength(1);
  });
});
