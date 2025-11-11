// =============================================================
// AESTHETIC GENOME RECOMBINER — CODEBASE (Vite + React + Tailwind)
// =============================================================
// This single document contains all core files. Create a new directory, then
// copy each block into the indicated path/filename. Run the install/build steps
// in the README at the bottom.
// =============================================================

// -------------------------------------------------------------
// package.json
// -------------------------------------------------------------
{
  "name": "aesthetic-genome-recombiner",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "delaunator": "^5.0.0",
    "face-api.js": "^0.22.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "vite": "^5.4.8"
  }
}

// -------------------------------------------------------------
// vite.config.js
// -------------------------------------------------------------
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})

// -------------------------------------------------------------
// postcss.config.js
// -------------------------------------------------------------
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}

// -------------------------------------------------------------
// tailwind.config.js
// -------------------------------------------------------------
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['ui-sans-serif', 'system-ui', 'Inter', 'sans-serif'],
      },
      colors: {
        ae: {
          bg: '#0b0b10',
          ink: '#e6e6ec',
          glow: '#7dd3fc',
          pulse: '#a78bfa',
        }
      }
    },
  },
  plugins: [],
}

// -------------------------------------------------------------
// index.html
// -------------------------------------------------------------
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>aeDNA — Aesthetic Genome Recombiner</title>
  </head>
  <body class="bg-ae-bg text-ae-ink">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>

// -------------------------------------------------------------
// src/main.jsx
// -------------------------------------------------------------
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// -------------------------------------------------------------
// src/index.css
// -------------------------------------------------------------
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }

/* Subtle neon focus */
:focus-visible { outline: 2px solid theme('colors.ae.glow'); outline-offset: 2px; }

// -------------------------------------------------------------
// src/App.jsx
// -------------------------------------------------------------
import React from 'react'
import Recombiner from './components/Recombiner.jsx'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/40 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <div className="font-display text-2xl tracking-wider select-none">
            <span className="font-bold">aeDNA</span>
            <span className="opacity-60"> / Recombiner</span>
          </div>
          <div className="ml-auto text-sm opacity-70">Breed new aesthetics ➜ hybrid emerges</div>
        </div>
      </header>

      <main className="flex-1">
        <Recombiner />
      </main>

      <footer className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-6 text-xs opacity-60">
          Built with face-api.js + Delaunay warping. Models load locally from /public/models.
        </div>
      </footer>
    </div>
  )
}

// -------------------------------------------------------------
// src/components/Recombiner.jsx
// -------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'
import Delaunator from 'delaunator'
import { computeAffine, drawTriangleFromImage } from '../lib/triangleWarp.js'
import { averagePoints, eyeCentersFrom68, alignFaceToFrame } from '../lib/landmarkUtils.js'

const MODEL_URL = '/models' // Put models here: tiny_face_detector, face_landmark_68

export default function Recombiner(){
  const [ready, setReady] = useState(false)
  const [parentA, setParentA] = useState(null)
  const [parentB, setParentB] = useState(null)
  const [lmA, setLmA] = useState(null)
  const [lmB, setLmB] = useState(null)
  const [weightA, setWeightA] = useState(0.5)
  const [mutation, setMutation] = useState(0)
  const [mode, setMode] = useState('both') // 'shape' | 'tone' | 'both'
  const canvasRef = useRef(null)
  const warpARef = useRef(null)
  const warpBRef = useRef(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL)
      setReady(true)
    })()
  }, [])

  const onFile = async (e, which) => {
    const file = e.target.files?.[0]
    if(!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = async () => {
      const detections = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 })).withFaceLandmarks(true)
      if(!detections) { alert('No face detected. Try a clearer selfie.'); return }
      const landmarks = detections.landmarks.positions.map(p => [p.x, p.y])
      if(which === 'A') { setParentA(img); setLmA(landmarks) }
      else { setParentB(img); setLmB(landmarks) }
    }
    img.src = url
  }

  const renderHybrid = async () => {
    if(!(parentA && parentB && lmA && lmB)) return
    if(busy) return
    setBusy(true)
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height

    ctx.clearRect(0,0,W,H)

    // Align both faces into the same canonical frame (eyes to fixed anchors)
    const anchors = {
      leftEye: [W*0.38, H*0.38],
      rightEye: [W*0.62, H*0.38],
      scale: 1.15,
    }

    const { alignedCanvas: aCanvas, alignedPoints: aPts } = alignFaceToFrame(parentA, lmA, W, H, anchors)
    const { alignedCanvas: bCanvas, alignedPoints: bPts } = alignFaceToFrame(parentB, lmB, W, H, anchors)

    // Blend landmarks to form hybrid shape
    const wA = weightA
    const wB = 1 - weightA
    let hybridPts = aPts.map((p, i) => [ p[0]*wA + bPts[i][0]*wB, p[1]*wA + bPts[i][1]*wB ])

    // Optional tiny mutation (jitter)
    if(mutation > 0){
      const mag = 2.0 * mutation // pixels
      hybridPts = hybridPts.map(([x,y]) => [x + (Math.random()-0.5)*mag, y + (Math.random()-0.5)*mag])
    }

    // Triangulate on hybrid points for piecewise affine warping
    const tri = Delaunator.from(hybridPts).triangles

    // Prepare warp buffers for A and B into hybrid shape
    const warpA = warpARef.current
    const warpB = warpBRef.current
    const wctxA = warpA.getContext('2d')
    const wctxB = warpB.getContext('2d')

    wctxA.clearRect(0,0,W,H)
    wctxB.clearRect(0,0,W,H)

    for(let i=0;i<tri.length;i+=3){
      const ia = tri[i], ib = tri[i+1], ic = tri[i+2]
      const dst = [ hybridPts[ia], hybridPts[ib], hybridPts[ic] ]

      const srcA = [ aPts[ia], aPts[ib], aPts[ic] ]
      const srcB = [ bPts[ia], bPts[ib], bPts[ic] ]

      drawTriangleFromImage(wctxA, aCanvas, srcA, dst)
      drawTriangleFromImage(wctxB, bCanvas, srcB, dst)
    }

    // Tone/shape blend modes
    ctx.save()
    if(mode === 'shape'){
      // Only shape mixed; show Parent A tone (weight as overlay)
      ctx.globalAlpha = 1
      ctx.drawImage(warpA, 0, 0)
    } else if(mode === 'tone'){
      // Use Parent A shape but tone-mix by alpha morph between warped A/B
      ctx.globalAlpha = 1
      ctx.drawImage(warpA, 0, 0)
      ctx.globalAlpha = wB
      ctx.drawImage(warpB, 0, 0)
    } else {
      // Both: weighted sum of warped images
      ctx.globalAlpha = wA
      ctx.drawImage(warpA, 0, 0)
      ctx.globalAlpha = wB
      ctx.drawImage(warpB, 0, 0)
    }
    ctx.restore()

    setBusy(false)
  }

  useEffect(() => {
    // Re-render when inputs or sliders change and all pieces exist
    if(parentA && parentB && lmA && lmB){
      renderHybrid()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentA, parentB, lmA, lmB, weightA, mutation, mode])

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3">
          <div className="text-sm opacity-70">Parent A</div>
          <label className="block">
            <input type="file" accept="image/*" onChange={(e)=>onFile(e,'A')} className="block w-full text-sm" />
          </label>
          <canvas ref={warpARef} width={720} height={900} className="w-full rounded-2xl bg-black/40 border border-white/10"/>
        </div>

        <div className="space-y-4">
          <div className="aspect-[4/5] w-full">
            <canvas ref={canvasRef} width={720} height={900} className="w-full h-full rounded-2xl bg-black/60 border border-white/10 shadow-[0_0_40px_rgba(125,211,252,0.2)]"/>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="col-span-2 p-4 rounded-xl border border-white/10 bg-white/5">
              <div className="text-xs mb-2 opacity-80">Parent Influence</div>
              <input type="range" min={0} max={100} value={Math.round(weightA*100)} onChange={(e)=>setWeightA(parseInt(e.target.value)/100)} className="w-full" />
              <div className="flex justify-between text-[11px] opacity-70 mt-1">
                <span>A: {Math.round(weightA*100)}%</span>
                <span>B: {Math.round((1-weightA)*100)}%</span>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-white/10 bg-white/5">
              <div className="text-xs mb-2 opacity-80">Mutation</div>
              <input type="range" min={0} max={5} value={mutation} onChange={(e)=>setMutation(parseInt(e.target.value))} className="w-full" />
              <div className="text-[11px] opacity-70 mt-1">± {mutation}px jitter</div>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <span className={`px-3 py-2 rounded-lg border ${mode==='shape'?'border-ae-glow text-ae-glow':'border-white/10 opacity-80'}`} onClick={()=>setMode('shape')}>Blend Shape</span>
            <span className={`px-3 py-2 rounded-lg border ${mode==='tone'?'border-ae-glow text-ae-glow':'border-white/10 opacity-80'}`} onClick={()=>setMode('tone')}>Blend Tone</span>
            <span className={`px-3 py-2 rounded-lg border ${mode==='both'?'border-ae-glow text-ae-glow':'border-white/10 opacity-80'}`} onClick={()=>setMode('both')}>Blend Both</span>
            <button className="ml-auto px-4 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/20 transition" onClick={renderHybrid} disabled={busy || !(lmA && lmB)}>
              {busy ? 'Evolving…' : 'Generate Hybrid'}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm opacity-70">Parent B</div>
          <label className="block">
            <input type="file" accept="image/*" onChange={(e)=>onFile(e,'B')} className="block w-full text-sm" />
          </label>
          <canvas ref={warpBRef} width={720} height={900} className="w-full rounded-2xl bg-black/40 border border-white/10"/>
        </div>
      </div>

      <div className="mt-8 p-4 rounded-xl border border-white/10 bg-gradient-to-r from-ae.pulse/10 to-ae.glow/10 text-xs opacity-80">
        Tip: crop selfies to show a single face, front-facing, even lighting. Both parents are aligned to a canonical eye position for clean blending.
      </div>
    </div>
  )
}

// -------------------------------------------------------------
// src/lib/triangleWarp.js
// -------------------------------------------------------------
// Piecewise affine image warping for each triangle

export function computeAffine(srcTri, dstTri){
  // srcTri, dstTri: [[x1,y1],[x2,y2],[x3,y3]]
  const [x0,y0] = srcTri[0]
  const [x1,y1] = srcTri[1]
  const [x2,y2] = srcTri[2]

  const [u0,v0] = dstTri[0]
  const [u1,v1] = dstTri[1]
  const [u2,v2] = dstTri[2]

  // Solve for affine mapping from image space to destination triangle
  // We want matrix A such that [u v 1]^T = M * [x y 1]^T with canvas setTransform(a, b, c, d, e, f)
  // Derive using linear algebra: build matrices and compute least-squares affine

  const denom = (x0*(y1 - y2) + x1*(y2 - y0) + x2*(y0 - y1)) || 1e-6
  const a = (u0*(y1 - y2) + u1*(y2 - y0) + u2*(y0 - y1)) / denom
  const b = (u0*(x2 - x1) + u1*(x0 - x2) + u2*(x1 - x0)) / denom
  const e = (u0*(x1*y2 - x2*y1) + u1*(x2*y0 - x0*y2) + u2*(x0*y1 - x1*y0)) / denom

  const c = (v0*(y1 - y2) + v1*(y2 - y0) + v2*(y0 - y1)) / denom
  const d = (v0*(x2 - x1) + v1*(x0 - x2) + v2*(x1 - x0)) / denom
  const f = (v0*(x1*y2 - x2*y1) + v1*(x2*y0 - x0*y2) + v2*(x0*y1 - x1*y0)) / denom

  // Return as canvas 2D transform params
  return [a, c, b, d, e, f]
}

export function drawTriangleFromImage(ctx, imageCanvas, srcTri, dstTri){
  const [a,c,b,d,e,f] = computeAffine(srcTri, dstTri)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(dstTri[0][0], dstTri[0][1])
  ctx.lineTo(dstTri[1][0], dstTri[1][1])
  ctx.lineTo(dstTri[2][0], dstTri[2][1])
  ctx.closePath()
  ctx.clip()
  ctx.setTransform(a, c, b, d, e, f)
  // Draw the whole source image (it will be transformed + clipped to triangle)
  ctx.drawImage(imageCanvas, 0, 0)
  ctx.restore()
}

// -------------------------------------------------------------
// src/lib/landmarkUtils.js
// -------------------------------------------------------------
// Landmark helpers: eye centers, alignment to canonical frame, etc.

function meanPoint(points){
  const n = points.length
  let x=0, y=0
  for(const [px,py] of points){ x+=px; y+=py }
  return [x/n, y/n]
}

export function eyeCentersFrom68(pts){
  // 68-point model indices
  const leftIdx = [36,37,38,39,40,41]
  const rightIdx = [42,43,44,45,46,47]
  const left = meanPoint(leftIdx.map(i => pts[i]))
  const right = meanPoint(rightIdx.map(i => pts[i]))
  return { left, right }
}

export function averagePoints(a, b, wA=0.5){
  const wB = 1 - wA
  return a.map((p,i) => [p[0]*wA + b[i][0]*wB, p[1]*wA + b[i][1]*wB])
}

export function alignFaceToFrame(image, pts, W, H, anchors={ leftEye:[W*0.38,H*0.38], rightEye:[W*0.62,H*0.38], scale:1.0 }){
  const { left, right } = eyeCentersFrom68(pts)
  const eyeDx = right[0] - left[0]
  const eyeDy = right[1] - left[1]
  const eyeDist = Math.hypot(eyeDx, eyeDy)
  const targetDx = anchors.rightEye[0] - anchors.leftEye[0]
  const targetDy = anchors.rightEye[1] - anchors.leftEye[1]
  const targetDist = Math.hypot(targetDx, targetDy)

  const scale = (targetDist / eyeDist) * (anchors.scale || 1.0)
  const angle = Math.atan2(eyeDy, eyeDx)
  const targetAngle = Math.atan2(targetDy, targetDx)
  const rot = targetAngle - angle

  // Compute transform for image -> aligned canvas
  // 1) translate by -eyeLeft
  // 2) rotate by -angle then rotate to targetAngle
  // 3) scale to targetDist
  // 4) translate to anchors.leftEye

  // Build an offscreen canvas to draw the aligned face
  const off = document.createElement('canvas')
  off.width = W; off.height = H
  const octx = off.getContext('2d')

  octx.save()
  octx.translate(anchors.leftEye[0], anchors.leftEye[1])
  octx.rotate(rot)
  octx.scale(scale, scale)
  octx.translate(-left[0], -left[1])
  octx.drawImage(image, 0, 0)
  octx.restore()

  // Transform points similarly
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const alignedPoints = pts.map(([x,y]) => {
    // translate to origin (left eye)
    let tx = x - left[0]
    let ty = y - left[1]
    // rotate
    let rx = tx * cos - ty * sin
    let ry = tx * sin + ty * cos
    // scale
    rx *= scale; ry *= scale
    // translate to target anchor
    rx += anchors.leftEye[0]
    ry += anchors.leftEye[1]
    return [rx, ry]
  })

  return { alignedCanvas: off, alignedPoints }
}

// -------------------------------------------------------------
// public/models/
// -------------------------------------------------------------
// Place the following face-api.js model files in /public/models (exact names):
// - tiny_face_detector_model-weights_manifest.json
// - tiny_face_detector_model-shard1.bin
// - face_landmark_68_tiny_model-weights_manifest.json
// - face_landmark_68_tiny_model-shard1.bin
// You can obtain them from the official face-api.js models repository and keep them locally so the app works offline.

// -------------------------------------------------------------
// README.md (quick start)
// -------------------------------------------------------------
# Aesthetic Genome Recombiner

Breed two selfies into a smooth hybrid using facial landmark alignment, Delaunay triangulation, and piecewise affine warping. Built with React, Vite, Tailwind, face-api.js, and Delaunator.

## ✨ Features
- Drag/drop two selfies (Parent A & B)
- Auto-detect landmarks (68-pt), align both faces to a canonical eye position
- Delaunay triangulation over the hybrid landmark mesh
- Piecewise affine warp of each parent into the hybrid shape
- Blend modes: Shape / Tone / Both
- Parent influence slider + optional mutation (subtle jitter)

## 📦 Install
```bash
npm i
npm run dev
```

## 🧠 Models
Download face-api.js models and place into `public/models`:
- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1.bin`
- `face_landmark_68_tiny_model-weights_manifest.json`
- `face_landmark_68_tiny_model-shard1.bin`

> Tip: Keep models in your repo under `public/models` so the app serves them at `/models`.

## 🖼️ Usage Tips
- Use single, frontal, evenly-lit faces.
- Crop images so the face occupies ~60–80% of frame.
- For best blends, both parents should have comparable head tilt.

## 🧩 Roadmap
- Smooth edge masks via feathered face hull
- Temporal morph clip (A → Hybrid → B) exporter (MP4/WebM)
- 3-parent tri-hybrid mode
- Gallery with genealogy graph & “Breed with it” button
- Mobile camera capture + EXIF auto-rotate

## 🛠️ Notes
- All processing happens client-side in the browser.
- If faces aren’t detected, try the full-size landmark model for precision.
- The affine mapping per triangle uses a closed-form solution; drawing is clipped to the destination triangle to avoid bleed.
