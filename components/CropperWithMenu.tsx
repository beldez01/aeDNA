// components/CropperWithMenu.tsx
// Image cropping component with square, circle, and custom polygon modes

"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

/** ===== Types ===== */
type CropMode = "square" | "circle" | "custom";

type CropResult = {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  mode: CropMode;
  rect?: { x: number; y: number; w: number; h: number };
  ellipse?: { cx: number; cy: number; rx: number; ry: number };
  polygon?: { points: Array<{ x: number; y: number }> };
};

type BaseProps = {
  src: string;
  width?: number | string;
  onCrop?: (result: CropResult) => void;
  onClipboardUpdate?: (result: CropResult) => void;
  writeToSystemClipboard?: boolean;
  /** Show inline hint text over the image */
  showToolbar?: boolean;
};

type WithMenuProps = BaseProps & {
  /** Optional label for the main button */
  buttonLabel?: string;
  /** Optional className for the wrapper div */
  className?: string;
};

/** =========================================================
 *  Public Component: CropperWithMenu
 *  - Renders a button "Crop" with a dropdown to choose mode
 *  - Activates overlay in selected mode, performs crop, then resets
 *  ======================================================== */
export default function CropperWithMenu({
  src,
  width = "100%",
  onCrop,
  onClipboardUpdate,
  writeToSystemClipboard = true,
  showToolbar = true,
  buttonLabel = "Crop",
  className = "",
}: WithMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<CropMode | null>(null);
  const [lastThumb, setLastThumb] = useState<string | null>(null);

  // Close menu when clicking outside
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onCropWrapped = (res: CropResult) => {
    setLastThumb(res.dataUrl);
    onCrop?.(res);
    // After a successful crop, reset mode so user picks again
    setMode(null);
  };

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="px-3 py-2 rounded-xl bg-neutral-900 text-neutral-100 border border-neutral-800 hover:bg-neutral-800 transition"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {buttonLabel}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="Crop modes"
              className="absolute z-50 mt-2 w-44 rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl overflow-hidden"
            >
              <MenuItem
                label="Square crop"
                kbd="R"
                onClick={() => {
                  setMode("square");
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                label="Circle crop"
                kbd="E"
                onClick={() => {
                  setMode("circle");
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                label="Custom (polygon)"
                kbd="P"
                onClick={() => {
                  setMode("custom");
                  setMenuOpen(false);
                }}
              />
            </div>
          )}
        </div>

        <div className="text-xs text-neutral-400">
          {mode
            ? mode === "square"
              ? "Mode: Square — drag to draw a rectangle, release to crop."
              : mode === "circle"
              ? "Mode: Circle — drag to draw an ellipse, release to crop."
              : "Mode: Custom — click points, double-click or click near first point to close. Esc cancels, Backspace undoes."
            : "Pick a crop mode to begin."}
        </div>
      </div>

      <Cropper
        key={mode ?? "idle"} // reset internal state when mode changes to null->mode
        src={src}
        mode={mode ?? "square"} // not used when mode is null; overlay disabled below
        width={width}
        onCrop={onCropWrapped}
        onClipboardUpdate={onClipboardUpdate}
        writeToSystemClipboard={writeToSystemClipboard}
        showToolbar={Boolean(mode) && showToolbar}
        overlayEnabled={Boolean(mode)}
      />

      {lastThumb && (
        <div className="mt-4">
          <div className="text-xs text-neutral-400 mb-1">Last cropped image</div>
          <img
            src={lastThumb}
            className="w-40 h-auto rounded-lg border border-neutral-800"
            alt="Last cropped"
          />
        </div>
      )}
    </div>
  );
}

/** Simple dropdown row */
function MenuItem({
  label,
  onClick,
  kbd,
}: {
  label: string;
  kbd?: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-800 flex items-center justify-between"
    >
      <span>{label}</span>
      {kbd && (
        <span className="ml-3 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
          {kbd}
        </span>
      )}
    </button>
  );
}

/* =========================================================
 *  Internal Component: Cropper (same as before, plus
 *  `overlayEnabled` prop so the overlay only shows when a
 *  mode has been chosen from the dropdown)
 *  ======================================================= */

type CropperProps = BaseProps & {
  mode: CropMode;
  overlayEnabled?: boolean; // NEW: hide overlay until user chooses a mode
};

export const Cropper: React.FC<CropperProps> = ({
  src,
  mode,
  width = "100%",
  onCrop,
  onClipboardUpdate,
  writeToSystemClipboard = true,
  showToolbar = true,
  overlayEnabled = true,
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [display, setDisplay] = useState({ w: 1, h: 1, scale: 1 });

  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);

  const [poly, setPoly] = useState<Array<{ x: number; y: number }>>([]);
  const [polyClosed, setPolyClosed] = useState(false);

  const maskColor = "rgba(0,0,0,0.45)";
  const strokeColor = "rgba(255,255,255,0.9)";
  const strokeWidth = 2;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const toImageSpace = (pt: { x: number; y: number }) => ({
    x: Math.round(pt.x / display.scale),
    y: Math.round(pt.y / display.scale),
  });

  const rectFromPoints = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    return { x, y, w, h };
  };

  const mousePos = (e: React.MouseEvent) => {
    const canvas = overlayRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    };
  };

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const handle = () => {
      const w = img.clientWidth;
      const h = img.clientHeight;
      const scale = w / natural.w;
      setDisplay({ w, h, scale });
      const cnv = overlayRef.current!;
      cnv.width = Math.max(1, Math.floor(w * dpr));
      cnv.height = Math.max(1, Math.floor(h * dpr));
      cnv.style.width = `${w}px`;
      cnv.style.height = `${h}px`;
      if (overlayEnabled) drawOverlay();
      else clearOverlay();
    };
    handle();
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgLoaded, natural.w, natural.h, dpr, mode, start, end, poly, polyClosed, overlayEnabled]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    setNatural({ w: el.naturalWidth, h: el.naturalHeight });
    setImgLoaded(true);
  };

  const clearOverlay = () => {
    const cnv = overlayRef.current;
    if (!cnv) return;
    const ctx = cnv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, display.w, display.h);
  };

  const drawOverlay = () => {
    if (!overlayEnabled) return;
    const cnv = overlayRef.current;
    if (!cnv) return;
    const ctx = cnv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, display.w, display.h);

    ctx.fillStyle = maskColor;
    ctx.fillRect(0, 0, display.w, display.h);

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();

    if (mode === "square" && start && end) {
      const r = rectFromPoints(start, end);
      ctx.rect(r.x, r.y, r.w, r.h);
    } else if (mode === "circle" && start && end) {
      const r = rectFromPoints(start, end);
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    } else if (mode === "custom") {
      const pts = polyClosed ? poly : poly.concat(end ? [end] : []);
      if (pts.length >= 2) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (polyClosed) ctx.closePath();
      }
    }

    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash(mode === "custom" && !polyClosed ? [6, 6] : []);
    ctx.beginPath();
    if (mode === "square" && start && end) {
      const r = rectFromPoints(start, end);
      ctx.rect(r.x, r.y, r.w, r.h);
    } else if (mode === "circle" && start && end) {
      const r = rectFromPoints(start, end);
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    } else if (mode === "custom") {
      if (poly.length > 0) {
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        if (!polyClosed && end) ctx.lineTo(end.x, end.y);
        if (polyClosed) ctx.closePath();
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const p of poly) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    ctx.stroke();
    ctx.restore();
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!overlayEnabled) return;
    const pos = mousePos(e);
    if (mode === "custom") {
      if (polyClosed) return;
      if (poly.length >= 3) {
        const p0 = poly[0];
        const dx = pos.x - p0.x;
        const dy = pos.y - p0.y;
        if (Math.hypot(dx, dy) <= 10) {
          setPolyClosed(true);
          setEnd(null);
          return;
        }
      }
      setPoly((prev) => prev.concat(pos));
      setEnd(pos);
      drawOverlay();
      return;
    }
    setStart(pos);
    setEnd(pos);
    setDragging(true);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!overlayEnabled) return;
    if (mode === "custom") {
      if (poly.length > 0 && !polyClosed) {
        setEnd(mousePos(e));
        drawOverlay();
      }
      return;
    }
    if (!dragging) return;
    setEnd(mousePos(e));
  };

  const onMouseUp = () => {
    if (!overlayEnabled) return;
    if (mode === "custom") return;
    if (start && end) finalizeRectOrEllipseCrop();
    setDragging(false);
  };

  const onDoubleClick = () => {
    if (!overlayEnabled) return;
    if (mode === "custom" && poly.length >= 3 && !polyClosed) {
      setPolyClosed(true);
      setEnd(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!overlayEnabled) return;
      if (mode !== "custom") return;
      if (e.key === "Escape") {
        setPoly([]);
        setPolyClosed(false);
        setEnd(null);
        drawOverlay();
      } else if (e.key === "Backspace") {
        if (polyClosed) {
          setPolyClosed(false);
        } else {
          setPoly((prev) => prev.slice(0, -1));
        }
        drawOverlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, polyClosed, poly.length, overlayEnabled]);

  useEffect(() => {
    if (!overlayEnabled) return;
    if (mode === "custom" && polyClosed && poly.length >= 3) {
      void finalizePolygonCrop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyClosed, overlayEnabled]);

  const readImage = useMemo(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    return img;
  }, []);
  useEffect(() => {
    readImage.src = src;
  }, [readImage, src]);

  const drawCroppedToCanvas = async (
    pathBuilder: (ctx: CanvasRenderingContext2D) => { bbox: { x: number; y: number; w: number; h: number } }
  ) => {
    const { w: W, h: H } = natural;

    const off = document.createElement("canvas");
    const ctx = off.getContext("2d")!;
    const { bbox } = pathBuilder(ctx);

    off.width = Math.max(1, Math.round(bbox.w));
    off.height = Math.max(1, Math.round(bbox.h));

    const ctx2 = off.getContext("2d")!;
    ctx2.save();
    const { buildShifted } = buildPathFactory(pathBuilder, bbox);
    buildShifted(ctx2);
    ctx2.clip();
    ctx2.drawImage(readImage, -bbox.x, -bbox.y, W, H);
    ctx2.restore();
    return off;
  };

  const buildPathFactory = (
    original: (ctx: CanvasRenderingContext2D) => { bbox: { x: number; y: number; w: number; h: number } },
    bbox: { x: number; y: number; w: number; h: number }
  ) => {
    const bx = bbox.x;
    const by = bbox.y;
    return {
      buildShifted: (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        if (mode === "square" && start && end) {
          const rDisp = rectFromPoints(start, end);
          const rImg = {
            x: Math.round(rDisp.x / display.scale),
            y: Math.round(rDisp.y / display.scale),
            w: Math.round(rDisp.w / display.scale),
            h: Math.round(rDisp.h / display.scale),
          };
          ctx.rect(rImg.x - bx, rImg.y - by, rImg.w, rImg.h);
        } else if (mode === "circle" && start && end) {
          const rDisp = rectFromPoints(start, end);
          const rImg = {
            x: Math.round(rDisp.x / display.scale),
            y: Math.round(rDisp.y / display.scale),
            w: Math.round(rDisp.w / display.scale),
            h: Math.round(rDisp.h / display.scale),
          };
          ctx.ellipse(
            rImg.x - bx + rImg.w / 2,
            rImg.y - by + rImg.h / 2,
            rImg.w / 2,
            rImg.h / 2,
            0,
            0,
            Math.PI * 2
          );
        } else if (mode === "custom") {
          const pts = poly.map(toImageSpace);
          if (pts.length >= 3) {
            ctx.moveTo(pts[0].x - bx, pts[0].y - by);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - bx, pts[i].y - by);
            ctx.closePath();
          }
        }
      },
    };
  };

  const finalizeRectOrEllipseCrop = async () => {
    if (!start || !end) return;
    const rDisp = rectFromPoints(start, end);
    const rImg = {
      x: Math.round(rDisp.x / display.scale),
      y: Math.round(rDisp.y / display.scale),
      w: Math.round(rDisp.w / display.scale),
      h: Math.round(rDisp.h / display.scale),
    };
    const isEllipse = mode === "circle";

    const pathBuilder = (ctx: CanvasRenderingContext2D) => {
      const bbox = { x: rImg.x, y: rImg.y, w: rImg.w, h: rImg.h };
      ctx.beginPath();
      if (isEllipse) {
        ctx.ellipse(rImg.x + rImg.w / 2, rImg.y + rImg.h / 2, rImg.w / 2, rImg.h / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.rect(rImg.x, rImg.y, rImg.w, rImg.h);
      }
      return { bbox };
    };

    const off = await drawCroppedToCanvas(pathBuilder);
    await deliver(off, {
      mode,
      rect: !isEllipse ? rImg : undefined,
      ellipse: isEllipse
        ? { cx: rImg.x + rImg.w / 2, cy: rImg.y + rImg.h / 2, rx: rImg.w / 2, ry: rImg.h / 2 }
        : undefined,
    });
    setStart(null);
    setEnd(null);
    drawOverlay();
  };

  const finalizePolygonCrop = async () => {
    if (poly.length < 3) return;
    const pts = poly.map(toImageSpace);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const bbox = {
      x: Math.max(0, Math.min(...xs)),
      y: Math.max(0, Math.min(...ys)),
      w: Math.min(natural.w, Math.max(...xs)) - Math.max(0, Math.min(...xs)),
      h: Math.min(natural.h, Math.max(...ys)) - Math.max(0, Math.min(...ys)),
    };

    const pathBuilder = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return { bbox };
    };

    const off = await drawCroppedToCanvas(pathBuilder);
    await deliver(off, { mode: "custom", polygon: { points: pts } });
    setPoly([]);
    setPolyClosed(false);
    setEnd(null);
    drawOverlay();
  };

  const deliver = async (
    canvas: HTMLCanvasElement,
    meta: Partial<Omit<CropResult, "blob" | "dataUrl" | "width" | "height">>
  ) => {
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b as Blob), "image/png"));
    const dataUrl = canvas.toDataURL("image/png");
    const result: CropResult = {
      blob,
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      mode: meta.mode as CropMode,
      rect: meta.rect,
      ellipse: meta.ellipse,
      polygon: meta.polygon,
    };
    onCrop?.(result);
    onClipboardUpdate?.(result);

    if (writeToSystemClipboard && "clipboard" in navigator && "write" in navigator.clipboard) {
      try {
        const item = new ClipboardItem({ "image/png": blob });
        await navigator.clipboard.write([item]);
      } catch {
        // Ignore permission errors
      }
    }
  };

  const hint = useMemo(() => {
    if (!overlayEnabled) return "";
    if (mode === "square") return "Drag to draw a rectangle. Release to crop.";
    if (mode === "circle") return "Drag to draw an ellipse/circle. Release to crop.";
    return "Click to place vertices. Double-click or click near the first point to close. Esc cancels, Backspace undoes.";
  }, [mode, overlayEnabled]);

  return (
    <div style={{ width }} className="relative select-none">
      {showToolbar && overlayEnabled && (
        <div className="mb-2 flex items-center gap-3 text-xs text-neutral-300">
          <span className="px-2 py-1 rounded-lg bg-neutral-900/70 border border-neutral-800">{hint}</span>
        </div>
      )}
      <div className="relative inline-block">
        <img
          ref={imgRef}
          src={src}
          alt="to crop"
          onLoad={onImgLoad}
          style={{ display: "block", width: "100%", height: "auto", borderRadius: "12px" }}
        />
        <canvas
          ref={overlayRef}
          className={`absolute inset-0 ${overlayEnabled ? "cursor-crosshair" : "pointer-events-none"}`}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onDoubleClick={onDoubleClick}
        />
      </div>
    </div>
  );
}
