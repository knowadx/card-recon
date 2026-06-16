"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch(`/api/auth/login?next=${encodeURIComponent(next)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok || res.redirected) {
      window.location.href = next;
    } else {
      const data = await res.json();
      setError(data.error ?? "Erro ao autenticar");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-[#e8eaed] shadow-sm p-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-bold text-[#1a202c]">ActiveView Finance</h1>
          <p className="text-[13px] text-[#6b7280] mt-1">Digite a senha para continuar</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            autoFocus
            className="w-full h-11 px-4 text-sm rounded-xl border border-[#e8eaed] focus:outline-none focus:border-[#00b9a5] focus:ring-2 focus:ring-[#00b9a5]/20 transition-all"
          />
          {error && <p className="text-[13px] text-rose-500">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full h-11 rounded-xl bg-[#00b9a5] hover:bg-[#00a896] text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
