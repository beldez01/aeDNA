"use client";

import React, { useEffect, useState, useRef } from "react";
import { X, Image as ImageIcon, Upload } from "lucide-react";

// ========== IndexedDB Utilities ==========

const DB_NAME = "aedna_artist_stack";
const DB_VERSION = 2;
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
      if (!db.objectStoreNames.contains("projects")) {
        const projStore = db.createObjectStore("projects", { keyPath: "id" });
        projStore.createIndex("createdAt", "createdAt");
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
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

// Export utilities for use in other pages
export async function saveToClipboard(blob: Blob, name: string = `cropped_${Date.now()}.png`): Promise<void> {
  const { width, height } = await measureImage(blob);
  const rec = {
    id: uid(),
    name,
    tags: ["cropped"],
    createdAt: Date.now(),
    width,
    height,
    blob,
  };
  await idbPut(rec);
}

// ========== Types ==========

export type ClipRecord = {
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
  width: number;
  height: number;
  blob: Blob;
};

// ========== ClipboardViewer Component ==========

interface ClipboardViewerProps {
  isOpen: boolean;
  onClose: () => void;
  onImageSelect?: (record: ClipRecord) => void;
}

export function ClipboardViewer({ isOpen, onClose, onImageSelect }: ClipboardViewerProps) {
  const [items, setItems] = useState<ClipRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const all = (await idbGetAll()) as ClipRecord[];
      setItems(all);
    } catch (error) {
      console.error("Failed to load clipboard:", error);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (isOpen) {
      refresh();
    }
  }, [isOpen]);

  // Paste handler
  useEffect(() => {
    if (!isOpen) return;
    
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
  }, [isOpen]);

  // Drag and drop handlers
  useEffect(() => {
    if (!isOpen || !dropZoneRef.current) return;

    const el = dropZoneRef.current;
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onDragEnter = (e: DragEvent) => {
      prevent(e);
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      prevent(e);
      setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      prevent(e);
      setIsDragging(false);
    };
    const onDropEvt = async (e: DragEvent) => {
      prevent(e);
      setIsDragging(false);
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        await handleFiles(dt.files);
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
  }, [isOpen]);

  async function handleFiles(files: FileList) {
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

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  function handleImageClick(rec: ClipRecord) {
    setSelected(rec.id);
    if (onImageSelect) {
      onImageSelect(rec);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[85vh] m-4 rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold">Studio Clipboard</h2>
            <span className="text-xs text-neutral-500">({items.length} items)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm flex items-center gap-2 transition"
              onClick={() => inputRef.current?.click()}
              title="Upload images"
            >
              <Upload className="w-4 h-4" />
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
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-neutral-800 transition"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          ref={dropZoneRef}
          className={`flex-1 overflow-y-auto p-4 ${
            isDragging ? "bg-emerald-500/5 border-2 border-emerald-500 border-dashed" : ""
          }`}
        >
          {isDragging && (
            <div className="absolute inset-0 grid place-items-center text-emerald-400 text-lg pointer-events-none">
              Drop images to add to Clipboard
            </div>
          )}
          
          {loading && (
            <div className="text-center text-neutral-400 py-8">Loading clipboard...</div>
          )}
          
          {!loading && items.length === 0 && (
            <div className="text-center text-neutral-400 py-12">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg mb-2">No images in clipboard</p>
              <p className="text-sm">
                Drop images here, paste with Ctrl/Cmd+V, or click Upload
              </p>
            </div>
          )}
          
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((rec) => (
                <ClipboardThumb
                  key={rec.id}
                  rec={rec}
                  selected={selected === rec.id}
                  onClick={() => handleImageClick(rec)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="p-3 border-t border-neutral-800 text-xs text-neutral-500 text-center">
          💡 Tip: Paste images with Ctrl/Cmd+V or drag & drop files here
        </div>
      </div>
    </div>
  );
}

// ========== Thumbnail Component ==========

function ClipboardThumb({
  rec,
  selected,
  onClick,
}: {
  rec: ClipRecord;
  selected: boolean;
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  
  useEffect(() => {
    const u = URL.createObjectURL(rec.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [rec.blob]);

  return (
    <button
      onClick={onClick}
      className={`group relative rounded-xl overflow-hidden border transition hover:scale-105 ${
        selected ? "border-emerald-500 ring-2 ring-emerald-500" : "border-neutral-800 hover:border-neutral-600"
      }`}
    >
      {url && (
        <img
          src={url}
          alt={rec.name}
          className="w-full h-32 object-cover"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-xs">
        <div className="truncate font-medium" title={rec.name}>
          {rec.name}
        </div>
        <div className="opacity-75 text-[10px]">
          {rec.width}×{rec.height}
        </div>
      </div>
      {selected && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </button>
  );
}

// ========== Floating Clipboard Button ==========

export function ClipboardButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 p-4 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg hover:shadow-xl transition-all hover:scale-110 z-40 group"
      title="Open Studio Clipboard"
    >
      <ImageIcon className="w-6 h-6" />
      <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold animate-pulse">
        📋
      </span>
    </button>
  );
}

