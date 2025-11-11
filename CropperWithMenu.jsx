"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

export default function CropperWithMenu({
  src,
  width = "100%",
  onCrop,
  onClipboardUpdate,
  writeToSystemClipboard = true,
  showToolbar = true,
  buttonLabel = "Crop",
  className = "",
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState(null);
  const [lastThumb, setLastThumb] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onCropWrapped = (res) => {
    setLastThumb(res.dataUrl);
    onCrop?.(res);
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
              <MenuItem label="Square crop" onClick={() => { setMode("square"); setMenuOpen(false); }} />
              <MenuItem label="Circle crop" onClick={() => { setMode("circle"); setMenuOpen(false); }} />
              <MenuItem label="Custom (polygon)" onClick={() => { setMode("custom"); setMenuOpen(false); }} />
            </div>
          )}
        </div>

        <div className="text-xs text-neutral-400">
          {mode
            ? mode === "square"
              ? "Mode: Square — drag to draw a rectangle, release to crop."
              : mode === "circle"
              ? "Mode: Circle — drag to draw an ellipse, release to crop."
              : "Mode: Custom — click points, double-click or click near the first point to close. Esc cancels, Backspace undoes."
            : "Pick a crop mode to begin."}
        </div>
      </div>

      <Cropper
        key={mode ?? "idle"}
        src={src}
        mode={mode ?? "square"}
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

function MenuItem({ label, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-800 flex items-center justify-between"
    >
      <span>{label}</span>
    </button>
  );
}

// Simplified Cropper core
function Cropper({
  src,
  mode,
  width = "100%",
  onCrop,
  onClipboardUpdate,
  writeToSystemClipboard = true,
  showToolbar = true,
  overlayEnabled = true,
}) {
  const imgRef = useRef(null);
  const overlayRef = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [display, setDisplay] = useState({ w: 1, h: 1, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [poly, setPoly] = useState([]);
  const [polyClosed, setPolyClosed] = useState(false);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const onImgLoad = (e) => {
    const el = e.currentTarget;
    setNatural({ w: el.naturalWidth, h: el.naturalHeight });
    setImgLoaded(true);
  };

  // ... simplified drawing/cropping logic ...
  // You can paste the rest of the logic from the TSX version here

  return (
    <div style={{ width }} className="relative select-none">
      {showToolbar && overlayEnabled && (
        <div className="mb-2 flex items-center gap-3 text-xs text-neutral-300">
          <span className="px-2 py-1 rounded-lg bg-neutral-900/70 border border-neutral-800">
            Crop active ({mode})
          </span>
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
          className="absolute inset-0 cursor-crosshair"
        />
      </div>
    </div>
  );
}
