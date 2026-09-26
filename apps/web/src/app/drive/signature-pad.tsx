"use client";

import { Eraser } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

export interface SignatureHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
}

/** Finger signature on a canvas; exported as a small PNG for the proof of delivery. */
export function SignaturePad({ ref, onChange }: { ref?: Ref<SignatureHandle>; onChange?: (empty: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear: () => {
      const c = canvas.current!;
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      setEmpty(true);
      onChange?.(true);
    },
    toBlob: () =>
      new Promise((resolve) => {
        if (empty) return resolve(null);
        canvas.current!.toBlob((b) => resolve(b), "image/png");
      }),
  }));

  return (
    <div className="relative">
      <canvas
        ref={canvas}
        aria-label="Sign here"
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-foreground bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          canvas.current!.setPointerCapture(e.pointerId);
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          if (empty) {
            setEmpty(false);
            onChange?.(false);
          }
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      {empty ? (
        <span className="pointer-events-none absolute bottom-2 left-3 text-base text-muted-foreground">Sign here</span>
      ) : (
        <button
          type="button"
          className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border-2 border-foreground bg-white px-2 py-1 text-sm font-semibold"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
            onChange?.(true);
          }}
        >
          <Eraser className="size-4" /> Clear
        </button>
      )}
    </div>
  );
}
