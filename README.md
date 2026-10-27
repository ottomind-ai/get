# get.ottomind.ai · skills.ottomind.ai

Bir AI'a tek link verip bir paketi kullandırmak için: **skills.ottomind.ai** işin ajan tarafını (SKILL.md: ne zaman kullanılır, nasıl kurulur, kullanıcıya ne sorulur), **get.ottomind.ai** paketin kendisini (sürümlü dosyalar, SHA-256, manifest, kurulum betiği) sunar. Her paketin SKILL.md'si kendi reposunda durur; sürüm etiketi atılınca bu repodaki ortak iş akışı ikisine birden yayımlar.

Bu repo herkese açık; içinde sır yok. Cloudflare Worker (`src/index.js`), ortak yayın iş akışı (`.github/workflows/yayinla.yml`) ve paketleme betikleri (`scripts/`).

## Adresler

```
get.ottomind.ai                          paket listesi (metin) · /index.json (JSON)
get.ottomind.ai/<paket>                  son sürümün kurulum betiği   → curl -fsSL https://get.ottomind.ai/<paket> | bash
get.ottomind.ai/<paket>/<sürüm>          o sürümün kurulum betiği
get.ottomind.ai/<paket>/latest.json      son sürümün manifesti (sürüm, dosyalar, sha256, kaynak commit)
get.ottomind.ai/<paket>/latest/<dosya>   son sürümün dosyası
get.ottomind.ai/<paket>/<sürüm>/<dosya>  sürümün dosyası, SHA256SUMS, manifest.json
skills.ottomind.ai                       llms.txt: bütün skill'ler · /index.json (JSON)
skills.ottomind.ai/<paket>/SKILL.md      son sürümün skill'i (AI'a verilecek tek link)
skills.ottomind.ai/<paket>/<paket>-skill.zip   Claude'a yüklenebilir skill (claude.ai → Ayarlar → Skills)
skills.ottomind.ai/<paket>/<sürüm>/…     o sürümün skill dosyaları
```

Sürümlü adresler hiç değişmez (bir yıl önbelleklenir); `latest`, kök listeler ve sürümsüz adresler 60 sn.

## Nasıl çalışır

- **Depo:** Cloudflare R2 `ottomind-paketler` bucket'ı; dışarıya kapalı, dosyaları yalnızca Worker sunar.
  - `paket/<paket>/<sürüm>/…` yayımlanmış sürüm. Bucket lock (süresiz) ile **silinemez ve değiştirilemez**; yayın anahtarı bunu aşamaz. Yanlış yayımlanan bir sürüm yalnızca Cloudflare hesabının yöneticisi kilidi kaldırarak silebilir (Bir şey yanlış yayımlanırsa).
  - `son/<paket>.json` son sürüm işareti; `index.json` liste. Her yayında yeniden yazılır.
- **Worker:** `ottomind-get`, `get.ottomind.ai/*` ve `skills.ottomind.ai/*` yollarında. Yalnızca GET/HEAD; yol bölümleri sıkı desenlerle denetlenir.
- **Yayın:** paket reposunda `vX.Y.Z` etiketi → `yayinla.yml`:
  1. etiketteki commit'ten paketler (`scripts/paketle.mjs`): `paket.json`'daki izin listesine giren **izlenen** dosyalar `<paket>.zip`'e (deterministik; aynı commit aynı sha256), hazır ikililer olduğu gibi, kurulum betiği, `skill/` (`{{name}}`, `{{version}}` doldurulur), `<paket>-skill.zip`, `SHA256SUMS`, `manifest.json`;
  2. yayımlanacak her şeyi açık hâliyle **gitleaks** ile tarar (`gitleaks.toml`: varsayılan kurallar + `*.ops.ottomind.ai`, NetBird `100.74.*`, AWS örnek kimlikleri); bulgu varsa durur;
  3. R2'ye yükler (`scripts/yukle.sh`): aynı özetli dosya atlanır, farklıysa durur; son sürüm işareti yalnızca daha yeni kararlı sürümde ilerler (ön sürüm `1.2.3-rc.1` işaret almaz); `index.json` yeniden üretilir;
  4. her dosyayı get/skills adreslerinden indirip özetini karşılaştırır.

## Paket ekleme

Paket reposunda üç şey:

**`paket.json`**

```json
{
  "ad": "prelit",
  "arsiv": ["server.js", "lib/", "public/", "package.json", "Dockerfile", "README.md"],
  "kurulum": "install.sh",
  "ekler": true,
  "skill": "skill"
}
```

- `ad`: paket ve skill adı (küçük harf, rakam, tire). SKILL.md'deki `name` ile aynı olmalı.
- `arsiv`: `<ad>.zip`'e girecek yollar (dosya ya da `/` ile biten klasör). Yalnızca git'te izlenen dosyalar girer; `.env`, `data/`, `node_modules` hiç girmez. **İzin listesi**: yeni bir dosya kendiliğinden yayımlanmaz. İç runbook'lar (AGENT.md gibi) listeye konmaz.
- `ekler`: derlenmiş dosyalar (ör. ikililer) önceki işte actions artifact olarak yüklenir, iş akışına `ekler: <desen>` ile verilir; düz bir klasör, olduğu gibi yayımlanır.
- `kurulum`: kendi kurulum betiği (`{{version}}` doldurulur). Verilmezse ve `arsiv` varsa varsayılan betik (`scripts/kurulum-varsayilan.sh`): zip'i ve SHA256SUMS'u indirir, özet tutmazsa durur, `./<ad>`'a açar.
- `skill`: SKILL.md'nin klasörü, varsayılan `skill/`.
- `package.json` varsa sürümü etiketle aynı olmalı.

**`skill/SKILL.md`** Claude skill biçiminde:

```markdown
---
name: prelit
description: Ne yaptığı ve AI'ın onu NE ZAMAN kullanacağı, tek paragraf (en çok 1024 karakter, < > yok).
---

# Prelit
Ne zaman kullanılır · nasıl kurulur (curl -fsSL https://get.ottomind.ai/{{name}}/{{version}} | bash) ·
nasıl kullanılır · kullanıcıya hangi kararlar sorulur · sınırlar.
```

Uzun ayrıntılar `skill/references/*.md` dosyalarına; SKILL.md onlara göreli linkle bağlanır. Skill herkese açıktır: sır, iç adres, müşteri bilgisi yazılmaz; anahtarlar için "kullanıcıya üret, sohbete yazma" denir.

**`.github/workflows/yayin.yml`**

```yaml
name: yayin
on:
  push:
    tags: ["v*"]
jobs:
  yayinla:
    uses: ottomind-ai/get/.github/workflows/yayinla.yml@main
    secrets:
      R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
      R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

Sırlar `ottomind-ai` organizasyonunda (yalnızca seçili repolara açık); organizasyon dışındaki bir repo için repo sırrı olarak eklenir. Anahtar yalnızca `ottomind-paketler` bucket'ında nesne okuma/yazma yetkisindedir.

Yayın: `git tag v1.2.3 && git push origin v1.2.3`. Aynı sürüm ikinci kez yayımlanamaz; düzeltme için sürüm yükseltilir (aynı commit'ten yeniden çalıştırmak güvenli: aynı baytlar atlanır).

**Actions dakikası olmadan (private repolar ücretli dakika harcar):** aynı adımlar bu bilgisayardan, gönderilmiş etiketten:

```bash
git -C ../prelit push origin v0.3.0
bash scripts/yerel-yayinla.sh ../prelit v0.3.0            # ikilisi olan paket: --ekler <klasör>
```

R2 anahtarını `~/.config/ottomind/r2-paket.env`'den (600) okur. Herkese açık repolarda (sina gibi) Actions ücretsizdir.

## İndirilen dosyayı elle doğrulamak

```bash
curl -fsSLO https://get.ottomind.ai/prelit/0.3.0/prelit.zip
curl -fsSL https://get.ottomind.ai/prelit/0.3.0/SHA256SUMS | grep ' prelit.zip$' | sha256sum -c -
```

`manifest.json` her dosyanın sha256'sını, boyutunu ve kaynak commit'i de verir.

## Geliştirme

```bash
npm test                       # Worker yolları (sahte R2), paketleme, zip
node scripts/paketle.mjs --kaynak ../prelit --etiket v0.3.0 --cikti out --tarama tarama
```

## Kurulum (bir kez) ve Worker yayını

Cloudflare hesabında: R2 bucket `ottomind-paketler`, `paket/` öneki için süresiz bucket lock kuralı, `skills.ottomind.ai` için proxy'li DNS kaydı, R2 API anahtarı (Object Read & Write, yalnızca bu bucket). Worker:

```bash
npx wrangler@4.149.0 login
npx wrangler@4.149.0 deploy
```

## Bir şey yanlış yayımlanırsa

İçinde sır olan bir sürüm: önce sırrı iptal et (yeni anahtar üret). Sonra Cloudflare panelinde R2 → `ottomind-paketler` → Settings → Bucket lock kuralını geçici olarak kaldır, `paket/<ad>/<sürüm>/` nesnelerini sil, `son/<ad>.json`'u önceki sürüme çevir, kuralı geri ekle; bir sonraki yayın `index.json`'u yeniler.
