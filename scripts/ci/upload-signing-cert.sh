#!/usr/bin/env bash
# Carica l'identità Developer ID nei secret di davidnussio/granello: MACOS_CERT_P12 (base64
# del .p12) e MACOS_CERT_PASSWORD (la sua password), insieme, così non possono divergere.
# Poi cancella il file .p12.
#
#   scripts/ci/upload-signing-cert.sh               # esporta dal portachiavi login
#   scripts/ci/upload-signing-cert.sh cert.p12      # usa un .p12 già esportato
#
# Senza argomenti `security export` esporta TUTTE le identità del portachiavi login (la
# firma usa solo quella "Developer ID Application"). Per mettere nel secret solo quella,
# esportala da Accesso Portachiavi (seleziona il certificato → Esporta → .p12) e passa
# il file. In entrambi i casi la password si scrive una volta sola e si controlla che apra
# il .p12 prima di caricare qualcosa. Da rifare quando il certificato viene rinnovato.
set -euo pipefail

REPO=davidnussio/granello

if [[ $# -ge 1 ]]; then
	P12="$1"
	read -r -s -p "Password del .p12 $P12: " P12_PASSWORD
	echo
else
	read -r -s -p "Password per il .p12 (nuova, solo per questa esportazione): " P12_PASSWORD
	echo
	read -r -s -p "Ripeti la password: " P12_PASSWORD_CHECK
	echo
	if [[ "$P12_PASSWORD" != "$P12_PASSWORD_CHECK" ]]; then
		echo "Le password non corrispondono, secret non cambiati." >&2
		exit 1
	fi
	P12="$(mktemp -d)/developer-id.p12"
fi
trap 'rm -f "$P12"' EXIT
if [[ -z "$P12_PASSWORD" ]]; then
	echo "Password vuota, secret non cambiati." >&2
	exit 1
fi
export P12_PASSWORD

if [[ $# -eq 0 ]]; then
	echo "Esporto le identità del portachiavi login (macOS può chiedere la password del portachiavi)..."
	security export -k login.keychain-db -t identities -f pkcs12 -P "$P12_PASSWORD" -o "$P12"
fi

if [[ ! -s "$P12" ]]; then
	echo "Il file $P12 manca o è vuoto, secret non cambiati." >&2
	exit 1
fi
# Lo stesso controllo dell'import in CI: la password deve aprire il file.
if ! /usr/bin/openssl pkcs12 -in "$P12" -noout -passin env:P12_PASSWORD 2>/dev/null; then
	echo "La password non apre il .p12, secret non cambiati." >&2
	exit 1
fi

base64 -i "$P12" | gh secret set MACOS_CERT_P12 --repo "$REPO"
printf '%s' "$P12_PASSWORD" | gh secret set MACOS_CERT_PASSWORD --repo "$REPO"
echo "Fatto: MACOS_CERT_P12 e MACOS_CERT_PASSWORD aggiornati, file .p12 cancellato."
gh secret list --repo "$REPO"
