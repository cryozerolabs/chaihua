import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { readPsd } from 'ag-psd';
import { reorderLayers } from '../shared/layers';
import { Store } from '../server/store';
import { compose } from '../server/imaging';
import { exportPsd } from '../server/exports';
import type { LayerGroupItem, PlacedLayer } from '../shared/types';

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
async function setup() {
  directory = await mkdtemp(path.join(tmpdir(), 'cryo-layer-order-'));
  const store = new Store(directory); await store.initialize();
  const make = async (name: string, color: string, z: number, visible = true): Promise<PlacedLayer> => {
    const asset = await store.saveAsset(await sharp({ create: { width: 4, height: 4, channels: 4, background: color } }).png().toBuffer());
    return { id: asset.id, name, asset, role: 'decoration', x: 0, y: 0, scale: 1, z, visible, locked: !visible };
  };
  const red = await make('红色', '#ff0000', 20), blue = await make('蓝色', '#0000ff', 5), hidden = await make('隐藏图层', '#00ff00', 10, false);
  const group: LayerGroupItem = { id: 'group', kind: 'layer-group', title: '层级', sourceId: 'source', width: 4, height: 4,
    x: 0, y: 0, createdAt: '', expanded: false, backgroundDescription: '', layers: [blue, red, hidden] };
  return { store, group, red, blue, hidden };
}
async function firstPixel(store: Store, group: LayerGroupItem) {
  return [...(await sharp(await compose(store, group.width, group.height, group.layers)).raw().toBuffer()).subarray(0, 4)];
}
describe('layer stacking order', () => {
  it('changes the visible PNG overlap and PSD stacking order, with hidden and locked state preserved', async () => {
    const { store, group, red, blue, hidden } = await setup();
    expect(await firstPixel(store, group)).toEqual([255, 0, 0, 255]);
    const layers = reorderLayers(group.layers, blue.id, red.id, 'before');
    const edited = { ...group, layers };
    expect(await firstPixel(store, edited)).toEqual([0, 0, 255, 255]);
    const psd = readPsd(await exportPsd(store, edited), { useImageData: true });
    expect(psd.children!.map(layer => layer.name)).toEqual(['隐藏图层', '红色', '蓝色']);
    expect(psd.children![0]).toMatchObject({ hidden: true, protected: { position: true } });
    expect(layers.find(layer => layer.id === hidden.id)).toMatchObject({ visible: false, locked: true, x: 0, y: 0, scale: 1, asset: hidden.asset });
    expect(group.layers.find(layer => layer.id === blue.id)!.z).toBe(5);
  });
  it('persists reordered layers and restores the original rendering when the previous item is saved', async () => {
    const { store, group, red, blue } = await setup();
    const edited = { ...group, layers: reorderLayers(group.layers, blue.id, red.id, 'before') };
    await store.patchProject({ items: [edited] });
    const restored = new Store(directory!); await restored.initialize();
    expect(await firstPixel(restored, restored.getItem(group.id) as LayerGroupItem)).toEqual([0, 0, 255, 255]);
    await restored.patchProject({ items: [group] });
    expect(await firstPixel(restored, restored.getItem(group.id) as LayerGroupItem)).toEqual([255, 0, 0, 255]);
  });
  it('handles downward insertion and avoids history edits for unchanged or invalid drops', async () => {
    const { group, red, blue, hidden } = await setup();
    expect(reorderLayers(group.layers, red.id, blue.id, 'after').map(layer => layer.id)).toEqual([hidden.id, blue.id, red.id]);
    expect(reorderLayers(group.layers, red.id, hidden.id, 'before')).toBe(group.layers);
    expect(reorderLayers(group.layers, red.id, red.id, 'after')).toBe(group.layers);
    expect(reorderLayers(group.layers, 'missing', blue.id, 'before')).toBe(group.layers);
  });
});
