"use client";

import { useEffect, useRef, useState } from "react";
import { Monogram } from "@/components/domain/header-actions";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";

const FRAME = 300; // side of the cropping window on screen, px (export geometry does not depend on FRAME)
const OUT = 256; // size of the exported square, px
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function isImageUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) || /^data:image\//i.test(v);
}
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/**
 * Avatar uploader/editor. Pick a file → a FULLSCREEN editor: drag the image with the mouse, zoom with
 * the wheel or +/-, the circle shows the final crop. The checkmark → we draw the crop onto a canvas → data-URL. Plus
 * a URL field as an alternative. The value is a string (data: or http(s)).
 */
export function AvatarEditor({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const [src, setSrc] = useState<string | null>(null); // image in editing mode (data-URL)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [urlText, setUrlText] = useState(value.startsWith("data:") ? "" : value);

  const editing = src !== null;

  // Frame geometry (shared by the preview and canvas): "cover" base × zoom, center + offset.
  const s0 = nat ? FRAME / Math.min(nat.w, nat.h) : 1;
  const s = s0 * zoom;
  const W = nat ? nat.w * s : FRAME;
  const H = nat ? nat.h * s : FRAME;
  const Lx = FRAME / 2 + offset.x - W / 2;
  const Ly = FRAME / 2 + offset.y - H / 2;

  function clamp(o: { x: number; y: number }) {
    const mx = Math.max(0, (W - FRAME) / 2);
    const my = Math.max(0, (H - FRAME) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  }

  // While the fullscreen editor is open — block background scrolling and bind Esc → cancel.
  useEffect(() => {
    if (!editing) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function pickFile() {
    fileRef.current?.click();
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allows picking the same file again
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSrc(String(reader.result));
      setNat(null);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    reader.readAsDataURL(f);
  }

  function onDown(e: React.PointerEvent) {
    dragRef.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }));
  }
  function onUp() {
    dragRef.current = null;
  }

  function setZoomTo(z: number) {
    setZoom(clampZoom(z));
    setOffset((o) => clamp(o)); // on zoom, re-clamp the offset
  }
  // Wheel zoom TOWARD THE CURSOR: the image point under the mouse stays under the mouse (rather than drifting to the center).
  function onWheel(e: React.WheelEvent) {
    if (!nat) return;
    const newZoom = clampZoom(zoom - e.deltaY * 0.0018); // wheel up → deltaY<0 → zoom +
    if (newZoom === zoom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left; // cursor in frame coordinates
    const cy = e.clientY - rect.top;
    const ratio = newZoom / zoom;
    const newW = W * ratio;
    const newH = H * ratio;
    // New top-left corner so that point (cx,cy) stays in place; from it → offset.
    const newLx = cx - (cx - Lx) * ratio;
    const newLy = cy - (cy - Ly) * ratio;
    const mx = Math.max(0, (newW - FRAME) / 2);
    const my = Math.max(0, (newH - FRAME) / 2);
    setZoom(newZoom);
    setOffset({
      x: Math.max(-mx, Math.min(mx, newLx - FRAME / 2 + newW / 2)),
      y: Math.max(-my, Math.min(my, newLy - FRAME / 2 + newH / 2)),
    });
  }

  function accept() {
    const img = imgRef.current;
    if (!img || !nat) return;
    const sx = -Lx / s;
    const sy = -Ly / s;
    const sSize = FRAME / s;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
    onChange(canvas.toDataURL("image/jpeg", 0.85));
    setSrc(null);
    setNat(null);
  }
  function cancel() {
    setSrc(null);
    setNat(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {editing ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]">
          {/* Top bar: close · hint · reload image */}
          <div className="flex items-center justify-between px-5 py-4">
            <button
              type="button"
              onClick={cancel}
              aria-label="Cancel"
              className="grid h-9 w-9 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <XIcon className="h-5 w-5" />
            </button>
            <span className="text-small text-fg-muted">Drag the image to adjust · scroll to zoom</span>
            <div className="h-9 w-9" aria-hidden />
          </div>

          {/* Center: cropping window + zoom buttons */}
          <div className="relative flex flex-1 items-center justify-center px-6">
            <div
              className="relative touch-none cursor-grab overflow-hidden rounded-2xl bg-black active:cursor-grabbing"
              style={{ width: FRAME, height: FRAME }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              onWheel={onWheel}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={src!}
                alt=""
                draggable={false}
                onLoad={(e) =>
                  setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
                className="pointer-events-none absolute max-w-none select-none"
                style={{ left: Lx, top: Ly, width: W, height: H }}
              />
              {/* Circle guide for the final avatar */}
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="h-[94%] w-[94%] rounded-full ring-1 ring-white/25 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            </div>

            {/* Zoom +/- */}
            <div className="absolute right-6 top-1/2 flex -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoomTo(zoom + 0.25)}
                className="grid h-10 w-10 place-items-center text-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                +
              </button>
              <div className="h-px bg-border" aria-hidden />
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoomTo(zoom - 0.25)}
                className="grid h-10 w-10 place-items-center text-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                −
              </button>
            </div>
          </div>

          {/* Accept — confirmation: green success (token --success), a centered check. */}
          <button
            type="button"
            onClick={accept}
            aria-label="Accept"
            className="absolute bottom-8 right-8 grid h-14 w-14 place-items-center rounded-full bg-success text-[#06231a] shadow-lg shadow-black/40 transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success"
          >
            <CheckIcon className="h-7 w-7" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button type="button" onClick={pickFile} className="group relative flex-none" title="Upload avatar">
            <Monogram name={name} avatarUrl={isImageUrl(value) ? value : undefined} size="xl" />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-caption font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              Upload
            </span>
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Input
              label="Or paste image URL"
              mono
              placeholder="https://…"
              value={urlText}
              onChange={(e) => {
                setUrlText(e.target.value);
                onChange(e.target.value.trim());
              }}
            />
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setUrlText("");
                }}
                className="w-fit text-caption text-fg-faint transition-colors hover:text-danger"
              >
                Remove avatar
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
