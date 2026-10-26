import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PaketHatasi, paketle, skillOnBilgi } from "../scripts/paketle.mjs";
import { crc32, zipYaz } from "../scripts/zip.mjs";

const SKILL = "---\nname: demo\ndescription: Demo package for tests. Use when testing.\n---\n\n# demo {{version}}\n\ncurl -fsSL https://get.ottomind.ai/{{name}}/{{version}} | bash\n";
const git = (d, ...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" }).trim();

function repo({ paket = { ad: "demo", arsiv: ["a.txt", "lib/", "run.sh"] }, skill = SKILL, surum = "1.2.3" } = {}) {
  const d = mkdtempSync(path.join(tmpdir(), "paket-"));
  git(d, "init", "-q", "-b", "main");
  git(d, "config", "user.email", "t@example.com");
  git(d, "config", "user.name", "t");
  writeFileSync(path.join(d, "paket.json"), JSON.stringify(paket));
  writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "demo", version: surum }));
  writeFileSync(path.join(d, "a.txt"), "merhaba\n");
  mkdirSync(path.join(d, "lib"));
  writeFileSync(path.join(d, "lib", "x.js"), "export const x = 1;\n");
  writeFileSync(path.join(d, "run.sh"), "#!/bin/sh\necho ok\n");
  chmodSync(path.join(d, "run.sh"), 0o755);
  writeFileSync(path.join(d, "AGENT.md"), "iç notlar\n");
  mkdirSync(path.join(d, "skill", "references"), { recursive: true });
  writeFileSync(path.join(d, "skill", "SKILL.md"), skill);
  writeFileSync(path.join(d, "skill", "references", "api.md"), "API {{version}}\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "ilk");
  writeFileSync(path.join(d, "izlenmeyen.txt"), "gizli\n");   // commit'te yok: arşive girmemeli
  return { d, commit: git(d, "rev-parse", "HEAD") };
}

function calistir(d, commit, ek = {}) {
  const out = mkdtempSync(path.join(tmpdir(), "out-"));
  return paketle({ kaynak: d, etiket: "v1.2.3", cikti: path.join(out, "o"), tarama: path.join(out, "t"), repo: "ottomind-ai/demo", commit, yayin: new Date("2026-10-27T00:00:00Z"), ...ek });
}

test("arşiv, kurulum, skill, SHA256SUMS ve manifest", () => {
  const { d, commit } = repo();
  const r = calistir(d, commit);
  const h = r.hedef;
  const liste = execFileSync("unzip", ["-Z1", path.join(h, "demo.zip")], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(liste, ["demo/a.txt", "demo/lib/x.js", "demo/run.sh"]);
  execFileSync("unzip", ["-tq", path.join(h, "demo.zip")]);
  // Python da açabilsin ve çalıştırılabilir izni korunsun.
  const izin = execFileSync("python3", ["-I", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(oct(z.getinfo('demo/run.sh').external_attr >> 16 & 0o777))", path.join(h, "demo.zip")], { encoding: "utf8" }).trim();
  assert.equal(izin, "0o755");

  const kurulum = readFileSync(path.join(h, "install.sh"), "utf8");
  assert.match(kurulum, /local name="demo" version="1\.2\.3"/);
  assert.doesNotMatch(kurulum, /\{\{/);
  assert.match(readFileSync(path.join(h, "skill", "SKILL.md"), "utf8"), /# demo 1\.2\.3/);
  assert.equal(readFileSync(path.join(h, "skill", "references", "api.md"), "utf8"), "API 1.2.3\n");
  assert.deepEqual(execFileSync("unzip", ["-Z1", path.join(h, "demo-skill.zip")], { encoding: "utf8" }).trim().split("\n").sort(), ["demo/SKILL.md", "demo/references/api.md"]);

  const sums = readFileSync(path.join(h, "SHA256SUMS"), "utf8").trim().split("\n");
  for (const satir of sums) {
    const [ozet, f] = satir.split(/\s+/);
    assert.equal(createHash("sha256").update(readFileSync(path.join(h, f))).digest("hex"), ozet, f);
  }
  assert.ok(sums.some((s) => s.endsWith("  skill/SKILL.md")));
  const m = JSON.parse(readFileSync(path.join(h, "manifest.json"), "utf8"));
  assert.equal(m.name, "demo");
  assert.equal(m.version, "1.2.3");
  assert.equal(m.description, "Demo package for tests. Use when testing.");
  assert.equal(m.install, "curl -fsSL https://get.ottomind.ai/demo | bash");
  assert.deepEqual(m.source, { repo: "ottomind-ai/demo", tag: "v1.2.3", commit });
  assert.deepEqual(m.files.map((f) => f.name).sort(), ["demo-skill.zip", "demo.zip", "install.sh"]);
  assert.equal(m.files.find((f) => f.name === "demo.zip").url, "https://get.ottomind.ai/demo/1.2.3/demo.zip");
});

test("aynı commit iki kez aynı baytları verir", () => {
  const { d, commit } = repo();
  const a = readFileSync(path.join(calistir(d, commit).hedef, "demo.zip"));
  const b = readFileSync(path.join(calistir(d, commit).hedef, "demo.zip"));
  assert.ok(a.equals(b));
});

test("tarama klasörü yalnızca yayımlananları içerir", () => {
  const { d, commit } = repo();
  const out = mkdtempSync(path.join(tmpdir(), "out-"));
  paketle({ kaynak: d, etiket: "v1.2.3", cikti: path.join(out, "o"), tarama: path.join(out, "t"), commit });
  const dosyalar = execFileSync("find", [path.join(out, "t"), "-type", "f"], { encoding: "utf8" }).trim().split("\n").map((f) => path.relative(path.join(out, "t"), f)).sort();
  assert.deepEqual(dosyalar, ["arsiv/a.txt", "arsiv/lib/x.js", "arsiv/run.sh", "install.sh", "skill/SKILL.md", "skill/references/api.md"]);
});

test("ekler olduğu gibi yayımlanır, kendi kurulum betiğiyle", () => {
  const { d, commit } = repo({ paket: { ad: "demo", ekler: true, kurulum: "run.sh" } });
  const ek = mkdtempSync(path.join(tmpdir(), "ek-"));
  writeFileSync(path.join(ek, "demo_linux_amd64.tar.gz"), "ikili");
  const r = calistir(d, commit, { ekler: ek });
  assert.equal(readFileSync(path.join(r.hedef, "demo_linux_amd64.tar.gz"), "utf8"), "ikili");
  assert.equal(readFileSync(path.join(r.hedef, "install.sh"), "utf8"), "#!/bin/sh\necho ok\n");
  assert.ok(!r.manifest.files.some((f) => f.name === "demo.zip"));
});

test("hatalar", () => {
  const bekle = (fn, re) => assert.throws(fn, (e) => e instanceof PaketHatasi && re.test(e.message));
  const { d, commit } = repo({ surum: "1.2.4" });
  bekle(() => calistir(d, commit), /package\.json sürümü \(1\.2\.4\) etiketle \(1\.2\.3\)/);
  const r2 = repo({ skill: SKILL.replace("name: demo", "name: baska") });
  bekle(() => calistir(r2.d, r2.commit), /name "baska" paket adıyla \(demo\)/);
  const r3 = repo({ paket: { ad: "demo", arsiv: ["yok/"] } });
  bekle(() => calistir(r3.d, r3.commit), /arsiv yolu repoda yok: yok\//);
  const r4 = repo({ paket: { ad: "demo", arsiv: ["../x"] } });
  bekle(() => calistir(r4.d, r4.commit), /arsiv yolu geçersiz/);
  const r5 = repo({ paket: { ad: "Demo", arsiv: ["a.txt"] } });
  bekle(() => calistir(r5.d, r5.commit), /ad "Demo" geçersiz/);
  const r6 = repo();
  bekle(() => calistir(r6.d, r6.commit, { etiket: "1.2.3" }), /vX\.Y\.Z/);
  const r7 = repo({ paket: { ad: "demo", ekler: true } });
  bekle(() => calistir(r7.d, r7.commit), /--ekler klasörü yok/);
  const r8 = repo({ paket: { ad: "demo" } });
  bekle(() => calistir(r8.d, r8.commit), /arsiv ya da ekler/);
});

test("SKILL.md ön bilgisi", () => {
  assert.throws(() => skillOnBilgi("# başlıksız\n", "demo"), /ön bilgi/);
  assert.throws(() => skillOnBilgi("---\nname: demo\ndescription:\n---\n", "demo"), /description boş/);
  assert.throws(() => skillOnBilgi(`---\nname: demo\ndescription: ${"x".repeat(1025)}\n---\n`, "demo"), /1024/);
  assert.throws(() => skillOnBilgi("---\nname: demo\ndescription: a <b> tag\n---\n", "demo"), /< ya da >/);
  assert.equal(skillOnBilgi('---\nname: demo\ndescription: "Tırnaklı açıklama"\n---\n', "demo").description, "Tırnaklı açıklama");
});

test("zip yazıcı: CRC ve geçersiz yollar", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.throws(() => zipYaz([{ ad: "../x", veri: Buffer.from("a") }]), /geçersiz yol/);
  assert.throws(() => zipYaz([{ ad: "/x", veri: Buffer.from("a") }]), /geçersiz yol/);
  assert.throws(() => zipYaz([{ ad: "a", veri: Buffer.from("1") }, { ad: "a", veri: Buffer.from("2") }]), /iki kez/);
});
