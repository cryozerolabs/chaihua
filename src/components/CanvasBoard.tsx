import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Text, Image as CanvasImage, Transformer } from 'react-konva';
import Konva from 'konva';
import type { CanvasItem, PlacedLayer, Point, Project, Viewport } from '../../shared/types';
import { displaySize, HEADER_HEIGHT, itemBounds, zoomAt } from '../../shared/geometry';

Konva.dragButtons = [0];

const imageCache = new Map<string, HTMLImageElement>();
function useImages(urls: string[]) {
  const key = [...new Set(urls)].sort().join('|');
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    let canceled = false;
    void Promise.all(key.split('|').filter(Boolean).map(url => new Promise<[string, HTMLImageElement | undefined]>(resolve => {
      const cached = imageCache.get(url);
      if (cached) return resolve([url, cached]);
      const image = new window.Image();
      image.onload = () => { imageCache.set(url, image); resolve([url, image]); };
      image.onerror = () => resolve([url, undefined]);
      image.src = url;
    }))).then(entries => {
      if (!canceled) setImages(Object.fromEntries(entries.filter((entry): entry is [string, HTMLImageElement] => Boolean(entry[1]))));
    });
    return () => { canceled = true; };
  }, [key]);
  return images;
}

function makeChecker() {
  const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fafbfe'; context.fillRect(0, 0, 20, 20);
  context.fillStyle = '#e8ebf3'; context.fillRect(0, 0, 10, 10); context.fillRect(10, 10, 10, 10);
  const image = new window.Image(); image.src = canvas.toDataURL();
  return image;
}

interface Props {
  project: Project;
  width: number;
  height: number;
  selectedId: string | null;
  editingId: string | null;
  activeLayerId: string | null;
  onSelect: (id: string | null) => void;
  onSelectLayer: (id: string | null) => void;
  onChangeItem: (item: CanvasItem) => void;
  onViewport: (viewport: Viewport) => void;
}

export function CanvasBoard(props: Props) {
  const stage = useRef<Konva.Stage>(null);
  const pan = useRef<{ start: Point; viewport: Viewport } | null>(null);
  const [space, setSpace] = useState(false);
  const checker = useMemo(makeChecker, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setSpace(true); }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  return <Stage ref={stage} width={props.width} height={props.height}
    x={props.project.viewport.x} y={props.project.viewport.y} scaleX={props.project.viewport.scale} scaleY={props.project.viewport.scale}
    style={{ cursor: space || pan.current ? 'grab' : 'default' }}
    onWheel={event => {
      event.evt.preventDefault();
      const pointer = stage.current?.getPointerPosition(); if (!pointer) return;
      const direction = event.evt.deltaY < 0 ? 1.08 : 1 / 1.08;
      props.onViewport(zoomAt(props.project.viewport, pointer, props.project.viewport.scale * direction));
    }}
    onMouseDown={event => {
      if (event.target === stage.current || space || event.evt.button === 1) {
        event.evt.preventDefault();
        const pointer = stage.current?.getPointerPosition();
        if (pointer) pan.current = { start: pointer, viewport: { ...props.project.viewport } };
        if (!space && event.evt.button === 0) { props.onSelect(null); props.onSelectLayer(null); }
      }
    }}
    onMouseMove={() => {
      if (!pan.current) return;
      const pointer = stage.current?.getPointerPosition(); if (!pointer) return;
      props.onViewport({ ...pan.current.viewport, x: pan.current.viewport.x + pointer.x - pan.current.start.x, y: pan.current.viewport.y + pointer.y - pan.current.start.y });
    }}
    onMouseUp={() => { pan.current = null; }} onMouseLeave={() => { pan.current = null; }}>
    <Layer>
      {props.project.items.map(item => <BoardItem key={item.id} item={item} checker={checker}
        selected={props.selectedId === item.id} editing={props.editingId === item.id} activeLayerId={props.activeLayerId}
        canDrag={!space} onSelect={props.onSelect} onSelectLayer={props.onSelectLayer} onChange={props.onChangeItem} />)}
    </Layer>
  </Stage>;
}

interface ItemProps {
  item: CanvasItem;
  checker: HTMLImageElement;
  selected: boolean;
  editing: boolean;
  activeLayerId: string | null;
  canDrag: boolean;
  onSelect: Props['onSelect'];
  onSelectLayer: Props['onSelectLayer'];
  onChange: Props['onChangeItem'];
}

function BoardItem({ item, checker, selected, editing, activeLayerId, canDrag, onSelect, onSelectLayer, onChange }: ItemProps) {
  const size = displaySize(item.width, item.height);
  const bounds = itemBounds(item);
  const previewX = (bounds.width - size.width) / 2;
  const layers = item.kind === 'original' ? [] : item.layers;
  const images = useImages(item.kind === 'original' ? [item.asset.url] : layers.map(layer => layer.asset.url));
  const transformer = useRef<Konva.Transformer>(null);
  const layerRefs = useRef(new Map<string, Konva.Image>());
  const sortedLayers = [...layers].filter(layer => layer.visible).sort((a,b) => a.z - b.z);
  useEffect(() => {
    const target = activeLayerId ? layerRefs.current.get(activeLayerId) : undefined;
    transformer.current?.nodes(editing && target && !layers.find(layer => layer.id === activeLayerId)?.locked ? [target] : []);
    transformer.current?.getLayer()?.batchDraw();
  }, [editing, activeLayerId, layers]);
  function changeLayer(id: string, patch: Partial<PlacedLayer>) {
    if (item.kind === 'original') return;
    onChange({ ...item, layers: item.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer) });
  }
  return <Group x={item.x} y={item.y} draggable={canDrag && item.kind==='original'}
    onMouseDown={event => { if (!canDrag || event.evt.button!==0) return; event.cancelBubble = true; onSelect(item.id); }}
    onTap={() => onSelect(item.id)}
    onDragEnd={event => {
      if (event.target !== event.currentTarget) return;
      onChange({ ...item, x: event.target.x(), y: event.target.y() });
    }}>
    <Rect width={bounds.width} height={bounds.height} fill="#ffffff" cornerRadius={12}
      stroke={selected ? '#7770eb' : '#e2e5ed'} strokeWidth={selected ? 2 : 1}
      shadowColor="#30375e" shadowBlur={selected ? 18 : 10} shadowOpacity={selected ? 0.12 : 0.05} shadowOffsetY={4} />
    <Group x={previewX} y={HEADER_HEIGHT} scaleX={size.scale} scaleY={size.scale} clip={{ x:0,y:0,width:item.width,height:item.height }}>
      <Rect width={item.width} height={item.height} fillPatternImage={checker} fillPatternScaleX={1 / size.scale} fillPatternScaleY={1 / size.scale} />
      {item.kind === 'original'
        ? <CanvasImage image={images[item.asset.url]} width={item.width} height={item.height} />
        : sortedLayers.map(layer => <CanvasImage key={layer.id} ref={node => { if (node) layerRefs.current.set(layer.id, node); else layerRefs.current.delete(layer.id); }}
          image={images[layer.asset.url]} x={layer.x} y={layer.y} width={layer.asset.width} height={layer.asset.height}
          scaleX={layer.scale} scaleY={layer.scale} draggable={canDrag && !layer.locked}
          onMouseDown={event => { if(canDrag && event.evt.button===0) { event.cancelBubble=true;onSelect(item.id);onSelectLayer(layer.id); } }}
          onTap={event => { if(canDrag) { event.cancelBubble=true;onSelect(item.id);onSelectLayer(layer.id); } }}
          onDragEnd={event => { event.cancelBubble = true; changeLayer(layer.id, { x: event.target.x(), y: event.target.y() }); }}
          onTransformEnd={event => {
            event.cancelBubble = true;
            changeLayer(layer.id, { x: event.target.x(), y: event.target.y(), scale: event.target.scaleX() });
          }} />)}
    </Group>
    {editing && <Group x={previewX} y={HEADER_HEIGHT} scaleX={size.scale} scaleY={size.scale}><Transformer ref={transformer} rotateEnabled={false} keepRatio={true} flipEnabled={false}
        enabledAnchors={['top-left','top-right','bottom-left','bottom-right']}
        anchorSize={8} borderStrokeWidth={1.4}
        anchorStroke="#665fe0" borderStroke="#665fe0" anchorFill="white" anchorCornerRadius={2}
        boundBoxFunc={(oldBox, newBox) => Math.abs(newBox.width) < 18 || Math.abs(newBox.height) < 18 ? oldBox : newBox} /></Group>}
    <Text x={12} y={HEADER_HEIGHT + size.height + 9} width={bounds.width - 24}
      text={`${item.width} × ${item.height}${item.kind === 'original' ? item.source === 'uploaded' ? '  ·  已上传' : '  ·  已生成' : item.kind === 'variant' ? '  ·  可编辑' : '  ·  RGBA'}`}
      fontSize={10} fill="#989caf" fontFamily="sans-serif" />
  </Group>;
}
