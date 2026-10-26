// Client-side crop/rotate preview. The server does the real work: it applies
// EXIF orientation, then `rotate`, then crops to `crop` (pixels of that rotated image).
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icon } from "./ui";

const RATIO = 4 / 5; // portrait headshot

export default function PhotoCropper({ file, onChange }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [img, setImg] = useState(null);
  const [rotate, setRotate] = useState(0);
  const [box, setBox] = useState(null); // in display pixels
  const [scale, setScale] = useState(1); // natural px per display px
  const drag = useRef(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im); // browsers apply EXIF orientation to <img>
    im.src = url;
    setRotate(0);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // draw rotated image and initialise crop box
  useEffect(() => {
    if (!img || !canvasRef.current || !wrapRef.current) return;
    const rot = ((rotate % 360) + 360) % 360;
    const w = rot % 180 === 0 ? img.naturalWidth : img.naturalHeight;
    const h = rot % 180 === 0 ? img.naturalHeight : img.naturalWidth;
    const maxW = Math.min(wrapRef.current.clientWidth || 360, 520);
    const maxH = 440;
    const s = Math.min(maxW / w, maxH / h, 1);
    const c = canvasRef.current;
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    setScale(1 / s);
    let bw = c.width;
    let bh = bw / RATIO;
    if (bh > c.height) {
      bh = c.height;
      bw = bh * RATIO;
    }
    bw *= 0.9;
    bh *= 0.9;
    setBox({ x: (c.width - bw) / 2, y: Math.max(0, (c.height - bh) / 3), w: bw, h: bh });
  }, [img, rotate]);

  // report crop in natural pixels
  useEffect(() => {
    if (!box) return;
    onChange({
      rotate,
      crop: { x: Math.round(box.x * scale), y: Math.round(box.y * scale), width: Math.round(box.w * scale), height: Math.round(box.h * scale) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, scale, rotate]);

  const clamp = useCallback((b) => {
    const c = canvasRef.current;
    const w = Math.max(60, Math.min(b.w, c.width));
    const h = w / RATIO > c.height ? c.height : w / RATIO;
    const ww = h * RATIO;
    return { w: ww, h, x: Math.max(0, Math.min(b.x, c.width - ww)), y: Math.max(0, Math.min(b.y, c.height - h)) };
  }, []);

  const start = (mode) => (e) => {
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    drag.current = { mode, sx: p.clientX, sy: p.clientY, box };
    const move = (ev) => {
      const q = ev.touches ? ev.touches[0] : ev;
      const d = drag.current;
      const dx = q.clientX - d.sx;
      const dy = q.clientY - d.sy;
      if (d.mode === "move") setBox(clamp({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }));
      else setBox(clamp({ ...d.box, w: d.box.w + dx }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  const nudge = (e) => {
    if (!box) return;
    const step = e.shiftKey ? 20 : 5;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (m) {
      e.preventDefault();
      setBox(clamp({ ...box, x: box.x + m[0], y: box.y + m[1] }));
    }
    if (e.key === "+" || e.key === "=") setBox(clamp({ ...box, w: box.w + step }));
    if (e.key === "-") setBox(clamp({ ...box, w: box.w - step }));
  };

  if (!file) return null;
  return (
    <div className="cropper" ref={wrapRef}>
      <div className="cropper-stage">
        <canvas ref={canvasRef} />
        {box && (
          <div
            className="crop-box"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            onMouseDown={start("move")}
            onTouchStart={start("move")}
            tabIndex={0}
            role="slider"
            aria-label="Crop area. Use arrow keys to move, plus and minus to resize."
            aria-valuenow={Math.round(box.w)}
            onKeyDown={nudge}
          >
            <span className="crop-handle" onMouseDown={(e) => (e.stopPropagation(), start("resize")(e))} onTouchStart={(e) => (e.stopPropagation(), start("resize")(e))} />
          </div>
        )}
      </div>
      <div className="cropper-tools">
        <Button size="sm" onClick={() => setRotate((r) => r - 90)}>
          <Icon name="rotate" size={14} className="flip" /> Rotate left
        </Button>
        <Button size="sm" onClick={() => setRotate((r) => r + 90)}>
          <Icon name="rotate" size={14} /> Rotate right
        </Button>
        <span className="muted small">Drag to frame the face. The corner handle resizes.</span>
      </div>
    </div>
  );
}

export function PhotoPicker({ onFile, label = "Choose photo", multiple }) {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const handle = (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    onFile(multiple ? files : files[0]);
  };
  return (
    <div className="photo-picker">
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple={multiple} onChange={handle} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
      <Button icon="upload" onClick={() => fileRef.current.click()}>{label}</Button>
      <Button icon="camera" className="only-touch" onClick={() => camRef.current.click()}>Take photo</Button>
    </div>
  );
}
