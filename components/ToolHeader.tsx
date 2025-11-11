"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PHASES, Phase } from "./PhaseDropdown";
import { Logo } from "./Logo";

export function ToolHeader({ title, tools = PHASES }: { title?: string; tools?: Phase[]; }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-900/80 bg-black/65 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        {/* Left: logo -> home */}
        <Link href="/" className="flex items-center gap-2" aria-label="æDNA home">
          <Logo size={96} compact className="[text-shadow:_0_0_20px_rgba(255,255,255,0.06)]" />
        </Link>
        
        {/* Right: Navigation pills inline */}
        <nav className="flex-1 flex justify-end">
          <ul className="flex flex-wrap items-center gap-2">
            {tools.map((t) => {
              const active = pathname === t.href;
              return (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-white/30 bg-white/10 text-white"
                        : "border-neutral-800 bg-black/40 text-neutral-300 hover:bg-black/60"
                    }`}
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-6">
      {children}
    </h1>
  );
}

