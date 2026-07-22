"use client";

import ReceiptsImporter from "@/components/receipts-importer";

export default function ReceiptsPage() {
  return (
    <div className="flex flex-col gap-5 p-2 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Faturas (PDFs)</h1>
        <p className="text-sm text-slate-500">
          Escolha a <strong>pasta</strong> com os PDFs das faturas do Meta. O navegador lê tudo aqui mesmo,
          extrai o <strong>código facebk</strong> e o <strong>ID da transação</strong>, e cruza:
          código → cobrança no extrato (coluna Fatura ✅/🔴) e ID → cobrança do Meta (coluna PDF).
          <br />Confira a amostra antes de importar — a coluna <strong>Código</strong> tem que vir preenchida.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <ReceiptsImporter />
      </div>
    </div>
  );
}
