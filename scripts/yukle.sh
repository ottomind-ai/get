#!/usr/bin/env bash
# Bir sürümü R2'ye (ottomind-paketler) yükler, son sürüm işaretini ve index.json'u günceller.
#   yukle.sh <out/<ad>/<sürüm>>
# Ortam: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (yalnızca bu bucket'a nesne okuma/yazma), isteğe bağlı R2_BUCKET.
# paket/ altı bucket lock ile kilitli: yayımlanmış bir sürüm değiştirilemez. Yeniden çalıştırmak güvenli: aynı özetli
# dosya atlanır, farklıysa iş durur (sürümü yükselt). Ön sürümler (1.2.3-rc.1) ve eski sürümler son sürüm işaretini taşımaz.
set -euo pipefail
DIR=${1:?"kullanım: yukle.sh out/<ad>/<sürüm>"}
DIR=${DIR%/}
SURUM=$(basename "$DIR")
AD=$(basename "$(dirname "$DIR")")
B=${R2_BUCKET:-ottomind-paketler}
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
export AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto
# R2, AWS CLI'nin yeni varsayılan bütünlük başlıklarını her işlemde istemiyor.
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
s3() { aws s3api --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" --output json "$@"; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

[[ -f $DIR/SHA256SUMS && -f $DIR/manifest.json ]] || { echo "✗ $DIR bir paketle.mjs çıktısı değil" >&2; exit 1; }

# 1) Sürüm dosyaları; SHA256SUMS ve manifest.json en son (yarım kalan bir yükleme "tamam" görünmesin).
mapfile -t LISTE < <(cd "$DIR" && find . -type f ! -name SHA256SUMS ! -name manifest.json | sed 's#^\./##' | sort)
LISTE+=(SHA256SUMS manifest.json)
for f in "${LISTE[@]}"; do
  key="paket/$AD/$SURUM/$f"
  ozet=$(sha256sum "$DIR/$f" | cut -d' ' -f1)
  if meta=$(s3 head-object --bucket "$B" --key "$key" 2>/dev/null); then
    var=$(jq -r '.Metadata.sha256 // ""' <<<"$meta")
    if [[ $var == "$ozet" ]]; then echo "  var: $key"; continue; fi
    echo "✗ $key zaten yayımlanmış ve içeriği farklı. Yayımlanmış sürüm değiştirilemez; sürümü yükselt." >&2
    exit 1
  fi
  s3 put-object --bucket "$B" --key "$key" --body "$DIR/$f" --metadata "sha256=$ozet" >/dev/null
  echo "  yüklendi: $key"
done

# 2) Son sürüm işareti: yalnızca kararlı ve mevcut olandan yeni bir sürüm için.
if [[ $SURUM == *-* ]]; then
  echo "  ön sürüm: son sürüm işareti değişmedi"
else
  simdiki=""
  if s3 get-object --bucket "$B" --key "son/$AD.json" "$tmp/son.json" >/dev/null 2>&1; then simdiki=$(jq -r '.version // ""' "$tmp/son.json"); fi
  if [[ -z $simdiki || ( $simdiki != "$SURUM" && $(printf '%s\n%s\n' "$simdiki" "$SURUM" | sort -V | tail -1) == "$SURUM" ) ]]; then
    jq -n --arg v "$SURUM" '{version: $v}' > "$tmp/yeni.json"
    s3 put-object --bucket "$B" --key "son/$AD.json" --body "$tmp/yeni.json" --content-type application/json >/dev/null
    echo "  son sürüm: $AD ${simdiki:-yok} → $SURUM"
  else
    echo "  son sürüm $simdiki kaldı ($SURUM daha yeni değil)"
  fi
fi

# 3) index.json: her paketin son sürümünün manifestinden.
mkdir -p "$tmp/m"
s3 list-objects-v2 --bucket "$B" --prefix son/ | jq -r '.Contents[]?.Key | select(endswith(".json"))' | sort | while read -r k; do
  p=${k#son/}; p=${p%.json}
  s3 get-object --bucket "$B" --key "$k" "$tmp/p.json" >/dev/null
  v=$(jq -r .version "$tmp/p.json")
  s3 get-object --bucket "$B" --key "paket/$p/$v/manifest.json" "$tmp/m/$p.json" >/dev/null || echo "  ! $p $v manifesti okunamadı" >&2
done
shopt -s nullglob
manifestler=("$tmp"/m/*.json)
(( ${#manifestler[@]} )) || manifestler=(/dev/null)
jq -s '{
  generated: (now | todate),
  packages: (map({
    name, version, description, published, install,
    manifest: "https://get.ottomind.ai/\(.name)/latest.json",
    skill: "https://skills.ottomind.ai/\(.name)/SKILL.md",
    skill_zip: "https://skills.ottomind.ai/\(.name)/\(.name)-skill.zip"
  }) | sort_by(.name))
}' "${manifestler[@]}" > "$tmp/index.json"
s3 put-object --bucket "$B" --key index.json --body "$tmp/index.json" --content-type application/json >/dev/null
echo "  index.json: $(jq -r '[.packages[] | "\(.name) \(.version)"] | join(", ")' "$tmp/index.json")"
