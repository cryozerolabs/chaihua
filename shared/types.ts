export type Point = { x: number; y: number };
export type Viewport = Point & { scale: number };
export type LayerRole = 'text' | 'subject' | 'decoration' | 'panel' | 'background';

export interface Asset {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface PlacedLayer {
  id: string;
  name: string;
  role: LayerRole;
  asset: Asset;
  x: number;
  y: number;
  scale: number;
  z: number;
  visible: boolean;
  locked: boolean;
}

interface BaseItem {
  id: string;
  kind: 'original' | 'layer-group' | 'variant';
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface OriginalItem extends BaseItem {
  kind: 'original';
  asset: Asset;
  source: 'generated' | 'uploaded';
  prompt?: string;
}

export interface LayerGroupItem extends BaseItem {
  kind: 'layer-group';
  sourceId: string;
  backgroundDescription: string;
  layers: PlacedLayer[];
  expanded: boolean;
}

export interface VariantItem extends BaseItem {
  kind: 'variant';
  sourceId: string;
  presetId: string;
  layers: PlacedLayer[];
  expanded?: boolean;
}

export type LayeredItem = LayerGroupItem | VariantItem;
export type Operation = 'generate' | 'decompose';
export type DecomposeOptions = { mode: 'auto' | 'custom'; instructions?: string };
export type CanvasItem = OriginalItem | LayerGroupItem | VariantItem;
export interface Project { version: 1; items: CanvasItem[]; viewport: Viewport }
export interface ProjectPatch { items?: CanvasItem[]; deleteIds?: string[]; viewport?: Viewport }
export interface Job {
  id: string;
  operation: Operation | 'rearrange'; // Read historical jobs without executing them.
  sourceId?: string;
  position?: Point;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string;
  error?: string;
  result?: { items: CanvasItem[] };
  request: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_PROJECT: Project = { version: 1, items: [], viewport: { x: 0, y: 0, scale: 1 } };
