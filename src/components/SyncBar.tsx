"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const PROVIDERS = [
  { id: "all", label: "Tudo" },
  { id: "meta", label: "Meta" },
  { id: "mercury", label: "Mercury" },
  { id: "revolut", label: "Revolut" },
  { id: "wise", label: "Wise" },
];

export function SyncBar({ period }: { period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function sync(provider: string) {
    setBusy(provider);
    setMsg(null);
    try {
      const res = await fetch(`/api/sync/${provider}?period=${period}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setMsg(`❌ ${provider}: ${json.error ?? res.statusText}`);
      } else {
        setMsg(`✅ ${provider}: ${JSON.stringify(json)}`);
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setMsg(`❌ ${provider}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function changePeriod(p: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("period", p);
    router.push(url.pathname + url.search);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          defaultValue={period}
          onChange={(e) => e.target.value && changePeriod(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => sync(p.id)}
            disabled={busy !== null}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === p.id ? "Sincronizando…" : `Sync ${p.label}`}
          </button>
        ))}
      </div>
      {msg && (
        <pre className="max-h-24 overflow-auto rounded-md bg-slate-900 p-2 text-xs text-slate-100">
          {msg}
        </pre>
      )}
    </div>
  );
}
