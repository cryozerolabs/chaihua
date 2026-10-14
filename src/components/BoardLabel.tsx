import { useEffect, useRef } from "react";
import { ImagePlus, Layers3 } from "lucide-react";
import type { CanvasItem, Viewport } from "../../shared/types";
import { itemBounds } from "../../shared/geometry";

interface Props {
  item: CanvasItem;
  viewport: Viewport;
  onSelect: (id: string) => void;
  onPreview: (item: CanvasItem) => void;
  onCommit: (item: CanvasItem, before: CanvasItem) => void;
}

export function BoardLabel({
  item,
  viewport,
  onSelect,
  onPreview,
  onCommit,
}: Props) {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    before: CanvasItem;
    last: CanvasItem;
    scale: number;
    moved: boolean;
  } | null>(null);
  const callbacks = useRef({ onPreview, onCommit });
  callbacks.current = { onPreview, onCommit };
  const box = itemBounds(item);
  const name =
    item.kind === "original"
      ? "原图"
      : item.kind === "layer-group"
        ? `图层组 · ${item.layers.length} 层`
        : `${item.title} · ${item.layers.length} 层`;
  useEffect(() => {
    const cancel = () => {
      if (drag.current?.moved) callbacks.current.onPreview(drag.current.before);
      drag.current = null;
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.startX,
        dy = event.clientY - current.startY;
      if (!current.moved && Math.hypot(dx, dy) < 3) return;
      current.moved = true;
      current.last = {
        ...current.before,
        x: current.before.x + dx / current.scale,
        y: current.before.y + dy / current.scale,
      };
      callbacks.current.onPreview(current.last);
    };
    const finish = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      drag.current = null;
      if (current.moved)
        callbacks.current.onCommit(current.last, current.before);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  return (
    <button
      data-item-id={item.id}
      aria-label={`选择${name}：${item.title}`}
      title="拖动标题栏移动整个对象"
      className={`board-label ${item.kind}`}
      style={{
        left: viewport.x + item.x * viewport.scale + 10,
        top: viewport.y + item.y * viewport.scale + 5,
        width: Math.max(65, box.width * viewport.scale - 20),
        height: Math.max(17, 30 * viewport.scale),
      }}
      onClick={() => onSelect(item.id)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        onSelect(item.id);
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          before: structuredClone(item),
          last: item,
          scale: viewport.scale,
          moved: false,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* Window listeners also cover browsers without pointer capture. */
        }
      }}
    >
      {item.kind === "original" ? (
        <ImagePlus size={13} />
      ) : (
        <Layers3 size={13} />
      )}
      <span>{name}</span>
    </button>
  );
}
