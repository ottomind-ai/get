#!/usr/bin/env bash
# Bir paketi GitHub Actions kullanmadan bu bilgisayardan yayımlar; ortak iş akışıyla (yayinla.yml) aynı adımlar:
# paketle → gitleaks → R2'ye yükle → get/skills adreslerinden indirip özetini karşılaştır.
#   bash yerel-yayinla.sh <paket reposu> <vX.Y.Z> [--ekler <klasör>]
# Etiket GitHub'a gönderilmiş olmalı (yayımlanan her şeyin kaynağı origin'de dursun); paket etiketin temiz bir kopyasından üretilir.
# R2 anahtarı: ortam değişkenleri ya da ~/.config/ottomind/r2-paket.env (get-kurulum.sh yazar, 600).
set -euo pipefail
BURASI=$(cd "$(dirname "$0")" && pwd)
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
REPO=$(cd "${1:?kullanım: yerel-yayinla.sh <repo> <vX.Y.Z> [--ekler <klasör>]}" && pwd)
ETIKET=${2:?etiket gerekli}
EKLER=""
if [[ ${3:-} == --ekler ]]; then EKLER=$(cd "${4:?ekler klasörü}" && pwd); fi
[[ $ETIKET =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail "etiket vX.Y.Z biçiminde olmalı: $ETIKET"

ENVF=$HOME/.config/ottomind/r2-paket.env
if [[ -z ${R2_ACCESS_KEY_ID:-} && -f $ENVF ]]; then set -a; . "$ENVF"; set +a; fi
[[ -n ${R2_ACCOUNT_ID:-} && -n ${R2_ACCESS_KEY_ID:-} && -n ${R2_SECRET_ACCESS_KEY:-} ]] || fail "R2 anahtarı yok ($ENVF ya da ortam değişkenleri)"
export R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
for k in node git jq aws curl; do command -v $k >/dev/null || fail "$k gerekli"; done

COMMIT=$(git -C "$REPO" rev-parse "$ETIKET^{commit}" 2>/dev/null) || fail "$ETIKET repoda yok"
UZAK=$(git -C "$REPO" ls-remote origin "refs/tags/$ETIKET^{}" "refs/tags/$ETIKET" | awk 'NR==1 || /\^\{\}$/ {c=$1} END {print c}')
[[ $UZAK == "$COMMIT" ]] || fail "$ETIKET origin'de yok ya da farklı commit'i gösteriyor; önce: git -C $REPO push origin $ETIKET"
ORIGIN=$(git -C "$REPO" remote get-url origin)
REPO_ADI=$(sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##' <<<"$ORIGIN")

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q "$REPO" "$tmp/kaynak"
git -C "$tmp/kaynak" -c advice.detachedHead=false checkout -q "$COMMIT"

echo "== paketle ($REPO_ADI $ETIKET, ${COMMIT:0:7})"
cikti=$(node "$BURASI/paketle.mjs" --kaynak "$tmp/kaynak" --etiket "$ETIKET" --cikti "$tmp/out" --tarama "$tmp/tarama" \
  --repo "$REPO_ADI" --commit "$COMMIT" ${EKLER:+--ekler "$EKLER"})
echo "$cikti" | sed 's/^/  /'
KLASOR=$(head -1 <<<"$cikti" | sed 's/.* → //')
AD=$(basename "$(dirname "$KLASOR")"); SURUM=$(basename "$KLASOR")

echo "== gizli bilgi taraması (gitleaks 8.30.1)"
case "$(uname -s)_$(uname -m)" in
  Darwin_arm64) g=darwin_arm64; h=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  Darwin_x86_64) g=darwin_x64; h=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  Linux_x86_64) g=linux_x64; h=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Linux_aarch64) g=linux_arm64; h=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  *) fail "gitleaks için desteklenmeyen sistem: $(uname -sm)" ;;
esac
curl -fsSLo "$tmp/gitleaks.tgz" "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_$g.tar.gz"
ozet() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
[[ $(ozet "$tmp/gitleaks.tgz") == "$h" ]] || fail "gitleaks indirmesinin özeti tutmuyor"
tar -xzf "$tmp/gitleaks.tgz" -C "$tmp" gitleaks
find "$tmp/tarama" -name '*.tar.gz' -exec sh -c 'mkdir -p "$1.d" && tar -xzf "$1" -C "$1.d"' _ {} \; 2>/dev/null || true
if ! "$tmp/gitleaks" dir "$tmp/tarama" --config "$BURASI/../gitleaks.toml" --redact --no-banner --exit-code 1 > "$tmp/gitleaks.log" 2>&1; then
  sed 's/^/  /' "$tmp/gitleaks.log" >&2
  fail "gitleaks bulgu verdi; yayın yapılmadı"
fi
tail -1 "$tmp/gitleaks.log" | sed 's/^/  /'

echo "== R2'ye yükle"
bash "$BURASI/yukle.sh" "$KLASOR"

echo "== dışarıdan doğrula"
base="https://get.ottomind.ai/$AD/$SURUM"
curl -fsS "$base/SHA256SUMS" | diff - "$KLASOR/SHA256SUMS" >/dev/null || fail "$base/SHA256SUMS yerel kopyayla aynı değil"
while read -r o f; do
  if [[ $f == skill/* ]]; then url="https://skills.ottomind.ai/$AD/$SURUM/${f#skill/}"; else url="$base/$f"; fi
  curl -fsS "$url" -o "$tmp/indir" || fail "indirilemedi: $url"
  [[ $(ozet "$tmp/indir") == "$o" ]] || fail "özet tutmuyor: $url"
done < "$KLASOR/SHA256SUMS"
echo "✓ $AD $SURUM yayımlandı"
echo "  kurulum: curl -fsSL https://get.ottomind.ai/$AD | bash"
echo "  skill:   https://skills.ottomind.ai/$AD/SKILL.md"
