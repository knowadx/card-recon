// Lê todos os recibos PDF (receipts/**/*.pdf) e extrai os campos-chave pra um JSON.
// Uso: npm i -D pdf-parse && node scripts/parse-receipts.mjs
// Saída: receipts-parsed.json  (depois carregar em prod via /api/admin/import-receipts)
import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse/lib/pdf-parse.js"); // arquivo interno: evita o "modo debug" do index

const ROOT = "receipts";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

function field(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

const files = walk(ROOT);
console.log(`${files.length} PDFs encontrados.`);
const rows = [];
let ok = 0, semRef = 0, erro = 0;

for (const file of files) {
  try {
    const data = await pdf(readFileSync(file));
    const text = data.text;
    const base = path.basename(file);

    // transactionId + data: vêm do NOME do arquivo (mais confiável); ref/conta/cartão/valor do conteúdo
    const txId = field(base, /#\s*([0-9]+-[0-9]+)/) || field(text, /Identifica[çc][ãa]o da transa[çc][ãa]o\s*([0-9]+-[0-9]+)/);
    const fnDate = base.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
    const date = fnDate ? `${fnDate[1]}-${fnDate[2]}-${fnDate[3]}T${fnDate[4]}:${fnDate[5]}:00Z` : null;

    const referenceNumber = field(text, /N[úu]mero de refer[êe]ncia:\s*([A-Za-z0-9]+)/);
    const accountId = field(text, /N[úu]mero de identifica[çc][ãa]o da conta:\s*([0-9]+)/);
    const accountName = field(text, /Fatura para\s+(.+)/);
    const cardLast4 = field(text, /(?:MasterCard|Mastercard|Visa|American Express|Amex)[^\d]*(\d{4})/i)
                   || field(text, /[·•]{2,}\s*(\d{4})/);
    const amountStr = field(text, /Pago\s*US\$\s*([\d.]*\d,\d{2})/) || field(text, /US\$\s*([\d.]*\d,\d{2})/);
    const amountUsd = amountStr ? Number(amountStr.replace(/\./g, "").replace(",", ".")) : null;

    if (!referenceNumber) semRef++;
    rows.push({ file: base, referenceNumber, transactionId: txId, accountId, accountName, cardLast4, amountUsd, date });
    ok++;
  } catch (e) {
    erro++;
    console.warn("ERRO", file, e.message);
  }
}

writeFileSync("receipts-parsed.json", JSON.stringify(rows, null, 0));
console.log(`OK ${ok} | sem referenceNumber ${semRef} | erro ${erro}`);
console.log("Gravado receipts-parsed.json");
// amostra
console.log(rows.slice(0, 3));
