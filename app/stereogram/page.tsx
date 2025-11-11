// app/stereogram/page.tsx
// StereogramLab - Autostereogram & Stereo Pair Generator

"use client";

import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Download } from "lucide-react";
import { ToolHeader } from "../../components/ToolHeader";
import { ClipboardViewer, ClipboardButton, saveToClipboard } from "../../components/ClipboardViewer";
import { Cropper } from "../../components/CropperWithMenu";

// ========== Types ==========

type GenMode = "autostereo" | "stereo-pair";

type Options = {
  maxDisparity: number;
  minDisparity: number;
  textureWidth: number;
  useColoredAutostereo: boolean;
  gammaDepth: number;
  smoothDepth: number;
  processingWidth: number;
};

// ========== Utilities ==========

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function toGrayscaleLuminosity(img: ImageData): Float32Array {
  const { width, height, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    out[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

function normalize01(buf: Float32Array) {
  let min = Infinity, max = -Infinity;
  for (const v of buf) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = (buf[i] - min) / range;
  return out;
}

function applyGamma(buf01: Float32Array, gamma: number) {
  const out = new Float32Array(buf01.length);
  const g = Math.max(0.2, Math.min(5, gamma));
  for (let i = 0; i < buf01.length; i++) out[i] = Math.pow(buf01[i], g);
  return out;
}

function boxBlurGray(buf01: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) return buf01;
  const tmp = new Float32Array(buf01.length);
  const out = new Float32Array(buf01.length);
  const r = Math.floor(radius);
  const w = width;
  const h = height;
  const kernel = 2 * r + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    let acc = 0;
    let idx = y * w;
    for (let x = -r; x <= r; x++) acc += buf01[idx + clamp(x, 0, w - 1)];
    tmp[idx] = acc / kernel;
    for (let x = 1; x < w; x++) {
      const add = buf01[idx + clamp(x + r, 0, w - 1)];
      const rem = buf01[idx + clamp(x - r - 1, 0, w - 1)];
      acc += add - rem;
      tmp[idx + x] = acc / kernel;
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    out[x] = acc / kernel;
    for (let y = 1; y < h; y++) {
      const add = tmp[clamp(y + r, 0, h - 1) * w + x];
      const rem = tmp[clamp(y - r - 1, 0, h - 1) * w + x];
      acc += add - rem;
      out[y * w + x] = acc / kernel;
    }
  }
  return out;
}

function resizeImageData(img: ImageData, targetWidth: number): { img: ImageData; scale: number } {
  const { width, height } = img;
  if (width <= targetWidth) return { img, scale: 1 };
  const s = targetWidth / width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * s));
  canvas.height = Math.max(1, Math.floor(height * s));
  const ctx = canvas.getContext("2d")!;
  const c2 = document.createElement("canvas");
  c2.width = width;
  c2.height = height;
  const cx2 = c2.getContext("2d")!;
  cx2.putImageData(img, 0, 0);
  ctx.drawImage(c2, 0, 0, canvas.width, canvas.height);
  const small = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { img: small, scale: s };
}

function imageToImageData(imgEl: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = imgEl.naturalWidth;
  c.height = imgEl.naturalHeight;
  const cx = c.getContext("2d")!;
  cx.drawImage(imgEl, 0, 0);
  return cx.getImageData(0, 0, c.width, c.height);
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function depthToDisparity(depth01: Float32Array, width: number, height: number, minDisp: number, maxDisp: number): Float32Array {
  const out = new Float32Array(depth01.length);
  for (let i = 0; i < depth01.length; i++) {
    const d = lerp(minDisp, maxDisp, depth01[i]);
    out[i] = d;
  }
  return out;
}

// ========== Autostereogram Generator ==========

function generateAutostereogram(disparity: Float32Array, baseColor: ImageData | null, options: Options): ImageData {
  const width = options.processingWidth;
  const height = Math.floor(disparity.length / width);
  const out = new ImageData(width, height);

  const textureWidth = clamp(Math.floor(options.textureWidth), 16, 512);
  const texture = new Uint8ClampedArray(textureWidth * 4);
  for (let x = 0; x < textureWidth; x++) {
    if (baseColor) {
      const bx = Math.floor((x / textureWidth) * baseColor.width);
      const by = Math.floor(baseColor.height * 0.5);
      const bi = (by * baseColor.width + bx) * 4;
      const i = x * 4;
      texture[i] = baseColor.data[bi];
      texture[i + 1] = baseColor.data[bi + 1];
      texture[i + 2] = baseColor.data[bi + 2];
      texture[i + 3] = 255;
    } else {
      const i = x * 4;
      const v = 180 + ((x * 97) % 70);
      texture[i] = v;
      texture[i + 1] = 200 - ((x * 53) % 60);
      texture[i + 2] = 160 + ((x * 29) % 80);
      texture[i + 3] = 255;
    }
  }

  const parent = new Int32Array(width);
  const colorR = new Int16Array(width).fill(-1);
  const colorG = new Int16Array(width).fill(-1);
  const colorB = new Int16Array(width).fill(-1);
  const depthWin = new Float32Array(width);

  function find(a: number): number {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  }

  function union(a: number, b: number) {
    a = find(a);
    b = find(b);
    if (a === b) return;
    parent[b] = a;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      parent[x] = x;
      depthWin[x] = 1e9;
      colorR[x] = colorG[x] = colorB[x] = -1;
    }

    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const d = Math.round(disparity[rowOff + x]);
      const xl = x - Math.floor(d / 2);
      const xr = xl + d;
      if (xl < 0 || xr < 0 || xl >= width || xr >= width) continue;
      const z = 1 - Math.abs(d);
      if (z <= depthWin[xl] && z <= depthWin[xr]) {
        union(xl, xr);
        depthWin[xl] = depthWin[xr] = z;
      }
    }

    for (let x = 0; x < width; x++) {
      const r = find(x);
      if (colorR[r] === -1) {
        const tIndex = (x % textureWidth) * 4;
        let R = texture[tIndex];
        let G = texture[tIndex + 1];
        let B = texture[tIndex + 2];

        if (options.useColoredAutostereo && baseColor) {
          const bx = Math.floor((x / width) * baseColor.width);
          const by = Math.floor((y / height) * baseColor.height);
          const bi = (by * baseColor.width + bx) * 4;
          R = (R * 0.5 + baseColor.data[bi] * 0.5) | 0;
          G = (G * 0.5 + baseColor.data[bi + 1] * 0.5) | 0;
          B = (B * 0.5 + baseColor.data[bi + 2] * 0.5) | 0;
        }

        colorR[r] = R;
        colorG[r] = G;
        colorB[r] = B;
      }
    }

    for (let x = 0; x < width; x++) {
      const r = find(x);
      const i = (rowOff + x) * 4;
      out.data[i] = colorR[r];
      out.data[i + 1] = colorG[r];
      out.data[i + 2] = colorB[r];
      out.data[i + 3] = 255;
    }
  }

  return out;
}

// ========== Stereo Pair Generator ==========

function generateStereoPair(baseColor: ImageData, disparity: Float32Array, options: Options): { left: ImageData; right: ImageData } {
  const width = options.processingWidth;
  const height = Math.floor(disparity.length / width);
  const left = new ImageData(width, height);
  const right = new ImageData(width, height);

  for (let i = 0; i < left.data.length; i += 4) left.data[i + 3] = 255;
  for (let i = 0; i < right.data.length; i += 4) right.data[i + 3] = 255;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const d = disparity[rowOff + x];
      const dl = Math.round(-d / 2);
      const dr = Math.round(+d / 2);

      const xs = x;
      const bx = Math.floor((xs / width) * baseColor.width);
      const by = Math.floor((y / height) * baseColor.height);
      const bi = (by * baseColor.width + bx) * 4;
      const R = baseColor.data[bi];
      const G = baseColor.data[bi + 1];
      const B = baseColor.data[bi + 2];

      const xl = x + dl;
      const xr = x + dr;
      if (xl >= 0 && xl < width) {
        const iL = (rowOff + xl) * 4;
        left.data[iL] = R;
        left.data[iL + 1] = G;
        left.data[iL + 2] = B;
        left.data[iL + 3] = 255;
      }
      if (xr >= 0 && xr < width) {
        const iR = (rowOff + xr) * 4;
        right.data[iR] = R;
        right.data[iR + 1] = G;
        right.data[iR + 2] = B;
        right.data[iR + 3] = 255;
      }
    }
  }

  return { left, right };
}

// ========== Main Component ==========

const DEFAULTS: Options = {
  maxDisparity: 48,
  minDisparity: 0,
  textureWidth: 96,
  useColoredAutostereo: false,
  gammaDepth: 1.0,
  smoothDepth: 1,
  processingWidth: 768,
};

export default function StereogramPage() {
  const [mode, setMode] = useState<GenMode>("autostereo");
  const [opts, setOpts] = useState<Options>(DEFAULTS);
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [depthFile, setDepthFile] = useState<File | null>(null);
  const [basePreview, setBasePreview] = useState<string | null>(null);
  const [depthPreview, setDepthPreview] = useState<string | null>(null);
  const [isDraggingBase, setIsDraggingBase] = useState(false);
  const [isDraggingDepth, setIsDraggingDepth] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [clipboardTarget, setClipboardTarget] = useState<"base" | "depth" | null>(null);
  const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
  const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
  const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showCropMenu, setShowCropMenu] = useState(false);
  const [cropTarget, setCropTarget] = useState<"auto" | "left" | "right" | null>(null);
  const cropMenuRef = useRef<HTMLDivElement>(null);

  const outCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleFileBase = (file: File) => {
    setBaseFile(file);
    setBasePreview(URL.createObjectURL(file));
  };

  const handleFileDepth = (file: File) => {
    setDepthFile(file);
    setDepthPreview(URL.createObjectURL(file));
  };

  const onFileBase = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileBase(file);
  };

  const onFileDepth = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileDepth(file);
  };

  const onDropBase = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingBase(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileBase(file);
  };

  const onDropDepth = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingDepth(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileDepth(file);
  };

  const openClipboardFor = (target: "base" | "depth") => {
    setClipboardTarget(target);
    setClipboardOpen(true);
  };

  const handleClipboardImage = (record: any) => {
    if (!clipboardTarget) return;
    const blob = record.blob;
    const file = new File([blob], record.name || "image.png", { type: blob.type });
    if (clipboardTarget === "base") {
      handleFileBase(file);
    } else {
      handleFileDepth(file);
    }
    setClipboardOpen(false);
    setClipboardTarget(null);
  };

  // Cropping handlers
  const handleCrop = (type: "square" | "circle" | "custom", target: "auto" | "left" | "right") => {
    let canvas: HTMLCanvasElement | null = null;
    if (target === "auto") canvas = outCanvasRef.current;
    else if (target === "left") canvas = leftCanvasRef.current;
    else if (target === "right") canvas = rightCanvasRef.current;
    
    if (!canvas) return;
    setOutputDataURL(canvas.toDataURL("image/png"));
    setCropMode(type);
    setCropTarget(target);
    setShowCropMenu(false);
  };

  const onCrop = (result: { blob: Blob; dataUrl: string; width: number; height: number }) => {
    setCroppedResult({ blob: result.blob, dataUrl: result.dataUrl });
    setCropMode(null);
  };

  const exportToStudio = async () => {
    if (!croppedResult) return;
    try {
      await saveToClipboard(croppedResult.blob, `stereogram_cropped_${Date.now()}.png`);
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

  const run = async () => {
    let baseImgData: ImageData | null = null;
    if (baseFile) {
      const img = await fileToImage(baseFile);
      baseImgData = imageToImageData(img);
    }

    let depthImgData: ImageData | null = null;
    if (depthFile) {
      const dimg = await fileToImage(depthFile);
      depthImgData = imageToImageData(dimg);
    }

    let refImg: ImageData | null = baseImgData || depthImgData;
    if (!refImg) {
      alert("Provide at least a base image or a depth map.");
      return;
    }

    const { img: refSmall } = resizeImageData(refImg, opts.processingWidth);

    let colorSmall: ImageData | null = null;
    if (baseImgData) {
      const { img: cs } = resizeImageData(baseImgData, opts.processingWidth);
      colorSmall = cs;
    }

    let depth01: Float32Array;
    if (depthImgData) {
      const { img: dsmall } = resizeImageData(depthImgData, opts.processingWidth);
      depth01 = normalize01(toGrayscaleLuminosity(dsmall));
    } else {
      depth01 = normalize01(toGrayscaleLuminosity(refSmall));
    }

    depth01 = applyGamma(depth01, opts.gammaDepth);
    depth01 = boxBlurGray(depth01, refSmall.width, refSmall.height, opts.smoothDepth);

    const disparity = depthToDisparity(depth01, refSmall.width, refSmall.height, opts.minDisparity, opts.maxDisparity);

    if (mode === "autostereo") {
      const result = generateAutostereogram(disparity, opts.useColoredAutostereo ? colorSmall : null, { ...opts, processingWidth: refSmall.width });
      const c = outCanvasRef.current!;
      c.width = result.width;
      c.height = result.height;
      const cx = c.getContext("2d")!;
      cx.putImageData(result, 0, 0);
    } else {
      if (!colorSmall) {
        alert("Stereo pair needs a base color image.");
        return;
      }
      const { left, right } = generateStereoPair(colorSmall, disparity, { ...opts, processingWidth: refSmall.width });
      const cl = leftCanvasRef.current!;
      const cr = rightCanvasRef.current!;
      cl.width = left.width;
      cl.height = left.height;
      cr.width = right.width;
      cr.height = right.height;
      cl.getContext("2d")!.putImageData(left, 0, 0);
      cr.getContext("2d")!.putImageData(right, 0, 0);
    }
  };

  function downloadCanvas(canvas: HTMLCanvasElement | null, name: string) {
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  return (
    <div className="min-h-screen w-full bg-[#0D0D0F] text-neutral-200">
      <ToolHeader />
      <main className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Stereogram Lab</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input + Controls */}
          <div>
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <div className="space-y-3">
                {/* Mode selector */}
                <div>
                  <div className="text-xs text-neutral-300 mb-2">Generation Mode</div>
                  <div className="inline-flex p-0.5 bg-neutral-900/60 rounded-xl border border-neutral-800 w-full">
                    <button
                      onClick={() => setMode("autostereo")}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${mode === "autostereo" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}
                    >
                      Autostereogram
                    </button>
                    <button
                      onClick={() => setMode("stereo-pair")}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition ${mode === "stereo-pair" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}
                    >
                      Stereo Pair
                    </button>
                  </div>
                </div>

                {/* Image uploads */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Base Image */}
                  <div>
                    <div className="text-xs text-neutral-300 mb-2">Base Image</div>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingBase(true); }}
                      onDragLeave={() => setIsDraggingBase(false)}
                      onDrop={onDropBase}
                      className={`group relative rounded-lg border overflow-hidden transition ${isDraggingBase ? "border-dashed border-teal-400" : "border-neutral-800"}`}
                      style={{minHeight: '100px'}}
                    >
                      {basePreview ? (
                        <img src={basePreview} alt="base" className="w-full h-full object-cover" style={{minHeight: '100px'}} />
                      ) : (
                        <div className="grid place-items-center bg-black/30 p-3" style={{minHeight: '100px'}}>
                          <div className="text-center">
                            <div className="text-[10px] text-neutral-400 mb-1">Base (Optional)</div>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openClipboardFor("base");
                              }}
                              className="text-[9px] text-teal-400 hover:text-teal-300 underline"
                            >
                              Choose from Clipboard
                            </button>
                          </div>
                        </div>
                      )}
                      <label className="absolute inset-0 cursor-pointer" style={{ pointerEvents: basePreview ? 'auto' : 'none' }}>
                        <input type="file" accept="image/*" className="hidden" onChange={onFileBase} />
                      </label>
                      {basePreview && (
                        <div className="absolute bottom-1 right-1">
                          <label className="inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded-lg bg-black/70 border border-neutral-700 cursor-pointer hover:bg-black/80">
                            <ImagePlus className="h-2.5 w-2.5"/>
                            <input type="file" accept="image/*" className="hidden" onChange={onFileBase} />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Depth Map */}
                  <div>
                    <div className="text-xs text-neutral-300 mb-2">Depth Map</div>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingDepth(true); }}
                      onDragLeave={() => setIsDraggingDepth(false)}
                      onDrop={onDropDepth}
                      className={`group relative rounded-lg border overflow-hidden transition ${isDraggingDepth ? "border-dashed border-teal-400" : "border-neutral-800"}`}
                      style={{minHeight: '100px'}}
                    >
                      {depthPreview ? (
                        <img src={depthPreview} alt="depth" className="w-full h-full object-cover" style={{minHeight: '100px'}} />
                      ) : (
                        <div className="grid place-items-center bg-black/30 p-3" style={{minHeight: '100px'}}>
                          <div className="text-center">
                            <div className="text-[10px] text-neutral-400 mb-1">Depth (Grayscale)</div>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openClipboardFor("depth");
                              }}
                              className="text-[9px] text-teal-400 hover:text-teal-300 underline"
                            >
                              Choose from Clipboard
                            </button>
                          </div>
                        </div>
                      )}
                      <label className="absolute inset-0 cursor-pointer" style={{ pointerEvents: depthPreview ? 'auto' : 'none' }}>
                        <input type="file" accept="image/*" className="hidden" onChange={onFileDepth} />
                      </label>
                      {depthPreview && (
                        <div className="absolute bottom-1 right-1">
                          <label className="inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded-lg bg-black/70 border border-neutral-700 cursor-pointer hover:bg-black/80">
                            <ImagePlus className="h-2.5 w-2.5"/>
                            <input type="file" accept="image/*" className="hidden" onChange={onFileDepth} />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Controls */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Max Disparity ({opts.maxDisparity}px)</label>
                    <input type="range" min={8} max={96} value={opts.maxDisparity} onChange={(e) => setOpts({ ...opts, maxDisparity: parseInt(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Min Disparity ({opts.minDisparity}px)</label>
                    <input type="range" min={-32} max={32} value={opts.minDisparity} onChange={(e) => setOpts({ ...opts, minDisparity: parseInt(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Depth Gamma ({opts.gammaDepth.toFixed(2)})</label>
                    <input type="range" min={0.2} max={3} step={0.05} value={opts.gammaDepth} onChange={(e) => setOpts({ ...opts, gammaDepth: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Smooth ({opts.smoothDepth}px)</label>
                    <input type="range" min={0} max={10} value={opts.smoothDepth} onChange={(e) => setOpts({ ...opts, smoothDepth: parseInt(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Process Width ({opts.processingWidth}px)</label>
                    <input type="range" min={256} max={1536} step={64} value={opts.processingWidth} onChange={(e) => setOpts({ ...opts, processingWidth: parseInt(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  {mode === "autostereo" && (
                    <div className="space-y-0.5">
                      <label className="text-neutral-300">Texture Width ({opts.textureWidth}px)</label>
                      <input type="range" min={32} max={256} value={opts.textureWidth} onChange={(e) => setOpts({ ...opts, textureWidth: parseInt(e.target.value) })} className="w-full accent-teal-400" />
                    </div>
                  )}
                  {mode === "autostereo" && (
                    <label className="flex items-center justify-between gap-2 text-xs col-span-2">
                      <span className="text-neutral-300">Colored Autostereo</span>
                      <button onClick={() => setOpts({ ...opts, useColoredAutostereo: !opts.useColoredAutostereo })} className={`w-10 h-6 rounded-full border transition relative ${opts.useColoredAutostereo?"bg-teal-500/30 border-teal-400":"bg-neutral-800 border-neutral-700"}`}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition ${opts.useColoredAutostereo?"translate-x-4 bg-teal-400":"bg-neutral-500"}`}></span>
                      </button>
                    </label>
                  )}
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Generate button */}
                <button
                  onClick={run}
                  className="w-full px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-medium text-sm transition"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>

          {/* Right: Output */}
          <div className="space-y-4">
            {mode === "autostereo" ? (
              <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-neutral-300">Autostereogram</h3>
                  <div className="flex gap-2">
                    {!cropMode && outCanvasRef.current?.width && (
                      <div className="relative" ref={cropMenuRef}>
                        <button
                          onClick={() => setShowCropMenu(!showCropMenu)}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                        >
                          ✂️ Crop
                        </button>
                        {showCropMenu && (
                          <div className="absolute top-full right-0 mt-1 w-32 rounded-lg border border-neutral-800 bg-neutral-900/95 backdrop-blur shadow-2xl z-50 overflow-hidden">
                            <button onClick={() => handleCrop("square", "auto")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Square</button>
                            <button onClick={() => handleCrop("circle", "auto")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Circle</button>
                            <button onClick={() => handleCrop("custom", "auto")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Custom</button>
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => downloadCanvas(outCanvasRef.current, "autostereogram.png")}
                      className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    >
                      <Download className="h-3.5 w-3.5"/>PNG
                    </button>
                  </div>
                </div>
                <div className="relative rounded-xl overflow-hidden border border-neutral-800 bg-black/50">
                  {cropMode && cropTarget === "auto" && outputDataURL ? (
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
                    <canvas ref={outCanvasRef} className="w-full h-auto" />
                  )}
                </div>
                <p className="text-xs text-neutral-400 mt-2">Tip: Cross your eyes or relax focus to see 3D depth.</p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-neutral-300">Left Image</h3>
                    <div className="flex gap-2">
                      {!cropMode && leftCanvasRef.current?.width && (
                        <button
                          onClick={() => handleCrop("custom", "left")}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                        >
                          ✂️
                        </button>
                      )}
                      <button
                        onClick={() => downloadCanvas(leftCanvasRef.current, "stereo_left.png")}
                        className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                      >
                        <Download className="h-3.5 w-3.5"/>PNG
                      </button>
                    </div>
                  </div>
                  <div className="relative rounded-xl overflow-hidden border border-neutral-800 bg-black/50">
                    {cropMode && cropTarget === "left" && outputDataURL ? (
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
                      <canvas ref={leftCanvasRef} className="w-full h-auto" />
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-neutral-300">Right Image</h3>
                    <div className="flex gap-2">
                      {!cropMode && rightCanvasRef.current?.width && (
                        <button
                          onClick={() => handleCrop("custom", "right")}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                        >
                          ✂️
                        </button>
                      )}
                      <button
                        onClick={() => downloadCanvas(rightCanvasRef.current, "stereo_right.png")}
                        className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                      >
                        <Download className="h-3.5 w-3.5"/>PNG
                      </button>
                    </div>
                  </div>
                  <div className="relative rounded-xl overflow-hidden border border-neutral-800 bg-black/50">
                    {cropMode && cropTarget === "right" && outputDataURL ? (
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
                      <canvas ref={rightCanvasRef} className="w-full h-auto" />
                    )}
                  </div>
                </div>
                <p className="text-xs text-neutral-400">View via parallel or cross-eyed free-viewing.</p>
              </>
            )}
          </div>
        </div>
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
                  a.download = `stereogram_cropped_${Date.now()}.png`;
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
      <ClipboardButton onClick={() => openClipboardFor("base")} />
    </div>
  );
}

