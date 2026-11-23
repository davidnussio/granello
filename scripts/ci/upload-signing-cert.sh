#!/usr/bin/env bash
# Carica l'identità Developer ID nel secret MACOS_CERT_P12 di davidnussio/granello
# (base64 del .p12), poi cancella il file esportato.
#
#   scripts/ci/upload-signing-cert.sh               # esporta dal portachiavi login
#   scripts/ci/upload-signing-cert.sh cert.p12      # usa un .p12 già esportato
#
# Senza argomenti `security export` esporta TUTTE le identità del portachiavi login (la
# firma usa solo quella "Developer ID Application"). Per mettere nel secret solo quella,
# esportala da Accesso Portachiavi (seleziona il certificato → Esporta → .p12) e passa
# il file: lo script lo cancella dopo il caricamento.
#
# La password del .p12 è quella del secret MACOS_CERT_PASSWORD (se ne scegli una nuova,
# rilancia `gh secret set MACOS_CERT_PASSWORD`). Da rifare quando il certificato viene
# rinnovato.
set -euo pipefail

REPO=davidnussio/granello

if [[ $# -ge 1 ]]; then
	P12="$1"
	trap 'rm -f "$P12"' EXIT
else
	P12="$(mktemp -d)/developer-id.p12"
	trap 'rm -f "$P12"' EXIT
	echo "Esporto le identità del portachiavi login (macOS chiede la password del .p12, poi quella del portachiavi)..."
	security export -k login.keychain-db -t identities -f pkcs12 -o "$P12"
fi

if [[ ! -s "$P12" ]]; then
	echo "Esportazione fallita: $P12 manca o è vuoto, secret non cambiato." >&2
	exit 1
fi

base64 -i "$P12" | gh secret set MACOS_CERT_P12 --repo "$REPO"
echo "Fatto: MACOS_CERT_P12 aggiornato, file .p12 cancellato."
gh secret list --repo "$REPO"
