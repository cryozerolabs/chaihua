import sharp, { type OverlayOptions } from 'sharp';
import { randomUUID } from 'node:crypto';
import type { LayerRole, PlacedLayer } from '../shared/types';
import type { Store } from './store';

export async function prepareLayer(store: Store, buffer: Buffer, role: LayerRole, name: string, z: number, width: number, height: number): Promise<PlacedLayer> {
  const png = await sharp(buffer).resize(width, height, { fit: 'fill' }).ensureAlpha().png().toBuffer();
  let left = 0, top = 0, cropWidth = width, cropHeight = height;
  if (role !== 'background') {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * info.channels + info.channels - 1] > 8) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) throw new Error(`图层“${name}”没有可见内容，请重试拆层。`);
    left = Math.max(0, minX - 2); top = Math.max(0, minY - 2);
    cropWidth = Math.min(width, maxX + 3) - left; cropHeight = Math.min(height, maxY + 3) - top;
  }
  const asset = await store.saveAsset(await sharp(png).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer());
  return { id: randomUUID(), name, role, asset, x: left, y: top, scale: 1, z, visible: true, locked: role === 'background' };
}

export async function compose(store: Store, width: number, height: number, layers: PlacedLayer[]): Promise<Buffer> {
  const inputs: OverlayOptions[] = [];
  for (const layer of [...layers].filter(l => l.visible).sort((a, b) => a.z - b.z)) {
    const asset = await store.readAsset(layer.asset);
    const w = Math.max(1, Math.round(layer.asset.width * layer.scale));
    const h = Math.max(1, Math.round(layer.asset.height * layer.scale));
    const image = await sharp(asset).resize(w, h).png().toBuffer();
    const x = Math.round(layer.x), y = Math.round(layer.y);
    const left = Math.max(0, x), top = Math.max(0, y);
    const clipWidth = Math.min(width, x + w) - left, clipHeight = Math.min(height, y + h) - top;
    if (clipWidth <= 0 || clipHeight <= 0) continue;
    inputs.push({ input: await sharp(image).extract({ left: left - x, top: top - y, width: clipWidth, height: clipHeight }).png().toBuffer(), left, top });
  }
  return sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).composite(inputs).png().toBuffer();
}

export async function visionImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

export async function contactSheet(images: Buffer[]): Promise<Buffer> {
  const columns = 3, cellWidth = 360, cellHeight = 280;
  const overlays: OverlayOptions[] = [];
  for (const [index, image] of images.entries()) {
    const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
    const thumbnail = await sharp(image).resize({ width: 332, height: 215, fit: 'contain', background: '#eef0f6' }).png().toBuffer();
    overlays.push({ input: thumbnail, left: x + 14, top: y + 12 });
    const svg = `<svg width="360" height="40"><text x="14" y="25" font-family="sans-serif" font-size="18" fill="#252a3a">${index + 1}</text></svg>`;
    overlays.push({ input: Buffer.from(svg), left: x, top: y + 230 });
  }
  return sharp({ create: { width: columns * cellWidth, height: Math.ceil(images.length / columns) * cellHeight, channels: 4, background: '#f8f9fc' } }).composite(overlays).png().toBuffer();
}
