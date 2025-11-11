"use client";

import React from "react";
import dynamic from "next/dynamic";

const BarChart = dynamic(() => import("recharts").then(m => m.BarChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then(m => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then(m => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then(m => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then(m => m.Tooltip), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then(m => m.CartesianGrid), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then(m => m.ResponsiveContainer), { ssr: false });

interface Bar {
  id: number;
  birth: number;
  death: number;
}

export default function BarcodeChart({ bars, onFocus }: { bars: Bar[]; onFocus?: (id: number) => void }) {
  const data = bars.map(b => ({ name: String(b.id), value: b.death - b.birth }));
  
  return (
    <div className="h-56 w-full">
      {typeof window !== "undefined" && data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" stroke="#aaa" tick={{ fill: "#aaa" }} />
            <YAxis stroke="#aaa" tick={{ fill: "#aaa" }} />
            <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
            <Bar 
              dataKey="value" 
              fill="#22d3ee"
              onClick={(d: any) => onFocus && onFocus(Number(d.name))} 
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full grid place-items-center text-neutral-500 text-sm">
          No barcode data yet
        </div>
      )}
    </div>
  );
}

