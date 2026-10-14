import { HEADER_HEIGHT, itemBounds } from './geometry';
import type { CanvasItem, Job, Point } from './types';

export type CanvasRect = Point & { width: number; height: number };
// Reserve enough room for any generated image card before its aspect ratio is known.
export const GENERATION_SPACE = { width: 380, height: 350 + HEADER_HEIGHT + 30 };

export function generationObstacles(items: CanvasItem[], jobs: Job[], excludingJobId?: string): CanvasRect[] {
  return [
    ...items.map(itemBounds),
    ...jobs.filter(job => job.id !== excludingJobId && job.operation === 'generate'
      && ['queued', 'running'].includes(job.status) && job.position)
      .map(job => ({ ...job.position!, ...GENERATION_SPACE })),
  ];
}

export function findFreePosition(preferred: Point, size: { width: number; height: number }, obstacles: CanvasRect[], gap = 32): Point {
  const clear = (point: Point) => obstacles.every(box => point.x + size.width + gap <= box.x
    || point.x >= box.x + box.width + gap || point.y + size.height + gap <= box.y
    || point.y >= box.y + box.height + gap);
  if (clear(preferred)) return preferred;
  const xs = new Set([preferred.x]), ys = new Set([preferred.y]);
  for (const box of obstacles) {
    xs.add(box.x - size.width - gap); xs.add(box.x + box.width + gap);
    ys.add(box.y - size.height - gap); ys.add(box.y + box.height + gap);
  }
  const candidates = [...xs].flatMap(x => [...ys].map(y => ({ x, y })));
  candidates.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y)
    - Math.hypot(b.x - preferred.x, b.y - preferred.y));
  return candidates.find(clear)!;
}
