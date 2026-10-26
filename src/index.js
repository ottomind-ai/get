// get.ottomind.ai ve skills.ottomind.ai: tek Worker, tek R2 bucket (ottomind-paketler).
//
// R2'de:
//   paket/<paket>/<sürüm>/...   yayımlanmış sürüm; bucket lock ile değiştirilemez, silinemez
//                               (dosyalar, SHA256SUMS, manifest.json, install.sh, skill/, <paket>-skill.zip)
//   son/<paket>.json            son sürümü gösteren işaret: {"version": "x.y.z"}
//   index.json                  bütün paketlerin listesi (yayın iş akışı her yayında yeniden üretir)
//
// get.ottomind.ai                          paket listesi (metin; /index.json JSON)
// get.ottomind.ai/<paket>                  son sürümün kurulum betiği (curl … | bash)
// get.ottomind.ai/<paket>/<sürüm>          o sürümün kurulum betiği
// get.ottomind.ai/<paket>/latest.json      son sürümün manifesti
// get.ottomind.ai/<paket>/latest/<dosya>   son sürümün dosyası
// get.ottomind.ai/<paket>/<sürüm>/<dosya>  sürümün dosyası
// skills.ottomind.ai                       llms.txt (bütün skill'ler); /index.json JSON
// skills.ottomind.ai/<paket>[/SKILL.md]    son sürümün SKILL.md'si
// skills.ottomind.ai/<paket>/<yol>         son sürümün skill dosyası (references/… ya da <paket>-skill.zip)
// skills.ottomind.ai/<paket>/<sürüm>/<yol> o sürümün skill dosyası

const PAKET = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SURUM = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const DOSYA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const TURLER = {
  sh: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8", zip: "application/zip", gz: "application/gzip", tgz: "application/gzip",
  png: "image/png", svg: "image/svg+xml", sig: "application/octet-stream", pem: "text/plain; charset=utf-8",
};
const SABIT = "public, max-age=31536000, immutable";   // sürümlü yollar hiç değişmez
const KISA = "public, max-age=60";                      // son sürüm, listeler

export default {
  async fetch(req, env) {
    if (req.method !== "GET" && req.method !== "HEAD") return metin("Yalnızca GET ve HEAD.\n", 405, { allow: "GET, HEAD" });
    const url = new URL(req.url);
    const host = url.hostname;
    let parcalar;
    try {
      parcalar = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return yok();
    }
    if (parcalar.some((p) => p === "." || p === ".." || p.includes("/") || p.includes("\\"))) return yok();
    if (host === (env.GET_HOST || "get.ottomind.ai")) return get(req, env, parcalar);
    if (host === (env.SKILLS_HOST || "skills.ottomind.ai")) return skills(req, env, parcalar);
    return yok();
  },
};

async function get(req, env, p) {
  if (p.length === 0) return liste(env, "get");
  if (p.length === 1 && p[0] === "index.json") return indeks(env);
  const [paket, ikinci, ...kalan] = p;
  if (!PAKET.test(paket)) return yok();

  if (ikinci === undefined) return nesne(req, env, paket, null, "install.sh", { kurulum: true });
  if (ikinci === "latest.json" && !kalan.length) return nesne(req, env, paket, null, "manifest.json");
  if (ikinci === "latest" && kalan.length === 1) return nesne(req, env, paket, null, kalan[0]);
  const s = SURUM.exec(ikinci);
  if (!s) return yok();
  if (!kalan.length) return nesne(req, env, paket, s[1], "install.sh", { kurulum: true });
  if (kalan.length === 1) return nesne(req, env, paket, s[1], kalan[0]);
  return yok();
}

async function skills(req, env, p) {
  if (p.length === 0 || (p.length === 1 && p[0] === "llms.txt")) return liste(env, "skills");
  if (p.length === 1 && p[0] === "index.json") return indeks(env);
  const [paket, ...kalan] = p;
  if (!PAKET.test(paket)) return yok();
  if (!kalan.length) return nesne(req, env, paket, null, "skill/SKILL.md");
  const s = SURUM.exec(kalan[0]);
  const surum = s ? s[1] : null;
  const yol = s ? kalan.slice(1) : kalan;
  if (!yol.length) return nesne(req, env, paket, surum, "skill/SKILL.md");
  if (yol.length === 1 && yol[0] === `${paket}-skill.zip`) return nesne(req, env, paket, surum, yol[0]);
  if (!yol.every((x) => DOSYA.test(x))) return yok();
  return nesne(req, env, paket, surum, "skill/" + yol.join("/"));
}

// Bir sürümün dosyası; surum null ise son sürüm (son/<paket>.json). Sürümlü yollar uzun önbelleklenir.
async function nesne(req, env, paket, surum, ad, { kurulum = false } = {}) {
  const son = surum === null;
  if (son) {
    surum = await sonSurum(env, paket);
    if (!surum) return yok(`${paket} adında bir paket yok. Liste: https://${env.GET_HOST || "get.ottomind.ai"}/\n`);
  }
  if (!ad.startsWith("skill/") && !DOSYA.test(ad)) return yok();
  const obj = await env.PAKETLER.get(`paket/${paket}/${surum}/${ad}`);
  if (!obj) {
    if (kurulum) return yok(`${paket} ${surum} için kurulum betiği yok; dosyalar: https://${env.GET_HOST || "get.ottomind.ai"}/${paket}/${surum}/manifest.json\n`);
    return yok();
  }
  const etag = obj.httpEtag;
  const basliklar = {
    "content-type": TURLER[ad.split(".").pop().toLowerCase()] || "application/octet-stream",
    "cache-control": son ? KISA : SABIT,
    etag,
    "x-paket": `${paket}@${surum}`,
  };
  if (ad.endsWith(".zip") || ad.endsWith(".gz") || ad.endsWith(".tgz")) {
    // Son sürüm adresinden inen dosya da sürümüyle adlansın.
    const dosya = ad.includes(surum) ? ad : ad.replace(/(\.tar\.gz|\.tgz|\.zip|\.gz)$/, `-${surum}$1`);
    basliklar["content-disposition"] = `attachment; filename="${dosya}"`;
  }
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: ortak(basliklar) });
  return new Response(req.method === "HEAD" ? null : obj.body, { status: 200, headers: ortak({ ...basliklar, "content-length": String(obj.size) }) });
}

async function sonSurum(env, paket) {
  const obj = await env.PAKETLER.get(`son/${paket}.json`);
  if (!obj) return null;
  try {
    const v = (await obj.json()).version;
    return typeof v === "string" && SURUM.test(v) ? SURUM.exec(v)[1] : null;
  } catch {
    return null;
  }
}

async function okuIndeks(env) {
  const obj = await env.PAKETLER.get("index.json");
  if (!obj) return { packages: [] };
  try {
    const d = await obj.json();
    return Array.isArray(d.packages) ? d : { packages: [] };
  } catch {
    return { packages: [] };
  }
}

async function indeks(env) {
  return new Response(JSON.stringify(await okuIndeks(env), null, 2) + "\n", {
    headers: ortak({ "content-type": "application/json; charset=utf-8", "cache-control": KISA }),
  });
}

// get kökü: insan ve ajan için düz metin; skills kökü: llms.txt biçimi.
async function liste(env, tur) {
  const { packages } = await okuIndeks(env);
  const get = `https://${env.GET_HOST || "get.ottomind.ai"}`, sk = `https://${env.SKILLS_HOST || "skills.ottomind.ai"}`;
  let out;
  if (tur === "skills") {
    out = "# ottomind skills\n\n" +
      "> Agent skills published by ottomind. Each skill tells an AI agent when and how to use one package. " +
      `Packages are downloaded from ${get} and verified with SHA-256. Machine-readable list: ${sk}/index.json\n\n## Skills\n\n` +
      (packages.length
        ? packages.map((x) => `- [${x.name}](${sk}/${x.name}/SKILL.md): ${x.description} (v${x.version}; Claude skill zip: ${sk}/${x.name}/${x.name}-skill.zip)`).join("\n")
        : "No skills published yet.") + "\n";
  } else {
    out = `ottomind packages — ${get}\nSkills for AI agents: ${sk}/llms.txt · JSON: ${get}/index.json\n\n` +
      (packages.length
        ? packages.map((x) => `${x.name} ${x.version}\n  ${x.description}\n` +
            (x.install ? `  install:  ${x.install}\n` : "") +
            `  manifest: ${get}/${x.name}/latest.json\n  skill:    ${sk}/${x.name}/SKILL.md\n`).join("\n")
        : "No packages published yet.\n");
  }
  return metin(out, 200, { "cache-control": KISA });
}

function ortak(h) {
  return { "x-content-type-options": "nosniff", "access-control-allow-origin": "*", ...h };
}

function metin(s, status = 200, h = {}) {
  return new Response(s, { status, headers: ortak({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...h }) });
}

function yok(s = "Bulunamadı.\n") {
  return metin(s, 404);
}
