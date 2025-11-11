// app/clipboard/page.tsx
// aeDNA Studio — Clipboard + Workpage

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ToolHeader } from "../../components/ToolHeader";

// ========== IndexedDB Utilities ==========

const DB_NAME = "aedna_artist_stack";
const DB_VERSION = 2;
const STORE = "images";
const PROJECTS_STORE = "projects";

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
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        const projStore = db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        projStore.createIndex("createdAt", "createdAt");
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

// Project management
function idbPutProject(project: any): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const tx = db.transaction(PROJECTS_STORE, "readwrite");
    const store = tx.objectStore(PROJECTS_STORE);
    const req = store.put(project);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

function idbGetAllProjects(): Promise<any[]> {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const tx = db.transaction(PROJECTS_STORE, "readonly");
    const store = tx.objectStore(PROJECTS_STORE);
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function idbDeleteProject(id: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const tx = db.transaction(PROJECTS_STORE, "readwrite");
    const store = tx.objectStore(PROJECTS_STORE);
    const req = store.delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

// ========== Types ==========

export type ClipMeta = {
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
  width: number;
  height: number;
};

export type ClipRecord = ClipMeta & { blob: Blob };

type WorkItem = {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
};

type Project = {
  id: string;
  name: string;
  createdAt: number;
  workItems: WorkItem[];
  canvasSize: { width: number; height: number };
  bg: string;
};

// ========== Helpers ==========

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function measureImage(blob: Blob): Promise<{ width: number; height: number }> {
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

// ========== Clipboard Component ==========

function ClipboardPanel({ onAddToWorkpage }: { onAddToWorkpage: (items: ClipRecord[]) => void }) {
  const [items, setItems] = useState<ClipRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    const all = (await idbGetAll()) as Array<ClipMeta & { blob: Blob }>;
    setItems(all as ClipRecord[]);
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
      const blob = file.slice(0, file.size, file.type);
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
    document.addEventListener("paste", onPaste as any);
    return () => document.removeEventListener("paste", onPaste as any);
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

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

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
            onChange={onFileChange}
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

      <Dropzone onDrop={handleFiles}>
        <div className="grid grid-cols-2 gap-3">
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
    <div className={"group relative rounded-xl overflow-hidden border " + (selected ? "border-emerald-500" : "border-neutral-800")}>
      <button onClick={onToggle} className="block w-full h-full">
        {url && <img src={url} alt={rec.name} className="w-full h-36 object-cover" />}
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

// ========== Workpage ==========

function Workpage({ 
  clipboardHook,
  workItems,
  setWorkItems,
  canvasSize,
  setCanvasSize,
  bg,
  setBg,
}: { 
  clipboardHook?: { latestSelection?: ClipRecord[] };
  workItems: WorkItem[];
  setWorkItems: React.Dispatch<React.SetStateAction<WorkItem[]>>;
  canvasSize: { width: number; height: number };
  setCanvasSize: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>;
  bg: string;
  setBg: React.Dispatch<React.SetStateAction<string>>;
}) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const prevSelectionRef = useRef<ClipRecord[] | undefined>();

  useEffect(() => {
    if (clipboardHook?.latestSelection && clipboardHook.latestSelection !== prevSelectionRef.current) {
      prevSelectionRef.current = clipboardHook.latestSelection;
      const newItems: WorkItem[] = clipboardHook.latestSelection.map((r, idx) => ({
        id: uid(), // Generate unique ID for each workpage item
        name: r.name,
        blob: r.blob,
        width: r.width,
        height: r.height,
        x: 50 + idx * 30,
        y: 50 + idx * 30,
        scale: 0.3,
        opacity: 1,
      }));
      addWorkItems(newItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboardHook?.latestSelection]);

  function addWorkItems(newItems: WorkItem[]) {
    setWorkItems((prev) => [...prev, ...newItems]);
    if (newItems.length > 0 && !selectedItem) {
      setSelectedItem(newItems[0].id);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const arr: WorkItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const blob = file.slice(0, file.size, file.type);
      const { width, height } = await measureImage(blob);
      arr.push({ 
        id: uid(), 
        name: file.name || "untitled", 
        blob, 
        width, 
        height,
        x: 100 + arr.length * 30,
        y: 100 + arr.length * 30,
        scale: 0.3,
        opacity: 1,
      });
    }
    addWorkItems(arr);
  }

  function updateItem(id: string, updates: Partial<WorkItem>) {
    setWorkItems(prev => prev.map(it => it.id === id ? { ...it, ...updates } : it));
  }

  function deleteItem(id: string) {
    setWorkItems(prev => prev.filter(it => it.id !== id));
    if (selectedItem === id) setSelectedItem(null);
  }

  function moveLayerUp(id: string) {
    setWorkItems(prev => {
      const idx = prev.findIndex(it => it.id === id);
      if (idx === -1 || idx === prev.length - 1) return prev;
      const newItems = [...prev];
      [newItems[idx], newItems[idx + 1]] = [newItems[idx + 1], newItems[idx]];
      return newItems;
    });
  }

  function moveLayerDown(id: string) {
    setWorkItems(prev => {
      const idx = prev.findIndex(it => it.id === id);
      if (idx === -1 || idx === 0) return prev;
      const newItems = [...prev];
      [newItems[idx], newItems[idx - 1]] = [newItems[idx - 1], newItems[idx]];
      return newItems;
    });
  }


  async function compilePNG() {
    if (workItems.length === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const it of workItems) {
      const bmp = await createImageBitmap(it.blob);
      const w = it.width * it.scale;
      const h = it.height * it.scale;
      ctx.globalAlpha = it.opacity;
      ctx.drawImage(bmp, it.x, it.y, w, h);
      bmp.close();
    }
    ctx.globalAlpha = 1;

    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `aeDNA_compilation_${Date.now()}.png`);
      }
    }, "image/png");
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const selected = workItems.find(it => it.id === selectedItem);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-lg font-semibold">Workpage</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs opacity-80">W</label>
          <input
            type="number"
            min={400}
            max={3200}
            step={100}
            value={canvasSize.width}
            onChange={(e) => setCanvasSize({ ...canvasSize, width: parseInt(e.target.value || "1200") })}
            className="w-20 px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700 text-sm"
          />
          <label className="text-xs opacity-80">H</label>
          <input
            type="number"
            min={400}
            max={3200}
            step={100}
            value={canvasSize.height}
            onChange={(e) => setCanvasSize({ ...canvasSize, height: parseInt(e.target.value || "800") })}
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
            onChange={onFileChange}
          />
          <button
            className="px-3 py-1 rounded-xl bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 text-sm"
            onClick={compilePNG}
            disabled={workItems.length === 0}
          >
            Compile PNG
          </button>
        </div>
      </div>

      {/* Item controls (always visible) */}
      {workItems.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 mb-2">
          {selected ? (
            <>
              <div className="text-xs text-neutral-400 mb-2">
                Selected: {selected.name} 
                <span className="ml-2 text-emerald-400">
                  (Layer {workItems.findIndex(it => it.id === selected.id) + 1} of {workItems.length})
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div className="space-y-1">
                  <label className="text-neutral-300">Scale ({selected.scale.toFixed(2)})</label>
                  <input type="range" min={0.1} max={2} step={0.05} value={selected.scale} onChange={(e) => updateItem(selected.id, { scale: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                </div>
                <div className="space-y-1">
                  <label className="text-neutral-300">Opacity ({(selected.opacity * 100).toFixed(0)}%)</label>
                  <input type="range" min={0} max={1} step={0.05} value={selected.opacity} onChange={(e) => updateItem(selected.id, { opacity: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                </div>
                <div className="space-y-1">
                  <label className="text-neutral-300">X ({selected.x})</label>
                  <input type="number" value={selected.x} onChange={(e) => updateItem(selected.id, { x: parseInt(e.target.value || "0") })} className="w-full px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700" />
                </div>
                <div className="space-y-1">
                  <label className="text-neutral-300">Y ({selected.y})</label>
                  <input type="number" value={selected.y} onChange={(e) => updateItem(selected.id, { y: parseInt(e.target.value || "0") })} className="w-full px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700" />
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button 
                  onClick={() => moveLayerUp(selected.id)} 
                  disabled={workItems.findIndex(it => it.id === selected.id) === workItems.length - 1}
                  className="flex-1 px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Move layer up (forward)"
                >
                  Layer Up ↑
                </button>
                <button 
                  onClick={() => moveLayerDown(selected.id)} 
                  disabled={workItems.findIndex(it => it.id === selected.id) === 0}
                  className="flex-1 px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Move layer down (backward)"
                >
                  Layer Down ↓
                </button>
                <button onClick={() => deleteItem(selected.id)} className="px-3 py-1 rounded-xl bg-red-800/80 hover:bg-red-700 border border-red-700 text-sm">
                  Delete
                </button>
              </div>
            </>
          ) : (
            <div className="text-xs text-neutral-400">Click an image to edit its properties</div>
          )}
        </div>
      )}

      <WorkDrop onDrop={handleFiles}>
        {workItems.length === 0 ? (
          <div className="text-sm text-neutral-400">Drop images here or use "Add Files". You can also send from the Clipboard.</div>
        ) : (
          <FreeformPreview 
            items={workItems} 
            canvasSize={canvasSize}
            bg={bg} 
            selectedItem={selectedItem}
            onSelect={setSelectedItem}
            onMove={(id, x, y) => updateItem(id, { x, y })}
            onScale={(id, scale) => updateItem(id, { scale })}
          />
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

function FreeformPreview({ 
  items, 
  canvasSize,
  bg, 
  selectedItem,
  onSelect,
  onMove,
  onScale,
}: { 
  items: WorkItem[]; 
  canvasSize: { width: number; height: number };
  bg: string;
  selectedItem: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onScale: (id: string, scale: number) => void;
}) {
  const [dragging, setDragging] = useState<{ 
    type: 'move' | 'scale'; 
    id: string; 
    startX: number; 
    startY: number; 
    offsetX: number; 
    offsetY: number;
    initialScale?: number;
    initialWidth?: number;
    initialHeight?: number;
    corner?: 'nw' | 'ne' | 'sw' | 'se';
  } | null>(null);

  const urls = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(it => map.set(it.id, URL.createObjectURL(it.blob)));
    return map;
  }, [items]);

  useEffect(() => {
    return () => urls.forEach(u => URL.revokeObjectURL(u));
  }, [urls]);

  const handleMouseDown = (e: React.MouseEvent, it: WorkItem) => {
    e.stopPropagation();
    onSelect(it.id); // Select immediately on mouseDown
    const rect = e.currentTarget.getBoundingClientRect();
    setDragging({
      type: 'move',
      id: it.id,
      startX: it.x,
      startY: it.y,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
  };

  const handleCornerDown = (e: React.MouseEvent, it: WorkItem, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    e.stopPropagation();
    onSelect(it.id);
    setDragging({
      type: 'scale',
      id: it.id,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: 0,
      offsetY: 0,
      initialScale: it.scale,
      initialWidth: it.width,
      initialHeight: it.height,
      corner,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;

    if (dragging.type === 'move') {
      const container = e.currentTarget.getBoundingClientRect();
      const containerX = e.clientX - container.left;
      const containerY = e.clientY - container.top;
      const scaleX = canvasSize.width / container.width;
      const scaleY = canvasSize.height / container.height;
      const newX = Math.round((containerX - dragging.offsetX * container.width / canvasSize.width) * scaleX);
      const newY = Math.round((containerY - dragging.offsetY * container.height / canvasSize.height) * scaleY);
      onMove(dragging.id, newX, newY);
    } else if (dragging.type === 'scale') {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      const dist = Math.hypot(dx, dy);
      const direction = (dragging.corner === 'nw' || dragging.corner === 'sw') ? -1 : 1;
      const scaleDelta = (dist * direction) / 200;
      const newScale = Math.max(0.1, Math.min(3, (dragging.initialScale || 1) + scaleDelta));
      onScale(dragging.id, newScale);
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  return (
    <div 
      className="relative rounded-xl overflow-hidden" 
      style={{ 
        background: bg, 
        paddingBottom: `${(canvasSize.height / canvasSize.width) * 100}%`,
        cursor: dragging ? 'grabbing' : 'default'
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => onSelect(null)} // Deselect when clicking background
    >
      <div className="absolute inset-0">
        {items.map((it) => {
          const url = urls.get(it.id);
          const w = it.width * it.scale;
          const h = it.height * it.scale;
          const selected = selectedItem === it.id;
          return (
            <div
              key={it.id}
              style={{
                position: 'absolute',
                left: `${(it.x / canvasSize.width) * 100}%`,
                top: `${(it.y / canvasSize.height) * 100}%`,
                width: `${(w / canvasSize.width) * 100}%`,
                height: `${(h / canvasSize.height) * 100}%`,
                opacity: it.opacity,
                cursor: 'grab',
                border: selected ? '2px solid #10b981' : '1px solid transparent',
                boxShadow: selected ? '0 0 20px rgba(16, 185, 129, 0.3)' : 'none',
              }}
              onMouseDown={(e) => handleMouseDown(e, it)}
              onClick={(e) => e.stopPropagation()}
            >
              {url && <img src={url} alt={it.name} className="w-full h-full object-cover rounded pointer-events-none" draggable={false} />}
              
              {/* Corner handles for selected item */}
              {selected && (
                <>
                  {/* Top-left */}
                  <div 
                    className="absolute -top-1 -left-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full cursor-nwse-resize hover:scale-125 transition"
                    onMouseDown={(e) => { e.stopPropagation(); handleCornerDown(e, it, 'nw'); }}
                  />
                  {/* Top-right */}
                  <div 
                    className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full cursor-nesw-resize hover:scale-125 transition"
                    onMouseDown={(e) => { e.stopPropagation(); handleCornerDown(e, it, 'ne'); }}
                  />
                  {/* Bottom-left */}
                  <div 
                    className="absolute -bottom-1 -left-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full cursor-nesw-resize hover:scale-125 transition"
                    onMouseDown={(e) => { e.stopPropagation(); handleCornerDown(e, it, 'sw'); }}
                  />
                  {/* Bottom-right */}
                  <div 
                    className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full cursor-nwse-resize hover:scale-125 transition"
                    onMouseDown={(e) => { e.stopPropagation(); handleCornerDown(e, it, 'se'); }}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ========== Projects Dropdown ==========

function ProjectsDropdown({ 
  currentProject, 
  onSelectProject, 
  onSaveProject,
}: { 
  currentProject: Project | null;
  onSelectProject: (project: Project) => void;
  onSaveProject: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setLoading(true);
    const all = await idbGetAllProjects();
    setProjects(all);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function createNewProject() {
    const name = prompt("Project name:", `Project ${projects.length + 1}`);
    if (!name) return;
    const newProj: Project = {
      id: uid(),
      name,
      createdAt: Date.now(),
      workItems: [],
      canvasSize: { width: 1200, height: 800 },
      bg: "#111111",
    };
    await idbPutProject(newProj);
    await refresh();
    onSelectProject(newProj);
    setIsOpen(false);
  }

  async function renameProject(proj: Project, e: React.MouseEvent) {
    e.stopPropagation();
    const name = prompt("Rename project:", proj.name);
    if (!name) return;
    await idbPutProject({ ...proj, name });
    await refresh();
  }

  async function deleteProject(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this project?")) return;
    await idbDeleteProject(id);
    await refresh();
  }

  function selectProject(proj: Project) {
    onSelectProject(proj);
    setIsOpen(false);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown trigger banner */}
      <div className="rounded-xl border border-neutral-800 bg-black/40 p-3 flex items-center justify-between">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-sm hover:text-emerald-400 transition flex-1"
        >
          <span className="text-neutral-400">Project:</span>
          <span className="font-medium text-emerald-400">
            {currentProject ? currentProject.name : "No project selected"}
          </span>
          <svg 
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={onSaveProject}
          disabled={!currentProject}
          className="ml-4 px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          💾 Save
        </button>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-neutral-800 bg-neutral-900/95 backdrop-blur shadow-2xl max-h-[400px] overflow-y-auto z-50">
          {/* New Project button */}
          <button
            onClick={createNewProject}
            className="w-full px-4 py-3 text-left text-sm border-b border-neutral-800 bg-emerald-900/20 hover:bg-emerald-900/40 transition flex items-center gap-2"
          >
            <span className="text-emerald-400 text-lg">+</span>
            <span className="font-medium text-emerald-400">New Project</span>
          </button>

          {/* Project list */}
          <div className="py-2">
            {loading && (
              <div className="px-4 py-3 text-sm text-neutral-400">Loading…</div>
            )}
            {!loading && projects.length === 0 && (
              <div className="px-4 py-3 text-sm text-neutral-400">No projects yet. Create one above.</div>
            )}
            {projects.map((proj) => (
              <div
                key={proj.id}
                className={`group px-4 py-3 cursor-pointer transition flex items-center justify-between ${
                  currentProject?.id === proj.id
                    ? "bg-emerald-500/10 border-l-2 border-emerald-500"
                    : "hover:bg-neutral-800/50"
                }`}
                onClick={() => selectProject(proj)}
              >
                <div>
                  <div className="text-sm font-medium">{proj.name}</div>
                  <div className="text-xs text-neutral-500">{proj.workItems.length} items</div>
                </div>
                <div className="hidden group-hover:flex gap-1">
                  <button
                    onClick={(e) => renameProject(proj, e)}
                    className="px-2 py-1 rounded-md bg-neutral-900/80 border border-neutral-700 text-xs hover:border-neutral-600"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => deleteProject(proj.id, e)}
                    className="px-2 py-1 rounded-md bg-red-900/80 border border-red-700 text-xs hover:border-red-600"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ========== Main Layout ==========

export default function ClipboardWorkpage() {
  const [incoming, setIncoming] = useState<ClipRecord[] | null>(null);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  const [bg, setBg] = useState<string>("#111111");

  function handleAddFromClipboard(recs: ClipRecord[]) {
    setIncoming(recs);
  }

  function handleSelectProject(proj: Project) {
    setCurrentProject(proj);
    setWorkItems(proj.workItems);
    setCanvasSize(proj.canvasSize);
    setBg(proj.bg);
  }

  async function handleSaveProject() {
    if (!currentProject) return;
    const updated: Project = {
      ...currentProject,
      workItems,
      canvasSize,
      bg,
    };
    await idbPutProject(updated);
    setCurrentProject(updated);
    alert("Project saved!");
  }

  return (
    <div className="min-h-screen w-full bg-[#0D0D0F] text-neutral-200">
      <ToolHeader />
      <main className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Studio</h1>

        {/* Projects Dropdown Banner */}
        <div className="mb-6">
          <ProjectsDropdown 
            currentProject={currentProject}
            onSelectProject={handleSelectProject}
            onSaveProject={handleSaveProject}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Clipboard - Left column */}
          <section className="lg:col-span-2 rounded-2xl bg-black/40 border border-neutral-800 p-4" style={{minHeight: '500px'}}>
            <ClipboardPanel onAddToWorkpage={handleAddFromClipboard} />
          </section>

          {/* Workpage - Right wide column */}
          <section className="lg:col-span-3 rounded-2xl bg-black/40 border border-neutral-800 p-4" style={{minHeight: '500px'}}>
            <Workpage 
              clipboardHook={{ latestSelection: incoming || undefined }}
              workItems={workItems}
              setWorkItems={setWorkItems}
              canvasSize={canvasSize}
              setCanvasSize={setCanvasSize}
              bg={bg}
              setBg={setBg}
            />
          </section>
        </div>

        <footer className="mt-6 text-xs text-neutral-500">
          Protip: Create projects to organize different compositions. Paste images (⌘/Ctrl+V) into Clipboard, add to Workpage, then Save project.
        </footer>
      </main>
    </div>
  );
}

