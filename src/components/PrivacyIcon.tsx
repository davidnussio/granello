import type { Privacy } from "../types";
import { t } from "../i18n";

/** Il livello in due parole, per le etichette. */
export const privacyLabel = (privacy: Privacy) =>
  privacy === "hardened" ? t("Privacy: blindata") : privacy === "audio" ? t("Privacy: audio locale") : t("Privacy: standard");

/** Cosa comporta il livello, per chi sta per registrare. */
export const privacyHint = (privacy: Privacy) =>
  privacy === "hardened"
    ? t("Blindata: non esce niente da questo Mac. Note AI, chat e ogni funzione AI usano solo un modello locale, o non sono disponibili.")
    : privacy === "audio"
      ? t("Audio locale: l'audio si trascrive solo su questo Mac. Il testo può andare al provider AI configurato.")
      : t("Standard: valgono le impostazioni generali.");

/**
 * Il livello di privacy come occhio: aperto = standard (ciò che le impostazioni permettono può
 * uscire), socchiuso = audio locale, barrato = blindata (da fuori non si vede niente).
 */
export default function PrivacyIcon({ privacy }: { privacy: Privacy }) {
  const eye = "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z";
  return (
    <svg className={"privacy-icon " + privacy} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {privacy === "audio" ? (
        // occhio socchiuso: la palpebra abbassata, con le ciglia
        <>
          <path d="M3 10.5c2.2 3 5.3 4.5 9 4.5s6.8-1.5 9-4.5" />
          <path d="M12 15v3M7 14l-1.4 2.6M17 14l1.4 2.6M3.6 11.6 2 13.4M20.4 11.6l1.6 1.8" />
        </>
      ) : (
        <>
          <path d={eye} />
          <circle cx="12" cy="12" r="2.8" />
          {privacy === "hardened" && <path d="M4 4l16 16" />}
        </>
      )}
    </svg>
  );
}
