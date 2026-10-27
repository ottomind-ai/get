# get.ottomind.ai · skills.ottomind.ai

Bir AI'a tek link verip bir paketi kullandırmak için: **skills.ottomind.ai** işin ajan tarafını (SKILL.md: ne zaman kullanılır, nasıl kurulur, kullanıcıya ne sorulur), **get.ottomind.ai** paketin kendisini (sürümlü dosyalar, SHA-256, manifest, kurulum betiği) sunar. Her paketin SKILL.md'si kendi reposunda durur; sürüm etiketi atılınca bu repodaki ortak iş akışı ikisine birden yayımlar.

Bu repo herkese açık; içinde sır yok. Cloudflare Worker (`src/index.js`), ortak yayın iş akışı (`.github/workflows/yayinla.yml`) ve paketleme betikleri (`scripts/`). Dosyalar AWS S3'te (krediden), adresleri ücretsiz Workers planındaki Worker sunar.

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

- **Depo:** AWS S3 `otto-paketler-079819355246` (eu-central-1); dışarıya kapalı (Block Public Access açık), dosyaları yalnızca Worker salt okunur bir anahtarla (`otto-paket-okuyucu`, Worker sırrı) imzalı isteklerle okur. Sürümlü yanıtlar Cloudflare önbelleğinde tutulur.
  - `paket/<paket>/<sürüm>/…` yayımlanmış sürüm. Bucket politikası buraya yalnızca "yoksa yaz" (`If-None-Match: *`) ile yazmaya izin verir ve silmeyi herkese reddeder: **silinemez ve değiştirilemez**; yayın rolü bunu aşamaz. Yanlış yayımlanan bir sürümü yalnızca AWS hesabının yöneticisi politikayı geçici olarak gevşetip silebilir (Bir şey yanlış yayımlanırsa). Versioning açık.
  - `son/<paket>.json` son sürüm işareti; `index.json` liste. Her yayında yeniden yazılır.
- **Worker:** `ottomind-get`, `get.ottomind.ai/*` ve `skills.ottomind.ai/*` yollarında. Yalnızca GET/HEAD; yol bölümleri sıkı desenlerle denetlenir.
- **Yayın:** paket reposunda `vX.Y.Z` etiketi → `yayinla.yml`:
  1. etiketteki commit'ten paketler (`scripts/paketle.mjs`): `paket.json`'daki izin listesine giren **izlenen** dosyalar `<paket>.zip`'e (deterministik; aynı commit aynı sha256), hazır ikililer olduğu gibi, kurulum betiği, `skill/` (`{{name}}`, `{{version}}` doldurulur), `<paket>-skill.zip`, `SHA256SUMS`, `manifest.json`;
  2. yayımlanacak her şeyi açık hâliyle **gitleaks** ile tarar (`gitleaks.toml`: varsayılan kurallar + `*.ops.ottomind.ai`, NetBird `100.74.*`, AWS örnek kimlikleri); bulgu varsa durur;
  3. GitHub OIDC ile `otto-paket-yayinci` rolünü üstlenip (sır yok) S3'e yükler (`scripts/yukle.sh`): aynı özetli dosya atlanır, farklıysa durur; son sürüm işareti yalnızca daha yeni kararlı sürümde ilerler (ön sürüm `1.2.3-rc.1` işaret almaz); `index.json` yeniden üretilir;
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
    permissions: { contents: read, id-token: write }
    uses: ottomind-ai/get/.github/workflows/yayinla.yml@main
```

Sır gerekmez: iş akışı AWS'ye GitHub OIDC ile girer. `otto-paket-yayinci` rolünü yalnızca güven ilkesinde adı geçen repoların `vX.Y.Z` etiketleri üstlenebilir; yeni bir paket reposu oraya eklenir (`get-kurulum.sh` → `ROLLER`). Rol yalnızca bu bucket'a yazabilir.

Yayın: `git tag v1.2.3 && git push origin v1.2.3`. Aynı sürüm ikinci kez yayımlanamaz; düzeltme için sürüm yükseltilir (aynı commit'ten yeniden çalıştırmak güvenli: aynı baytlar atlanır).

**Actions dakikası olmadan (private repolar ücretli dakika harcar):** aynı adımlar bu bilgisayardan, gönderilmiş etiketten:

```bash
git -C ../prelit push origin v0.3.0
bash scripts/yerel-yayinla.sh ../prelit v0.3.0            # ikilisi olan paket: --ekler <klasör>
```

Bu bilgisayardaki AWS oturumunu kullanır (`aws login`); bucket politikası burada da geçerli. Herkese açık repolarda (sina gibi) Actions ücretsizdir.

## İndirilen dosyayı elle doğrulamak

```bash
curl -fsSLO https://get.ottomind.ai/prelit/0.3.0/prelit.zip
curl -fsSL https://get.ottomind.ai/prelit/0.3.0/SHA256SUMS | grep ' prelit.zip$' | sha256sum -c -
```

`manifest.json` her dosyanın sha256'sını, boyutunu ve kaynak commit'i de verir.

## Geliştirme

```bash
npm ci && npm test             # Worker yolları (sahte depo), S3 imzası, paketleme, zip
node scripts/paketle.mjs --kaynak ../prelit --etiket v0.3.0 --cikti out --tarama tarama
```

## Kurulum (bir kez) ve Worker yayını

AWS'de (`get-kurulum.sh kur`): S3 bucket `otto-paketler-079819355246` (versioning, Block Public Access, şifreleme, yalnızca TLS, `paket/` için üzerine yazma ve silme yasağı), GitHub OIDC sağlayıcısı, yayın rolü `otto-paket-yayinci` (yalnızca izinli repoların etiketleri; yalnızca bu bucket'a yazma), Worker'ın salt okunur kullanıcısı `otto-paket-okuyucu`. Cloudflare'da (ücretsiz plan, kart gerekmez): `skills.ottomind.ai` için proxy'li DNS kaydı ve Worker:

```bash
npm ci
npx wrangler@4.149.0 login
npx wrangler@4.149.0 deploy
# okuyucu anahtarı: aws iam create-access-key … | wrangler secret put AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

## Bir şey yanlış yayımlanırsa

İçinde sır olan bir sürüm: önce sırrı iptal et (yeni anahtar üret). Sonra AWS'de bucket politikasındaki silme yasağını geçici olarak kaldır, `paket/<ad>/<sürüm>/` nesnelerini (versiyonlarıyla) sil, `son/<ad>.json`'u önceki sürüme çevir, politikayı geri koy; bir sonraki yayın `index.json`'u yeniler. Cloudflare önbelleğinden de temizle (Caching → Purge, ilgili adresler).
