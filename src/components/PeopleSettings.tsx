import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { ContactsAccess } from "../types";
import { t } from "../i18n";
import { thisDevice } from "../platformText";

interface Props {
  /** La rubrica del Mac è attiva (Impostazioni salvate). */
  contacts: boolean;
  onContactsChanged: (on: boolean) => Promise<boolean>;
  /** Apre la pagina Persone. */
  onOpenPeople: () => void;
  toast: (text: string) => void;
}

/**
 * Impostazioni → Persone: la rubrica del Mac. Le persone e i gruppi stanno nella pagina
 * Persone, nella barra laterale.
 */
export default function PeopleSettings({ contacts, onContactsChanged, onOpenPeople, toast }: Props) {
  const [access, setAccess] = useState<ContactsAccess | null>(null);
  const [missingEmails, setMissingEmails] = useState(0);
  const [busy, setBusy] = useState(false);

  const countMissing = () =>
    api
      .listPeople()
      .then((people) => setMissingEmails(people.filter((p) => !p.email).length))
      .catch(() => {});

  useEffect(() => {
    void countMissing();
    api
      .contactsAccess()
      .then(setAccess)
      .catch(() => setAccess("unsupported"));
  }, []);
  /** Accende o spegne la rubrica del Mac; la prima volta macOS chiede il permesso. */
  const toggleContacts = async (on: boolean) => {
    if (!on) {
      await onContactsChanged(false);
      return;
    }
    let now = access;
    if (now === "notDetermined") {
      now = await api.requestContactsAccess().catch(() => "denied" as const);
      setAccess(now);
    }
    if (now === "authorized" || now === "limited") await onContactsChanged(true);
    else
      toast(
        t(
          "macOS non permette a Granello di leggere la rubrica: consentilo in Impostazioni di Sistema → Privacy e sicurezza → Contatti.",
        ),
      );
  };

  const fillEmails = async () => {
    setBusy(true);
    try {
      const n = await api.fillEmailsFromContacts();
      toast(
        n === 0
          ? t("Nessuna email da aggiungere: la rubrica non ne ha per queste persone.")
          : n === 1
            ? t("Aggiunta 1 email dalla rubrica")
            : t("Aggiunte {n} email dalla rubrica", { n }),
      );
      await countMissing();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const readable = access === "authorized" || access === "limited";

  return (
    <>
      <section className="card">
        <p className="muted small">
          {t(
            "Le persone delle tue note e i loro gruppi (team, reparti, clienti, tutta l'azienda) stanno nella pagina Persone.",
          )}
        </p>
        <button className="btn small" onClick={onOpenPeople}>
          {t("Apri la pagina Persone")}
        </button>
      </section>

      {access !== "unsupported" && access !== null && (
        <section className="card">
          <h3>{t("Rubrica di {device}", { device: thisDevice() })}</h3>
          <p className="muted small">
            {t(
              "Mentre scrivi un partecipante, Granello propone anche i nomi della rubrica e ne prende l'email. Legge solo chi cerchi: la rubrica non viene copiata e resta su {device}.",
              { device: thisDevice() },
            )}
          </p>
          <label className="row gap check">
            <input
              type="checkbox"
              checked={contacts && readable}
              onChange={(e) => void toggleContacts(e.target.checked)}
            />
            <span>{t("Proponi i contatti della rubrica")}</span>
          </label>
          {(access === "denied" || access === "restricted") && (
            <p className="warn small">
              {t(
                "macOS non permette a Granello di leggere la rubrica: consentilo in Impostazioni di Sistema → Privacy e sicurezza → Contatti.",
              )}
            </p>
          )}
          {contacts && readable && missingEmails > 0 && (
            <button className="btn small roster-fill" onClick={fillEmails} disabled={busy}>
              {missingEmails === 1
                ? t("Completa 1 email mancante")
                : t("Completa {n} email mancanti", { n: missingEmails })}
            </button>
          )}
        </section>
      )}
    </>
  );
}
