import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { ContactsAccess, ImportedPerson, Person } from "../types";
import { dayLabel } from "../format";
import { t } from "../i18n";
import { thisDevice } from "../platformText";

interface Props {
  /** La rubrica del Mac è attiva (Impostazioni salvate). */
  contacts: boolean;
  onContactsChanged: (on: boolean) => Promise<boolean>;
  /** Apre la Libreria sui meeting di questa persona. */
  onOpenPerson: (name: string) => void;
  toast: (text: string) => void;
}

type Sort = "name" | "meetings" | "recent";

/** "1 meeting", "3 meeting": il plurale giusto in tutte e due le lingue. */
const meetingCount = (n: number) => (n === 1 ? t("1 meeting") : t("{n} meeting", { n }));

/**
 * Impostazioni → Persone: la rubrica di Granello a tutta pagina. Si cerca, si ordina, si
 * corregge un nome (arriva in tutti i meeting), si uniscono due voci che sono la stessa
 * persona, si importano contatti da un file vCard e si collega la rubrica del Mac.
 */
export default function PeopleSettings({ contacts, onContactsChanged, onOpenPerson, toast }: Props) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  /** La riga in modifica, con i valori dei campi. */
  const [editing, setEditing] = useState<{ id: number; name: string; email: string } | null>(null);
  /** La riga che sta scegliendo con chi unirsi, e la scelta. */
  const [merging, setMerging] = useState<{ id: number; into: number | null } | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const [importing, setImporting] = useState<ImportedPerson[] | null>(null);
  const [access, setAccess] = useState<ContactsAccess | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listPeople()
      .then(setPeople)
      .catch((e) => toast(errorText(e)));

  useEffect(() => {
    void load();
    api
      .contactsAccess()
      .then(setAccess)
      .catch(() => setAccess("unsupported"));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- si carica una volta, all'apertura
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = (people ?? []).filter(
      (p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q),
    );
    return found.toSorted((a, b) =>
      sort === "meetings"
        ? b.meetings - a.meetings || a.name.localeCompare(b.name)
        : sort === "recent"
          ? (b.lastMeetingAt ?? 0) - (a.lastMeetingAt ?? 0) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    );
  }, [people, query, sort]);

  const saveEdit = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      setPeople(await api.updatePerson(editing.id, editing.name, editing.email.trim() || null));
      setEditing(null);
      setError(null);
    } catch (e) {
      setError({ id: editing.id, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const merge = async (from: Person, into: Person) => {
    setBusy(true);
    try {
      setPeople(await api.mergePeople(from.id, into.id));
      setMerging(null);
      toast(t("{from} unito a {into}", { from: from.name, into: into.name }));
    } catch (e) {
      setError({ id: from.id, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = (p: Person) =>
    api
      .deletePerson(p.id)
      .then(load)
      .catch((e) => toast(errorText(e)));

  const pickVcard = async () => {
    try {
      const found = await api.pickVcard();
      if (found) setImporting(found);
    } catch (e) {
      toast(errorText(e));
    }
  };

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
      await load();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const missingEmails = (people ?? []).filter((p) => !p.email).length;
  const readable = access === "authorized" || access === "limited";

  return (
    <>
      <section className="card roster-card">
        <p className="muted small">
          {t(
            "Chi ha partecipato ai tuoi meeting: Granello le propone quando aggiungi i partecipanti. Correggi un nome e cambia in tutti i meeting; unisci due voci che sono la stessa persona. Toglierne una non modifica i meeting.",
          )}
        </p>
        <div className="roster-tools">
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Cerca per nome o email")}
            aria-label={t("Cerca per nome o email")}
          />
          <select
            className="chip select"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label={t("Ordina le persone")}
          >
            <option value="name">{t("Per nome")}</option>
            <option value="meetings">{t("Più meeting")}</option>
            <option value="recent">{t("Viste di recente")}</option>
          </select>
          <div className="spacer" />
          <button
            className="btn small ghost"
            onClick={pickVcard}
            title={t("Aggiungi persone da un file .vcf")}
          >
            {t("Importa vCard…")}
          </button>
        </div>

        {people === null ? null : people.length === 0 ? (
          <p className="muted small">
            {t(
              "Ancora nessuna persona: si aggiungono da sole con i partecipanti dei meeting, o importale da un file vCard.",
            )}
          </p>
        ) : (
          <div className="roster-table" role="table" aria-label={t("Persone")}>
            <div className="roster-row head" role="row">
              <span role="columnheader">{t("Nome")}</span>
              <span role="columnheader">{t("Email")}</span>
              <span role="columnheader" className="num">
                {t("Meeting")}
              </span>
              <span role="columnheader">{t("Ultimo meeting")}</span>
              <span role="columnheader" aria-label={t("Azioni")} />
            </div>
            {shown.map((p) =>
              editing?.id === p.id ? (
                <PersonEditor
                  key={p.id}
                  value={editing}
                  error={error?.id === p.id ? error.text : ""}
                  busy={busy}
                  onChange={setEditing}
                  onSave={saveEdit}
                  onCancel={() => {
                    setEditing(null);
                    setError(null);
                  }}
                />
              ) : (
                <div key={p.id} className="roster-group">
                  <div className="roster-row" role="row">
                    <span role="cell" className="roster-name">
                      {p.meetings > 0 ? (
                        <button
                          className="link-button"
                          onClick={() => onOpenPerson(p.name)}
                          title={t("Apri i meeting di {name} nella Libreria", { name: p.name })}
                        >
                          {p.name}
                        </button>
                      ) : (
                        p.name
                      )}
                    </span>
                    <span role="cell" className="muted ellipsis">
                      {p.email ?? ""}
                    </span>
                    <span role="cell" className="muted num">
                      {meetingCount(p.meetings)}
                    </span>
                    <span role="cell" className="muted">
                      {p.lastMeetingAt ? dayLabel(p.lastMeetingAt) : "—"}
                    </span>
                    <span role="cell" className="roster-acts">
                      <button
                        className="lib-act"
                        onClick={() => {
                          setMerging(null);
                          setError(null);
                          setEditing({ id: p.id, name: p.name, email: p.email ?? "" });
                        }}
                        aria-label={t("Modifica {name}", { name: p.name })}
                        title={t("Cambia nome o email: il nome nuovo arriva in tutti i meeting")}
                      >
                        ✎
                      </button>
                      <button
                        className="lib-act"
                        onClick={() => {
                          setEditing(null);
                          setError(null);
                          setMerging(merging?.id === p.id ? null : { id: p.id, into: null });
                        }}
                        aria-label={t("Unisci {name} a un'altra persona", { name: p.name })}
                        title={t("Unisci a un'altra persona: è la stessa, scritta in due modi")}
                        disabled={people.length < 2}
                      >
                        ⇢
                      </button>
                      <button
                        className="lib-act"
                        aria-label={t("Rimuovi {name}", { name: p.name })}
                        title={t("Rimuovi {name}", { name: p.name })}
                        onClick={() => remove(p)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  {merging?.id === p.id && (
                    <MergeRow
                      from={p}
                      people={people}
                      into={merging.into}
                      busy={busy}
                      error={error?.id === p.id ? error.text : ""}
                      onChoose={(into) => setMerging({ id: p.id, into })}
                      onMerge={(into) => merge(p, into)}
                      onCancel={() => {
                        setMerging(null);
                        setError(null);
                      }}
                    />
                  )}
                </div>
              ),
            )}
            {shown.length === 0 && <p className="muted small roster-empty">{t("Nessun risultato")}</p>}
          </div>
        )}
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

      {importing && (
        <VcardImport
          found={importing}
          onClose={() => setImporting(null)}
          onImported={(all, n) => {
            setImporting(null);
            setPeople(all);
            toast(n === 1 ? t("1 persona aggiunta") : t("{n} persone aggiunte", { n }));
          }}
        />
      )}
    </>
  );
}

function PersonEditor({
  value,
  error,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  value: { id: number; name: string; email: string };
  error: string;
  busy: boolean;
  onChange: (v: { id: number; name: string; email: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => nameInput.current?.select(), []);
  return (
    <form
      className="roster-group editing"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="roster-row">
        <input
          ref={nameInput}
          value={value.name}
          maxLength={80}
          aria-label={t("Nome")}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <input
          type="email"
          value={value.email}
          maxLength={120}
          placeholder={t("Email")}
          aria-label={t("Email")}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
        />
        <span className="roster-edit-buttons">
          <button type="button" className="btn small ghost" onClick={onCancel}>
            {t("Annulla")}
          </button>
          <button className="btn small" disabled={busy || !value.name.trim()}>
            {t("Salva")}
          </button>
        </span>
      </div>
      {error && <p className="warn small roster-note">{error}</p>}
    </form>
  );
}

function MergeRow({
  from,
  people,
  into,
  busy,
  error,
  onChoose,
  onMerge,
  onCancel,
}: {
  from: Person;
  people: Person[];
  into: number | null;
  busy: boolean;
  error: string;
  onChoose: (id: number | null) => void;
  onMerge: (into: Person) => void;
  onCancel: () => void;
}) {
  const others = people.filter((p) => p.id !== from.id).toSorted((a, b) => a.name.localeCompare(b.name));
  const target = others.find((p) => p.id === into) ?? null;
  return (
    <div className="roster-merge">
      <span>{t("{name} è la stessa persona di", { name: from.name })}</span>
      <select
        className="chip select"
        value={into ?? ""}
        autoFocus
        aria-label={t("Persona con cui unire {name}", { name: from.name })}
        onChange={(e) => onChoose(e.target.value ? Number(e.target.value) : null)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <option value="">{t("Scegli…")}</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {target && (
        <span className="muted small">
          {from.meetings === 1
            ? t("1 meeting passa a {into}; {from} sparisce dalla rubrica.", {
                into: target.name,
                from: from.name,
              })
            : t("{n} meeting passano a {into}; {from} sparisce dalla rubrica.", {
                n: from.meetings,
                into: target.name,
                from: from.name,
              })}
        </span>
      )}
      <div className="spacer" />
      <button className="btn small ghost" onClick={onCancel}>
        {t("Annulla")}
      </button>
      <button className="btn small" disabled={!target || busy} onClick={() => target && onMerge(target)}>
        {t("Unisci")}
      </button>
      {error && <p className="warn small roster-note">{error}</p>}
    </div>
  );
}

function VcardImport({
  found,
  onClose,
  onImported,
}: {
  found: ImportedPerson[];
  onClose: () => void;
  onImported: (all: Person[], added: number) => void;
}) {
  // chi è già in rubrica parte senza spunta; gli altri tutti spuntati se sono pochi
  const fresh = found.filter((p) => !p.known);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    new Set(fresh.length <= 50 ? fresh.map((p) => p.name) : []),
  );
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const q = filter.trim().toLowerCase();
  const listed = found.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q),
  );

  const toggle = (name: string) => {
    const next = new Set(picked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  };

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const chosen = found.filter((p) => picked.has(p.name));
      const all = await api.addPeople(chosen);
      onImported(all, chosen.filter((p) => !p.known).length);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-bg"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="modal vcard-dialog" role="dialog" aria-modal="true" aria-label={t("Importa da vCard")}>
        <h3>{t("Importa da vCard")}</h3>
        <p className="muted small">
          {t(
            "Scegli chi aggiungere alla rubrica di Granello: le proporrà tra i partecipanti. Chi c'è già riceve l'email, se non ne aveva una.",
          )}
        </p>
        <div className="roster-tools">
          <input
            className="search"
            type="search"
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("Cerca per nome o email")}
            aria-label={t("Cerca per nome o email")}
          />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setPicked(new Set([...picked, ...listed.map((p) => p.name)]))}
          >
            {t("Seleziona tutti")}
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              const next = new Set(picked);
              for (const p of listed) next.delete(p.name);
              setPicked(next);
            }}
          >
            {t("Nessuno")}
          </button>
        </div>
        <div className="vcard-list">
          {listed.map((p) => (
            <label key={p.name} className="vcard-item">
              <input type="checkbox" checked={picked.has(p.name)} onChange={() => toggle(p.name)} />
              <span className="roster-name">{p.name}</span>
              <span className="muted small ellipsis">{p.email ?? ""}</span>
              {p.known && <span className="chip small-chip">{t("già in rubrica")}</span>}
            </label>
          ))}
          {listed.length === 0 && <p className="muted small roster-empty">{t("Nessun risultato")}</p>}
        </div>
        {error && <p className="warn small">{error}</p>}
        <div className="project-buttons">
          <span className="muted small">
            {t("{n} di {total} scelti", { n: picked.size, total: found.length })}
          </span>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("Annulla")}
          </button>
          <button className="btn" disabled={picked.size === 0 || busy} onClick={add}>
            {picked.size === 1 ? t("Aggiungi 1 persona") : t("Aggiungi {n} persone", { n: picked.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
