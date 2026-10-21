/*
 * unzip.js — leitor de ZIP mínimo, sem dependência externa.
 *
 * Por que existe: o retorno do eFinanceira vem em .zip, e .zip NÃO é anexável no
 * PJe — o que a juntada precisa é do PDF de dentro. O Firefox descomprime deflate
 * cru (DecompressionStream), mas não lê o CONTÊINER zip (diretório central, headers).
 * Este módulo faz essa leitura e devolve os arquivos já descomprimidos.
 *
 * Escopo deliberadamente pequeno: lê o Diretório Central (que sempre traz os
 * tamanhos) e descomprime cada entrada por STORE (método 0) ou DEFLATE (método 8,
 * via DecompressionStream "deflate-raw"). Não faz zip64, cifra, nem escrita.
 * Roda igual no content script (Firefox ≥115) e no Node (teste).
 *
 * API:  await CratosUnzip.entries(arrayBufferOuUint8)  ->  [{ name, bytes }]
 */
(function (raiz) {
  "use strict";

  async function inflateRaw(bytes) {
    // deflate-raw = deflate sem cabeçalho zlib, que é o que o zip guarda (método 8).
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = ds.readable.getReader();
    const partes = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      partes.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of partes) { out.set(p, o); o += p.length; }
    return out;
  }

  async function entries(entrada) {
    const u8 = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = u8.length;

    // 1) Acha o End Of Central Directory (assinatura 0x06054b50), varrendo do fim.
    //    O comentário final pode ter até 65535 bytes, então limitamos a busca.
    const EOCD_SIG = 0x06054b50;
    let eocd = -1;
    const limite = Math.max(0, n - 22 - 65535);
    for (let i = n - 22; i >= limite; i--) {
      if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("EOCD não encontrado — não é um zip válido");

    const totalEntradas = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);   // offset do início do Diretório Central

    const CD_SIG = 0x02014b50;
    const LFH_SIG = 0x04034b50;
    const dec = new TextDecoder("utf-8");
    const saida = [];

    for (let e = 0; e < totalEntradas; e++) {
      if (dv.getUint32(p, true) !== CD_SIG) break;   // fim/estrutura inesperada: para em vez de estourar
      const metodo   = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const fnLen    = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen  = dv.getUint16(p + 32, true);
      const lfhOff   = dv.getUint32(p + 42, true);
      const nome     = dec.decode(u8.subarray(p + 46, p + 46 + fnLen));
      p += 46 + fnLen + extraLen + commLen;

      // Diretório: pula (nome termina em "/")
      if (nome.endsWith("/")) continue;

      // O header LOCAL tem os PRÓPRIOS comprimentos de nome/extra (podem diferir do CD).
      if (dv.getUint32(lfhOff, true) !== LFH_SIG) continue;
      const lFnLen = dv.getUint16(lfhOff + 26, true);
      const lExLen = dv.getUint16(lfhOff + 28, true);
      const dataIni = lfhOff + 30 + lFnLen + lExLen;
      const comp = u8.subarray(dataIni, dataIni + compSize);

      let bytes;
      if (metodo === 0) bytes = comp.slice();            // STORE
      else if (metodo === 8) bytes = await inflateRaw(comp);  // DEFLATE
      else throw new Error("método de compressão não suportado: " + metodo + " (" + nome + ")");

      saida.push({ name: nome, bytes });
    }
    return saida;
  }

  /*
   * Seleciona os PDFs de dentro das entradas do zip e dá a cada um o rótulo do
   * CRATOS: "eFinanceira (<ano>)" no primeiro, "eFinanceira N (<ano>)" do segundo
   * em diante — o (ANO) sempre no fim. O ano separa os zips entre si (os PDFs
   * internos têm o MESMO nome em todos os anos); o índice separa PDFs do mesmo ano.
   * Devolve [] quando não há PDF (zip vazio/assíncrono ainda não pronto).
   */
  function rotularEfinPdfs(entradas, exercicio) {
    const ehPdf = (b) => b && b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    const ano = String(exercicio || "").replace(/[^\d]/g, "").slice(-4);
    const anoTxt = ano ? " (" + ano + ")" : "";
    return (entradas || []).filter((e) => ehPdf(e.bytes)).map((e, j) => ({
      label: "eFinanceira" + (j === 0 ? "" : " " + (j + 1)) + anoTxt,
      bytes: e.bytes,
    }));
  }

  const api = { entries, rotularEfinPdfs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  raiz.CratosUnzip = api;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
