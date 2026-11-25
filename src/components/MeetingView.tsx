import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, errorText, newStreamId, on, SYSTEM_AUDIO } from "../api";
import type {
  CalendarEvent,
  Meeting,
  Privacy,
  RecordingStatus,
  Template,
  TranscriptPart,
  TranscriptSegment,
  Project,
} from "../types";
import ChipInput, { type ChipSuggestion } from "./ChipInput";
import NoteEditor from "../editor/NoteEditor";
import Markdown from "./Markdown";
import TranscriptPanel from "./TranscriptPanel";
import Recordings from "./Recordings";
import PrivacyIcon, { privacyHint, privacyLabel } from "./PrivacyIcon";
import PinIcon from "./PinIcon";
import ChatPanel from "./ChatPanel";
import ProjectDialog, { projectColor } from "./ProjectDialog";
import { projectOptions } from "../tree";
import { dayLabel, longWhen, mmss, sameDay, shortWhen, time } from "../format";
import { t } from "../i18n";
import { thisDevice } from "../platformText";
import { Sparkles, sparkle } from "../sparkles";
import type { Editor } from "@tiptap/react";
import { setAiMeeting, setTranscriptState } from "../editor/aiContext";
import { insertQuote, quoteMd } from "../editor/plugins/transcriptQuote";
import { QUOTE_FROM_SLASH } from "../editor/meeting";
import {
  MOMENT_EVENTS,
  emptyMoments,
  fillMomentsIn,
  fillMomentsMd,
  insertMoment,
  momentMd,
} from "../editor/plugins/moment";

interface Props {
  id: string;
  rec: RecordingStatus;
  toast: (text: string, action?: { label: string; run: () => void }) => void;
  onChanged: () => void;
  onRecChanged: () => void;
  onDeleted: () => void;
  projects: Project[];
  onProjectsChanged: (projects: Project[]) => void;
  /** La privacy minima del vault aperto: i livelli più bassi non si possono scegliere. */
  minPrivacy: Privacy;
}

/** Voce del selettore del progetto che apre la finestra per crearne uno. */
const NEW_PROJECT = "+new";

type Tab = "notes" | "enhanced";
type Side = "none" | "transcript" | "chat";

/**
 * Il pannello di destra si apre sempre sulla trascrizione: lo spazio per le note basta anche
 * sullo schermo del portatile. Se lo si chiude resta chiuso per quel meeting, anche quando la
 * pagina si ricarica (per esempio dopo una sincronizzazione).
 */
let lastSide: { id: string; side: Side } | null = null;

/** Il testo di una parte oscurata, come in `src-tauri/src/models.rs`. */
const REDACTED = "█████";

function useDebounced<T>(fn: (v: T) => void, ms: number) {
  const timer = useRef<number>();
  const last = useRef<{ v: T } | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (last.current) {
      fnRef.current(last.current.v);
      last.current = null;
    }
  }, []);
  const call = useCallback(
    (v: T) => {
      last.current = { v };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, ms);
    },
    [flush, ms],
  );
  useEffect(() => flush, [flush]); // salva all'uscita
  // salva subito anche quando la finestra perde il fuoco o sta per chiudersi,
  // senza aspettare il debounce: chiudendo l'app non si perde l'ultima frase
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);
  return call;
}

const suggestPeople = async (query: string): Promise<ChipSuggestion[]> =>
  (await api.suggestPeople(query)).map((p) => ({
    value: p.name,
    hint: p.email ?? undefined,
    badge:
      p.source === "calendar"
        ? t("dal calendario")
        : p.source === "contacts"
          ? t("dalla rubrica")
          : undefined,
  }));

const suggestTags = async (query: string): Promise<ChipSuggestion[]> => {
  const q = query.replace(/^#/, "").toLowerCase();
  return (await api.listTags())
    .filter((tag) => tag.name.includes(q))
    .slice(0, 8)
    .map((tag) => ({ value: tag.name, hint: t("{n} note", { n: tag.count }) }));
};

const ICONS = {
  copy: "M9 9h10v11H9zM5 15V4h10",
  print: "M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z",
  trash: "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v5M14 11v5",
  // la classica icona della barra laterale, qui a destra
  sidebar: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM15 4v16",
} as const;

/** Icona di un'azione dell'intestazione, nello stesso tratto dell'occhio della privacy. */
function ActionIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      className="action-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export default function MeetingView({
  id,
  rec,
  toast,
  onChanged,
  onRecChanged,
  onDeleted,
  projects,
  onProjectsChanged,
  minPrivacy,
}: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  /**
   * L'ultima modifica com'era quando la nota è stata aperta: dice quando ci si era lavorato
   * l'ultima volta, e non diventa «ora» mentre si scrive.
   */
  const lastChange = useMemo(
    () => meeting?.updatedAt ?? null,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- conta solo l'apertura di un'altra nota
    [meeting?.id],
  );
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tab, setTab] = useState<Tab>("notes");
  const [side, setSideState] = useState<Side>(() => (lastSide?.id === id ? lastSide.side : "transcript"));
  const setSide = useCallback(
    (next: Side | ((s: Side) => Side)) =>
      setSideState((s) => {
        const value = typeof next === "function" ? next(s) : next;
        lastSide = { id, side: value };
        return value;
      }),
    [id],
  );
  const [streaming, setStreaming] = useState<string | null>(null);
  const [level, setLevel] = useState<{ mic: number; system: number | null }>({ mic: 0, system: null });
  const [elapsed, setElapsed] = useState(0);
  const [busyRec, setBusyRec] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  /** Stampa o copia in attesa di conferma: il meeting è riservato e il testo sta per uscire dall'app. */
  const [confirmOut, setConfirmOut] = useState<"print" | "copy" | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [calEvent, setCalEvent] = useState<CalendarEvent | null>(null);
  const enhanceRef = useRef<() => void>(() => {});
  const hasEnhancedRef = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [enhVersion, setEnhVersion] = useState(0);
  const streamRef = useRef<string | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [systemDevice, setSystemDevice] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ doneMs: number; totalMs: number | null } | null>(
    null,
  );
  const [transcriptFocus, setTranscriptFocus] = useState<{ ms: number } | null>(null);
  // l'editor delle note, quando è a schermo: i momenti segnati vanno lì
  const notesEditor = useRef<Editor | null>(null);
  const notesRef = useRef("");
  const enhancedEditor = useRef<Editor | null>(null);
  const [userName, setUserName] = useState("");
  const fillRef = useRef<(auto: boolean) => void>(() => {});
  const markRef = useRef<(from?: Editor) => void>(() => {});
  const quoteRef = useRef<(from: Editor) => void>(() => {});
  const fillingRef = useRef(false);
  const [keptAudio, setKeptAudio] = useState(false);
  const [refining, setRefining] = useState(false);
  const [recVersion, setRecVersion] = useState(0);
  // chi sta parlando al microfono: "me" finché non si indica un altro; riparte a ogni registrazione
  const [micSpeaker, setMicSpeaker] = useState("me");
  useEffect(() => {
    if (rec.meetingId !== id) setMicSpeaker("me");
  }, [rec.meetingId, id]);
  const refineRef = useRef<() => void>(() => {});
  const titleInput = useRef<HTMLInputElement>(null);
  const [titling, setTitling] = useState(false);
  const tabRef = useRef<Tab>("notes");
  const setNotesRef = useRef<(md: string) => void>(() => {});

  // la sessione su questo meeting è una registrazione dal vivo oppure un file in trascrizione
  const inSession = rec.meetingId === id;
  const isRecording = inSession && !rec.importing;
  const isImporting = inSession && rec.importing;
  const otherRecording = rec.recording && !inSession;

  const load = useCallback(async () => {
    try {
      const d = await api.getMeeting(id);
      setMeeting(d.meeting);
      setSegments(d.segments);
      if (d.meeting.enhancedMd) setTab("enhanced");
    } catch (e) {
      toast(errorText(e));
    }
  }, [id, toast]);

  useEffect(() => {
    load();
    api
      .listTemplates()
      .then(setTemplates)
      .catch(() => {});
    api
      .keptAudio(id)
      .then(setKeptAudio)
      .catch(() => {});
    // evento di calendario alla stessa ora: da lì si possono importare i partecipanti
    api
      .calendarMatch(id)
      .then(setCalEvent)
      .catch(() => {});
  }, [load, id]);

  // l'AI dei blocchi dell'editor lavora su questo meeting e segue la sua trascrizione
  useEffect(() => {
    setAiMeeting(id);
    return () => setAiMeeting(null);
  }, [id]);
  useEffect(() => {
    setTranscriptState({ count: segments.length, live: rec.meetingId === id && !rec.importing });
  }, [segments.length, rec.meetingId, rec.importing, id]);

  const loadDevices = useCallback(() => {
    api
      .listAudioDevices()
      .then(setDevices)
      .catch(() => {});
    api
      .getSettings()
      .then((s) => {
        setSystemDevice(s.systemDevice);
        setUserName(s.userName ?? "");
      })
      .catch(() => {});
  }, []);
  useEffect(loadDevices, [loadDevices, id]);

  const changeSystemDevice = async (device: string | null) => {
    const previous = systemDevice;
    setSystemDevice(device);
    try {
      await api.setSystemDevice(device);
    } catch (e) {
      setSystemDevice(previous);
      toast(errorText(e));
    }
  };

  useEffect(() => {
    const offs = [
      on("transcript-segment", (s) => {
        if (s.meetingId === id) setSegments((prev) => [...prev, s].toSorted((a, b) => a.startMs - b.startMs));
      }),
      on("audio-level", (l) => {
        if (l.meetingId === id) setLevel({ mic: l.mic, system: l.system });
      }),
      on("import-progress", (p) => {
        if (p.meetingId === id) setImportProgress({ doneMs: p.doneMs, totalMs: p.totalMs });
      }),
      on("recording-finished", (mid) => {
        if (mid !== id) return;
        setFinishing(false);
        setImportProgress(null);
        // il passo successivo naturale dopo la registrazione
        if (!hasEnhancedRef.current) {
          toast(t("Trascrizione completata"), {
            label: t("✦ Genera note AI"),
            run: () => enhanceRef.current(),
          });
        }
        // la registrazione salvata, se c'è, è appena stata chiusa
        setRecVersion((v) => v + 1);
        // ora c'è tutta la trascrizione: l'AI scrive cosa si diceva nei momenti segnati
        fillRef.current(true);
        // se l'audio è stato conservato, l'affinamento online si propone: lo avvia l'utente
        api
          .keptAudio(id)
          .then((kept) => {
            setKeptAudio(kept);
            if (kept) {
              toast(t("Audio conservato: puoi affinare la trascrizione online con Gladia"), {
                label: t("Affina online"),
                run: () => refineRef.current(),
              });
            }
          })
          .catch(() => {});
      }),
      on("llm-delta", (d) => {
        if (d.streamId === streamRef.current) setStreaming((s) => (s ?? "") + d.delta);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [id, toast]);

  // cronometro
  useEffect(() => {
    if (!isRecording) return;
    const startedAt = Date.now();
    const base = segments.length ? segments[segments.length - 1].endMs : 0;
    const iv = setInterval(() => setElapsed(base + Date.now() - startedAt), 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // dopo il salvataggio la barra laterale ricarica l'elenco: la nota sale tra le ultime modificate
  const saveNotes = useDebounced<string>((notesMd) => {
    api
      .updateMeeting({ id, notesMd })
      .then(onChanged)
      .catch((e) => toast(errorText(e)));
  }, 600);
  const saveEnhanced = useDebounced<string>((enhancedMd) => {
    api
      .updateMeeting({ id, enhancedMd })
      .then(onChanged)
      .catch((e) => toast(errorText(e)));
  }, 600);
  const saveTitle = useDebounced<string>((title) => {
    api
      .updateMeeting({ id, title })
      .then(onChanged)
      .catch((e) => toast(errorText(e)));
  }, 500);

  const setNotes = (md: string) => {
    setMeeting((m) => (m ? { ...m, notesMd: md } : m));
    saveNotes(md);
  };

  // Una frase selezionata nella trascrizione diventa una citazione nella nota che si sta guardando.
  const addQuote = useCallback(
    (picked: { ms: number; source: TranscriptSegment["source"]; text: string }) => {
      // dopo l'affinamento online la sorgente è già il nome del parlante
      const who =
        picked.source === "me"
          ? userName.trim() || t("Io")
          : picked.source === "file"
            ? ""
            : picked.source === "them"
              ? t("Altri")
              : picked.source;
      const quote = { ms: picked.ms, who, text: picked.text };
      const editor = tabRef.current === "enhanced" ? enhancedEditor.current : notesEditor.current;
      if (editor && !editor.isDestroyed) insertQuote(editor, quote);
      else setNotesRef.current(`${notesRef.current.trimEnd()}\n\n${quoteMd(quote)}\n`.trimStart());
      toast(
        tabRef.current === "enhanced" && editor
          ? t("Citazione aggiunta alle note AI")
          : t("Citazione aggiunta alle tue note"),
      );
    },
    [userName, toast],
  );

  // Segna il momento attuale della registrazione. `from` è l'editor da cui parte il comando "/".
  const markMoment = async (from?: Editor) => {
    const position = isRecording ? await api.recordingPosition(id).catch(() => null) : null;
    // comando "/" a registrazione ferma: marcatore a 0:00, con il minuto da scrivere a mano
    if (position === null && !from) return;
    const ms = position ?? 0;
    const editor = from ?? notesEditor.current;
    if (editor && !editor.isDestroyed) insertMoment(editor, ms);
    else setNotes(`${notesRef.current.trimEnd()}\n\n${momentMd(ms)}\n`.trimStart());
    if (position !== null) toast(t("Momento segnato a {time}", { time: mmss(ms) }));
  };
  markRef.current = markMoment;

  // Citazione dal comando "/": vuota, ma al minuto della registrazione e non a 0:00.
  quoteRef.current = async (from: Editor) => {
    const position = isRecording ? await api.recordingPosition(id).catch(() => null) : null;
    if (from.isDestroyed) return;
    from
      .chain()
      .focus()
      .insertContent({ type: "transcriptQuote", attrs: { data: { ms: position ?? 0, who: "", text: "" } } })
      .run();
  };

  // L'ultima frase trascritta, intera, diventa una citazione: per chi non ha tempo di selezionarla.
  // non una parte oscurata né una da verificare: potrebbe essere oscurata dopo, e nelle note resterebbe
  const lastSegment = segments.findLast((s) => !s.review && s.text.trim() && s.text.trim() !== REDACTED);
  const quoteLast = () => {
    if (lastSegment)
      addQuote({ ms: lastSegment.startMs, source: lastSegment.source, text: lastSegment.text.trim() });
  };

  // Fa scrivere all'AI cosa si diceva nei momenti ancora vuoti. `auto`: a fine registrazione,
  // senza disturbare se non c'è niente da fare o l'AI non è configurata.
  const fillMoments = async (auto: boolean) => {
    const moments = emptyMoments(notesRef.current);
    if (!moments.length || fillingRef.current) return;
    if (auto && !(await api.aiReady().catch(() => false))) return;
    fillingRef.current = true;
    if (!auto) toast(t("Chiedo all'AI cosa si stava dicendo…"));
    try {
      const fills = await api.fillMoments(id, moments);
      if (!fills.length) {
        if (!auto) toast(t("La trascrizione non dice niente attorno a quei momenti"));
        return;
      }
      const editor = notesEditor.current;
      if (editor && !editor.isDestroyed) fillMomentsIn(editor, fills);
      else setNotes(fillMomentsMd(notesRef.current, fills));
      toast(
        fills.length === 1
          ? t("Un momento segnato è stato riempito")
          : t("{n} momenti segnati sono stati riempiti", { n: fills.length }),
      );
    } catch (e) {
      toast(errorText(e));
    } finally {
      fillingRef.current = false;
    }
  };
  fillRef.current = fillMoments;

  useEffect(() => {
    const onMark = (e: Event) => markRef.current((e as CustomEvent<Editor | undefined>).detail ?? undefined);
    const onQuote = (e: Event) => {
      e.preventDefault();
      quoteRef.current((e as CustomEvent<Editor>).detail);
    };
    const onFill = () => fillRef.current(false);
    const onShow = (e: Event) => {
      setSide("transcript");
      setTranscriptFocus({ ms: (e as CustomEvent<number>).detail });
    };
    // ⇧⌘M (Ctrl+Shift+M): segna il momento ovunque sia il cursore
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        markRef.current();
      }
    };
    window.addEventListener(MOMENT_EVENTS.mark, onMark);
    window.addEventListener(QUOTE_FROM_SLASH, onQuote);
    window.addEventListener(MOMENT_EVENTS.fill, onFill);
    window.addEventListener(MOMENT_EVENTS.show, onShow);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(MOMENT_EVENTS.mark, onMark);
      window.removeEventListener(QUOTE_FROM_SLASH, onQuote);
      window.removeEventListener(MOMENT_EVENTS.fill, onFill);
      window.removeEventListener(MOMENT_EVENTS.show, onShow);
      window.removeEventListener("keydown", onKey);
    };
  }, [setSide]);

  const toggleRecording = async () => {
    setBusyRec(true);
    try {
      if (inSession) {
        setFinishing(true);
        await api.stopRecording();
      } else {
        await api.startRecording(id);
        setSide((s) => (s === "none" ? "transcript" : s));
      }
    } catch (e) {
      setFinishing(false);
      toast(errorText(e));
    } finally {
      setBusyRec(false);
      onRecChanged();
    }
  };

  const importAudio = async () => {
    setBusyRec(true);
    try {
      // la scelta del file avviene nella finestra di sistema; false = annullata
      if (await api.importAudio(id)) {
        setImportProgress(null);
        setSide((s) => (s === "none" ? "transcript" : s));
      }
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusyRec(false);
      onRecChanged();
    }
  };

  const enhance = async () => {
    if (!meeting) return;
    const sid = newStreamId();
    streamRef.current = sid;
    setStreaming("");
    setTab("enhanced");
    try {
      const text = await api.enhanceNotes(id, sid);
      setMeeting((m) => (m ? { ...m, enhancedMd: text } : m));
      setEnhVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorText(e));
      // generazione fallita o annullata: senza note AI precedenti si torna alle proprie note
      if (!meeting.enhancedMd) setTab("notes");
    } finally {
      streamRef.current = null;
      setStreaming(null);
    }
  };

  enhanceRef.current = enhance;
  hasEnhancedRef.current = !!meeting?.enhancedMd;
  notesRef.current = meeting?.notesMd ?? "";
  tabRef.current = tab;
  setNotesRef.current = setNotes;

  // rigenerare sostituisce le note AI (e le modifiche fatte a mano): serve una conferma
  const requestEnhance = () => {
    if (meeting?.enhancedMd && !confirmRegen) {
      setConfirmRegen(true);
      setTimeout(() => setConfirmRegen(false), 4000);
      return;
    }
    setConfirmRegen(false);
    enhance();
  };

  // Fa proporre all'AI un titolo da note e trascrizione, e lo mette al posto di quello attuale.
  const generateTitle = async () => {
    if (titling) return;
    setTitling(true);
    try {
      // le ultime note scritte devono essere già salvate: il titolo si basa su quelle
      await api.updateMeeting({ id, notesMd: notesRef.current });
      const title = (await api.aiAssist({ meetingId: id, kind: "title", instruction: "" })).trim();
      if (!title) return;
      if (titleInput.current) titleInput.current.value = title;
      saveTitle(title);
      setMeeting((m) => (m ? { ...m, title } : m));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setTitling(false);
    }
  };

  const saveMeta = async (patch: { attendees?: string[]; tags?: string[] }) => {
    // aggiornamento immediato; il backend restituisce poi i valori ripuliti
    setMeeting((m) => (m ? { ...m, ...patch } : m));
    try {
      const saved = await api.updateMeetingMeta({ id, ...patch });
      setMeeting((m) => (m ? { ...m, attendees: saved.attendees, tags: saved.tags } : m));
      onChanged();
    } catch (e) {
      toast(errorText(e));
      load();
    }
  };

  const changePrivacy = async (privacy: Privacy) => {
    const previous = meeting?.privacy ?? "open";
    setMeeting((m) => (m ? { ...m, privacy } : m));
    try {
      await api.setMeetingPrivacy(id, privacy);
      if (privacy !== "open") setKeptAudio(false);
    } catch (e) {
      setMeeting((m) => (m ? { ...m, privacy: previous } : m));
      toast(errorText(e));
    }
  };

  // Oscurare cancella il testo per sempre; "da verificare" lo lascia leggibile ma tiene il
  // meeting lontano dai modelli online finché ogni parte segnata non è stata decisa.
  const redact = (parts: TranscriptPart[]) =>
    api
      .redactTranscript(id, parts)
      .then((next) => {
        setSegments(next);
        // oscurando, l'audio conservato e le registrazioni salvate vengono cancellati:
        // contengono ancora quelle parole
        setKeptAudio(false);
        setRecVersion((v) => v + 1);
      })
      .catch((e) => toast(errorText(e)));
  const review = (ids: number[], flag: boolean) =>
    api
      .reviewTranscript(id, ids, flag)
      .then(setSegments)
      .catch((e) => toast(errorText(e)));

  // Affinamento online: l'audio conservato viene caricato su Gladia e la trascrizione locale
  // lascia il posto a quella con i parlanti. Poi l'audio viene cancellato.
  const refine = async () => {
    if (refining) return;
    setRefining(true);
    try {
      setSegments(await api.refineTranscript(id));
      setKeptAudio(false);
      toast(t("Trascrizione affinata: ora distingue i parlanti. Clic su un nome per cambiarlo."));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setRefining(false);
    }
  };
  refineRef.current = refine;
  const discardAudio = () =>
    api
      .discardAudio(id)
      .then(() => setKeptAudio(false))
      .catch((e) => toast(errorText(e)));
  const assignSpeaker = (ids: number[], name: string) =>
    api
      .assignSpeaker(id, ids, name)
      .then(setSegments)
      .catch((e) => toast(errorText(e)));
  // Più persone allo stesso microfono: da adesso ciò che sente va a chi è indicato qui.
  const changeSpeaker = async (name: string) => {
    const previous = micSpeaker;
    setMicSpeaker(name);
    try {
      await api.setSpeaker(id, name);
    } catch (e) {
      setMicSpeaker(previous);
      toast(errorText(e));
    }
  };
  const renameSpeaker = (from: string, to: string) =>
    api
      .renameSpeaker(id, from, to)
      .then(setSegments)
      .catch((e) => toast(errorText(e)));

  /** Mette il meeting in un progetto, o lo toglie dal suo (null). */
  const changeProject = async (projectId: string | null) => {
    const previous = meeting?.projectId ?? null;
    setMeeting((m) => (m ? { ...m, projectId } : m));
    try {
      await api.setMeetingsProject([id], projectId);
      onChanged();
    } catch (e) {
      setMeeting((m) => (m ? { ...m, projectId: previous } : m));
      toast(errorText(e));
    }
  };

  /** Fissa il meeting in cima alla barra laterale, o lo toglie dai fissati. */
  const togglePinned = async () => {
    const previous = meeting?.pinnedAt ?? null;
    const pinned = previous === null;
    setMeeting((m) => (m ? { ...m, pinnedAt: pinned ? Date.now() : null } : m));
    try {
      await api.setMeetingsPinned([id], pinned);
      onChanged();
    } catch (e) {
      setMeeting((m) => (m ? { ...m, pinnedAt: previous } : m));
      toast(errorText(e));
    }
  };

  const changeTemplate = async (templateId: string) => {
    setMeeting((m) => (m ? { ...m, templateId } : m));
    // su una nota ancora vuota il template porta le sue note di partenza; se c'è già
    // qualcosa di scritto non si tocca
    const start = templates.find((tpl) => tpl.id === templateId)?.notesMd ?? "";
    if (start.trim() && !meeting?.notesMd.trim()) {
      setNotes(start);
      notesEditor.current?.commands.setContent(start, false);
    }
    await api.updateMeeting({ id, templateId }).catch((e) => toast(errorText(e)));
  };

  /**
   * Stampa e copia portano il testo fuori da Granello. Per un meeting blindato, o con parti
   * della trascrizione ancora da verificare, il primo clic avvisa e il secondo procede.
   */
  const leaving = (action: "print" | "copy"): boolean => {
    const reserved = meeting?.privacy === "hardened" || segments.some((s) => s.review);
    if (!reserved || confirmOut === action) {
      setConfirmOut(null);
      return true;
    }
    setConfirmOut(action);
    setTimeout(() => setConfirmOut((c) => (c === action ? null : c)), 5000);
    toast(
      meeting?.privacy === "hardened"
        ? t("Nota blindata: così il testo esce da Granello. Premi di nuovo per procedere.")
        : t("Ci sono parti da verificare: così il testo esce da Granello. Premi di nuovo per procedere."),
    );
    return false;
  };

  /** La nota che si sta guardando, in Markdown con il titolo in testa. */
  const copyNote = async () => {
    if (!meeting || !leaving("copy")) return;
    const text = tab === "enhanced" ? (meeting.enhancedMd ?? "") : meeting.notesMd;
    try {
      await navigator.clipboard.writeText(`# ${meeting.title}\n\n${text}`);
      toast(t("Note copiate negli appunti"));
    } catch (e) {
      toast(errorText(e));
    }
  };

  /** Apre la stampa di sistema sulla nota che si sta guardando: da lì si salva anche in PDF. */
  const printNote = () => {
    if (!leaving("print")) return;
    api.printWindow().catch((e) => toast(errorText(e)));
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    try {
      await api.deleteMeeting(id);
      onDeleted();
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (!meeting) return <div className="page muted">{t("Caricamento…")}</div>;

  const hasContent = meeting.notesMd.trim().length > 0 || segments.length > 0;
  const canEnhance = hasContent && !inSession && streaming === null;
  const when = meeting.startedAt ?? meeting.createdAt;
  // l'ultima modifica si dice solo se la nota è stata ripresa più di un'ora dopo la fine del
  // meeting: prima ripeterebbe la data
  const edited = lastChange !== null && lastChange > (meeting.endedAt ?? when) + 3600_000 ? lastChange : null;
  const missingFromEvent = (calEvent?.attendees ?? []).filter(
    (name) => !meeting.attendees.some((a) => a.toLowerCase() === name.toLowerCase()),
  );

  const markButton = (
    <button
      className="btn small mark-btn"
      onClick={() => markMoment()}
      title={t(
        "Segna questo momento nelle note: a fine registrazione l'AI scrive cosa si stava dicendo (⇧⌘M)",
      )}
    >
      {t("⚑ Segna")}
    </button>
  );

  // la chat si apre da sotto; richiudendola si torna alla trascrizione
  const chatButton = (
    <button
      className={"btn small ghost" + (side === "chat" ? " on" : "")}
      onClick={() => setSide(side === "chat" ? "transcript" : "chat")}
    >
      {sparkle(t("✦ Chiedi"))}
    </button>
  );

  // apre e chiude il pannello di destra: sta sempre nell'angolo in alto a destra
  const sidebarToggle = (
    <button
      className={"chip icon-action sidebar-toggle" + (side !== "none" ? " on" : "")}
      onClick={() => setSide(side === "none" ? "transcript" : "none")}
      aria-label={side === "none" ? t("Mostra la trascrizione") : t("Chiudi pannello")}
      aria-expanded={side !== "none"}
      title={side === "none" ? t("Mostra la trascrizione") : t("Chiudi pannello")}
    >
      <ActionIcon name="sidebar" />
    </button>
  );

  return (
    <div className={"meeting" + (side !== "none" ? " with-side" : "")}>
      <div className="meeting-main">
        <header className="meeting-header">
          <div className="title-row">
            {/* il campo è largo quanto il titolo, così il pulsante gli sta accanto */}
            <span className="title-fit" data-value={meeting.title || t("Titolo della nota")}>
              <input
                ref={titleInput}
                className="title-input"
                // senza, il campo ha una larghezza minima sua e il pulsante resta lontano dai titoli corti
                size={1}
                aria-label={t("Titolo della nota")}
                defaultValue={meeting.title}
                placeholder={t("Titolo della nota")}
                onChange={(e) => {
                  const title = e.target.value;
                  setMeeting((m) => (m ? { ...m, title } : m));
                  saveTitle(title);
                }}
              />
            </span>
            <button
              className={"title-ai" + (titling ? " busy" : "")}
              onClick={generateTitle}
              disabled={titling || !hasContent}
              aria-label={t("Genera il titolo con l'AI")}
              title={
                hasContent
                  ? t("Genera il titolo con l'AI, da note e trascrizione")
                  : t("Scrivi qualche nota o registra: poi l'AI può proporre un titolo")
              }
            >
              <Sparkles />
            </button>
            {/* il progetto sta in alto a destra, sopra le azioni sul meeting */}
            <select
              className={"chip select project-select" + (meeting.projectId ? " set" : "")}
              value={meeting.projectId ?? ""}
              // il selettore prende il colore del progetto scelto
              style={
                {
                  "--project": projectColor(projects.find((p) => p.id === meeting.projectId)),
                } as CSSProperties
              }
              aria-label={t("Progetto di questa nota")}
              title={
                projects.find((p) => p.id === meeting.projectId)?.description ||
                t("Il progetto in cui sta questa nota")
              }
              onChange={(e) => {
                if (e.target.value === NEW_PROJECT) setCreatingProject(true);
                else void changeProject(e.target.value || null);
              }}
            >
              <option value="">{t("Nessun progetto")}</option>
              {projectOptions(projects, meeting.projectId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value={NEW_PROJECT}>{t("+ Nuovo progetto")}…</option>
            </select>
          </div>
          <div className="meta-row">
            <span
              className="chip"
              title={
                edited
                  ? t("Creata {created} · ultima modifica {changed}", {
                      created: longWhen(when),
                      changed: longWhen(edited),
                    })
                  : undefined
              }
            >
              {dayLabel(when)} · {time(when)}
              {edited !== null && (
                <span className="chip-edited">
                  {" · "}
                  {sameDay(edited, Date.now())
                    ? t("ultima modifica alle {time}", { time: time(edited) })
                    : t("ultima modifica {when}", { when: shortWhen(edited) })}
                </span>
              )}
            </span>
            <select
              className="chip select"
              value={meeting.templateId ?? "generale"}
              onChange={(e) => changeTemplate(e.target.value)}
              title={t("Template usato per le note AI")}
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  ☰ {tpl.name}
                </option>
              ))}
            </select>
            <select
              className={"chip select privacy-select " + meeting.privacy}
              value={meeting.privacy}
              onChange={(e) => changePrivacy(e.target.value as Privacy)}
              aria-label={t("Privacy di questa nota")}
              title={
                meeting.privacy === "hardened"
                  ? t(
                      "Blindata: non esce niente da {device}. Note AI, chat e ogni funzione AI usano solo un modello locale, o non sono disponibili.",
                      { device: thisDevice() },
                    )
                  : meeting.privacy === "audio"
                    ? t(
                        "Audio locale: l'audio si trascrive solo su {device}. Il testo può andare al provider AI configurato.",
                        { device: thisDevice() },
                      )
                    : t("Standard: valgono le impostazioni generali.")
              }
            >
              <option value="open" disabled={minPrivacy !== "open"}>
                {t("Privacy: standard")}
              </option>
              <option value="audio" disabled={minPrivacy === "hardened"}>
                {t("Privacy: audio locale")}
              </option>
              <option value="hardened">{t("Privacy: blindata")}</option>
            </select>
            {/* lontano dalle azioni di tutti i giorni (registra, trascrizione, chiedi) */}
            <span className="meeting-actions">
              <button
                className={"chip icon-action pin-action" + (meeting.pinnedAt !== null ? " on" : "")}
                onClick={togglePinned}
                aria-pressed={meeting.pinnedAt !== null}
                aria-label={
                  meeting.pinnedAt !== null ? t("Togli dai fissati") : t("Fissa nella barra laterale")
                }
                title={
                  meeting.pinnedAt !== null
                    ? t("Togli dai fissati")
                    : t("Fissa nella barra laterale: resta sotto la Libreria")
                }
              >
                <PinIcon filled={meeting.pinnedAt !== null} />
              </button>
              <button
                className={"chip icon-action" + (confirmOut === "copy" ? " confirm" : "")}
                onClick={copyNote}
                disabled={streaming !== null}
                aria-label={t("Copia la nota come Markdown")}
                title={t("Copia la nota come Markdown")}
              >
                {confirmOut === "copy" ? t("Confermi?") : <ActionIcon name="copy" />}
              </button>
              <button
                className={"chip icon-action" + (confirmOut === "print" ? " confirm" : "")}
                onClick={printNote}
                disabled={streaming !== null}
                aria-label={t("Stampa o salva in PDF")}
                title={t("Stampa o salva in PDF la nota che stai guardando")}
              >
                {confirmOut === "print" ? t("Confermi?") : <ActionIcon name="print" />}
              </button>
              <button
                className={"chip icon-action delete-meeting" + (confirmDelete ? " confirm" : "")}
                onClick={remove}
                disabled={inSession}
                aria-label={t("Elimina la nota")}
                title={
                  isImporting
                    ? t("Annulla la trascrizione del file prima di eliminare la nota")
                    : isRecording
                      ? t("Ferma la registrazione prima di eliminare la nota")
                      : t("Elimina la nota")
                }
              >
                {confirmDelete ? t("Confermi?") : <ActionIcon name="trash" />}
              </button>
            </span>
          </div>
          <div className="meta-row people-row">
            <ChipInput
              values={meeting.attendees}
              onChange={(attendees) => saveMeta({ attendees })}
              suggest={suggestPeople}
              addLabel={t("+ Partecipante")}
              placeholder={t("Nome del partecipante")}
              chipClass="person"
            />
            {missingFromEvent.length > 0 && calEvent && (
              <button
                className="chip import"
                title={missingFromEvent.join(", ")}
                onClick={() => saveMeta({ attendees: [...meeting.attendees, ...missingFromEvent] })}
              >
                {t("Importa {n} da «{title}»", { n: missingFromEvent.length, title: calEvent.title })}
              </button>
            )}
          </div>
          <div className="meta-row">
            <ChipInput
              values={meeting.tags}
              onChange={(tags) => saveMeta({ tags })}
              suggest={suggestTags}
              addLabel={t("+ Tag")}
              placeholder={t("Nome del tag")}
              prefix="#"
              chipClass="tag"
              normalize={(raw) =>
                raw
                  .trim()
                  .replace(/^#+/, "")
                  .toLowerCase()
                  .replace(/[\s,]+/g, "-")
              }
            />
          </div>
        </header>

        <div className="toolbar">
          <div className="seg">
            <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>
              {t("Le mie note")}
            </button>
            <button
              className={tab === "enhanced" ? "on" : ""}
              onClick={() => setTab("enhanced")}
              disabled={!meeting.enhancedMd && streaming === null}
            >
              {sparkle(t("✦ Note AI"))}
            </button>
          </div>
          <div className="spacer" />
          {streaming !== null ? (
            <button
              className="btn small"
              onClick={() => streamRef.current && api.cancelStream(streamRef.current).catch(() => {})}
              title={t("Interrompe la generazione: le note AI precedenti restano invariate")}
            >
              {t("◼ Interrompi")}
            </button>
          ) : (
            <button
              className={
                "btn small" +
                (canEnhance && !meeting.enhancedMd ? " primary" : "") +
                (confirmRegen ? " danger" : "")
              }
              disabled={!canEnhance}
              onClick={requestEnhance}
              title={
                isImporting
                  ? t("Attendi la fine della trascrizione per generare le note")
                  : isRecording
                    ? t("Ferma la registrazione per generare le note")
                    : meeting.enhancedMd
                      ? t("Rigenerando, le note AI attuali e le tue modifiche vengono sostituite")
                      : ""
              }
            >
              {confirmRegen
                ? t("Sostituire le note AI?")
                : meeting.enhancedMd
                  ? t("↻ Rigenera note AI")
                  : sparkle(t("✦ Genera note AI"))}
            </button>
          )}
        </div>

        <div className="doc">
          {tab === "notes" && (
            <NoteEditor
              docKey={id + ":notes"}
              value={meeting.notesMd}
              placeholder={t(
                "Scrivi i punti importanti, al resto pensa la trascrizione. Digita / per i comandi.",
              )}
              onEditor={(editor) => (notesEditor.current = editor)}
              onChange={setNotes}
            />
          )}
          {tab === "enhanced" &&
            (streaming !== null ? (
              <div className="streaming">
                <Markdown text={streaming || "…"} />
              </div>
            ) : (
              <NoteEditor
                docKey={id + ":enhanced:" + enhVersion}
                value={meeting.enhancedMd ?? ""}
                className="enhanced"
                onEditor={(editor) => (enhancedEditor.current = editor)}
                onChange={(md) => saveEnhanced(md)}
              />
            ))}
        </div>

        <footer className="recbar">
          <button
            className={"rec-btn" + (inSession ? " on" : "")}
            onClick={toggleRecording}
            disabled={busyRec || otherRecording}
            title={
              otherRecording
                ? t("C'è già una registrazione in corso su un'altra nota")
                : `${privacyLabel(meeting.privacy)}. ${privacyHint(meeting.privacy)}`
            }
          >
            <span className="rec-icon" />
            {isImporting
              ? t("Annulla")
              : isRecording
                ? t("Stop")
                : segments.length
                  ? t("Riprendi")
                  : t("Registra")}
            {/* chi avvia la registrazione vede subito quanto di questo meeting può uscire dal Mac */}
            <PrivacyIcon privacy={meeting.privacy} />
          </button>
          {isRecording && meeting.attendees.length > 0 && (
            <select
              className={"chip select" + (micSpeaker !== "me" ? " on" : "")}
              value={micSpeaker}
              onChange={(e) => changeSpeaker(e.target.value)}
              aria-label={t("Chi sta parlando al microfono")}
              title={t(
                "Più persone allo stesso microfono? Indica chi sta parlando: da quel momento la trascrizione lo attribuisce a lui.",
              )}
            >
              <option value="me">{t("Al microfono: io")}</option>
              {meeting.attendees.map((name) => (
                <option key={name} value={name}>
                  {t("Al microfono: {name}", { name })}
                </option>
              ))}
            </select>
          )}
          {!inSession && (
            <button
              className="btn small ghost"
              onClick={importAudio}
              disabled={busyRec || rec.recording || finishing}
              title={t("Trascrive un file audio o video invece di registrare dal vivo")}
            >
              {t("Carica audio")}
            </button>
          )}
          {!isImporting && (
            <select
              className="chip select others-device"
              value={systemDevice ?? ""}
              // i dispositivi collegati possono essere cambiati dall'ultima volta
              onFocus={loadDevices}
              onChange={(e) => changeSystemDevice(e.target.value || null)}
              aria-label={t("Audio degli altri partecipanti")}
              title={t(
                "Da dove arriva l'audio degli altri partecipanti. Si può cambiare anche mentre registri.",
              )}
            >
              <option value="">{t("Altri: nessuno")}</option>
              <option value={SYSTEM_AUDIO}>{t("Altri: audio di sistema")}</option>
              {/* un dispositivo salvato ma ora scollegato resta visibile */}
              {[
                ...new Set([
                  ...(systemDevice && systemDevice !== SYSTEM_AUDIO ? [systemDevice] : []),
                  ...devices,
                ]),
              ].map((d) => (
                <option key={d} value={d}>
                  {t("Altri: {device}", { device: d })}
                </option>
              ))}
            </select>
          )}
          {isImporting && !finishing && (
            <span className="muted small">
              {importProgress?.totalMs
                ? t("Trascrivo il file… {pct}%", {
                    pct: Math.min(100, Math.round((importProgress.doneMs / importProgress.totalMs) * 100)),
                  })
                : t("Trascrivo il file… {time}", { time: mmss(importProgress?.doneMs ?? 0) })}
            </span>
          )}
          {isRecording && (
            <>
              <Meter label={t("Tu")} value={level.mic} />
              {level.system !== null && <Meter label={t("Altri")} value={level.system} />}
              <span className="muted small mono">{mmss(elapsed)}</span>
            </>
          )}
          {(finishing || (isRecording && rec.pendingChunks > 1)) && (
            <span className="muted small">{t("Completo la trascrizione…")}</span>
          )}
          {!isRecording && otherRecording && (
            <span className="muted small">{t("Registrazione in corso altrove")}</span>
          )}
          <div className="spacer" />
          {/* il segno sta nel pannello di destra; qui solo se il pannello è chiuso */}
          {isRecording && side === "none" && markButton}
          {side === "none" && chatButton}
        </footer>
        {side === "none" && sidebarToggle}
      </div>

      {side !== "none" && (
        <aside className="side-panel">
          <div className="side-panel-head">
            <strong>
              {side === "transcript"
                ? segments.length
                  ? t("Trascrizione ({n})", { n: segments.length })
                  : t("Trascrizione")
                : t("Chiedi su questa nota")}
            </strong>
            {sidebarToggle}
          </div>
          {/* l'audio salvato di questo meeting, se c'è: si riascolta accanto alla trascrizione */}
          {side === "transcript" && <Recordings meetingId={id} version={recVersion} toast={toast} />}
          {side === "transcript" ? (
            <TranscriptPanel
              segments={segments}
              live={isRecording}
              importing={isImporting}
              focus={transcriptFocus}
              onQuote={addQuote}
              onRedact={redact}
              onReview={review}
              onRename={renameSpeaker}
              privacy={meeting.privacy}
              people={meeting.attendees}
              onAssign={assignSpeaker}
              kept={keptAudio && !inSession ? { refining, refine, discard: discardAudio } : null}
            />
          ) : (
            <ChatPanel
              scope={id}
              toast={toast}
              suggestions={[
                t("Scrivi una email di follow-up"),
                t("Quali sono le azioni e chi le fa?"),
                t("Cosa non è stato deciso?"),
              ]}
            />
          )}
          <footer className="recbar side-foot">
            {/* mentre si registra: segnare il momento e citare l'ultima frase, accanto alla trascrizione */}
            {isRecording && (
              <>
                {markButton}
                <button
                  className="btn small"
                  disabled={!lastSegment}
                  onClick={quoteLast}
                  title={t("Cita nelle note l'ultima frase trascritta, con chi l'ha detta e il minuto")}
                >
                  {t("❝ Cita")}
                </button>
                <div className="spacer" />
              </>
            )}
            {chatButton}
          </footer>
        </aside>
      )}
      {creatingProject && (
        <ProjectDialog
          projects={projects}
          onClose={() => setCreatingProject(false)}
          onSaved={(saved, all) => {
            setCreatingProject(false);
            onProjectsChanged(all);
            // il progetto appena creato da qui è per questo meeting
            void changeProject(saved.id);
          }}
        />
      )}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  // RMS -> scala percettiva grezza
  const pct = Math.min(100, Math.round(Math.sqrt(value) * 220));
  return (
    <span className="meter" title={label}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: pct + "%" }} />
      </span>
    </span>
  );
}
