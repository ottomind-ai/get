#!/usr/bin/env node
// Bir paket reposunun sürüm etiketinden get.ottomind.ai / skills.ottomind.ai'ye gidecek dosyaları üretir.
//   node paketle.mjs --kaynak <repo> --etiket v1.2.3 --cikti <klasör> --tarama <klasör> [--ekler <klasör>] [--repo sahip/ad]
// Kaynak repoda paket.json:
//   { "ad": "prelit",                    paket ve skill adı (küçük harf, rakam, tire)
//     "arsiv": ["server.js", "lib/"],    <ad>.zip'e girecek izinli yollar (dosya ya da "/" ile biten klasör);
//                                        yalnızca etiketteki commit'te izlenen (git ls-files) dosyalar girer
//     "ekler": true,                     --ekler klasöründeki hazır dosyalar (ör. derlenmiş ikililer) olduğu gibi yayımlanır
//     "kurulum": "install.sh",           kendi kurulum betiği; yoksa ve arsiv varsa varsayılan betik
//     "skill": "skill" }                 SKILL.md'nin klasörü (varsayılan "skill")
// Çıktı: <cikti>/<ad>/<sürüm>/ altında dosyalar, install.sh, skill/, <ad>-skill.zip, SHA256SUMS, manifest.json.
// <tarama> klasörüne gizli bilgi taraması için açık hâlleri konur. {{name}} ve {{version}} metin dosyalarında doldurulur.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipYaz } from "./zip.mjs";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
export const PAKET = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const ETIKET = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const METIN = /\.(md|txt|sh|json|ya?ml|toml)$/i;
const GET = "https://get.ottomind.ai", SKILLS = "https://skills.ottomind.ai";

export class PaketHatasi extends Error {}
const hata = (m) => { throw new PaketHatasi(m); };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const doldur = (s, d) => s.replace(/\{\{(name|version)\}\}/g, (_, k) => d[k]);

// SKILL.md'nin ön bilgisi: Claude skill kuralları (name = paket adı, description dolu, en çok 1024 karakter, etiket yok).
export function skillOnBilgi(metin, ad) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(metin);
  if (!m) hata("SKILL.md '---' ile başlayan bir ön bilgi (name, description) içermeli");
  const alan = {};
  for (const satir of m[1].split(/\r?\n/)) {
    const k = /^([a-z_-]+):\s*(.*)$/.exec(satir);
    if (k) alan[k[1]] = k[2].replace(/^["']|["']$/g, "").trim();
  }
  if (alan.name !== ad) hata(`SKILL.md name "${alan.name ?? ""}" paket adıyla (${ad}) aynı olmalı`);
  if (!alan.description) hata("SKILL.md description boş");
  if (alan.description.length > 1024) hata("SKILL.md description en çok 1024 karakter olabilir");
  if (/[<>]/.test(alan.description)) hata("SKILL.md description < ya da > içeremez");
  return alan;
}

function izlenenler(kaynak) {
  const cikti = execFileSync("git", ["-C", kaynak, "ls-files", "-s", "-z"], { encoding: "utf8" });
  return cikti.split("\0").filter(Boolean).map((s) => {
    const [bilgi, yol] = s.split("\t");
    return { yol, mod: bilgi.startsWith("100755") ? 0o755 : 0o644, link: bilgi.startsWith("120000") };
  });
}

function dosyalar(kok) {
  const out = [];
  for (const g of readdirSync(kok, { withFileTypes: true, recursive: true })) {
    if (g.isSymbolicLink()) hata(`bağlantı (symlink) yayımlanamaz: ${path.join(g.parentPath, g.name)}`);
    if (g.isFile()) out.push(path.relative(kok, path.join(g.parentPath, g.name)).split(path.sep).join("/"));
  }
  return out.sort();
}

export function paketle({ kaynak, etiket, cikti, tarama, ekler = null, repo = "", commit = "", yayin = new Date() }) {
  const pj = JSON.parse(readFileSync(path.join(kaynak, "paket.json"), "utf8"));
  const ad = pj.ad;
  if (!PAKET.test(ad || "")) hata(`paket.json ad "${ad}" geçersiz (küçük harf, rakam, tire)`);
  const e = ETIKET.exec(etiket || "");
  if (!e) hata(`etiket "${etiket}" vX.Y.Z biçiminde olmalı`);
  const surum = e[1];
  const npm = path.join(kaynak, "package.json");
  if (existsSync(npm)) {
    const v = JSON.parse(readFileSync(npm, "utf8")).version;
    if (v && v !== surum) hata(`package.json sürümü (${v}) etiketle (${surum}) aynı değil`);
  }
  const d = { name: ad, version: surum };
  const hedef = path.join(cikti, ad, surum);
  rmSync(hedef, { recursive: true, force: true });
  rmSync(tarama, { recursive: true, force: true });
  mkdirSync(hedef, { recursive: true });
  mkdirSync(tarama, { recursive: true });
  const zaman = commit ? new Date(Number(execFileSync("git", ["-C", kaynak, "log", "-1", "--format=%ct", commit], { encoding: "utf8" }).trim()) * 1000) : new Date(Date.UTC(2020, 0, 1));

  // 1) Arşiv: izinli yollardaki izlenen dosyalar, <ad>/ klasörüyle.
  if (pj.arsiv !== undefined) {
    if (!Array.isArray(pj.arsiv) || !pj.arsiv.length) hata("paket.json arsiv boş olmayan bir liste olmalı");
    const izinli = pj.arsiv.map((y) => {
      if (typeof y !== "string" || !y || y.startsWith("/") || y.split("/").includes("..")) hata(`arsiv yolu geçersiz: ${y}`);
      return y;
    });
    const secilen = izlenenler(kaynak).filter((f) => izinli.some((y) => (y.endsWith("/") ? f.yol.startsWith(y) : f.yol === y)));
    for (const y of izinli) if (!secilen.some((f) => (y.endsWith("/") ? f.yol.startsWith(y) : f.yol === y))) hata(`arsiv yolu repoda yok: ${y}`);
    const girdiler = secilen.map((f) => {
      if (f.link) hata(`bağlantı (symlink) arşive giremez: ${f.yol}`);
      const veri = readFileSync(path.join(kaynak, f.yol));
      const t = path.join(tarama, "arsiv", f.yol);
      mkdirSync(path.dirname(t), { recursive: true });
      writeFileSync(t, veri);
      return { ad: `${ad}/${f.yol}`, veri, mod: f.mod };
    });
    writeFileSync(path.join(hedef, `${ad}.zip`), zipYaz(girdiler, zaman));
  }

  // 2) Ekler: derlenmiş dosyalar olduğu gibi (alt klasörsüz).
  if (pj.ekler) {
    if (!ekler || !existsSync(ekler)) hata("paket.json ekler istiyor ama --ekler klasörü yok");
    const liste = dosyalar(ekler);
    if (!liste.length) hata("ekler klasörü boş");
    mkdirSync(path.join(tarama, "ekler"), { recursive: true });
    for (const f of liste) {
      if (f.includes("/")) hata(`ekler düz bir klasör olmalı: ${f}`);
      if (/^(SHA256SUMS|manifest\.json|install\.sh)$/.test(f) || f === `${ad}-skill.zip`) hata(`ekler ayrılmış bir adı kullanıyor: ${f}`);
      cpSync(path.join(ekler, f), path.join(hedef, f));
      cpSync(path.join(ekler, f), path.join(tarama, "ekler", f));
    }
  }
  if (pj.arsiv === undefined && !pj.ekler) hata("paket.json'da arsiv ya da ekler olmalı");

  // 3) Kurulum betiği.
  const kurulumKaynak = pj.kurulum ? path.join(kaynak, pj.kurulum) : pj.arsiv ? path.join(BURASI, "kurulum-varsayilan.sh") : null;
  if (kurulumKaynak) {
    if (!existsSync(kurulumKaynak)) hata(`kurulum betiği yok: ${pj.kurulum}`);
    const k = doldur(readFileSync(kurulumKaynak, "utf8"), d);
    writeFileSync(path.join(hedef, "install.sh"), k);
    writeFileSync(path.join(tarama, "install.sh"), k);
  }

  // 4) Skill: SKILL.md (+ ek dosyalar), metinler doldurulur; Claude'a yüklenebilir zip.
  const skillKlasor = path.join(kaynak, pj.skill || "skill");
  if (!existsSync(path.join(skillKlasor, "SKILL.md"))) hata(`${pj.skill || "skill"}/SKILL.md yok`);
  const skillGirdi = [];
  let onBilgi;
  for (const f of dosyalar(skillKlasor)) {
    let veri = readFileSync(path.join(skillKlasor, f));
    if (METIN.test(f)) veri = Buffer.from(doldur(veri.toString("utf8"), d));
    if (f === "SKILL.md") onBilgi = skillOnBilgi(veri.toString("utf8"), ad);
    for (const kok of [path.join(hedef, "skill"), path.join(tarama, "skill")]) {
      mkdirSync(path.dirname(path.join(kok, f)), { recursive: true });
      writeFileSync(path.join(kok, f), veri);
    }
    skillGirdi.push({ ad: `${ad}/${f}`, veri });
  }
  writeFileSync(path.join(hedef, `${ad}-skill.zip`), zipYaz(skillGirdi, zaman));

  // 5) SHA256SUMS ve manifest.
  const hepsi = dosyalar(hedef);
  const ozetler = hepsi.map((f) => ({ f, h: sha256(readFileSync(path.join(hedef, f))), n: statSync(path.join(hedef, f)).size }));
  writeFileSync(path.join(hedef, "SHA256SUMS"), ozetler.map((x) => `${x.h}  ${x.f}`).join("\n") + "\n");
  const manifest = {
    name: ad,
    version: surum,
    description: onBilgi.description,
    published: yayin.toISOString().replace(/\.\d{3}Z$/, "Z"),
    source: { repo, tag: etiket, commit },
    install: kurulumKaynak ? `curl -fsSL ${GET}/${ad} | bash` : null,
    install_pinned: kurulumKaynak ? `curl -fsSL ${GET}/${ad}/${surum} | bash` : null,
    skill: `${SKILLS}/${ad}/${surum}/SKILL.md`,
    skill_zip: `${SKILLS}/${ad}/${surum}/${ad}-skill.zip`,
    checksums: `${GET}/${ad}/${surum}/SHA256SUMS`,
    files: ozetler.filter((x) => !x.f.startsWith("skill/")).map((x) => ({ name: x.f, size: x.n, sha256: x.h, url: `${GET}/${ad}/${surum}/${x.f}` })),
  };
  writeFileSync(path.join(hedef, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { ad, surum, hedef, manifest };
}

function argumanlar(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) hata(`beklenmeyen argüman: ${argv[i]}`);
    a[argv[i].slice(2)] = argv[i + 1];
  }
  return a;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const a = argumanlar(process.argv.slice(2));
    const r = paketle({ kaynak: a.kaynak, etiket: a.etiket, cikti: a.cikti, tarama: a.tarama, ekler: a.ekler || null, repo: a.repo || "", commit: a.commit || "" });
    console.log(`${r.ad} ${r.surum} → ${r.hedef}`);
    for (const f of r.manifest.files) console.log(`  ${f.sha256}  ${f.name} (${f.size} B)`);
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `ad=${r.ad}\nsurum=${r.surum}\nklasor=${r.hedef}\n`, { flag: "a" });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
