/**
 * Texto de um arquivo de extrato escolhido na tela. O OFX costuma declarar CHARSET:1252 mas vir em UTF-8
 * (medido na XP e no BTG): tenta UTF-8 estrito e, se não for, lê como windows-1252.
 */
export async function textoDoArquivo(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1252").decode(bytes); }
}
