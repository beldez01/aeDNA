"use client";

import React, { useState, useRef } from "react";

/**
 * Stereogram Quick Tool (aeDNA)
 * -------------------------------------------
 * Ultra-simple interface for generating autostereograms from a single image.
 * Optional depth map can be uploaded, but defaults to using image luminance.
 * Advanced options are hidden behind a toggle.
 */

import { Switch } from "@/components/ui/switch";

export default function StereogramTool() {
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [depthFile, setDepthFile] = useState<File | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  async function run() {
    if (!baseFile && !depthFile) return alert("Upload an image.");
    const baseImg = baseFile ? await fileToImage(baseFile) : null;
    const depthImg = depthFile ? await fileToImage(depthFile) : null;
    const base = baseImg ? imageToImageData(baseImg) : null;
    const depth = depthImg ? imageToImageData(depthImg) : null;
    const ref = base || depth;
    if (!ref) return;

    const resized = resizeImageData(ref, 512);
    const depthData = depth
      ? normalize01(toGrayscaleLuminosity(resizeImageData(depth, 512).img))
      : normalize01(toGrayscaleLuminosity(resized.img));

    const disparity = depthToDisparity(depthData, resized.img.width, resized.img.height, 0, 48);
    const result = generateAutostereogram(disparity, base ? resized.img : null, {
      maxDisparity: 48,
      minDisparity: 0,
      textureWidth: 96,
      useColoredAutostereo: true,
      gammaDepth: 1,
      smoothDepth: 1,
      processingWidth: 512,
    });

    const c = canvasRef.current!;
    c.width = result.width;
    c.height = result.height;
    c.getContext("2d")!.putImageData(result, 0, 0);
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-center">Quick Stereogram Generator</h1>

      <div className="space-y-3">
        <label className="block text-sm font-medium">Upload Image</label>
        <input type="file" accept="image/*" onChange={(e) => setBaseFile(e.target.files?.[0] || null)} />

        <label className="block text-sm font-medium">Optional Depth Map</label>
        <input type="file" accept="image/*" onChange={(e) => setDepthFile(e.target.files?.[0] || null)} />
      </div>

      <button
        onClick={run}
        className="w-full px-4 py-2 rounded-2xl bg-white text-black font-semibold"
      >
        Generate Stereogram
      </button>

      <canvas ref={canvasRef} className="w-full border border-neutral-800 rounded-xl" />

      <div className="mt-4">
        <label className="flex items-center gap-2">
          <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
          <span className="text-sm text-neutral-400">Show advanced settings</span>
        </label>
      </div>

      {showAdvanced && (
        <div className="text-xs text-neutral-400">
          Future advanced parameters will go here.
        </div>
      )}
    </div>
  );
}

// Reuse core logic from the main StereogramLab file (not shown here):
// - imageToImageData
// - fileToImage
// - resizeImageData
// - toGrayscaleLuminosity
// - normalize01
// - depthToDisparity
// - generateAutostereogram
