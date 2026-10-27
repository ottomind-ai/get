import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { s3 } from "../src/index.js";

// R2 bağlamasının yerine: anahtar → içerik.
function kova(nesneler) {
  return {
    async get(k) {
      if (!(k in nesneler)) return null;
      const v = nesneler[k];
      const buf = Buffer.from(typeof v === "string" ? v : JSON.stringify(v));
      return { body: buf, size: buf.length, httpEtag: `"e-${k.length}-${buf.length}"`, async json() { return JSON.parse(buf.toString()); } };
    },
  };
}

const MANIFEST = { name: "prelit", version: "0.3.0", description: "Team votes" };
const env = {
  GET_HOST: "get.ottomind.ai",
  SKILLS_HOST: "skills.ottomind.ai",
  PAKETLER: kova({
    "index.json": { packages: [{ name: "prelit", version: "0.3.0", description: "Team votes", install: "curl -fsSL https://get.ottomind.ai/prelit | bash" }] },
    "son/prelit.json": { version: "0.3.0" },
    "paket/prelit/0.3.0/install.sh": "#!/usr/bin/env bash\necho 0.3.0\n",
    "paket/prelit/0.2.0/install.sh": "#!/usr/bin/env bash\necho 0.2.0\n",
    "paket/prelit/0.3.0/prelit.zip": "ZIP",
    "paket/prelit/0.3.0/SHA256SUMS": "abc  prelit.zip\n",
    "paket/prelit/0.3.0/manifest.json": MANIFEST,
    "paket/prelit/0.3.0/prelit-skill.zip": "SKILLZIP",
    "paket/prelit/0.3.0/skill/SKILL.md": "---\nname: prelit\n---\n# 0.3.0\n",
    "paket/prelit/0.3.0/skill/references/api.md": "api",
    "son/yalniz.json": { version: "1.0.0" },
    "paket/yalniz/1.0.0/manifest.json": { name: "yalniz" },
  }),
};

const iste = (url, init) => worker.fetch(new Request(url, init), env);
const metin = async (url, init) => {
  const r = await iste(url, init);
  return { r, t: await r.text() };
};

test("get kökü paketleri listeler, index.json JSON döner", async () => {
  const { r, t } = await metin("https://get.ottomind.ai/");
  assert.equal(r.status, 200);
  assert.match(t, /prelit 0\.3\.0/);
  assert.match(t, /curl -fsSL https:\/\/get\.ottomind\.ai\/prelit \| bash/);
  const j = await (await iste("https://get.ottomind.ai/index.json")).json();
  assert.equal(j.packages[0].name, "prelit");
});

test("/<paket> son sürümün kurulum betiği, kısa önbellek", async () => {
  for (const u of ["https://get.ottomind.ai/prelit", "https://get.ottomind.ai/prelit/"]) {
    const { r, t } = await metin(u);
    assert.equal(r.status, 200);
    assert.match(t, /echo 0\.3\.0/);
    assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "public, max-age=60");
    assert.equal(r.headers.get("x-paket"), "prelit@0.3.0");
  }
});

test("/<paket>/<sürüm> o sürümün betiği (v önekiyle de), uzun önbellek", async () => {
  for (const u of ["https://get.ottomind.ai/prelit/0.2.0", "https://get.ottomind.ai/prelit/v0.2.0"]) {
    const { r, t } = await metin(u);
    assert.equal(r.status, 200);
    assert.match(t, /echo 0\.2\.0/);
    assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
  }
});

test("latest.json, latest/<dosya> ve sürümlü dosya", async () => {
  assert.deepEqual(await (await iste("https://get.ottomind.ai/prelit/latest.json")).json(), MANIFEST);
  const son = await iste("https://get.ottomind.ai/prelit/latest/prelit.zip");
  assert.equal(son.status, 200);
  assert.equal(son.headers.get("content-disposition"), 'attachment; filename="prelit-0.3.0.zip"');
  assert.equal(son.headers.get("content-type"), "application/zip");
  const s = await metin("https://get.ottomind.ai/prelit/0.3.0/SHA256SUMS");
  assert.equal(s.t, "abc  prelit.zip\n");
});

test("kurulum betiği olmayan paket ve olmayan paket açıklayıcı 404", async () => {
  const a = await metin("https://get.ottomind.ai/yalniz");
  assert.equal(a.r.status, 404);
  assert.match(a.t, /kurulum betiği yok/);
  const b = await metin("https://get.ottomind.ai/yok");
  assert.equal(b.r.status, 404);
  assert.match(b.t, /yok adında bir paket yok/);
});

test("yol kaçışı ve geçersiz yollar 404", async () => {
  // Düz "/.." ve "%2e%2e" bölümlerini URL ayrıştırıcısı zaten çözer (/prelit/latest/.. → /prelit/); Worker'a kodlanmış "/" ya da "\\" gelebilir.
  for (const u of [
    "https://get.ottomind.ai/prelit/0.3.0/..%2Fson%2Fprelit.json",
    "https://get.ottomind.ai/prelit/0.3.0/skill/SKILL.md",
    "https://get.ottomind.ai/prelit/0.3.0/a/b",
    "https://get.ottomind.ai/Prelit",
    "https://get.ottomind.ai/prelit/1.2",
    "https://get.ottomind.ai/prelit/0.3.0/%E0%A4%A",
    "https://skills.ottomind.ai/prelit/..%2F..%2Findex.json",
    "https://skills.ottomind.ai/prelit/references/a%5Cb",
  ]) {
    assert.equal((await iste(u)).status, 404, u);
  }
});

test("skills kökü llms.txt, skill dosyaları son ve sürümlü", async () => {
  for (const u of ["https://skills.ottomind.ai/", "https://skills.ottomind.ai/llms.txt"]) {
    const { r, t } = await metin(u);
    assert.equal(r.status, 200);
    assert.match(t, /^# ottomind skills/);
    assert.match(t, /- \[prelit\]\(https:\/\/skills\.ottomind\.ai\/prelit\/SKILL\.md\): Team votes/);
  }
  for (const u of ["https://skills.ottomind.ai/prelit", "https://skills.ottomind.ai/prelit/SKILL.md", "https://skills.ottomind.ai/prelit/0.3.0/SKILL.md"]) {
    const { r, t } = await metin(u);
    assert.equal(r.status, 200, u);
    assert.match(t, /name: prelit/);
  }
  assert.equal((await metin("https://skills.ottomind.ai/prelit/references/api.md")).t, "api");
  assert.equal((await metin("https://skills.ottomind.ai/prelit/0.3.0/references/api.md")).t, "api");
  const z = await iste("https://skills.ottomind.ai/prelit/prelit-skill.zip");
  assert.equal(z.status, 200);
  assert.equal(z.headers.get("content-disposition"), 'attachment; filename="prelit-skill-0.3.0.zip"');
  assert.equal((await iste("https://skills.ottomind.ai/prelit/0.3.0/prelit-skill.zip")).status, 200);
});

test("yöntem, ETag, HEAD, başka alan adı", async () => {
  assert.equal((await iste("https://get.ottomind.ai/prelit", { method: "POST" })).status, 405);
  const ilk = await iste("https://get.ottomind.ai/prelit/0.3.0/prelit.zip");
  const etag = ilk.headers.get("etag");
  assert.ok(etag);
  assert.equal((await iste("https://get.ottomind.ai/prelit/0.3.0/prelit.zip", { headers: { "if-none-match": etag } })).status, 304);
  const head = await iste("https://get.ottomind.ai/prelit/0.3.0/prelit.zip", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "3");
  assert.equal((await iste("https://ornek.ottomind.ai/prelit")).status, 404);
  assert.equal(ilk.headers.get("access-control-allow-origin"), "*");
  assert.equal(ilk.headers.get("x-content-type-options"), "nosniff");
});

test("index.json yokken boş liste", async () => {
  const bos = { ...env, PAKETLER: kova({}) };
  const r = await worker.fetch(new Request("https://skills.ottomind.ai/"), bos);
  assert.match(await r.text(), /No skills published yet/);
  const g = await worker.fetch(new Request("https://get.ottomind.ai/"), bos);
  assert.match(await g.text(), /No packages published yet/);
});

test("S3: imzalı istek doğru adrese gider, 404 → yok, diğer hatalar fırlatır", async () => {
  const env = { S3_BUCKET: "otto-paketler-1", S3_REGION: "eu-central-1", AWS_ACCESS_KEY_ID: "AKIATEST", AWS_SECRET_ACCESS_KEY: "gizli" };
  const istekler = [];
  const asil = globalThis.fetch;
  globalThis.fetch = async (r) => {
    istekler.push(r);
    if (r.url.endsWith("/yok.json")) return new Response("", { status: 404 });
    if (r.url.endsWith("/yasak.json")) return new Response("", { status: 403 });
    return new Response('{"version":"1.0.0"}', { headers: { "content-length": "19", etag: '"abc"' } });
  };
  try {
    const d = s3(env);
    const o = await d.get("son/prelit.json");
    assert.equal(istekler[0].url, "https://otto-paketler-1.s3.eu-central-1.amazonaws.com/son/prelit.json");
    assert.match(istekler[0].headers.get("authorization"), /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/eu-central-1\/s3\/aws4_request/);
    assert.equal(o.size, 19);
    assert.equal(o.httpEtag, '"abc"');
    assert.deepEqual(await o.json(), { version: "1.0.0" });
    assert.equal(await d.get("yok.json"), null);
    await assert.rejects(() => d.get("yasak.json"), /S3 403/);
    await d.get("paket/a b/1.0.0/x.zip");
    assert.equal(istekler.at(-1).url, "https://otto-paketler-1.s3.eu-central-1.amazonaws.com/paket/a%20b/1.0.0/x.zip");
  } finally {
    globalThis.fetch = asil;
  }
});

test("depo okunamazsa 502", async () => {
  const bozuk = { ...env, PAKETLER: { async get() { throw new Error("S3 500"); } } };
  const r = await worker.fetch(new Request("https://get.ottomind.ai/prelit"), bozuk);
  assert.equal(r.status, 502);
  assert.match(await r.text(), /okunamıyor/);
});
