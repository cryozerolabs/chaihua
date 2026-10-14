import sharp from "sharp";
import {
  initializeCanvas,
  writePsdBuffer,
  type Layer,
  type PixelData,
} from "ag-psd";
import type { LayeredItem } from "../shared/types";
import type { Store } from "./store";
import { compose } from "./imaging";

// Raw RGBA avoids browser canvas and alpha premultiplication in PSD exports.
initializeCanvas(
  () => {
    throw new Error("PSD 导出使用原始像素，不生成 Canvas 缩略图。");
  },
  (width, height) => ({
    width,
    height,
    colorSpace: "srgb",
    data: new Uint8ClampedArray(width * height * 4),
  }),
);

async function pixels(buffer: Buffer): Promise<PixelData> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data),
  };
}

export async function exportPsd(
  store: Store,
  item: LayeredItem,
): Promise<Buffer> {
  const children: Layer[] = [];
  let pixelCount = item.width * item.height;
  for (const layer of [...item.layers].sort((a, b) => a.z - b.z)) {
    const width = Math.max(1, Math.round(layer.asset.width * layer.scale));
    const height = Math.max(1, Math.round(layer.asset.height * layer.scale));
    pixelCount += width * height;
    if (width > 30000 || height > 30000 || pixelCount > 100_000_000)
      throw new Error("当前 PSD 图层尺寸过大，请缩小图层后重新导出。");
    const scaled = await sharp(await store.readAsset(layer.asset))
      .resize(width, height)
      .png()
      .toBuffer();
    const left = Math.round(layer.x),
      top = Math.round(layer.y);
    children.push({
      name: layer.name,
      left,
      top,
      right: left + width,
      bottom: top + height,
      blendMode: "normal",
      opacity: 1,
      hidden: !layer.visible,
      protected: {
        position: layer.locked,
        composite: layer.locked,
        transparency: layer.locked,
      },
      imageData: await pixels(scaled),
    });
  }
  return writePsdBuffer(
    {
      width: item.width,
      height: item.height,
      children,
      imageData: await pixels(
        await compose(store, item.width, item.height, item.layers),
      ),
    },
    { generateThumbnail: false, noBackground: true, trimImageData: false },
  );
}
