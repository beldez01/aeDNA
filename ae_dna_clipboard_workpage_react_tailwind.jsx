import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * aeDNA Artist Stack — Clipboard + Workpage
 * -------------------------------------------------
 * Features
 * - Persistent image Clipboard using IndexedDB (store blobs + metadata)
 * - Drag & drop or paste images into Clipboard
 * - Tag, rename, delete, multi-select
 * - Send selected images to Workpage
 * - Workpage supports: drag-in files, add from Clipboard, auto-grid layout config
 * - Compile to a single PNG via <canvas> (download)
 * - No external deps beyond React + Tailwind
 */

// =============================
// IndexedDB utilities
// =============================
const DB_NAME = "aedna_artist_stack";
const DB_VERSION = 1;
const STORE = "images";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("name", "name", { unique: false });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function idbPut(record: any): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.put(record);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

function idbGetAll(): Promise<any[]> {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function idbDelete(id: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

// =============================
// Types
// =============================
export type ClipMeta = {
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
  width: number;
  height: number;
  // blob stored in IDB under same key
};

export type ClipRecord = ClipMeta & { blob: Blob };

// =============================
// Helpers
// =============================
async function blobFromFile(file: File): Promise<Blob> {
  // Pass-through (kept for future hooks)
  return file.slice(0, file.size, file.type);
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function measureImage(blob: Blob): Promise<{ width: number; height: number }>{
  const bmp = await createImageBitmap(blob);
  const width = bmp.width;
  const height = bmp.height;
  bmp.close();
  return { width, height };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// =============================
// Clipboard Component
// =============================
function ClipboardPanel({
  onAddToWorkpage,
}: {
  onAddToWorkpage: (items: ClipRecord[]) => void;
}) {
  const [items, setItems] = useState<ClipRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    const all = (await idbGetAll()) as Array<ClipMeta & { blob: Blob }>;
    // Convert to object URLs
    const withUrls = all.map((r) => ({ ...r }));
    setItems(withUrls as ClipRecord[]);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const blob = await blobFromFile(file);
      const { width, height } = await measureImage(blob);
      const rec: ClipRecord = {
        id: uid(),
        name: file.name || "untitled",
        tags: [],
        createdAt: Date.now(),
        width,
        height,
        blob,
      };
      await idbPut(rec);
    }
    await refresh();
  }

  // Paste handler
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (blob) {
            const { width, height } = await measureImage(blob);
            const rec: ClipRecord = {
              id: uid(),
              name: `pasted_${new Date().toISOString()}`,
              tags: ["pasted"],
              createdAt: Date.now(),
              width,
              height,
              blob,
            };
            await idbPut(rec);
          }
        }
      }
      await refresh();
    };
    document.addEventListener("paste", onPaste as EventListener);
    return () => document.removeEventListener("paste", onPaste as EventListener);
  }, []);

  async function removeSelected() {
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => idbDelete(id)));
    setSelected(new Set());
    await refresh();
  }

  async function renameItem(id: string) {
    const rec = items.find((i) => i.id === id);
    if (!rec) return;
    const name = prompt("Rename image:", rec.name) || rec.name;
    await idbPut({ ...rec, name });
    await refresh();
  }

  async function tagItem(id: string) {
    const rec = items.find((i) => i.id === id);
    if (!rec) return;
    const tagStr = prompt("Add tags (comma-separated):", rec.tags.join(", ")) || "";
    const tags = tagStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await idbPut({ ...rec, tags });
    await refresh();
  }

  function addSelectionToWorkpage() {
    const sel = items.filter((i) => selected.has(i.id));
    if (sel.length === 0) return;
    onAddToWorkpage(sel);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-lg font-semibold">Clipboard</h2>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
            onClick={() => inputRef.current?.click()}
            title="Upload images"
          >
            Upload
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
            onClick={addSelectionToWorkpage}
            disabled={selected.size === 0}
          >
            Add to Workpage
          </button>
          <button
            className="px-3 py-1 rounded-xl bg-red-800/80 hover:bg-red-700 border border-red-700 text-sm"
            onClick={removeSelected}
            disabled={selected.size === 0}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Dropzone */}
      <Dropzone onDrop={handleFiles}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {loading && <div className="text-sm text-neutral-400">Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="text-sm text-neutral-400 col-span-full">
              Drop or paste images here to fill your Clipboard.
            </div>
          )}
          {items.map((it) => (
            <Thumb
              key={it.id}
              rec={it}
              selected={selected.has(it.id)}
              onToggle={() => toggle(it.id)}
              onRename={() => renameItem(it.id)}
              onTag={() => tagItem(it.id)}
            />
          ))}
        </div>
      </Dropzone>
    </div>
  );
}

function Thumb({
  rec,
  selected,
  onToggle,
  onRename,
  onTag,
}: {
  rec: ClipRecord;
  selected: boolean;
  onToggle: () => void;
  onRename: () => void;
  onTag: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(rec.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [rec.blob]);

  return (
    <div
      className={
        "group relative rounded-xl overflow-hidden border " +
        (selected ? "border-emerald-500" : "border-neutral-800")
      }
    >
      <button onClick={onToggle} className="block w-full h-full">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={rec.name} className="w-full h-36 object-cover" />
        )}
      </button>
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent text-xs">
        <div className="truncate" title={rec.name}>{rec.name}</div>
        <div className="opacity-75 truncate">{rec.width}×{rec.height}</div>
        {rec.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {rec.tags.map((t, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
        <button
          onClick={onRename}
          className="px-2 py-1 rounded-md bg-neutral-900/80 border border-neutral-700 text-xs"
        >
          Rename
        </button>
        <button
          onClick={onTag}
          className="px-2 py-1 rounded-md bg-neutral-900/80 border border-neutral-700 text-xs"
        >
          Tag
        </button>
      </div>
    </div>
  );
}

function Dropzone({ onDrop, children }: { onDrop: (files: FileList | null) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current!;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };

    const onDragEnter = (e: DragEvent) => { prevent(e); setActive(true); };
    const onDragOver = (e: DragEvent) => { prevent(e); setActive(true); };
    const onDragLeave = (e: DragEvent) => { prevent(e); setActive(false); };
    const onDropEvt = (e: DragEvent) => {
      prevent(e);
      setActive(false);
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        onDrop(dt.files);
      }
    };

    el.addEventListener("dragenter", onDragEnter as any);
    el.addEventListener("dragover", onDragOver as any);
    el.addEventListener("dragleave", onDragLeave as any);
    el.addEventListener("drop", onDropEvt as any);

    return () => {
      el.removeEventListener("dragenter", onDragEnter as any);
      el.removeEventListener("dragover", onDragOver as any);
      el.removeEventListener("dragleave", onDragLeave as any);
      el.removeEventListener("drop", onDropEvt as any);
    };
  }, [onDrop]);

  return (
    <div
      ref={ref}
      className={
        "relative flex-1 rounded-2xl border p-3 mt-2 " +
        (active ? "border-emerald-500 bg-emerald-500/5" : "border-neutral-800 bg-neutral-900/40")
      }
    >
      {active && (
        <div className="absolute inset-0 grid place-items-center text-emerald-400 text-sm">
          Drop images to add to Clipboard
        </div>
      )}
      {children}
    </div>
  );
}

// =============================
// Workpage
// =============================

type WorkItem = {
  id: string; // reference id (clipboard id or ephemeral)
  name: string;
  blob: Blob;
  width: number;
  height: number;
};

function Workpage({ clipboardHook }: { clipboardHook?: { latestSelection?: ClipRecord[] } }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [cols, setCols] = useState<number>(3);
  const [gap, setGap] = useState<number>(8);
  const [pad, setPad] = useState<number>(24);
  const [bg, setBg] = useState<string>("#111111");

  const inputRef = useRef<HTMLInputElement | null>(null);

  function addWorkItems(newItems: WorkItem[]) {
    setItems((prev) => [...prev, ...newItems]);
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const arr: WorkItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const blob = await blobFromFile(file);
      const { width, height } = await measureImage(blob);
      arr.push({ id: uid(), name: file.name || "untitled", blob, width, height });
    }
    addWorkItems(arr);
  }

  function layoutGrid(dim: { width: number; height: number }, items: WorkItem[]) {
    const columns = Math.max(1, cols);
    const g = gap; // px
    const padding = pad;
    // Compute target cell width based on canvas width minus paddings and gaps
    const innerW = dim.width - padding * 2 - g * (columns - 1);
    const cellW = Math.floor(innerW / columns);

    // Measure rows by accumulating items
    const placements: { x: number; y: number; w: number; h: number }[] = [];
    let x = padding;
    let y = padding;
    let colIndex = 0;
    let rowHeights: number[] = [];

    let maxX = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const scale = cellW / it.width;
      const w = Math.round(it.width * scale);
      const h = Math.round(it.height * scale);

      placements.push({ x, y, w, h });
      rowHeights.push(h);

      maxX = Math.max(maxX, x + w);

      colIndex++;
      if (colIndex === columns) {
        // move to next row
        const rowH = Math.max(...rowHeights);
        y += rowH + g;
        x = padding;
        colIndex = 0;
        rowHeights = [];
      } else {
        x += w + g;
      }
    }

    // final height
    const lastRowH = rowHeights.length ? Math.max(...rowHeights) : 0;
    const totalH = y + lastRowH + padding;

    const totalW = Math.max(dim.width, maxX + padding);

    return { placements, totalW, totalH };
  }

  async function compilePNG() {
    if (items.length === 0) return;
    // Set a working width; dynamically expand height
    const targetWidth = 1600; // px
    const positions = layoutGrid({ width: targetWidth, height: 1 }, items);

    const canvas = document.createElement("canvas");
    canvas.width = positions.totalW;
    canvas.height = positions.totalH;
    const ctx = canvas.getContext("2d")!;

    // bg
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // draw items
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const p = positions.placements[i];
      const bmp = await createImageBitmap(it.blob);
      ctx.drawImage(bmp, p.x, p.y, p.w, p.h);
      bmp.close();
    }

    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `aeDNA_compilation_${Date.now()}.png`);
      }
    }, "image/png");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-lg font-semibold">Workpage</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs opacity-80">Cols</label>
          <input
            type="number"
            min={1}
            max={12}
            value={cols}
            onChange={(e) => setCols(parseInt(e.target.value || "1"))}
            className="w-16 px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700 text-sm"
          />
          <label className="text-xs opacity-80">Gap</label>
          <input
            type="number"
            min={0}
            max={64}
            value={gap}
            onChange={(e) => setGap(parseInt(e.target.value || "0"))}
            className="w-16 px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700 text-sm"
          />
          <label className="text-xs opacity-80">Padding</label>
          <input
            type="number"
            min={0}
            max={128}
            value={pad}
            onChange={(e) => setPad(parseInt(e.target.value || "0"))}
            className="w-20 px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700 text-sm"
          />
          <label className="text-xs opacity-80">BG</label>
          <input
            type="color"
            value={bg}
            onChange={(e) => setBg(e.target.value)}
            className="h-8 w-10 rounded-md border border-neutral-700 bg-neutral-900"
          />
          <button
            className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
            onClick={() => inputRef.current?.click()}
          >
            Add Files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            className="px-3 py-1 rounded-xl bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 text-sm"
            onClick={compilePNG}
            disabled={items.length === 0}
          >
            Compile PNG
          </button>
        </div>
      </div>

      {/* Work drop area */}
      <WorkDrop onDrop={handleFiles}>
        {items.length === 0 ? (
          <div className="text-sm text-neutral-400">Drop images here or use “Add Files”. You can also send from the Clipboard.</div>
        ) : (
          <MasonryPreview items={items} cols={cols} gap={gap} pad={pad} bg={bg} />
        )}
      </WorkDrop>
    </div>
  );
}

function WorkDrop({ onDrop, children }: { onDrop: (files: FileList | null) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current!;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };

    const onDragEnter = (e: DragEvent) => { prevent(e); setActive(true); };
    const onDragOver = (e: DragEvent) => { prevent(e); setActive(true); };
    const onDragLeave = (e: DragEvent) => { prevent(e); setActive(false); };
    const onDropEvt = (e: DragEvent) => {
      prevent(e);
      setActive(false);
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        onDrop(dt.files);
      }
    };

    el.addEventListener("dragenter", onDragEnter as any);
    el.addEventListener("dragover", onDragOver as any);
    el.addEventListener("dragleave", onDragLeave as any);
    el.addEventListener("drop", onDropEvt as any);

    return () => {
      el.removeEventListener("dragenter", onDragEnter as any);
      el.removeEventListener("dragover", onDragOver as any);
      el.removeEventListener("dragleave", onDragLeave as any);
      el.removeEventListener("drop", onDropEvt as any);
    };
  }, [onDrop]);

  return (
    <div
      ref={ref}
      className={
        "relative flex-1 rounded-2xl border p-4 mt-2 min-h-[320px] " +
        (active ? "border-emerald-500 bg-emerald-500/5" : "border-neutral-800 bg-neutral-900/40")
      }
    >
      {active && (
        <div className="absolute inset-0 grid place-items-center text-emerald-400 text-sm">
          Drop images to add to Workpage
        </div>
      )}
      {children}
    </div>
  );
}

function MasonryPreview({ items, cols, gap, pad, bg }: { items: WorkItem[]; cols: number; gap: number; pad: number; bg: string }) {
  // Lightweight CSS grid preview; thumbnails from blob URLs
  const urls = useMemo(() => items.map((it) => URL.createObjectURL(it.blob)), [items]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const gridTemplateCols = `repeat(${Math.max(1, cols)}, minmax(0, 1fr))`;

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: bg }}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: gridTemplateCols, gap: `${gap}px`, padding: `${pad}px` }}
      >
        {urls.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={u} className="w-full h-auto rounded-lg shadow" alt="work" />
        ))}
      </div>
    </div>
  );
}

// =============================
// Main Layout — Clipboard + Workpage side-by-side
// =============================
export default function AeDNA_Clipboard_Workpage() {
  const [incoming, setIncoming] = useState<ClipRecord[] | null>(null);

  function handleAddFromClipboard(recs: ClipRecord[]) {
    setIncoming(recs);
  }

  return (
    <div className="min-h-screen w-full bg-black text-neutral-200">
      {/* Top header */}
      <header className="sticky top-0 z-10 backdrop-blur bg-black/60 border-b border-neutral-900">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="font-bold tracking-widest text-xl">aeDNA</div>
            <div className="opacity-60">Artist Stack</div>
          </div>
          <div className="text-sm opacity-70">Clipboard ↔ Workpage · Drag, Tag, Compile</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-2 rounded-2xl bg-neutral-950 border border-neutral-900 p-4">
          <ClipboardPanel onAddToWorkpage={handleAddFromClipboard} />
        </section>
        <section className="lg:col-span-3 rounded-2xl bg-neutral-950 border border-neutral-900 p-4">
          <Workpage clipboardHook={{ latestSelection: incoming || undefined }} />
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-neutral-500">
        Protip: Paste images directly (⌘/Ctrl+V) into the Clipboard. Select multiple and “Add to Workpage,” then Compile.
      </footer>
    </div>
  );
}
