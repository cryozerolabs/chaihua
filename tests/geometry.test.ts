import { describe, expect, it } from 'vitest';
import { fitViewport, itemBounds, screenToWorld, zoomAt } from '../shared/geometry';
import type { OriginalItem } from '../shared/types';

describe('canvas coordinates', () => {
  it('keeps the point under the cursor fixed while zooming', () => {
    const view = { x: 123, y: -48, scale: 0.7 }, pointer = { x: 540, y: 270 };
    const before = screenToWorld(pointer, view);
    const after = screenToWorld(pointer, zoomAt(view, pointer, 1.6));
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
  });
  it('fits portrait and landscape cards without losing their proportions', () => {
    const base = { kind: 'original', title: 'x', createdAt: '', source: 'uploaded', asset: { id: '', url: '', width: 100, height: 100 } } as const;
    const items: OriginalItem[] = [{ ...base, id: 'a', x: -80, y: 40, width: 1080, height: 1920 }, { ...base, id: 'b', x: 500, y: 60, width: 900, height: 383 }];
    const viewport = fitViewport(items, 1280, 800);
    for (const item of items) {
      const box = itemBounds(item);
      expect(viewport.x + box.x * viewport.scale).toBeGreaterThan(0);
      expect(viewport.x + (box.x + box.width) * viewport.scale).toBeLessThan(1280);
      expect(viewport.y + (box.y + box.height) * viewport.scale).toBeLessThan(700);
    }
  });
});
