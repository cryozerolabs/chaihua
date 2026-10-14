import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Store } from '../server/store';
import { compose, prepareLayer } from '../server/imaging';
import type { OriginalItem, PlacedLayer } from '../shared/types';

let directory: string, store: Store;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'ming-test-')); store = new Store(directory); await store.initialize(); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('persistent project and editable layer composition', () => {
  it('preserves concurrent additions and viewport patches, then restores them', async () => {
    const asset = await store.saveAsset(await sharp({ create: { width: 20, height: 30, channels: 4, background: '#123456' } }).png().toBuffer());
    const original = (title: string): OriginalItem => ({ id: randomUUID(), kind: 'original', title, x: 0, y: 0, source: 'uploaded', createdAt: '', asset, width: 20, height: 30 });
    const first = original('first'), second = original('second');
    await Promise.all([store.patchProject({ items: [first] }), store.patchProject({ items: [second] }), store.patchProject({ viewport: { x: 90, y: 40, scale: 0.7 } })]);
    const restored = new Store(directory); await restored.initialize();
    expect(restored.getProject().items.map(i => i.id)).toEqual([first.id, second.id]);
    expect(restored.getProject().viewport).toEqual({ x: 90, y: 40, scale: 0.7 });
  });
  it('crops Alpha bounds and restores the original layer position when compositing', async () => {
    const red = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const original = await sharp({ create: { width: 50, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: red, left: 20, top: 12 }]).png().toBuffer();
    const layer = await prepareLayer(store, original, 'subject', 'subject', 1, 50, 40);
    expect(layer.x).toBe(18); expect(layer.y).toBe(10); expect(layer.asset.width).toBe(16); expect(layer.asset.height).toBe(12);
    const result = await compose(store, 50, 40, [layer]);
    expect(await sharp(result).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());
  });
  it('exports edited layers clipped at the canvas edges and respects visibility', async () => {
    const asset = await store.saveAsset(await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ff0000' } }).png().toBuffer());
    const layer: PlacedLayer = { id: 'x', name: 'x', role: 'subject', asset, x: -5, y: 10, scale: 2, z: 1, visible: true, locked: false };
    const visible = await sharp(await compose(store, 30, 25, [layer])).raw().toBuffer({ resolveWithObject: true });
    expect(visible.info.width).toBe(30); expect(visible.info.height).toBe(25);
    expect(visible.data[(11 * 30 + 0) * 4 + 3]).toBe(255);
    expect(visible.data[3]).toBe(0);
    const hidden = await sharp(await compose(store, 30, 25, [{ ...layer, visible: false }])).raw().toBuffer();
    expect(hidden.every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
  });
  it('makes interrupted jobs retryable after a restart', async () => {
    const job = await store.createJob('generate', { prompt: 'test', position: { x: 0, y: 0 } });
    await store.updateJob(job.id, { status: 'running' });
    const restored = new Store(directory); await restored.initialize();
    expect(restored.jobs.get(job.id)?.status).toBe('failed');
    expect(restored.jobs.get(job.id)?.error).toContain('重启');
  });
});
