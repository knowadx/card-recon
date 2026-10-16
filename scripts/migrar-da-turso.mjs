// migrar-da-turso.mjs — copia o banco antigo (Turso/SQLite) para o Postgres novo do PixelFinance.
//
// Uso (no VPS, num container node na rede do PixelFinance — ver deploy/README.md):
//   ALVO_DATABASE_URL=postgresql://... node migrar-da-turso.mjs            → só CONFERE (desfaz no fim)
//   ALVO_DATABASE_URL=postgresql://... node migrar-da-turso.mjs --aplicar  → grava
// Credenciais da fonte: /s/turso_url e /s/turso_token (arquivos; nunca na linha de comando).
//
// Regras:
//  - a fonte é SÓ LEITURA: o token tem que ser read-only ("a":"ro" no JWT) e só há SELECT;
//  - tudo numa transação: qualquer erro (tipo, vínculo, duplicidade) desfaz TUDO;
//  - sem --aplicar, faz a cópia inteira e dá ROLLBACK (prova que entra, sem gravar);
//  - nada some calado: tabela desconhecida, ou coluna com dado que não existe no destino, PARA;
//  - o destino tem que estar VAZIO;
//  - no fim confere contagem por tabela e soma dos valores das transações.
import fs from "node:fs";
import { createClient } from "@libsql/client";
import pg from "pg";

const APLICAR = process.argv.includes("--aplicar");
const ALVO = process.env.ALVO_DATABASE_URL;
if (!ALVO) throw new Error("defina ALVO_DATABASE_URL");

// pais antes de filhos (as chaves estrangeiras são conferidas na hora)
const ORDEM = [
  "Holding", "Operation", "User", "Membership", "OperationMembership", "Company", "Account",
  "Category", "Transaction", "TransactionSplit", "AccountingSplit", "Document",
  "DashboardChart", "DashboardChartLine", "PlanSeries", "PlanSeriesValue", "ChartSeriesLink",
  "ExchangeRate", "Setting", "Credential", "MetaAdAccount", "MetaBillingCharge", "MetaReceipt", "CardWhitelist",
];
// sessões do login antigo não servem no novo (o login passa a ser pela Cloudflare)
const PULAR = new Set(["Session"]);
const LOTE = 500;

const log = (...a) => console.log(...a);

function tokenSoLeitura(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload.a === "ro";
  } catch {
    return false;
  }
}

function converter(v, tipo) {
  if (v === null || v === undefined) return null;
  if (tipo === "boolean") return v === 1 || v === 1n || v === true || v === "1" || v === "true";
  if (tipo.startsWith("timestamp")) {
    const d = typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000) : new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new Error(`data inválida: formato "${String(v).replace(/[0-9]/g, "9")}"`);
    return d;
  }
  if (tipo === "double precision" || tipo === "real" || tipo === "numeric") return Number(v);
  if (tipo === "integer" || tipo === "bigint" || tipo === "smallint") return Number(v);
  return typeof v === "bigint" ? v.toString() : v;
}

/** Categorias têm pai na própria tabela: ordena para o pai entrar antes do filho. */
function ordenarPorPai(rows) {
  const ids = new Set(rows.map((r) => r.id));
  const feitos = new Set();
  const out = [];
  let resto = rows;
  while (resto.length) {
    const prontos = resto.filter((r) => !r.parentId || !ids.has(r.parentId) || feitos.has(r.parentId));
    if (prontos.length === 0) throw new Error("ciclo de parentId em Category");
    prontos.forEach((r) => { out.push(r); feitos.add(r.id); });
    resto = resto.filter((r) => !feitos.has(r.id));
  }
  return out;
}

const fonteUrl = fs.readFileSync("/s/turso_url", "utf8").trim();
const fonteToken = fs.readFileSync("/s/turso_token", "utf8").trim();
if (!tokenSoLeitura(fonteToken)) throw new Error("o token da Turso NÃO é só leitura — parei sem conectar");
const fonte = createClient({ url: fonteUrl, authToken: fonteToken });
const alvo = new pg.Client({ connectionString: ALVO });
await alvo.connect();

// ── conferências antes de copiar ─────────────────────────────────────────────
const tabelasFonte = (await fonte.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND name NOT LIKE '_litestream%'",
)).rows.map((r) => String(r.name));
const desconhecidas = tabelasFonte.filter((t) => !ORDEM.includes(t) && !PULAR.has(t));
if (desconhecidas.length) throw new Error(`tabela(s) na fonte que o script não conhece: ${desconhecidas.join(", ")} — atualize ORDEM`);

const colunasAlvo = {};
for (const r of (await alvo.query(
  "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'",
)).rows) {
  (colunasAlvo[r.table_name] ??= {})[r.column_name] = r.data_type;
}
const naoVazias = [];
for (const t of ORDEM) {
  if (!colunasAlvo[t]) throw new Error(`tabela ${t} não existe no destino — rode as migrations antes`);
  const n = Number((await alvo.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n);
  if (n > 0) naoVazias.push(`${t}(${n})`);
}
if (naoVazias.length) throw new Error(`o destino NÃO está vazio: ${naoVazias.join(", ")}`);

// ── cópia, numa transação só ─────────────────────────────────────────────────
const relatorio = [];
await alvo.query("BEGIN");
try {
  for (const t of ORDEM) {
    if (!tabelasFonte.includes(t)) { relatorio.push({ t, fonte: "—", destino: 0, obs: "não existe na fonte" }); continue; }
    const colsFonte = (await fonte.execute(`PRAGMA table_info("${t}")`)).rows.map((r) => String(r.name));
    const tipos = colunasAlvo[t];
    const comuns = colsFonte.filter((c) => c in tipos);
    const soNaFonte = colsFonte.filter((c) => !(c in tipos));
    for (const c of soNaFonte) {
      const n = Number((await fonte.execute(`SELECT count(*) n FROM "${t}" WHERE "${c}" IS NOT NULL`)).rows[0].n);
      if (n > 0) throw new Error(`${t}.${c} tem ${n} valor(es) e não existe no destino — dado seria perdido`);
    }
    let rows = (await fonte.execute(`SELECT ${comuns.map((c) => `"${c}"`).join(", ")} FROM "${t}"`)).rows;
    if (t === "Category") rows = ordenarPorPai(rows);
    for (let i = 0; i < rows.length; i += LOTE) {
      const lote = rows.slice(i, i + LOTE);
      const params = [];
      const valores = lote.map((r) => `(${comuns.map((c) => { params.push(converter(r[c], tipos[c])); return `$${params.length}`; }).join(", ")})`);
      await alvo.query(`INSERT INTO "${t}" (${comuns.map((c) => `"${c}"`).join(", ")}) VALUES ${valores.join(", ")}`, params);
    }
    const nDestino = Number((await alvo.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n);
    const soNoDestino = Object.keys(tipos).filter((c) => !colsFonte.includes(c));
    relatorio.push({
      t, fonte: rows.length, destino: nDestino,
      obs: [soNaFonte.length ? `vazias só na fonte: ${soNaFonte.join(",")}` : "", soNoDestino.length ? `padrão no destino: ${soNoDestino.join(",")}` : ""].filter(Boolean).join(" · "),
    });
    if (nDestino !== rows.length) throw new Error(`${t}: fonte ${rows.length} × destino ${nDestino}`);
  }

  // soma dos valores das transações (dinheiro tem que bater)
  const somaFonte = Number((await fonte.execute(`SELECT coalesce(sum(amount),0) s FROM "Transaction"`)).rows[0].s);
  const somaAlvo = Number((await alvo.query(`SELECT coalesce(sum(amount),0) s FROM "Transaction"`)).rows[0].s);
  if (Math.abs(somaFonte - somaAlvo) > 0.005) throw new Error(`soma das transações não bate: fonte ${somaFonte} × destino ${somaAlvo}`);
  relatorio.push({ t: "Σ Transaction.amount", fonte: somaFonte.toFixed(2), destino: somaAlvo.toFixed(2), obs: "bate" });

  await alvo.query(APLICAR ? "COMMIT" : "ROLLBACK");
} catch (e) {
  await alvo.query("ROLLBACK").catch(() => {});
  log("✗ ERRO — nada foi gravado:", e.message);
  await alvo.end();
  process.exit(1);
}

for (const r of relatorio) log(`${String(r.t).padEnd(22)} ${String(r.fonte).padStart(12)} → ${String(r.destino).padEnd(12)} ${r.obs}`);
log(APLICAR ? "✓ GRAVADO no destino" : "✓ CONFERÊNCIA ok — tudo entrou e foi DESFEITO (rode com --aplicar para gravar)");
await alvo.end();
