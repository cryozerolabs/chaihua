import type { CanvasItem, Point, Viewport } from './types';

export const HEADER_HEIGHT = 40;
export function displaySize(width: number, height: number) {
  const scale = Math.min(380 / width, 350 / height);
  return { width: width * scale, height: height * scale, scale };
}
export function itemBounds(item: CanvasItem) {
  const size = displaySize(item.width, item.height);
  return { x: item.x, y: item.y, width: Math.max(size.width, 220), height: HEADER_HEIGHT + size.height + 30 };
}
export function screenToWorld(point: Point, viewport: Viewport): Point {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
}
export function zoomAt(viewport: Viewport, point: Point, scale: number): Viewport {
  const next = Math.max(0.15, Math.min(3, scale));
  const world = screenToWorld(point, viewport);
  return { x: point.x - world.x * next, y: point.y - world.y * next, scale: next };
}
export function fitViewport(items: CanvasItem[], width: number, height: number): Viewport {
  if (!items.length) return { x: 0, y: 0, scale: 1 };
  const bounds = items.map(itemBounds);
  const left = Math.min(...bounds.map(b => b.x));
  const top = Math.min(...bounds.map(b => b.y));
  const right = Math.max(...bounds.map(b => b.x + b.width));
  const bottom = Math.max(...bounds.map(b => b.y + b.height));
  const availableHeight = Math.max(150, height - 250);
  const scale = Math.min(1.2, Math.max(0.15, Math.min((width - 120) / (right - left), availableHeight / (bottom - top))));
  return { x: (width - (right - left) * scale) / 2 - left * scale, y: 40 + (availableHeight - (bottom - top) * scale) / 2 - top * scale, scale };
}
