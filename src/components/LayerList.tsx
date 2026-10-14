import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Download, Eye, EyeOff, GripVertical, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import type { LayeredItem, PlacedLayer } from '../../shared/types';
import { reorderLayers } from '../../shared/layers';

const roleNames = { text: '文字', subject: '主体', decoration: '装饰', panel: '色块', background: '背景' };
type Props = { item: LayeredItem; selectedId: string | null; exporting: boolean;
  onSelect: (id: string) => void; onChange: (item: LayeredItem) => void; onDownload: (layer: PlacedLayer) => void };

export function LayerList({ item, selectedId, exporting, onSelect, onChange, onDownload }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const dragged = useRef<{ id: string; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const ordered = [...item.layers].sort((a, b) => b.z - a.z);
  const finish = () => { dragged.current = null; setDraggingId(null); setDrop(null); };
  const move = (sourceId: string, targetId: string, edge: 'before' | 'after') => {
    const layers = reorderLayers(item.layers, sourceId, targetId, edge);
    if (layers !== item.layers) onChange({ ...item, layers });
    onSelect(sourceId);
  };
  const targetAt = (x: number, y: number) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.inspector-layer');
    const id = row?.dataset.layerId;
    if (!row || !id || !list.current?.contains(row) || id === dragged.current?.id) return null;
    const rect = row.getBoundingClientRect();
    return { id, edge: y < rect.top + rect.height / 2 ? 'before' as const : 'after' as const };
  };
  const begin = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, active: false };
    onSelect(id);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragged.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5) {
      drag.active = true; setDraggingId(drag.id);
    }
    if (drag.active) setDrop(targetAt(drag.x, drag.y));
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragged.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.active ? targetAt(event.clientX, event.clientY) : null;
    if (target) move(drag.id, target.id, target.edge);
    finish();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => {
    if (!draggingId) return;
    let frame: number;
    const tick = () => {
      const drag = dragged.current;
      const panel = list.current?.closest<HTMLElement>('.layer-inspector');
      if (!drag?.active) return;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        if (drag.x >= rect.left && drag.x <= rect.right && drag.y >= rect.top && drag.y <= rect.bottom) {
          if (drag.y < rect.top + 30) panel.scrollTop -= 8;
          else if (drag.y > rect.bottom - 30) panel.scrollTop += 8;
        }
      }
      const target = targetAt(drag.x, drag.y);
      setDrop(previous => previous?.id === target?.id && previous?.edge === target?.edge ? previous : target);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [draggingId]);
  const pointerProps = (id: string) => ({ onPointerDown: (event: PointerEvent<HTMLButtonElement>) => begin(event, id),
    onPointerMove: pointerMove, onPointerUp: end, onPointerCancel: finish, onLostPointerCapture: finish });
  return <div ref={list} className="inspector-layer-list" aria-label="图层列表，上方图层显示在前面">
    {ordered.map((layer, index) => <div key={layer.id} data-layer-id={layer.id}
      className={`inspector-layer ${selectedId === layer.id ? 'selected' : ''} ${draggingId === layer.id ? 'dragging' : ''} ${drop?.id === layer.id ? `drop-${drop.edge}` : ''}`}>
      <button className="layer-drag-handle" {...pointerProps(layer.id)} aria-label={`调整${layer.name}的层级`} title="拖动调整层级；Alt + ↑ / ↓"
        onClick={() => onSelect(layer.id)} onKeyDown={event => {
          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); const target = ordered[index + (event.key === 'ArrowUp' ? -1 : 1)];
          if (target) move(layer.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after');
        }}><GripVertical size={14} /></button>
      <button className="layer-row" {...pointerProps(layer.id)} onClick={() => onSelect(layer.id)}><span className="layer-thumb"><img src={layer.asset.url} alt="" draggable={false} /></span><span><strong>{layer.name}</strong><small>{roleNames[layer.role]}</small></span></button>
      <button className="icon-button" title={layer.locked ? '解锁图层' : '锁定图层'} aria-label={`${layer.locked ? '解锁' : '锁定'}${layer.name}`}
        onClick={() => onChange({ ...item, layers: item.layers.map(old => old.id === layer.id ? { ...old, locked: !old.locked } : old) })}>{layer.locked ? <LockKeyhole size={14} /> : <LockKeyholeOpen size={14} />}</button>
      <button className="icon-button" title="导出原始素材" aria-label={`导出素材：${layer.name}`} disabled={exporting} onClick={() => onDownload(layer)}><Download size={14} /></button>
      <button className="icon-button" title={layer.visible ? '隐藏图层' : '显示图层'} aria-label={`${layer.visible ? '隐藏' : '显示'}${layer.name}`}
        onClick={() => onChange({ ...item, layers: item.layers.map(old => old.id === layer.id ? { ...old, visible: !old.visible } : old) })}>{layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
    </div>)}
  </div>;
}
