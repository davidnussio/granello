#!/usr/bin/env bash
# Allinea i secret di GitHub per firma e notarizzazione (quelli che legge release.yml) a
# envsec, che è la fonte di verità (contesto `apple`, oppure ENVSEC_CONTEXT):
#
#   macos.cert.password  password del .p12 (si genera una volta con
#                        `envsec -c apple secret macos.cert.password -a`)
#   apple.api.key.p8     base64 della chiave API di App Store Connect (.p8)
#   apple.api.key.id     il suo Key ID
#   apple.api.issuer     il suo Issuer ID
#   macos.cert.p12       scritto da questo script: base64 di un .p12 con SOLO
#                        l'identità Developer ID
#
# `security export` esporta tutte le identità del portachiavi, quindi lo script ricostruisce
# il .p12 con il solo certificato Developer ID e la sua chiave (riconosciuta confrontando le
# chiavi pubbliche), controlla che la password lo apra, lo salva in envsec e carica i cinque
# secret. Da rilanciare quando il certificato viene rinnovato. Lo stesso script c'è in
# Ingombro.
#
# Uso: scripts/ci/sync-signing-secrets.sh [argomenti per gh, di default --repo davidnussio/granello]
#   DRY_RUN=1          ricostruisce e controlla il .p12, non cambia niente
#   SOURCE_KEYCHAIN=…  portachiavi da cui esportare (di default login.keychain-db)
#   FROM_ENVSEC=1      parte dal macos.cert.p12 già in envsec invece di esportare il
#                      portachiavi (nessuna richiesta di password di macOS)
set -euo pipefail

CTX="${ENVSEC_CONTEXT:-apple}"
IDENTITY="${SIGNING_IDENTITY:-Developer ID Application: dambox Sagl (CLFTJ6F63K)}"
KEYCHAIN="${SOURCE_KEYCHAIN:-login.keychain-db}"
OPENSSL=/usr/bin/openssl # LibreSSL: scrive .p12 che ogni macOS sa importare
GH_ARGS=("$@")
if [[ ${#GH_ARGS[@]} -eq 0 ]]; then GH_ARGS=(--repo davidnussio/granello); fi

get() { envsec -c "$CTX" get "$1"; }

P12_PASSWORD="$(get macos.cert.password)"
if [[ -z "$P12_PASSWORD" ]]; then
	echo "envsec $CTX: macos.cert.password è vuoto." >&2
	exit 1
fi
export P12_PASSWORD

WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

if [[ "${FROM_ENVSEC:-}" == "1" ]]; then
	# Dal .p12 già salvato in envsec (nessuna richiesta del portachiavi).
	get macos.cert.p12 | tr -d '\n' | base64 -D > "$WORK/all.p12"
else
	echo "Esporto le identità del portachiavi (macOS può chiedere la password del portachiavi)..."
	security export -k "$KEYCHAIN" -t identities -f pkcs12 -P "$P12_PASSWORD" -o "$WORK/all.p12" > /dev/null
fi

# Un file PEM per ogni certificato e per ogni chiave privata dell'esportazione.
"$OPENSSL" pkcs12 -in "$WORK/all.p12" -nokeys -passin env:P12_PASSWORD 2> /dev/null |
	awk -v d="$WORK" '/BEGIN CERTIFICATE/{n++; f=d"/cert"n".pem"} f{print > f} /END CERTIFICATE/{f=""}'
"$OPENSSL" pkcs12 -in "$WORK/all.p12" -nocerts -nodes -passin env:P12_PASSWORD 2> /dev/null |
	awk -v d="$WORK" '/BEGIN .*PRIVATE KEY/{n++; f=d"/key"n".pem"} f{print > f} /END .*PRIVATE KEY/{f=""}'

CERT=""
for c in "$WORK"/cert*.pem; do
	if "$OPENSSL" x509 -in "$c" -noout -subject | grep -qF "CN=$IDENTITY"; then
		CERT="$c"
		break
	fi
done
if [[ -z "$CERT" ]]; then
	echo "\"$IDENTITY\" non c'è in $KEYCHAIN." >&2
	exit 1
fi

CERT_PUB="$("$OPENSSL" x509 -in "$CERT" -noout -pubkey)"
KEY=""
for k in "$WORK"/key*.pem; do
	if [[ "$("$OPENSSL" pkey -in "$k" -pubout 2> /dev/null)" == "$CERT_PUB" ]]; then
		KEY="$k"
		break
	fi
done
if [[ -z "$KEY" ]]; then
	echo "La chiave privata di \"$IDENTITY\" non c'è nell'esportazione." >&2
	exit 1
fi

"$OPENSSL" pkcs12 -export -in "$CERT" -inkey "$KEY" -name "$IDENTITY" \
	-out "$WORK/developer-id.p12" -passout env:P12_PASSWORD

# Lo stesso controllo dell'import in CI, più: esattamente un certificato e una chiave.
CERTS="$("$OPENSSL" pkcs12 -in "$WORK/developer-id.p12" -nokeys -passin env:P12_PASSWORD 2> /dev/null | grep -c 'BEGIN CERTIFICATE')"
KEYS="$("$OPENSSL" pkcs12 -in "$WORK/developer-id.p12" -nocerts -nodes -passin env:P12_PASSWORD 2> /dev/null | grep -c 'BEGIN .*PRIVATE KEY')"
if [[ "$CERTS" != 1 || "$KEYS" != 1 ]]; then
	echo "Il .p12 ricostruito ha $CERTS certificati e $KEYS chiavi, ne servono 1 e 1." >&2
	exit 1
fi

P12_B64="$(base64 -i "$WORK/developer-id.p12")"
if [[ "${DRY_RUN:-}" == "1" ]]; then
	echo "DRY_RUN: .p12 ricostruito con solo \"$IDENTITY\" ($(wc -c < "$WORK/developer-id.p12" | tr -d " ") byte), niente cambiato."
	exit 0
fi
printf '%s' "$P12_B64" | envsec -c "$CTX" add macos.cert.p12 > /dev/null
echo "envsec $CTX: macos.cert.p12 aggiornato (solo l'identità Developer ID)."

printf '%s' "$P12_B64" | gh secret set MACOS_CERT_P12 ${GH_ARGS[@]+"${GH_ARGS[@]}"}
printf '%s' "$P12_PASSWORD" | gh secret set MACOS_CERT_PASSWORD ${GH_ARGS[@]+"${GH_ARGS[@]}"}
get apple.api.key.p8 | tr -d '\n' | gh secret set APPLE_API_KEY_P8 ${GH_ARGS[@]+"${GH_ARGS[@]}"}
get apple.api.key.id | tr -d '\n' | gh secret set APPLE_API_KEY_ID ${GH_ARGS[@]+"${GH_ARGS[@]}"}
get apple.api.issuer | tr -d '\n' | gh secret set APPLE_API_ISSUER ${GH_ARGS[@]+"${GH_ARGS[@]}"}
echo "Fatto: i cinque secret di firma sono allineati a envsec $CTX."
gh secret list ${GH_ARGS[@]+"${GH_ARGS[@]}"}
