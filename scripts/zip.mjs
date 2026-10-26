// Bağımlılıksız, deterministik zip yazıcı: aynı girdiler her zaman aynı baytları (ve aynı sha256'yı) verir.
// Girdiler adına göre sıralanır, zaman damgası tek ve sabittir, unix izinleri (ör. çalıştırılabilir) korunur.
import { deflateRawSync } from "node:zlib";

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosZamani(d) {
  const y = Math.max(1980, d.getUTCFullYear());
  return {
    saat: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    tarih: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

// girdiler: [{ ad: "klasor/dosya.txt", veri: Buffer, mod?: 0o644 | 0o755 }]; zaman: Date
export function zipYaz(girdiler, zaman = new Date(Date.UTC(1980, 0, 1))) {
  const { saat, tarih } = dosZamani(zaman);
  const sirali = [...girdiler].sort((a, b) => (a.ad < b.ad ? -1 : a.ad > b.ad ? 1 : 0));
  const yerel = [], merkez = [];
  let ofset = 0;
  const adlar = new Set();
  for (const g of sirali) {
    if (!g.ad || g.ad.startsWith("/") || g.ad.split("/").includes("..") || g.ad.includes("\\")) throw new Error(`geçersiz yol: ${g.ad}`);
    if (adlar.has(g.ad)) throw new Error(`iki kez: ${g.ad}`);
    adlar.add(g.ad);
    const ad = Buffer.from(g.ad, "utf8");
    const sikisik = deflateRawSync(g.veri, { level: 9 });
    const yontem = sikisik.length < g.veri.length ? 8 : 0;
    const govde = yontem === 8 ? sikisik : g.veri;
    const crc = crc32(g.veri);
    if (g.veri.length > 0xfffffffe || ofset > 0xfffffffe) throw new Error("zip64 desteklenmiyor");

    const b = Buffer.alloc(30);
    b.writeUInt32LE(0x04034b50, 0);
    b.writeUInt16LE(20, 4);            // açmak için gereken sürüm
    b.writeUInt16LE(0x0800, 6);        // UTF-8 adlar
    b.writeUInt16LE(yontem, 8);
    b.writeUInt16LE(saat, 10);
    b.writeUInt16LE(tarih, 12);
    b.writeUInt32LE(crc, 14);
    b.writeUInt32LE(govde.length, 18);
    b.writeUInt32LE(g.veri.length, 22);
    b.writeUInt16LE(ad.length, 26);
    b.writeUInt16LE(0, 28);
    yerel.push(b, ad, govde);

    const m = Buffer.alloc(46);
    m.writeUInt32LE(0x02014b50, 0);
    m.writeUInt16LE((3 << 8) | 20, 4);  // unix, 2.0
    m.writeUInt16LE(20, 6);
    m.writeUInt16LE(0x0800, 8);
    m.writeUInt16LE(yontem, 10);
    m.writeUInt16LE(saat, 12);
    m.writeUInt16LE(tarih, 14);
    m.writeUInt32LE(crc, 16);
    m.writeUInt32LE(govde.length, 20);
    m.writeUInt32LE(g.veri.length, 24);
    m.writeUInt16LE(ad.length, 28);
    m.writeUInt16LE(0, 30);
    m.writeUInt16LE(0, 32);
    m.writeUInt16LE(0, 34);
    m.writeUInt16LE(0, 36);
    m.writeUInt32LE(((0o100000 | (g.mod ?? 0o644)) << 16) >>> 0, 38);   // normal dosya + izinler
    m.writeUInt32LE(ofset, 42);
    merkez.push(m, ad);
    ofset += 30 + ad.length + govde.length;
  }
  const merkezBoyut = merkez.reduce((n, x) => n + x.length, 0);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0);
  son.writeUInt16LE(sirali.length, 8);
  son.writeUInt16LE(sirali.length, 10);
  son.writeUInt32LE(merkezBoyut, 12);
  son.writeUInt32LE(ofset, 16);
  return Buffer.concat([...yerel, ...merkez, son]);
}
