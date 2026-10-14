import { describe, expect, it } from 'vitest';
import { displaySize, HEADER_HEIGHT } from '../shared/geometry';
import { findFreePosition, generationObstacles, GENERATION_SPACE, type CanvasRect } from '../shared/placement';
import type { Job } from '../shared/types';

function overlaps(a: CanvasRect, b: CanvasRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('generation space', () => {
  it('keeps a free preferred position and finds a nearby gap in a crowded canvas', () => {
    expect(findFreePosition({ x: -800, y: -900 }, GENERATION_SPACE, [])).toEqual({ x: -800, y: -900 });
    const occupied = [{ x: -80, y: -40, width: 350, height: 420 }, { x: 280, y: -40, width: 350, height: 420 },
      { x: -80, y: 390, width: 350, height: 420 }];
    const position = findFreePosition({ x: 100, y: 100 }, GENERATION_SPACE, occupied);
    expect(occupied.every(box => !overlaps({ ...position, ...GENERATION_SPACE }, box))).toBe(true);
    expect(Math.hypot(position.x - 100, position.y - 100)).toBeLessThan(700);
  });
  it('reserves queued and running tasks, excluding completed tasks and the task being placed', () => {
    const job = (id: string, status: Job['status'], x: number): Job => ({ id, operation: 'generate', status,
      position: { x, y: 0 }, stage: '', request: {}, createdAt: '', updatedAt: '' });
    const obstacles = generationObstacles([], [job('queued', 'queued', 0), job('running', 'running', 500),
      job('done', 'succeeded', 1000), job('self', 'running', 1500)], 'self');
    expect(obstacles.map(box => box.x)).toEqual([0, 500]);
    const position = findFreePosition({ x: 0, y: 0 }, GENERATION_SPACE, obstacles);
    expect(obstacles.every(box => !overlaps({ ...position, ...GENERATION_SPACE }, box))).toBe(true);
  });
  it('reserves enough room for portrait, square and landscape results', () => {
    for (const [width, height] of [[1080, 1920], [2048, 2048], [1920, 1080], [300, 3000]]) {
      const size = displaySize(width, height);
      expect(Math.max(220, size.width)).toBeLessThanOrEqual(GENERATION_SPACE.width);
      expect(size.height + HEADER_HEIGHT + 30).toBeLessThanOrEqual(GENERATION_SPACE.height);
    }
  });
  it('finds a new position if another card moves into a reservation', () => {
    const occupied = [{ x: 0, y: 0, width: 350, height: 420 }];
    const reserved = findFreePosition({ x: 0, y: 0 }, GENERATION_SPACE, occupied);
    occupied.push({ ...reserved, width: 280, height: 320 });
    const final = findFreePosition(reserved, { width: 350, height: 420 }, occupied);
    expect(final).not.toEqual(reserved);
    expect(occupied.every(box => !overlaps({ ...final, width: 350, height: 420 }, box))).toBe(true);
  });
});
