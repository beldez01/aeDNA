// app/recombiner/page.tsx
// Aesthetic Genome Recombiner - Enhanced with full head capture

"use client";

import React, { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import Delaunator from "delaunator";
import { ToolHeader } from "../../components/ToolHeader";
import { ClipboardViewer, ClipboardButton, saveToClipboard } from "../../components/ClipboardViewer";
import { Cropper } from "../../components/CropperWithMenu";

const MODEL_URL = "/models";

// ========== Helper Functions ==========

function meanPoint(points: number[][]) {
  const n = points.length;
  let x = 0, y = 0;
  for (const [px, py] of points) { x += px; y += py; }
  return [x / n, y / n];
}

function eyeCentersFrom68(pts: number[][]) {
  const leftIdx = [36, 37, 38, 39, 40, 41];
  const rightIdx = [42, 43, 44, 45, 46, 47];
  const left = meanPoint(leftIdx.map(i => pts[i]));
  const right = meanPoint(rightIdx.map(i => pts[i]));
  return { left, right };
}

function computeAffine(srcTri: number[][], dstTri: number[][]) {
  const [x0, y0] = srcTri[0];
  const [x1, y1] = srcTri[1];
  const [x2, y2] = srcTri[2];
  const [u0, v0] = dstTri[0];
  const [u1, v1] = dstTri[1];
  const [u2, v2] = dstTri[2];

  const denom = (x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1)) || 1e-6;
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / denom;
  const b = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / denom;
  const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / denom;
  const c = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / denom;
  const d = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / denom;
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / denom;

  return [a, c, b, d, e, f];
}

function drawTriangleFromImage(ctx: CanvasRenderingContext2D, imageCanvas: HTMLCanvasElement, srcTri: number[][], dstTri: number[][]) {
  const [a, c, b, d, e, f] = computeAffine(srcTri, dstTri);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dstTri[0][0], dstTri[0][1]);
  ctx.lineTo(dstTri[1][0], dstTri[1][1]);
  ctx.lineTo(dstTri[2][0], dstTri[2][1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, c, b, d, e, f);
  ctx.drawImage(imageCanvas, 0, 0);
  ctx.restore();
}

function alignFaceToFrame(
  image: HTMLImageElement,
  pts: number[][],
  W: number,
  H: number,
  anchors: { leftEye: number[]; rightEye: number[]; scale: number }
) {
  const { left, right } = eyeCentersFrom68(pts);
  const eyeDx = right[0] - left[0];
  const eyeDy = right[1] - left[1];
  const eyeDist = Math.hypot(eyeDx, eyeDy);
  const targetDx = anchors.rightEye[0] - anchors.leftEye[0];
  const targetDy = anchors.rightEye[1] - anchors.leftEye[1];
  const targetDist = Math.hypot(targetDx, targetDy);

  const scale = (targetDist / eyeDist) * (anchors.scale || 1.0);
  const angle = Math.atan2(eyeDy, eyeDx);
  const targetAngle = Math.atan2(targetDy, targetDx);
  const rot = targetAngle - angle;

  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const octx = off.getContext("2d")!;

  octx.save();
  octx.translate(anchors.leftEye[0], anchors.leftEye[1]);
  octx.rotate(rot);
  octx.scale(scale, scale);
  octx.translate(-left[0], -left[1]);
  octx.drawImage(image, 0, 0);
  octx.restore();

  const cos = Math.cos(rot), sin = Math.sin(rot);
  const alignedPoints = pts.map(([x, y]) => {
    let tx = x - left[0];
    let ty = y - left[1];
    let rx = tx * cos - ty * sin;
    let ry = tx * sin + ty * cos;
    rx *= scale;
    ry *= scale;
    rx += anchors.leftEye[0];
    ry += anchors.leftEye[1];
    return [rx, ry];
  });

  return { alignedCanvas: off, alignedPoints };
}

// ==== Head mask (includes forehead, hair, ears, neck) ====

function createHeadMask(pts: number[][], W: number, H: number): HTMLCanvasElement {
  const mask = document.createElement("canvas");
  mask.width = W;
  mask.height = H;
  const ctx = mask.getContext("2d")!;

  // Bounds from all landmarks
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x,y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const faceW = maxX - minX;
  const faceH = maxY - minY;
  const cx = (minX + maxX) / 2;

  // Key geometry from 68-point model
  const jawLeft = pts[0];
  const jawRight = pts[16];
  const chin = pts[8];
  const browY = Math.min(
    pts[17][1], pts[18][1], pts[19][1], pts[20][1],
    pts[21][1], pts[22][1], pts[23][1], pts[24][1],
    pts[25][1], pts[26][1]
  );
  const eyes = eyeCentersFrom68(pts);
  const eyeMidY = (eyes.left[1] + eyes.right[1]) / 2;

  // Expansion ratios tuned to include full head + neck
  const topExtra = faceH * 1.6;      // MUCH more room above for full forehead/hair
  const sideExtra = faceW * 0.5;     // more room for ears/hair sides
  const neckExtra = faceH * 0.7;     // neck length

  const topY = browY - topExtra;     // Start from brow, extend way up
  const leftX = Math.min(minX, jawLeft[0]) - sideExtra;
  const rightX = Math.max(maxX, jawRight[0]) + sideExtra;
  const chinY = chin[1];
  const bottomY = chinY + neckExtra;

  // Head ellipse - directly use the expanded bounds
  const headCx = cx;
  const headCy = (topY + bottomY) / 2;  // Center between expanded top and bottom
  const rx = (rightX - leftX) / 2;      // Width from expanded left to right
  const ry = (bottomY - topY) / 2;      // Height from expanded top to bottom

  ctx.save();
  ctx.fillStyle = "white";

  // Draw head ellipse using full expanded bounds
  ctx.beginPath();
  ctx.ellipse(headCx, headCy, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // Add a soft neck trapezoid under the jaw
  const neckWidthTop = (jawRight[0] - jawLeft[0]) * 0.85;
  const neckWidthBottom = neckWidthTop * 0.9;
  const neckLeftTop = cx - neckWidthTop / 2;
  const neckRightTop = cx + neckWidthTop / 2;
  const neckLeftBottom = cx - neckWidthBottom / 2;
  const neckRightBottom = cx + neckWidthBottom / 2;

  ctx.beginPath();
  ctx.moveTo(neckLeftTop, chinY);
  ctx.lineTo(neckRightTop, chinY);
  ctx.lineTo(neckRightBottom, bottomY);
  ctx.lineTo(neckLeftBottom, bottomY);
  ctx.closePath();
  ctx.fill();

  // Feather edges
  const feather = 10;
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d")!;
  tctx.drawImage(mask, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.filter = `blur(${feather}px)`;
  ctx.drawImage(tmp, 0, 0);
  ctx.filter = "none";
  ctx.restore();

  return mask;
}

// ========== Main Component ==========

export default function RecombinerPage() {
  const [ready, setReady] = useState(false);
  const [parentA, setParentA] = useState<HTMLImageElement | null>(null);
  const [parentB, setParentB] = useState<HTMLImageElement | null>(null);
  const [previewA, setPreviewA] = useState<string | null>(null);
  const [previewB, setPreviewB] = useState<string | null>(null);
  const [lmA, setLmA] = useState<number[][] | null>(null);
  const [lmB, setLmB] = useState<number[][] | null>(null);
  const [weightA, setWeightA] = useState(0.5);
  const [mode, setMode] = useState<"shape" | "tone" | "both">("both");
  const [busy, setBusy] = useState(false);
  const [isDraggingA, setIsDraggingA] = useState(false);
  const [isDraggingB, setIsDraggingB] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [clipboardTarget, setClipboardTarget] = useState<"A" | "B" | null>(null);
  const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
  const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
  const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showCropMenu, setShowCropMenu] = useState(false);
  const cropMenuRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpARef = useRef<HTMLCanvasElement>(null);
  const warpBRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    (async () => {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
        setReady(true);
      } catch (err) {
        console.error("Failed to load face-api.js models:", err);
        alert("Face-api.js models not found. Please download models to /public/models/");
      }
    })();
  }, []);

  const handleFile = (file: File, which: "A" | "B") => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      setBusy(true);
      try {
        // Try with lower threshold for better detection
        const detections = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ 
            inputSize: 512,  // Larger input for better accuracy
            scoreThreshold: 0.2  // Lower threshold to catch more faces
          }))
          .withFaceLandmarks(true);
        
        if (!detections) {
          alert("No face detected. Please ensure:\n• Face is clearly visible and well-lit\n• Face is front-facing\n• Image is not too small or blurry");
          setBusy(false);
          return;
        }
        
        // Get 68 landmark points
        const landmarks = detections.landmarks.positions.map((p: any) => [p.x, p.y]);
        
        if (landmarks.length !== 68) {
          alert("Face landmarks incomplete. Try a different image.");
          setBusy(false);
          return;
        }
        
        if (which === "A") {
          setParentA(img);
          setPreviewA(url);
          setLmA(landmarks);
        } else {
          setParentB(img);
          setPreviewB(url);
          setLmB(landmarks);
        }
        setBusy(false);
      } catch (err) {
        console.error("Face detection error:", err);
        alert("Face detection failed. Please try another image.");
        setBusy(false);
      }
    };
    img.onerror = () => {
      alert("Failed to load image. Please try another file.");
      setBusy(false);
    };
    img.src = url;
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>, which: "A" | "B") => {
    const file = e.target.files?.[0];
    if (file) handleFile(file, which);
  };

  const onDrop = (e: React.DragEvent, which: "A" | "B") => {
    e.preventDefault();
    if (which === "A") setIsDraggingA(false);
    else setIsDraggingB(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file, which);
  };

  const openClipboardFor = (which: "A" | "B") => {
    setClipboardTarget(which);
    setClipboardOpen(true);
  };

  const handleClipboardImage = (record: any) => {
    if (!clipboardTarget) return;
    const blob = record.blob;
    const file = new File([blob], record.name || "image.png", { type: blob.type });
    handleFile(file, clipboardTarget);
    setClipboardOpen(false);
    setClipboardTarget(null);
  };

  // Cropping handlers
  const handleCrop = (type: "square" | "circle" | "custom") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setOutputDataURL(canvas.toDataURL("image/png"));
    setCropMode(type);
    setShowCropMenu(false);
  };

  const onCrop = (result: { blob: Blob; dataUrl: string; width: number; height: number }) => {
    setCroppedResult({ blob: result.blob, dataUrl: result.dataUrl });
    setCropMode(null);
  };

  const exportToStudio = async () => {
    if (!croppedResult) return;
    try {
      await saveToClipboard(croppedResult.blob, `genome_cropped_${Date.now()}.png`);
      alert("✓ Saved to Studio clipboard!");
      setCroppedResult(null);
    } catch (err) {
      console.error("Clipboard error:", err);
      alert("Failed to save to clipboard");
    }
  };

  // Close crop menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (cropMenuRef.current && !cropMenuRef.current.contains(event.target as Node)) {
        setShowCropMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const renderHybrid = async () => {
    if (!(parentA && parentB && lmA && lmB) || busy) return;
    setBusy(true);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const W = 900;
    const H = 1100;
    canvas.width = W;
    canvas.height = H;

    ctx.clearRect(0, 0, W, H);

    // Eyes sit a bit lower; larger scale to guarantee full head
    const anchors = {
      leftEye: [W * 0.36, H * 0.36],
      rightEye: [W * 0.64, H * 0.36],
      scale: 1.95,
    };

    const { alignedCanvas: aCanvas, alignedPoints: aPts } = alignFaceToFrame(parentA, lmA, W, H, anchors);
    const { alignedCanvas: bCanvas, alignedPoints: bPts } = alignFaceToFrame(parentB, lmB, W, H, anchors);

    const wA = weightA;
    const wB = 1 - weightA;
    const hybridPts = aPts.map((p, i) => [p[0] * wA + bPts[i][0] * wB, p[1] * wA + bPts[i][1] * wB]);

    const tri = Delaunator.from(hybridPts).triangles;

    const warpA = warpARef.current!;
    const warpB = warpBRef.current!;
    warpA.width = W;
    warpA.height = H;
    warpB.width = W;
    warpB.height = H;
    const wctxA = warpA.getContext("2d")!;
    const wctxB = warpB.getContext("2d")!;

    // NEW: Head mask instead of tight face ellipse
    const headMask = createHeadMask(hybridPts, W, H);
    
    wctxA.clearRect(0, 0, W, H);
    wctxB.clearRect(0, 0, W, H);

    for (let i = 0; i < tri.length; i += 3) {
      const ia = tri[i], ib = tri[i + 1], ic = tri[i + 2];
      const dst = [hybridPts[ia], hybridPts[ib], hybridPts[ic]];
      const srcA = [aPts[ia], aPts[ib], aPts[ic]];
      const srcB = [bPts[ia], bPts[ib], bPts[ic]];

      drawTriangleFromImage(wctxA, aCanvas, srcA, dst);
      drawTriangleFromImage(wctxB, bCanvas, srcB, dst);
    }

    // Composite warped heads with mask
    const compositeA = document.createElement("canvas");
    compositeA.width = W;
    compositeA.height = H;
    const compCtxA = compositeA.getContext("2d")!;
    compCtxA.drawImage(warpA, 0, 0);
    compCtxA.globalCompositeOperation = "destination-in";
    compCtxA.drawImage(headMask, 0, 0);
    
    const compositeB = document.createElement("canvas");
    compositeB.width = W;
    compositeB.height = H;
    const compCtxB = compositeB.getContext("2d")!;
    compCtxB.drawImage(warpB, 0, 0);
    compCtxB.globalCompositeOperation = "destination-in";
    compCtxB.drawImage(headMask, 0, 0);

    // Background: softly blurred full aligned images (fills any gaps)
    ctx.save();
    ctx.filter = "blur(12px)";
    ctx.globalAlpha = wA * 0.85;
    ctx.drawImage(aCanvas, 0, 0, W, H);
    ctx.globalAlpha = wB * 0.85;
    ctx.drawImage(bCanvas, 0, 0, W, H);
    ctx.restore();
    ctx.filter = "none";
    
    // Draw sharp hybrid head on top
    ctx.save();
    if (mode === "shape") {
      ctx.drawImage(compositeA, 0, 0);
    } else if (mode === "tone") {
      ctx.drawImage(compositeA, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = wB * 0.5;
      ctx.drawImage(compositeB, 0, 0);
    } else {
      ctx.globalAlpha = 1;
      ctx.drawImage(compositeA, 0, 0);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = wB;
      ctx.drawImage(compositeB, 0, 0);
    }
    ctx.restore();

    setBusy(false);
  };

  useEffect(() => {
    if (parentA && parentB && lmA && lmB) {
      renderHybrid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentA, parentB, lmA, lmB, weightA, mode]);

  function reset() {
    setWeightA(0.5);
    setMode("both");
  }

  return (
    <div className="min-h-screen w-full bg-[#0D0D0F] text-neutral-200">
      <ToolHeader />
      <main className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Genome Recombiner</h1>

        {!ready && (
          <div className="text-center py-8 text-neutral-500">Loading face detection models...</div>
        )}

        {ready && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Parent A - Smaller */}
            <div className="lg:col-span-3 space-y-3">
              <div className="text-sm text-neutral-400">Parent A</div>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingA(true); }}
                onDragLeave={() => setIsDraggingA(false)}
                onDrop={(e) => onDrop(e, "A")}
                className={`relative rounded-lg border overflow-hidden transition ${
                  isDraggingA ? "border-dashed border-teal-400" : "border-neutral-800"
                }`}
                style={{minHeight: '120px', maxHeight: '500px'}}
              >
                {previewA ? (
                  <img src={previewA} alt="Parent A" className="w-full h-auto object-cover" />
                ) : (
                  <div className="grid place-items-center bg-black/30 p-6" style={{minHeight: '120px'}}>
                    <div className="text-center">
                      <div className="text-xs text-neutral-400 mb-2">Drag & drop or upload</div>
                      <div className="text-[10px] text-neutral-500 mb-2">Front-facing selfie</div>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openClipboardFor("A");
                        }}
                        className="text-[11px] text-teal-400 hover:text-teal-300 underline"
                      >
                        Choose from Clipboard
                      </button>
                    </div>
                  </div>
                )}
                <label className="absolute inset-0 cursor-pointer" style={{ pointerEvents: previewA ? 'auto' : 'none' }}>
                  <input type="file" accept="image/*" onChange={(e) => onFile(e, "A")} className="hidden" disabled={busy} />
                </label>
                {busy && lmA === null && (
                  <div className="absolute inset-0 bg-black/50 grid place-items-center">
                    <div className="text-xs text-neutral-300">Detecting face...</div>
                  </div>
                )}
              </div>
              {lmA && (
                <div className="text-[10px] text-teal-400">✓ 68 landmarks detected</div>
              )}
            </div>

            {/* Hybrid - Larger */}
            <div className="lg:col-span-6 space-y-4">
              {parentA && parentB && lmA && lmB && !cropMode && (
                <div className="flex justify-end gap-2 mb-2">
                  <div className="relative" ref={cropMenuRef}>
                    <button
                      onClick={() => setShowCropMenu(!showCropMenu)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    >
                      ✂️ Crop
                    </button>
                    {showCropMenu && (
                      <div className="absolute top-full right-0 mt-1 w-32 rounded-lg border border-neutral-800 bg-neutral-900/95 backdrop-blur shadow-2xl z-50 overflow-hidden">
                        <button onClick={() => handleCrop("square")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Square</button>
                        <button onClick={() => handleCrop("circle")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Circle</button>
                        <button onClick={() => handleCrop("custom")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Custom</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="aspect-[9/11] w-full">
                {cropMode && outputDataURL ? (
                  <div className="relative w-full h-full">
                    <button
                      onClick={() => setCropMode(null)}
                      className="absolute top-2 right-2 z-10 px-3 py-1 rounded-lg bg-red-800/90 hover:bg-red-700 border border-red-700 text-xs"
                    >
                      Cancel
                    </button>
                    <Cropper
                      src={outputDataURL}
                      mode={cropMode}
                      onCrop={onCrop}
                    />
                  </div>
                ) : (
                  <>
                    <canvas
                      ref={canvasRef}
                      width={900}
                      height={1100}
                      className="w-full h-full rounded-2xl bg-black/60 border border-neutral-800 shadow-[0_0_40px_rgba(125,211,252,0.2)]"
                    />
                    <canvas ref={warpARef} className="hidden" />
                    <canvas ref={warpBRef} className="hidden" />
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-300">Parent Influence — A: {(weightA*100).toFixed(0)}% / B: {((1-weightA)*100).toFixed(0)}%</label>
                    <input type="range" min={0} max={1} step={0.01} value={weightA} onChange={(e) => setWeightA(parseFloat(e.target.value))} className="w-full accent-teal-400" />
                  </div>

                  <div className="flex gap-2 items-center mt-3">
                    <button
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs transition ${
                        mode === "shape" ? "border-teal-400 text-teal-400 bg-teal-500/10" : "border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                      }`}
                      onClick={() => setMode("shape")}
                    >
                      Shape
                    </button>
                    <button
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs transition ${
                        mode === "tone" ? "border-teal-400 text-teal-400 bg-teal-500/10" : "border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                      }`}
                      onClick={() => setMode("tone")}
                    >
                      Tone
                    </button>
                    <button
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs transition ${
                        mode === "both" ? "border-teal-400 text-teal-400 bg-teal-500/10" : "border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                      }`}
                      onClick={() => setMode("both")}
                    >
                      Both
                    </button>
                    <button
                      className="px-3 py-2 rounded-lg border border-neutral-800 text-neutral-400 hover:bg-neutral-800 text-xs transition"
                      onClick={reset}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Parent B - Smaller */}
            <div className="lg:col-span-3 space-y-3">
              <div className="text-sm text-neutral-400">Parent B</div>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingB(true); }}
                onDragLeave={() => setIsDraggingB(false)}
                onDrop={(e) => onDrop(e, "B")}
                className={`relative rounded-lg border overflow-hidden transition ${
                  isDraggingB ? "border-dashed border-teal-400" : "border-neutral-800"
                }`}
                style={{minHeight: '120px', maxHeight: '500px'}}
              >
                {previewB ? (
                  <img src={previewB} alt="Parent B" className="w-full h-auto object-cover" />
                ) : (
                  <div className="grid place-items-center bg-black/30 p-6" style={{minHeight: '120px'}}>
                    <div className="text-center">
                      <div className="text-xs text-neutral-400 mb-2">Drag & drop or upload</div>
                      <div className="text-[10px] text-neutral-500 mb-2">Front-facing selfie</div>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openClipboardFor("B");
                        }}
                        className="text-[11px] text-teal-400 hover:text-teal-300 underline"
                      >
                        Choose from Clipboard
                      </button>
                    </div>
                  </div>
                )}
                <label className="absolute inset-0 cursor-pointer" style={{ pointerEvents: previewB ? 'auto' : 'none' }}>
                  <input type="file" accept="image/*" onChange={(e) => onFile(e, "B")} className="hidden" disabled={busy} />
                </label>
                {busy && lmB === null && previewB && (
                  <div className="absolute inset-0 bg-black/50 grid place-items-center">
                    <div className="text-xs text-neutral-300">Detecting face...</div>
                  </div>
                )}
              </div>
              {lmB && (
                <div className="text-[10px] text-teal-400">✓ 68 landmarks detected</div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Export Dialog */}
      {croppedResult && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setCroppedResult(null)}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">Export Cropped Image</h3>
            <img src={croppedResult.dataUrl} alt="cropped" className="w-full h-auto rounded-xl border border-neutral-800 mb-4" />
            <div className="flex gap-3">
              <button
                onClick={exportToStudio}
                className="flex-1 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 text-sm"
              >
                📋 Export to Studio
              </button>
              <button
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = croppedResult.dataUrl;
                  a.download = `genome_cropped_${Date.now()}.png`;
                  a.click();
                  setCroppedResult(null);
                }}
                className="flex-1 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
              >
                💾 Download
              </button>
              <button
                onClick={() => setCroppedResult(null)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clipboard Viewer */}
      <ClipboardViewer 
        isOpen={clipboardOpen} 
        onClose={() => {
          setClipboardOpen(false);
          setClipboardTarget(null);
        }}
        onImageSelect={handleClipboardImage}
      />
      
      {/* Clipboard Button */}
      <ClipboardButton onClick={() => openClipboardFor("A")} />
    </div>
  );
}
