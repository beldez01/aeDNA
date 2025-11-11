# Bulk Update Script for Persistence + Cropping

## Pattern to Apply to Each Page:

### 1. Add imports
```typescript
import { usePageState } from "../../lib/usePageState";
import { Cropper } from "../../components/CropperWithMenu";
import { Download } from "lucide-react"; // if not already imported
```

### 2. Add crop state
```typescript
const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
const [showCropMenu, setShowCropMenu] = useState(false);
const cropMenuRef = useRef<HTMLDivElement>(null);
```

### 3. Convert useState to usePageState for settings
```typescript
const [persistedState, setPersistedState] = usePageState("page-key", {
  // all settings here
});
const { setting1, setting2 } = persistedState;
const setSetting1 = (v) => setPersistedState(p => ({ ...p, setting1: v }));
```

### 4. Add crop handlers (after state)
```typescript
const handleCrop = (type: "square" | "circle" | "custom") => {
  const canvas = outputCanvasRef.current;
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
    const item = new ClipboardItem({ "image/png": croppedResult.blob });
    await navigator.clipboard.write([item]);
    alert("Copied to system clipboard! Open Studio to paste.");
    setCroppedResult(null);
  } catch (err) {
    console.error("Clipboard error:", err);
    alert("Failed to copy to clipboard");
  }
};

useEffect(() => {
  function handleClickOutside(event: MouseEvent) {
    if (cropMenuRef.current && !cropMenuRef.current.contains(event.target as Node)) {
      setShowCropMenu(false);
    }
  }
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);
```

### 5. Add buttons to output section header
```typescript
{uploaded && !cropMode && (
  <div className="flex gap-2">
    <div className="relative" ref={cropMenuRef}>
      <button onClick={() => setShowCropMenu(!showCropMenu)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">
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
    <button onClick={async () => {
      const canvas = outputCanvasRef.current;
      if (!canvas) return;
      try {
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => b ? resolve(b) : reject(), "image/png");
        });
        const item = new ClipboardItem({ "image/png": blob });
        await navigator.clipboard.write([item]);
        alert("Copied to system clipboard! Open Studio to paste.");
      } catch (err) {
        console.error("Clipboard error:", err);
        alert("Failed to copy to clipboard");
      }
    }} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">
      📋 Studio
    </button>
  </div>
)}
```

### 6. Add Cropper component (replace canvas)
```typescript
{cropMode && outputDataURL ? (
  <div className="relative w-full h-full">
    <button onClick={() => setCropMode(null)} className="absolute top-2 right-2 z-10 px-3 py-1 rounded-lg bg-red-800/90 hover:bg-red-700 border border-red-700 text-xs">
      Cancel
    </button>
    <Cropper src={outputDataURL} mode={cropMode} onCrop={onCrop} />
  </div>
) : (
  // original canvas here
)}
```

### 7. Add Export Dialog (before closing </div>)
```typescript
{croppedResult && (
  <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setCroppedResult(null)}>
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
      <h3 className="text-lg font-semibold mb-3">Export Cropped Image</h3>
      <img src={croppedResult.dataUrl} alt="cropped" className="w-full h-auto rounded-xl border border-neutral-800 mb-4" />
      <div className="flex gap-3">
        <button onClick={exportToStudio} className="flex-1 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 text-sm">
          📋 Export to Studio
        </button>
        <button onClick={() => {
          const a = document.createElement("a");
          a.href = croppedResult.dataUrl;
          a.download = `cropped_${Date.now()}.png`;
          a.click();
          setCroppedResult(null);
        }} className="flex-1 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm">
          💾 Download
        </button>
        <button onClick={() => setCroppedResult(null)} className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm">
          Cancel
        </button>
      </div>
    </div>
  </div>
)}
```

## Pages to Update:
- [x] charge-field
- [x] entropy-complexity
- [ ] multi-scale
- [ ] calculus-lab
- [ ] fractalization
- [ ] stereogram
- [ ] genome-recombiner

