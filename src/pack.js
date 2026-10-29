// gzip+base64 helpers (CompressionStream; browsers + Node 18+). Used for compact membership messages.
export async function pack(rows) {
  const s = new Blob([JSON.stringify(rows)]).stream().pipeThrough(new CompressionStream('gzip'));
  const b = new Uint8Array(await new Response(s).arrayBuffer()); let t = ''; for (const x of b) t += String.fromCharCode(x); return btoa(t);
}
export async function unpack(b64) {
  const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(s).text());
}
