import type { PlacedLayer } from './types';

/** Inspector order is front to back; exported pixels use z from back to front. */
export function reorderLayers(layers: PlacedLayer[], sourceId: string, targetId: string, edge: 'before' | 'after'): PlacedLayer[] {
  const ordered = [...layers].sort((a, b) => b.z - a.z);
  const source = ordered.find(layer => layer.id === sourceId);
  if (!source || sourceId === targetId || !ordered.some(layer => layer.id === targetId)) return layers;
  const next = ordered.filter(layer => layer.id !== sourceId);
  const targetIndex = next.findIndex(layer => layer.id === targetId);
  next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, source);
  if (next.every((layer, index) => layer.id === ordered[index].id)) return layers;
  return next.map((layer, index) => ({ ...layer, z: next.length - index - 1 }));
}
