import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { readPsd } from "ag-psd";
import { exportPsd } from "../server/exports";
import { Store } from "../server/store";
import { compose } from "../server/imaging";
import type { LayerGroupItem, PlacedLayer } from "../shared/types";

let store: Store, directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "cryo-export-"));
  store = new Store(directory);
  await store.initialize();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("layered PSD export", () => {
  it("preserves pixels outside the canvas, scaled layer bounds, stacking, visibility and alpha", async () => {
    const asset = await store.saveAsset(
      await sharp({
        create: {
          width: 12,
          height: 8,
          channels: 4,
          background: { r: 220, g: 60, b: 25, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer(),
    );
    const make = (id: string, z: number, visible: boolean): PlacedLayer => ({
      id,
      name: id,
      role: "subject",
      asset,
      x: -5,
      y: 6,
      scale: 2,
      z,
      visible,
      locked: !visible,
    });
    const group: LayerGroupItem = {
      id: "group",
      kind: "layer-group",
      sourceId: "original",
      title: "export",
      width: 30,
      height: 20,
      x: 999,
      y: -999,
      createdAt: "",
      expanded: false,
      backgroundDescription: "",
      layers: [make("隐藏素材", 5, false), make("可见素材", 1, true)],
    };
    const psd = readPsd(await exportPsd(store, group), {
      useImageData: true,
      skipThumbnail: true,
    });
    expect(psd.width).toBe(30);
    expect(psd.height).toBe(20);
    expect(psd.children!.map((l) => l.name)).toEqual(["可见素材", "隐藏素材"]);
    const visible = psd.children![0],
      hidden = psd.children![1];
    expect(visible).toMatchObject({
      left: -5,
      top: 6,
      right: 19,
      bottom: 22,
      hidden: false,
    });
    expect(visible.imageData).toMatchObject({ width: 24, height: 16 });
    expect(visible.imageData!.data[3]).toBe(128);
    expect(hidden.hidden).toBe(true);
    expect(hidden.protected?.position).toBe(true);
    // Recompose the actual decoded PSD layers, including the off-canvas pixels.
    const decoded: PlacedLayer[] = [];
    for (const [index, layer] of psd.children!.entries()) {
      const pixels = layer.imageData!;
      const png = await sharp(Buffer.from(pixels.data), {
        raw: { width: pixels.width, height: pixels.height, channels: 4 },
      })
        .png()
        .toBuffer();
      decoded.push({
        ...make(layer.name!, index, !layer.hidden),
        asset: await store.saveAsset(png),
        x: layer.left!,
        y: layer.top!,
        scale: 1,
      });
    }
    expect(
      await sharp(await compose(store, 30, 20, decoded))
        .raw()
        .toBuffer(),
    ).toEqual(
      await sharp(await compose(store, 30, 20, group.layers))
        .raw()
        .toBuffer(),
    );
  });
});
