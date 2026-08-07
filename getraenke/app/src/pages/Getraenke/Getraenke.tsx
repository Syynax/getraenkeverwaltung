import { useState, useMemo, useRef, useEffect } from 'react';
import { useGetraenke } from '../../hooks/useGetraenke';
import { useScanKopplung } from '../../hooks/useScanKopplung';
import { EVENT_STATI, EVENT_POSITION_TYPEN } from '../../constants/getraenke';
import type { Sorte, SorteFormData, BuchungFormData, BestandMitSorte, Kategorie, BuchungsTyp, EventStatus, EventPositionTyp, EventPosition, BesonderesEvent, EventPositionFormData, BesonderesEventFormData, InventurAbweichung, OberkategorieFormData, OberkategorieMitBestand } from '../../types/getraenke';
import { GermanDateInput } from '../../components';
import { lookupBarcode } from '../../services/api';
import { ScanTab, type ScanFeedback, type OffenerCode } from './ScanTab';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import styles from './Getraenke.module.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

/**
 * Deckel für gleichzeitig offene unbekannte Codes. Darüber wird nichts mehr
 * angenommen – lieber eine ehrliche Meldung als eine Liste, die niemand mehr
 * abarbeitet, oder ein stilles Verwerfen älterer Einträge.
 */
const MAX_OFFENE_CODES = 20;

/** Übliche Gebindegrössen – deckt das meiste ab, daneben bleibt das freie Feld. */
const GEBINDE: { wert: number; label: string }[] = [
  { wert: 20, label: '20er' },
  { wert: 24, label: '24er' },
  { wert: 12, label: '12er' },
  { wert: 11, label: '11er' },
  { wert: 6, label: '6er' },
];

/**
 * Vorgaben des Servers, gespiegelt für die Platzhalter im Formular.
 * Leer gelassene Felder werden dort eingesetzt.
 */
const SORTE_VORGABEN = { warnschwelle: 2, sollBestand: 4 } as const;

/** Leeres Feld bleibt leer, statt zu 0 zu werden – sonst kann man nichts offenlassen. */
const zahlOderLeer = (roh: string, komma = false): number | '' => {
  if (roh.trim() === '') return '';
  const zahl = komma ? parseFloat(roh) : parseInt(roh, 10);
  return Number.isFinite(zahl) ? Math.max(0, zahl) : '';
};

type EinkaufDraft = Record<number, { menge: number; preis: number }>;

/**
 * Einkaufsentwurf über einen Reload retten. sessionStorage statt localStorage:
 * Ein Einkauf gehört zu dieser Sitzung – ein Tab, der Wochen später aufgeht,
 * soll nicht mit einer alten Bestellung starten.
 */
const EINKAUF_SCHLUESSEL = 'getraenke.einkaufDraft';

const ladeEinkaufDraft = (): EinkaufDraft => {
  try {
    const roh = sessionStorage.getItem(EINKAUF_SCHLUESSEL);
    if (!roh) return {};
    const wert = JSON.parse(roh) as unknown;
    if (!wert || typeof wert !== 'object' || Array.isArray(wert)) return {};

    const sauber: EinkaufDraft = {};
    for (const [id, zeile] of Object.entries(wert as Record<string, unknown>)) {
      const sorteId = Number(id);
      const z = zeile as { menge?: unknown; preis?: unknown };
      if (!Number.isFinite(sorteId) || typeof z?.menge !== 'number' || typeof z?.preis !== 'number') continue;
      sauber[sorteId] = { menge: Math.max(0, z.menge), preis: Math.max(0, z.preis) };
    }
    return sauber;
  } catch {
    return {};
  }
};

const merkeEinkaufDraft = (draft: EinkaufDraft): void => {
  try {
    if (Object.keys(draft).length === 0) sessionStorage.removeItem(EINKAUF_SCHLUESSEL);
    else sessionStorage.setItem(EINKAUF_SCHLUESSEL, JSON.stringify(draft));
  } catch {
    /* privater Modus o.ä. – dann gilt der Entwurf nur, solange die Seite offen ist */
  }
};

const leereSorte = (): SorteFormData => ({
  name: '',
  kategorie: 'alkoholfrei',
  oberkategorieId: null,
  flaschenProKasten: 20,
  warnschwelle: '',
  einkaufspreis: '',
  verkaufspreis: '',
  sollBestand: '',
  barcodes: [],
});

/**
 * Open Food Facts liefert die Menge als Freitext („0,5 l", „20 x 0.5 l"). Steht
 * dort eine Stückzahl, ist das die Gebindegrösse – sonst bleibt es beim Default.
 */
const gebindeAusMenge = (menge: string | null | undefined): number | null => {
  if (!menge) return null;
  const treffer = menge.match(/(\d{1,3})\s*[x×]/i);
  if (!treffer) return null;
  const zahl = parseInt(treffer[1], 10);
  return zahl >= 1 && zahl <= 100 ? zahl : null;
};

type ModalType = 'none' | 'neueSorte' | 'buchung' | 'bestandKorrektur' | 'event' | 'inventur' | 'oberkategorien';
type SubTab = 'bestand' | 'einkauf' | 'scan' | 'events' | 'auswertung';

const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'bestand', label: 'Bestand', icon: 'fa-warehouse' },
  { id: 'einkauf', label: 'Einkauf', icon: 'fa-cart-shopping' },
  { id: 'scan', label: 'Scannen', icon: 'fa-barcode' },
  { id: 'events', label: 'Events', icon: 'fa-calendar-days' },
  { id: 'auswertung', label: 'Auswertung', icon: 'fa-chart-bar' },
];

const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  geplant: 'Geplant',
  'in-bearbeitung': 'In Bearbeitung',
  eingekauft: 'Eingekauft',
  erledigt: 'Erledigt',
  abgesagt: 'Abgesagt',
};

const EVENT_POSITION_LABELS: Record<EventPositionTyp, string> = {
  sorte: 'Getränkesorte',
  frei: 'Freier Artikel',
};

interface BestandKorrekturState {
  sorteId: number;
  sorteName: string;
  lager: number;
}

export const Getraenke: React.FC = () => {
  const {
    sorten,
    bestand,
    buchungen,
    einkaufsliste,
    events,
    statistik,
    kassenbericht,
    loading,
    error,
    createSorte,
    updateSorte,
    deleteSorte,
    setBestand,
    buchen,
    stornieren,
    inventur,
    verbucheEinkauf,
    createEvent,
    updateEvent,
    deleteEvent,
    oberkategorien,
    createOberkategorie,
    updateOberkategorie,
    deleteOberkategorie,
  } = useGetraenke();

  const [modal, setModal] = useState<ModalType>('none');
  const [activeTab, setActiveTab] = useState<SubTab>('bestand');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const nextEventItemId = useRef(1);

  const getNextEventItemId = () => {
    const id = nextEventItemId.current;
    nextEventItemId.current += 1;
    return id;
  };

  const buildDefaultEventItem = (): EventPositionFormData => {
    const defaultSorte = sorten[0];

    if (defaultSorte) {
      return {
        id: getNextEventItemId(),
        typ: 'sorte',
        sorteId: defaultSorte.id,
        artikelName: defaultSorte.name,
        menge: 1,
        einheit: 'Kästen',
      };
    }

    return {
      id: getNextEventItemId(),
      typ: 'frei',
      sorteId: null,
      artikelName: '',
      menge: 1,
      einheit: 'Stück',
    };
  };

  const buildEmptyEventForm = (): BesonderesEventFormData => ({
    name: '',
    datum: new Date().toISOString().slice(0, 10),
    status: 'geplant',
    notiz: '',
    items: [buildDefaultEventItem()],
  });

  // Sorte form state
  const [sorteForm, setSorteForm] = useState<SorteFormData>({
    name: '',
    kategorie: 'alkoholfrei',
    oberkategorieId: null,
    flaschenProKasten: 20,
    warnschwelle: '',
    einkaufspreis: '',
    verkaufspreis: '',
    sollBestand: '',
    barcodes: [],
  });
  const [editSorteId, setEditSorteId] = useState<number | null>(null);

  // Buchung form state
  const [buchungForm, setBuchungForm] = useState<BuchungFormData>({
    sorteId: 0,
    typ: 'eingang',
    menge: 1,
    standort: 'lager',
    notiz: '',
  });

  // Bestand Korrektur state
  const [bestandKorrektur, setBestandKorrektur] = useState<BestandKorrekturState>({
    sorteId: 0,
    sorteName: '',
    lager: 0,
  });
  const [eventForm, setEventForm] = useState<BesonderesEventFormData>(() => buildEmptyEventForm());
  const [editEventId, setEditEventId] = useState<number | null>(null);

  // Einkauf-Tab: pro Sorte erfasste Menge (Kästen) + Preis (€/Kasten).
  // Liegt in der sessionStorage, damit ein Reload im Getränkemarkt nicht die
  // halbe Bestellung kostet.
  const [einkaufDraft, setEinkaufDraft] = useState<EinkaufDraft>(ladeEinkaufDraft);
  const [nurNachbestellen, setNurNachbestellen] = useState(true);

  useEffect(() => { merkeEinkaufDraft(einkaufDraft); }, [einkaufDraft]);

  // Scan-Tab
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  // Unbekannte Codes sammeln sich, statt sich gegenseitig zu überschreiben.
  // Der Ref ist die Wahrheit: Die Codes laufen aus der Warteschlange herein,
  // ohne dass React zwischendurch garantiert neu gerendert hat.
  const [offeneCodes, setOffeneCodes] = useState<OffenerCode[]>([]);
  const offeneRef = useRef<OffenerCode[]>([]);

  const aendereOffene = (fn: (bisher: OffenerCode[]) => OffenerCode[]) => {
    offeneRef.current = fn(offeneRef.current);
    setOffeneCodes(offeneRef.current);
  };

  const verwirfOffenen = (code: string) => {
    aendereOffene(bisher => bisher.filter(o => o.code !== code));
  };

  // Wird das Sorten-Formular aus einem Scan heraus geöffnet, verschwindet der
  // offene Code erst, wenn die Sorte wirklich angelegt ist.
  const [neueSorteAusCode, setNeueSorteAusCode] = useState<string | null>(null);

  // Einkaufsliste ref for export
  const einkaufslisteRef = useRef<HTMLDivElement>(null);

  // Oberkategorien verwalten
  const [gruppeForm, setGruppeForm] = useState<OberkategorieFormData>({ name: '', sollBestand: '', warnschwelle: '' });
  const [editGruppeId, setEditGruppeId] = useState<number | null>(null);

  const openOberkategorien = () => {
    setGruppeForm({ name: '', sollBestand: '', warnschwelle: '' });
    setEditGruppeId(null);
    setActionError(null);
    setModal('oberkategorien');
  };

  const handleGruppeSubmit = async () => {
    if (!gruppeForm.name.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (editGruppeId !== null) await updateOberkategorie(editGruppeId, gruppeForm);
      else await createOberkategorie(gruppeForm);
      setGruppeForm({ name: '', sollBestand: '', warnschwelle: '' });
      setEditGruppeId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setActionLoading(false);
    }
  };

  const handleGruppeLoeschen = async (g: OberkategorieMitBestand) => {
    if (!confirm(`Oberkategorie „${g.name}" entfernen?\n\nDie ${g.sortenAnzahl} Sorte(n) darin bleiben mit ihrem Bestand erhalten und stehen danach einzeln.`)) {
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await deleteOberkategorie(g.id);
      if (editGruppeId === g.id) {
        setEditGruppeId(null);
        setGruppeForm({ name: '', sollBestand: '', warnschwelle: '' });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setActionLoading(false);
    }
  };

  // Inventur: gezählte Flaschen je Sorte, leer heisst „noch nicht gezählt".
  const [inventurZaehlung, setInventurZaehlung] = useState<Record<number, number | ''>>({});
  const [inventurNotiz, setInventurNotiz] = useState('');
  const [inventurErgebnis, setInventurErgebnis] = useState<InventurAbweichung[] | null>(null);

  const openInventur = () => {
    // Mit dem aktuellen Stand vorbelegen: wer nichts ändert, bestätigt ihn.
    const start: Record<number, number | ''> = {};
    for (const b of bestand) start[b.sorte.id] = b.lager;
    setInventurZaehlung(start);
    setInventurNotiz(`Inventur ${new Date().toLocaleDateString('de-DE')}`);
    setInventurErgebnis(null);
    setActionError(null);
    setModal('inventur');
  };

  const handleInventurSubmit = async () => {
    const zeilen = bestand
      .map(b => ({ sorteId: b.sorte.id, flaschen: inventurZaehlung[b.sorte.id] }))
      .filter((z): z is { sorteId: number; flaschen: number } => typeof z.flaschen === 'number');

    if (zeilen.length === 0) {
      setActionError('Es wurde nichts gezählt.');
      return;
    }

    setActionLoading(true);
    setActionError(null);
    try {
      const ergebnis = await inventur(zeilen, inventurNotiz.trim() || undefined);
      setInventurErgebnis(ergebnis.abweichungen);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Inventur fehlgeschlagen');
    } finally {
      setActionLoading(false);
    }
  };

  // Warnt vor einer zweiten „Cola", blockiert aber nichts – Sorten dürfen
  // absichtlich ähnlich heissen (0,33 l vs 0,5 l).
  const namensDublette = useMemo(() => {
    if (editSorteId !== null) return null;
    const gesucht = sorteForm.name.trim().toLowerCase();
    if (gesucht.length < 3) return null;
    return sorten.find(s => s.name.trim().toLowerCase() === gesucht)?.name ?? null;
  }, [sorteForm.name, sorten, editSorteId]);

  // Computed data
  const stats = useMemo(() => {
    const lagerFlaschen = bestand.reduce((sum, b) => sum + b.lager, 0);
    // Eine Gruppe zählt als eine Meldung, egal wie viele Marken darin stecken.
    const warnungen = einkaufsliste.sorten.length + einkaufsliste.gruppen.length;
    return { lagerFlaschen, warnungen };
  }, [bestand, einkaufsliste]);

  const offeneEvents = useMemo(() =>
    events.filter(event => event.status !== 'erledigt' && event.status !== 'abgesagt').length,
  [events]);

  const eventPositionenGesamt = useMemo(() =>
    events.reduce((sum, event) => sum + event.items.length, 0),
  [events]);

  // Einheitliche, klare Bestandsanzeige: "6 Kästen + 9 Fl" statt mehrdeutigem "6,9K".
  const formatBestand = (flaschen: number, fpk: number) => {
    if (fpk <= 0) return `${flaschen} Fl`;
    const kaesten = Math.floor(flaschen / fpk);
    const rest = flaschen % fpk;
    const kastenLabel = kaesten === 1 ? 'Kasten' : 'Kästen';
    if (kaesten > 0 && rest > 0) return `${kaesten} ${kastenLabel} + ${rest} Fl`;
    if (kaesten > 0) return `${kaesten} ${kastenLabel}`;
    return `${rest} Fl`;
  };

  // --- Handlers ---

  const openNeueSorte = () => {
    setSorteForm(leereSorte());
    setEditSorteId(null);
    setActionError(null);
    setModal('neueSorte');
  };

  /**
   * Sorte aus einem gescannten Barcode anlegen. Name und Gebinde kommen – soweit
   * vorhanden – aus dem Produkt-Lookup, der Code ist schon hinterlegt. Damit
   * bleiben im Formular oft nur noch Bestätigen und Speichern.
   */
  const openSorteAusScan = (offen: OffenerCode) => {
    const produkt = offen.produkt;
    const name = produkt
      ? [produkt.marke, produkt.name].filter(Boolean).join(' ').trim() || produkt.name
      : '';
    setSorteForm({
      ...leereSorte(),
      name,
      flaschenProKasten: gebindeAusMenge(produkt?.menge) ?? 20,
      barcodes: [offen.code],
    });
    setEditSorteId(null);
    setActionError(null);
    setNeueSorteAusCode(offen.code);
    setModal('neueSorte');
  };

  const openEditSorte = (b: BestandMitSorte) => {
    setSorteForm({
      name: b.sorte.name,
      kategorie: b.sorte.kategorie,
      oberkategorieId: b.sorte.oberkategorieId ?? null,
      flaschenProKasten: b.sorte.flaschenProKasten,
      warnschwelle: b.sorte.warnschwelle,
      einkaufspreis: b.sorte.einkaufspreis || 0,
      verkaufspreis: b.sorte.verkaufspreis || 0,
      sollBestand: b.sorte.sollBestand || 4,
      barcodes: b.sorte.barcodes ?? [],
    });
    setEditSorteId(b.sorte.id);
    setActionError(null);
    setModal('neueSorte');
  };

  const openBuchung = (sorteId?: number) => {
    setBuchungForm({
      sorteId: sorteId || (sorten.length > 0 ? sorten[0].id : 0),
      typ: 'eingang',
      menge: 1,
      standort: 'lager',
      notiz: '',
    });
    setActionError(null);
    setModal('buchung');
  };

  const openBestandKorrektur = (b: BestandMitSorte) => {
    setBestandKorrektur({
      sorteId: b.sorte.id,
      sorteName: b.sorte.name,
      lager: b.lager,
    });
    setActionError(null);
    setModal('bestandKorrektur');
  };

  const openNeuesEvent = () => {
    setEventForm(buildEmptyEventForm());
    setEditEventId(null);
    setActionError(null);
    setModal('event');
  };

  const openEditEvent = (event: BesonderesEvent) => {
    const highestItemId = event.items.reduce((maxId, item) => Math.max(maxId, item.id), 0);
    nextEventItemId.current = Math.max(nextEventItemId.current, highestItemId + 1);
    setEventForm({
      name: event.name,
      datum: event.datum.slice(0, 10),
      status: event.status,
      notiz: event.notiz ?? '',
      items: event.items.map(item => ({ ...item })),
    });
    setEditEventId(event.id);
    setActionError(null);
    setModal('event');
  };

  const updateEventItem = (itemId: number, patch: Partial<EventPositionFormData>) => {
    setEventForm(current => ({
      ...current,
      items: current.items.map(item => item.id === itemId ? { ...item, ...patch } : item),
    }));
  };

  const handleEventItemTypeChange = (itemId: number, typ: EventPositionTyp) => {
    const defaultSorte = sorten[0];
    setEventForm(current => ({
      ...current,
      items: current.items.map(item => {
        if (item.id !== itemId) {
          return item;
        }

        if (typ === 'sorte') {
          return {
            ...item,
            typ,
            sorteId: defaultSorte?.id ?? null,
            artikelName: defaultSorte?.name ?? '',
            einheit: item.einheit.trim() || 'Kästen',
          };
        }

        return {
          ...item,
          typ,
          sorteId: null,
          artikelName: item.typ === 'frei' ? item.artikelName : '',
          einheit: item.einheit.trim() || 'Stück',
        };
      }),
    }));
  };

  const handleEventSorteChange = (itemId: number, sorteId: number) => {
    const sorte = sorten.find(entry => entry.id === sorteId);
    updateEventItem(itemId, {
      sorteId,
      artikelName: sorte?.name ?? '',
      einheit: 'Kästen',
    });
  };

  const addEventItem = () => {
    setEventForm(current => ({
      ...current,
      items: [...current.items, buildDefaultEventItem()],
    }));
  };

  const removeEventItem = (itemId: number) => {
    setEventForm(current => ({
      ...current,
      items: current.items.filter(item => item.id !== itemId),
    }));
  };

  const handleSorteSubmit = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      if (editSorteId !== null) {
        await updateSorte(editSorteId, sorteForm);
      } else {
        await createSorte(sorteForm);
        if (neueSorteAusCode) {
          verwirfOffenen(neueSorteAusCode);
          setScanFeedback({ type: 'ok', message: `Sorte „${sorteForm.name.trim()}" angelegt, Barcode ist hinterlegt.` });
        }
      }
      setNeueSorteAusCode(null);
      setModal('none');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSorte = async (id: number) => {
    if (!confirm('Sorte wirklich deaktivieren?')) return;
    try {
      await deleteSorte(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fehler beim Löschen');
    }
  };

  const handleBuchungSubmit = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await buchen(buchungForm);
      setModal('none');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fehler beim Buchen');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBestandKorrekturSubmit = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await setBestand(bestandKorrektur.sorteId, bestandKorrektur.lager);
      setModal('none');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fehler beim Korrigieren');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEventSubmit = async () => {
    if (!eventForm.name.trim()) {
      setActionError('Bitte einen Event-Namen eingeben.');
      return;
    }

    if (!eventForm.datum) {
      setActionError('Bitte ein Datum auswählen.');
      return;
    }

    const invalidItem = eventForm.items.find(item => (
      item.menge <= 0 ||
      !item.einheit.trim() ||
      (item.typ === 'sorte' ? !item.sorteId : !item.artikelName.trim())
    ));

    if (invalidItem) {
      setActionError('Bitte alle Event-Positionen vollständig und mit gültiger Menge ausfüllen.');
      return;
    }

    setActionLoading(true);
    setActionError(null);
    try {
      const payload: BesonderesEventFormData = {
        name: eventForm.name.trim(),
        datum: eventForm.datum,
        status: eventForm.status,
        notiz: eventForm.notiz?.trim() || '',
        items: eventForm.items.map(item => ({
          ...item,
          artikelName: item.typ === 'sorte'
            ? sorten.find(entry => entry.id === item.sorteId)?.name ?? item.artikelName
            : item.artikelName.trim(),
          einheit: item.einheit.trim() || (item.typ === 'sorte' ? 'Kästen' : 'Stück'),
        })),
      };

      if (editEventId !== null) {
        await updateEvent(editEventId, payload);
      } else {
        await createEvent(payload);
      }

      setModal('none');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fehler beim Speichern des Events');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteEvent = async (id: number) => {
    if (!confirm('Event wirklich löschen?')) return;

    try {
      await deleteEvent(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fehler beim Löschen des Events');
    }
  };

  // --- Einkauf-Tab ---
  const einkaufEmpfMap = useMemo(
    () => new Map(einkaufsliste.sorten.map(e => [e.sorte.id, e.empfohleneBestellung])),
    [einkaufsliste]
  );

  /**
   * Sorten, die zu einer Gruppe mit Bedarf gehören. Vorbelegt wird hier keine
   * Menge – welche Marke es wird, entscheidet der Einkauf. Sie sollen aber im
   * gefilterten Einkauf sichtbar bleiben.
   */
  /**
   * Einkaufsliste zum Anzeigen, Kopieren und Drucken: eigenständige Sorten und
   * Gruppen in einer gemeinsamen Form. Bei einer Gruppe steht dabei, welche
   * Marken dazugehören – gekauft wird eine davon.
   */
  const einkaufZeilen = useMemo(() => [
    ...einkaufsliste.sorten.map(e => ({
      schluessel: `s${e.sorte.id}`,
      name: e.sorte.name,
      hinweis: null as string | null,
      aktuellerBestand: e.aktuellerBestand,
      empfohleneBestellung: e.empfohleneBestellung,
    })),
    ...einkaufsliste.gruppen.map(g => ({
      schluessel: `g${g.oberkategorie.id}`,
      name: g.oberkategorie.name,
      hinweis: g.sorten.map(s => s.name).join(', '),
      aktuellerBestand: g.aktuellerBestand,
      empfohleneBestellung: g.empfohleneBestellung,
    })),
  ], [einkaufsliste]);

  const gruppenSortenIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of einkaufsliste.gruppen) for (const s of g.sorten) ids.add(s.id);
    return ids;
  }, [einkaufsliste]);

  const getEinkaufRow = (b: BestandMitSorte) => einkaufDraft[b.sorte.id] ?? {
    menge: einkaufEmpfMap.get(b.sorte.id) ?? 0,
    preis: b.sorte.einkaufspreis ?? 0,
  };

  /** Ausgangswert einer Zeile, ohne den State zum Renderzeitpunkt zu lesen. */
  const einkaufRowAus = (b: BestandMitSorte, draft: EinkaufDraft) => draft[b.sorte.id] ?? {
    menge: einkaufEmpfMap.get(b.sorte.id) ?? 0,
    preis: b.sorte.einkaufspreis ?? 0,
  };

  const setEinkaufRow = (b: BestandMitSorte, patch: Partial<{ menge: number; preis: number }>) => {
    setEinkaufDraft(prev => ({ ...prev, [b.sorte.id]: { ...einkaufRowAus(b, prev), ...patch } }));
  };

  /**
   * Menge relativ verändern. Muss aus `prev` rechnen: Vier schnelle Klicks auf
   * „+" landen im selben Render-Durchlauf und würden sonst alle denselben
   * Ausgangswert sehen – drei davon gingen verloren.
   */
  const aendereEinkaufMenge = (b: BestandMitSorte, delta: number) => {
    setEinkaufDraft(prev => {
      const zeile = einkaufRowAus(b, prev);
      return { ...prev, [b.sorte.id]: { ...zeile, menge: Math.max(0, zeile.menge + delta) } };
    });
  };

  // Standardmässig nur zeigen, was wirklich ansteht – plus alles, wo schon eine
  // Menge drinsteht, sonst würde eine erfasste Zeile beim Filtern verschwinden.
  const einkaufOffen = useMemo(() => bestand.filter(b =>
    (einkaufEmpfMap.get(b.sorte.id) ?? 0) > 0
    || (einkaufDraft[b.sorte.id]?.menge ?? 0) > 0
    || gruppenSortenIds.has(b.sorte.id),
  ), [bestand, einkaufEmpfMap, einkaufDraft, gruppenSortenIds]);

  const einkaufSichtbar = nurNachbestellen ? einkaufOffen : bestand;

  /**
   * Einkauf nach Oberkategorie geblockt, damit der Gruppenbedarf dort steht, wo
   * die Mengen erfasst werden. Ohne das müsste man sich merken, wie viele
   * Kästen Bier noch fehlen, während man sie auf die Marken verteilt.
   */
  const einkaufGruppiert = useMemo(() => {
    const bedarfJeGruppe = new Map(einkaufsliste.gruppen.map(g => [g.oberkategorie.id, g]));
    const bloecke = new Map<number | null, { id: number | null; name: string | null; eintraege: BestandMitSorte[] }>();

    for (const b of einkaufSichtbar) {
      const schluessel = b.oberkategorieId;
      const vorhanden = bloecke.get(schluessel);
      if (vorhanden) vorhanden.eintraege.push(b);
      else bloecke.set(schluessel, { id: schluessel, name: b.oberkategorieName, eintraege: [b] });
    }

    return [...bloecke.values()].sort((a, b) => {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return a.name.localeCompare(b.name, 'de');
    }).map(block => {
      const bedarf = block.id != null ? bedarfJeGruppe.get(block.id) : undefined;
      // Was in diesem Block schon erfasst ist – zählt live mit beim Hochsteppen.
      const erfasst = block.eintraege.reduce((summe, b) => summe + getEinkaufRow(b).menge, 0);
      return {
        ...block,
        bedarf,
        erfasst,
        offen: bedarf ? Math.max(0, bedarf.empfohleneBestellung - erfasst) : 0,
      };
    });
  }, [einkaufSichtbar, einkaufsliste, einkaufDraft, einkaufEmpfMap]);

  const einkaufSumme = useMemo(() =>
    bestand.reduce((sum, b) => {
      const row = einkaufDraft[b.sorte.id] ?? { menge: einkaufEmpfMap.get(b.sorte.id) ?? 0, preis: b.sorte.einkaufspreis ?? 0 };
      return sum + (row.menge > 0 ? row.menge * row.preis : 0);
    }, 0),
    [bestand, einkaufDraft, einkaufEmpfMap]
  );

  // --- Scan-Tab ---
  const sorteToFormData = (s: Sorte): SorteFormData => ({
    name: s.name,
    kategorie: s.kategorie,
    oberkategorieId: s.oberkategorieId ?? null,
    flaschenProKasten: s.flaschenProKasten,
    warnschwelle: s.warnschwelle,
    einkaufspreis: s.einkaufspreis,
    verkaufspreis: s.verkaufspreis,
    sollBestand: s.sollBestand,
    barcodes: s.barcodes ?? [],
  });

  const handleScannedCode = async (code: string) => {
    const c = code.trim();
    // Kein Abbruch bei laufender Buchung: Der Scan-Tab reicht die Codes einzeln
    // und wartet jeweils ab. Ein Filter auf scanBusy würde hier – gerade bei
    // einem schnell scannenden Handy – Codes verschlucken.
    if (!c) return;
    const sorte = sorten.find(s => (s.barcodes ?? []).includes(c));
    if (!sorte) {
      // Denselben Code nicht doppelt aufnehmen – der Scanner feuert gern mehrfach.
      if (offeneRef.current.some(o => o.code === c)) return;

      if (offeneRef.current.length >= MAX_OFFENE_CODES) {
        setScanFeedback({
          type: 'error',
          message: `Code ${c} nicht übernommen: erst die offenen Zuordnungen erledigen.`,
        });
        return;
      }

      aendereOffene(bisher => [...bisher, {
        code: c,
        produktLaeuft: true,
        produktAktiv: true,
        produkt: null,
        vorschlagSorteId: null,
        produktFehler: null,
      }]);

      // Die Produktdatenbank liefert nur einen Vorschlag. Fehler dort dürfen den
      // Scan nicht anhalten – im Zweifel bleibt es bei der manuellen Zuordnung.
      let ergebnis: Partial<OffenerCode>;
      try {
        const treffer = await lookupBarcode(c);
        ergebnis = {
          produktAktiv: treffer.aktiv,
          produkt: treffer.produkt,
          vorschlagSorteId: treffer.vorschlagSorteId,
          produktFehler: treffer.fehler,
        };
      } catch {
        ergebnis = { produktAktiv: true, produkt: null, produktFehler: 'Produktdatenbank nicht erreichbar.' };
      }

      // Nur übernehmen, solange der Code noch offen ist – zwischenzeitlich kann
      // er zugeordnet oder verworfen worden sein.
      aendereOffene(bisher => bisher.map(o =>
        o.code === c ? { ...o, produktLaeuft: false, ...ergebnis } : o,
      ));
      return;
    }
    setScanBusy(true);
    try {
      await buchen({ sorteId: sorte.id, typ: 'eingang', menge: 1, standort: 'lager', notiz: 'Scan-Einlagerung' });
      setScanFeedback({ type: 'ok', message: `1 Kasten ${sorte.name} ins Lager gebucht.` });
    } catch (err) {
      setScanFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Fehler beim Einbuchen' });
    } finally {
      setScanBusy(false);
    }
  };

  // Die Kopplung hängt an der Seite, nicht am Scan-Tab: Ein Wechsel auf einen
  // anderen Unter-Tab soll sie nicht abreissen.
  const kopplung = useScanKopplung(handleScannedCode);

  const handleAssignBarcode = async (code: string, sorteId: number) => {
    const sorte = sorten.find(s => s.id === sorteId);
    if (!sorte || scanBusy) return;
    const barcodes = Array.from(new Set([...(sorte.barcodes ?? []), code.trim()]));
    setScanBusy(true);
    try {
      await updateSorte(sorte.id, { ...sorteToFormData(sorte), barcodes });
      await buchen({ sorteId: sorte.id, typ: 'eingang', menge: 1, standort: 'lager', notiz: 'Scan-Einlagerung' });
      verwirfOffenen(code.trim());
      setScanFeedback({ type: 'ok', message: `Code zugeordnet & 1 Kasten ${sorte.name} eingebucht.` });
    } catch (err) {
      setScanFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Fehler beim Zuordnen' });
    } finally {
      setScanBusy(false);
    }
  };

  const handleEinkaufVerbuchen = async () => {
    const items = bestand
      .map(b => {
        const row = einkaufDraft[b.sorte.id] ?? { menge: einkaufEmpfMap.get(b.sorte.id) ?? 0, preis: b.sorte.einkaufspreis ?? 0 };
        return { sorteId: b.sorte.id, menge: row.menge, einkaufspreis: row.preis };
      })
      .filter(i => i.menge > 0);
    if (items.length === 0) {
      setActionError('Keine Mengen erfasst.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await verbucheEinkauf(items);
      setEinkaufDraft({});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fehler beim Verbuchen des Einkaufs');
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickBuchung = async (sorteId: number, typ: BuchungsTyp) => {
    try {
      await buchen({ sorteId, typ, menge: 1, standort: 'lager' });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler');
    }
  };

  const formatDatum = (datum: string) => {
    return new Date(datum).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatEventDatum = (datum: string) => {
    const datePart = datum.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [year, month, day] = datePart.split('-');
      return `${day}.${month}.${year}`;
    }

    return new Date(datum).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  };

  const buchungTypLabel = (typ: string) => {
    switch (typ) {
      case 'eingang': return 'Eingang';
      case 'ausgang': return 'Ausgang';
      case 'schwund': return 'Schwund';
      case 'inventur': return 'Inventur';
      case 'auffuellung': return 'Auffüllung';
      default: return typ;
    }
  };

  /**
   * Lagerbestand nach Oberkategorie gruppiert, eigenständige Sorten zuletzt.
   * So sieht man auf einen Blick, wie viel Bier insgesamt dasteht, ohne die
   * einzelnen Marken zusammenzählen zu müssen.
   */
  const bestandGruppiert = useMemo(() => {
    const gruppen = new Map<number | null, { id: number | null; name: string | null; eintraege: BestandMitSorte[] }>();

    for (const b of bestand) {
      const schluessel = b.oberkategorieId;
      const vorhanden = gruppen.get(schluessel);
      if (vorhanden) vorhanden.eintraege.push(b);
      else gruppen.set(schluessel, { id: schluessel, name: b.oberkategorieName, eintraege: [b] });
    }

    return [...gruppen.values()].sort((a, b) => {
      // Eigenständige Sorten ans Ende, sonst alphabetisch.
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return a.name.localeCompare(b.name, 'de');
    }).map(gruppe => {
      const info = gruppe.id != null ? oberkategorien.find(g => g.id === gruppe.id) : undefined;
      const kaesten = gruppe.eintraege.reduce((s, e) => s + e.lager / e.sorte.flaschenProKasten, 0);
      return { ...gruppe, info, kaesten };
    });
  }, [bestand, oberkategorien]);

  /** Inventur und die alten Auffüllungen führen Flaschen, alles andere Kästen. */
  const mengeText = (b: { typ: string; menge: number }) => {
    if (b.typ === 'inventur') {
      return `${b.menge > 0 ? '+' : ''}${b.menge} Fl.`;
    }
    return `${b.menge} ${b.typ === 'auffuellung' ? 'Fl.' : 'Kästen'}`;
  };

  const handleStornieren = async (id: number, sorteName: string) => {
    if (!confirm(`Buchung für ${sorteName} stornieren?\n\nDer Bestand wird zurückgedreht. Die Buchung bleibt im Verlauf sichtbar.`)) {
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await stornieren(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Stornieren fehlgeschlagen');
    } finally {
      setActionLoading(false);
    }
  };

  const formatMonat = (monat: string) => {
    const [year, month] = monat.split('-');
    const monate = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    return `${monate[parseInt(month) - 1]} ${year}`;
  };

  const getEventStatusClass = (status: EventStatus) => {
    switch (status) {
      case 'erledigt':
        return styles.eventStatusDone;
      case 'eingekauft':
        return styles.eventStatusReady;
      case 'abgesagt':
        return styles.eventStatusCanceled;
      case 'in-bearbeitung':
        return styles.eventStatusActive;
      default:
        return styles.eventStatusPlanned;
    }
  };

  const getEventItemName = (item: Pick<EventPosition, 'typ' | 'sorteId' | 'artikelName'>) => {
    if (item.typ === 'sorte' && item.sorteId) {
      return sorten.find(entry => entry.id === item.sorteId)?.name ?? item.artikelName;
    }

    return item.artikelName;
  };

  const escapePrintHtml = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const handlePrintEvent = (event: BesonderesEvent) => {
    const itemsMarkup = event.items.length === 0
      ? '<tr><td colspan="3">Keine Positionen hinterlegt</td></tr>'
      : event.items
          .map(item => {
            const artikel = escapePrintHtml(getEventItemName(item));
            const typ = escapePrintHtml(EVENT_POSITION_LABELS[item.typ]);
            const menge = escapePrintHtml(`${item.menge} ${item.einheit}`);
            return `<tr><td>${artikel}</td><td>${typ}</td><td>${menge}</td></tr>`;
          })
          .join('');

    const status = escapePrintHtml(EVENT_STATUS_LABELS[event.status]);
    const titel = escapePrintHtml(event.name);
    const datum = escapePrintHtml(formatEventDatum(event.datum));
    const notiz = event.notiz ? `<p class="note"><strong>Notiz:</strong> ${escapePrintHtml(event.notiz)}</p>` : '';
    const html = `
      <html>
        <head>
          <title>${titel} - Einkaufsliste</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 2rem; color: #111827; }
            h1 { margin: 0 0 0.5rem; font-size: 1.6rem; }
            .meta { margin-bottom: 1rem; color: #4b5563; font-size: 0.95rem; }
            .status { display: inline-block; margin-left: 0.5rem; padding: 0.2rem 0.6rem; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-weight: 700; }
            .note { margin: 1rem 0 1.5rem; padding: 0.85rem 1rem; background: #f3f4f6; border-radius: 0.75rem; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #d1d5db; padding: 0.75rem; text-align: left; }
            th { background: #f9fafb; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
            td:last-child { white-space: nowrap; font-weight: 700; color: #b45309; }
            .footer { margin-top: 1.5rem; color: #6b7280; font-size: 0.85rem; }
          </style>
        </head>
        <body>
          <h1>${titel}</h1>
          <div class="meta">${datum}<span class="status">${status}</span></div>
          ${notiz}
          <table>
            <thead>
              <tr><th>Artikel</th><th>Typ</th><th>Menge</th></tr>
            </thead>
            <tbody>${itemsMarkup}</tbody>
          </table>
          <p class="footer">Gedruckt am: ${escapePrintHtml(new Date().toLocaleDateString('de-DE'))}</p>
        </body>
      </html>`;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handleExportEinkaufsliste = () => {
    if (einkaufZeilen.length === 0) return;
    const lines = ['Einkaufsliste - Getränke', '========================', ''];
    for (const e of einkaufZeilen) {
      lines.push(`${e.name}: ${e.empfohleneBestellung} Kästen (Bestand: ${e.aktuellerBestand.toFixed(1)} Kästen)`);
      if (e.hinweis) lines.push(`    davon eine Marke: ${e.hinweis}`);
    }
    lines.push('', `Erstellt am: ${new Date().toLocaleDateString('de-DE')}`);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text)
      .then(() => alert('Einkaufsliste in die Zwischenablage kopiert!'))
      .catch(() => alert('Kopieren nicht möglich. Bitte Liste manuell markieren.'));
  };

  const handlePrintEinkaufsliste = () => {
    if (einkaufZeilen.length === 0) return;
    const html = `
      <html><head><title>Einkaufsliste</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 2rem; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; text-align: left; }
        th { background: #f3f4f6; font-weight: 600; }
        .date { margin-top: 1rem; color: #6b7280; font-size: 0.875rem; }
      </style></head><body>
      <h1>Einkaufsliste - Getränke</h1>
      <table>
        <thead><tr><th>Sorte</th><th>Aktueller Bestand</th><th>Bestellen</th></tr></thead>
        <tbody>${einkaufZeilen.map(e => `<tr><td>${escapePrintHtml(e.name)}${e.hinweis ? `<br><small>${escapePrintHtml(e.hinweis)}</small>` : ''}</td><td>${escapePrintHtml(`${e.aktuellerBestand.toFixed(1)} Kästen`)}</td><td><strong>${escapePrintHtml(`${e.empfohleneBestellung} Kästen`)}</strong></td></tr>`).join('')}</tbody>
      </table>
      <p class="date">Erstellt am: ${new Date().toLocaleDateString('de-DE')}</p>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  };

  // Chart data
  const verbrauchsChartData = useMemo(() => {
    if (!statistik || statistik.gesamt.length === 0) return null;
    return {
      labels: statistik.gesamt.map(g => formatMonat(g.monat)),
      datasets: [
        {
          label: 'Eingang (Kästen)',
          data: statistik.gesamt.map(g => g.eingang),
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderRadius: 6,
        },
        {
          label: 'Ausgang (Kästen)',
          data: statistik.gesamt.map(g => g.ausgang),
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderRadius: 6,
        },
      ],
    };
  }, [statistik]);

  const kassenChartData = useMemo(() => {
    if (!kassenbericht || kassenbericht.monate.length === 0) return null;
    return {
      labels: kassenbericht.monate.map(m => formatMonat(m.monat)),
      datasets: [
        {
          label: 'Einnahmen (€)',
          data: kassenbericht.monate.map(m => m.einnahmen),
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderRadius: 6,
        },
        {
          label: 'Ausgaben (€)',
          data: kassenbericht.monate.map(m => m.ausgaben),
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderRadius: 6,
        },
      ],
    };
  }, [kassenbericht]);

  // --- Render ---

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.75rem' }}></i>
        Getränkedaten werden geladen...
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Aktionsleiste – der Titel steht in der App-Kopfleiste (App.tsx). */}
      <header className={styles.header}>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={openNeueSorte}>
            <i className="fas fa-plus"></i> Neue Sorte
          </button>
          <button className={styles.btnPrimary} onClick={() => openBuchung()}>
            <i className="fas fa-exchange-alt"></i> Buchung
          </button>
          <button className={styles.btnWarning} onClick={openNeuesEvent}>
            <i className="fas fa-calendar-plus"></i> Event
          </button>
        </div>
      </header>

      {error && <div className={styles.errorMessage}><i className="fas fa-exclamation-triangle"></i> {error}</div>}

      {/* Kompakte Status-Leiste */}
      <div className={styles.statusBar}>
        <div className={`${styles.statusPill} ${stats.warnungen > 0 ? styles.statusPillDanger : styles.statusPillOk}`}>
          <i className={`fas ${stats.warnungen > 0 ? 'fa-triangle-exclamation' : 'fa-check'}`}></i>
          <div className={styles.statusPillText}>
            <span className={styles.statusPillValue}>{stats.warnungen}</span>
            <span className={styles.statusPillLabel}>Nachbestellen</span>
          </div>
        </div>
        <div className={styles.statusPill}>
          <i className="fas fa-warehouse"></i>
          <div className={styles.statusPillText}>
            <span className={styles.statusPillValue}>{stats.lagerFlaschen} Fl</span>
            <span className={styles.statusPillLabel}>Lager</span>
          </div>
        </div>
      </div>

      {/* Sub-Tab-Navigation */}
      <nav className={styles.subTabs}>
        {SUB_TABS.map(t => {
          const count = t.id === 'bestand' ? stats.warnungen
            : t.id === 'events' ? offeneEvents
            : null;
          const alert = t.id === 'bestand' && stats.warnungen > 0;
          return (
            <button
              key={t.id}
              className={`${styles.subTab} ${activeTab === t.id ? styles.subTabActive : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <i className={`fas ${t.icon}`}></i>
              {t.label}
              {count !== null && count > 0 && (
                <span className={`${styles.subTabCount} ${alert ? styles.subTabCountAlert : ''}`}>{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bestand: Sorten-Karten + Einkaufsliste */}
      {activeTab === 'bestand' && (
      <div className={styles.mainGrid}>
        <div className={styles.tableCard}>
          <div className={styles.sectionHeader}>
            <h3><i className="fas fa-warehouse" style={{ marginRight: '0.5rem' }}></i>Lagerbestand</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={styles.btnSecondary} onClick={openOberkategorien}>
                <i className="fas fa-layer-group"></i> Oberkategorien
              </button>
              {bestand.length > 0 && (
                <button className={styles.btnSecondary} onClick={openInventur}>
                  <i className="fas fa-clipboard-check"></i> Inventur
                </button>
              )}
            </div>
          </div>
          {bestand.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-box-open"></i>
              <p>Keine Sorten vorhanden. Lege oben eine neue Sorte an.</p>
            </div>
          ) : (
            bestandGruppiert.map(gruppe => (
            <div key={gruppe.id ?? '__eigen'} className={styles.gruppenBlock}>
              {/* Kopfzeile nur, wenn es überhaupt Oberkategorien gibt. */}
              {(gruppe.name || bestandGruppiert.length > 1) && (
                <div className={styles.gruppenKopf}>
                  <span className={styles.gruppenName}>
                    {gruppe.name ? (
                      <><i className="fas fa-layer-group"></i> {gruppe.name}</>
                    ) : (
                      <><i className="fas fa-bottle-water"></i> Einzelne Sorten</>
                    )}
                  </span>
                  {/* Nur der Gesamtbestand – der Soll-Vergleich steht in der
                      Einkaufsliste und bezieht sich auf eine andere Teilmenge. */}
                  <span className={`${styles.gruppenSumme} ${gruppe.info?.unterWarnschwelle ? styles.stockValueWarn : ''}`}>
                    {gruppe.kaesten.toFixed(1)} Kästen
                  </span>
                </div>
              )}
            <div className={styles.sorteGrid}>
              {gruppe.eintraege.map(b => {
                const fpk = b.sorte.flaschenProKasten;
                const lagerCls = b.lager === 0 ? styles.stockValueNull : b.unterWarnschwelle ? styles.stockValueWarn : '';
                return (
                  <div
                    key={b.sorte.id}
                    className={`${styles.sorteCard} ${b.gesamt === 0 ? styles.sorteCardDanger : b.unterWarnschwelle ? styles.sorteCardWarn : ''}`}
                  >
                    <div className={styles.sorteCardHeader}>
                      <div className={styles.sorteCardTitle}>
                        <i className={`fas ${b.sorte.kategorie === 'alkoholfrei' ? 'fa-glass-water' : 'fa-beer-mug-empty'}`}
                          style={{ color: b.sorte.kategorie === 'alkoholfrei' ? '#3b82f6' : '#d97706' }}></i>
                        <strong title={b.sorte.name}>{b.sorte.name}</strong>
                      </div>
                      <details className={styles.cardMenu}>
                        <summary title="Mehr"><i className="fas fa-ellipsis-vertical"></i></summary>
                        <div className={styles.menuList}>
                          <button className={styles.menuItem} onClick={() => openBestandKorrektur(b)}>
                            <i className="fas fa-sliders"></i> Bestand korrigieren
                          </button>
                          <button className={styles.menuItem} onClick={() => openEditSorte(b)}>
                            <i className="fas fa-pen"></i> Sorte bearbeiten
                          </button>
                          <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => handleDeleteSorte(b.sorte.id)}>
                            <i className="fas fa-trash"></i> Deaktivieren
                          </button>
                        </div>
                      </details>
                    </div>

                    <div className={styles.stockRow}>
                      <div className={styles.stockInfo}>
                        <span className={styles.stockLabel}>Lager</span>
                        <span className={`${styles.stockValue} ${lagerCls}`}>{formatBestand(b.lager, fpk)}</span>
                      </div>
                      <div className={styles.stepper}>
                        <button
                          className={`${styles.stepBtn} ${styles.btnMinus}`}
                          title="1 Kasten entnehmen"
                          disabled={b.lager < fpk}
                          onClick={() => handleQuickBuchung(b.sorte.id, 'ausgang')}
                        >−</button>
                        <button
                          className={`${styles.stepBtn} ${styles.btnPlus}`}
                          title="1 Kasten einbuchen"
                          onClick={() => handleQuickBuchung(b.sorte.id, 'eingang')}
                        >+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
            ))
          )}
        </div>

        {/* Einkaufsliste */}
        <div className={styles.einkaufslisteCard} ref={einkaufslisteRef}>
          <div className={styles.einkaufslisteHeader}>
            <h3><i className="fas fa-cart-shopping" style={{ marginRight: '0.5rem' }}></i>Einkaufsliste</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {einkaufZeilen.length > 0 && (
                <>
                  <span className={styles.einkaufsBadge}>{einkaufZeilen.length}</span>
                  <button className={`${styles.quickBtn} ${styles.btnEdit}`} title="Kopieren" onClick={handleExportEinkaufsliste}>
                    <i className="fas fa-copy" style={{ fontSize: '0.6875rem' }}></i>
                  </button>
                  <button className={`${styles.quickBtn} ${styles.btnSettings}`} title="Drucken" onClick={handlePrintEinkaufsliste}>
                    <i className="fas fa-print" style={{ fontSize: '0.6875rem' }}></i>
                  </button>
                </>
              )}
            </div>
          </div>
          {einkaufZeilen.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-check-circle" style={{ color: '#10b981' }}></i>
              <p>Alles auf Lager!</p>
            </div>
          ) : (
            einkaufZeilen.map(e => (
              <div key={e.schluessel} className={styles.einkaufsItem}>
                <div className={styles.einkaufsItemInfo}>
                  <span className={styles.einkaufsItemName}>
                    {e.name}
                    {e.hinweis && <span className={styles.gruppenMarke}>Gruppe</span>}
                  </span>
                  <span className={styles.einkaufsItemDetail}>
                    Bestand: {e.aktuellerBestand.toFixed(1)} Kästen
                    {e.hinweis && <> · {e.hinweis}</>}
                  </span>
                </div>
                <div className={styles.einkaufsItemMenge}>
                  <span className={styles.einkaufsMengeValue}>{e.empfohleneBestellung}</span>
                  <span className={styles.einkaufsMengeLabel}>Kästen</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* Einkauf: Lager bestücken + neue Preise erfassen */}
      {activeTab === 'einkauf' && (
      <div className={styles.tableCard}>
        <h3><i className="fas fa-cart-shopping" style={{ marginRight: '0.5rem' }}></i>Einkauf einbuchen</h3>
        <p className={styles.sectionSubtext} style={{ marginBottom: '1rem' }}>
          Menge in Kästen erfassen und den Preis je Kasten anpassen – wird als Eingang ins Lager gebucht. Vorbelegt mit der Bestellempfehlung und dem zuletzt bekannten Preis.
        </p>

        {actionError && <div className={styles.errorMessage}>{actionError}</div>}

        {bestand.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="fas fa-box-open"></i>
            <p>Keine Sorten vorhanden. Lege zuerst eine Sorte an.</p>
          </div>
        ) : (
          <>
            <div className={styles.einkaufLeiste}>
              <div className={styles.einkaufFilter}>
                <button
                  className={`${styles.einkaufFilterBtn} ${nurNachbestellen ? styles.einkaufFilterAktiv : ''}`}
                  onClick={() => setNurNachbestellen(true)}
                >
                  Nur nachbestellen ({einkaufOffen.length})
                </button>
                <button
                  className={`${styles.einkaufFilterBtn} ${!nurNachbestellen ? styles.einkaufFilterAktiv : ''}`}
                  onClick={() => setNurNachbestellen(false)}
                >
                  Alle Sorten ({bestand.length})
                </button>
              </div>
              <button className={styles.einkaufLeer} onClick={() => setEinkaufDraft({})} disabled={actionLoading}>
                <i className="fas fa-eraser"></i> Mengen zurücksetzen
              </button>
            </div>

            {einkaufSichtbar.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="fas fa-check"></i>
                <p>Nichts nachzubestellen. Über <strong>Alle Sorten</strong> kommst du trotzdem an jede Sorte.</p>
              </div>
            ) : (
            einkaufGruppiert.map(block => (
            <div key={block.id ?? '__eigen'} className={styles.gruppenBlock}>
              {(block.name || einkaufGruppiert.length > 1) && (
                <div className={styles.gruppenKopf}>
                  <span className={styles.gruppenName}>
                    {block.name ? (
                      <><i className="fas fa-layer-group"></i> {block.name}</>
                    ) : (
                      <><i className="fas fa-bottle-water"></i> Einzelne Sorten</>
                    )}
                  </span>
                  {/* Der Gruppenbedarf gehört genau hierhin: Er zählt beim
                      Hochsteppen live herunter, egal auf welche Marke. */}
                  {block.bedarf && (
                    <span className={`${styles.gruppenSumme} ${block.offen === 0 ? styles.gruppenErledigt : ''}`}>
                      {block.offen === 0
                        ? <><i className="fas fa-check"></i> {block.bedarf.empfohleneBestellung} Kästen verteilt</>
                        : <>noch {block.offen} von {block.bedarf.empfohleneBestellung} Kästen zu verteilen</>}
                    </span>
                  )}
                </div>
              )}
            <div className={styles.sorteGrid}>
              {block.eintraege.map(b => {
                const row = getEinkaufRow(b);
                const empf = einkaufEmpfMap.get(b.sorte.id) ?? 0;
                return (
                  <div key={b.sorte.id} className={`${styles.sorteCard} ${row.menge > 0 ? styles.einkaufCardActive : ''}`}>
                    <div className={styles.sorteCardHeader}>
                      <div className={styles.sorteCardTitle}>
                        <i className={`fas ${b.sorte.kategorie === 'alkoholfrei' ? 'fa-glass-water' : 'fa-beer-mug-empty'}`}
                          style={{ color: b.sorte.kategorie === 'alkoholfrei' ? '#3b82f6' : '#d97706' }}></i>
                        <strong title={b.sorte.name}>{b.sorte.name}</strong>
                      </div>
                      {empf > 0 && <span className={styles.einkaufEmpf} title="Empfohlene Bestellung">Empf. {empf}</span>}
                    </div>
                    <div className={styles.einkaufMeta}>Lager: {formatBestand(b.lager, b.sorte.flaschenProKasten)}</div>

                    {/* Stepper statt Zahlenfeld: im Markt einhändig bedienbar. */}
                    <div className={styles.einkaufMengeRow}>
                      <span className={styles.stockLabel}>Kästen</span>
                      <div className={styles.stepper}>
                        <button
                          className={`${styles.stepBtn} ${styles.btnMinus}`}
                          title="Ein Kasten weniger"
                          disabled={row.menge <= 0}
                          onClick={() => aendereEinkaufMenge(b, -1)}
                        >−</button>
                        <input
                          type="number" min={0} step={1} inputMode="numeric"
                          className={styles.einkaufMenge}
                          value={row.menge}
                          onChange={e => setEinkaufRow(b, { menge: Math.max(0, parseInt(e.target.value) || 0) })}
                          aria-label={`Kästen ${b.sorte.name}`}
                        />
                        <button
                          className={`${styles.stepBtn} ${styles.btnPlus}`}
                          title="Ein Kasten mehr"
                          onClick={() => aendereEinkaufMenge(b, +1)}
                        >+</button>
                      </div>
                    </div>

                    <div className={styles.formGroup}>
                      <label>Preis €/Kasten</label>
                      <input
                        type="number" min={0} step={0.01} inputMode="decimal"
                        value={row.preis}
                        onChange={e => setEinkaufRow(b, { preis: Math.max(0, parseFloat(e.target.value) || 0) })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
            ))
            )}

            <div className={styles.einkaufFooter}>
              <div className={styles.einkaufSumme}>Einkaufssumme: <strong>{einkaufSumme.toFixed(2)} €</strong></div>
              <button className={styles.btnPrimary} onClick={handleEinkaufVerbuchen} disabled={actionLoading}>
                <i className="fas fa-check"></i> {actionLoading ? 'Verbuchen…' : 'Einkauf verbuchen'}
              </button>
            </div>
          </>
        )}
      </div>
      )}

      {/* Scannen: Barcode → 1 Kasten ins Lager */}
      {activeTab === 'scan' && (
        <ScanTab
          sorten={sorten}
          feedback={scanFeedback}
          offeneCodes={offeneCodes}
          busy={scanBusy}
          kopplung={kopplung}
          onAssign={handleAssignBarcode}
          onVerwerfen={verwirfOffenen}
          onNeueSorte={openSorteAusScan}
        />
      )}

      {/* Events */}
      {activeTab === 'events' && (
      <section className={styles.eventsSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h3><i className="fas fa-calendar-days" style={{ marginRight: '0.5rem' }}></i>Besondere Events</h3>
            <p className={styles.sectionSubtext}>{events.length} Events, {offeneEvents} offen, {eventPositionenGesamt} Positionen</p>
          </div>
          <button className={styles.btnWarning} onClick={openNeuesEvent}>
            <i className="fas fa-plus"></i> Event anlegen
          </button>
        </div>

        {events.length === 0 ? (
          <div className={styles.eventEmptyState}>
            <i className="fas fa-list-check"></i>
            <p>Noch keine besonderen Events angelegt</p>
            <span>Lege ein Event an und hinterlege dort separat, was eingekauft werden muss.</span>
          </div>
        ) : (
          <div className={styles.eventsGrid}>
            {events.map(event => (
              <article key={event.id} className={styles.eventCard}>
                <div className={styles.eventCardHeader}>
                  <div>
                    <h4>{event.name}</h4>
                    <div className={styles.eventMeta}>
                      <span>{formatEventDatum(event.datum)}</span>
                      <span>{event.items.length} Positionen</span>
                    </div>
                  </div>
                  <span className={`${styles.eventStatusBadge} ${getEventStatusClass(event.status)}`}>
                    {EVENT_STATUS_LABELS[event.status]}
                  </span>
                </div>

                {event.notiz && <p className={styles.eventNotiz}>{event.notiz}</p>}

                <div className={styles.eventItemsList}>
                  {event.items.length === 0 ? (
                    <div className={styles.eventItemsEmpty}>Noch keine Positionen hinterlegt</div>
                  ) : (
                    event.items.map(item => (
                      <div key={item.id} className={styles.eventItemRow}>
                        <div>
                          <span className={styles.eventItemName}>{getEventItemName(item)}</span>
                          <span className={styles.eventItemMeta}>{EVENT_POSITION_LABELS[item.typ]}</span>
                        </div>
                        <span className={styles.eventItemAmount}>{item.menge} {item.einheit}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className={styles.eventActions}>
                  <button className={styles.btnSecondary} onClick={() => handlePrintEvent(event)}>
                    <i className="fas fa-print"></i> Drucken
                  </button>
                  <button className={styles.btnSecondary} onClick={() => openEditEvent(event)}>
                    <i className="fas fa-pen"></i> Bearbeiten
                  </button>
                  <button className={styles.btnDanger} onClick={() => handleDeleteEvent(event.id)}>
                    <i className="fas fa-trash"></i> Löschen
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Auswertung: Buchungen + Statistik + Kassenbericht */}
      {activeTab === 'auswertung' && (
      <>
      {/* Letzte Buchungen */}
      <div className={styles.buchungenCard}>
        <h3><i className="fas fa-clock-rotate-left" style={{ marginRight: '0.5rem' }}></i>Letzte Buchungen</h3>
        {/* Ein abgelehnter Storno muss hier sichtbar werden – sonst passiert
            beim Klick scheinbar einfach nichts. */}
        {actionError && modal === 'none' && <div className={styles.errorMessage}>{actionError}</div>}
        {buchungen.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="fas fa-inbox"></i>
            <p>Noch keine Buchungen vorhanden</p>
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Sorte</th>
                  <th>Typ</th>
                  <th>Menge</th>
                  <th>Wer</th>
                  <th>Notiz</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {buchungen.slice(0, 20).map(b => (
                  <tr key={b.id} className={b.storniert ? styles.buchungStorniert : ''}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDatum(b.datum)}</td>
                    <td>{b.sorteName}</td>
                    <td>
                      <span className={`${styles.buchungTyp} ${
                        b.typ === 'eingang' ? styles.typEingang :
                        b.typ === 'ausgang' ? styles.typAusgang :
                        b.typ === 'schwund' ? styles.typSchwund :
                        b.typ === 'inventur' ? styles.typInventur :
                        styles.typAuffuellung
                      }`}>
                        {buchungTypLabel(b.typ)}
                      </span>
                    </td>
                    {/* Bei Inventur und Auffüllung steht in menge eine Zahl in
                        Flaschen, sonst in Kästen. */}
                    <td>{mengeText(b)}</td>
                    <td>{b.benutzer || '—'}</td>
                    <td>
                      {b.notiz || '—'}
                      {b.storniert && (
                        <span className={styles.stornoHinweis}>
                          storniert{b.storniertVon ? ` von ${b.storniertVon}` : ''}
                        </span>
                      )}
                    </td>
                    <td>
                      {/* Auch eine Inventur ist stornierbar – wer sich beim
                          Zählen vertut, muss das zurücknehmen können. */}
                      {!b.storniert && (
                        <button
                          className={styles.stornoBtn}
                          title="Diese Buchung stornieren"
                          disabled={actionLoading}
                          onClick={() => handleStornieren(b.id, b.sorteName)}
                        >
                          <i className="fas fa-rotate-left"></i>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Verbrauchsstatistik */}
      {verbrauchsChartData && (
        <div className={styles.chartCard}>
          <h3><i className="fas fa-chart-bar" style={{ marginRight: '0.5rem' }}></i>Verbrauchsstatistik</h3>
          <div className={styles.chartWrapper}>
            <Bar data={verbrauchsChartData} options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'top' },
                title: { display: false },
              },
              scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } },
              },
            }} />
          </div>
        </div>
      )}

      {/* Kassenbericht */}
      {kassenbericht && (
        <div className={styles.kassenberichtSection}>
          <div className={styles.chartCard}>
            <h3><i className="fas fa-euro-sign" style={{ marginRight: '0.5rem' }}></i>Kassenbericht</h3>
            <div className={styles.kassenSummary}>
              <div className={`${styles.kassenCard} ${styles.kassenEinnahmen}`}>
                <span className={styles.kassenLabel}>Einnahmen</span>
                <span className={styles.kassenWert}>{kassenbericht.gesamtEinnahmen.toFixed(2)} €</span>
              </div>
              <div className={`${styles.kassenCard} ${styles.kassenAusgaben}`}>
                <span className={styles.kassenLabel}>Ausgaben</span>
                <span className={styles.kassenWert}>{kassenbericht.gesamtAusgaben.toFixed(2)} €</span>
              </div>
              <div className={`${styles.kassenCard} ${kassenbericht.gesamtGewinn >= 0 ? styles.kassenGewinn : styles.kassenVerlust}`}>
                <span className={styles.kassenLabel}>{kassenbericht.gesamtGewinn >= 0 ? 'Gewinn' : 'Verlust'}</span>
                <span className={styles.kassenWert}>{kassenbericht.gesamtGewinn.toFixed(2)} €</span>
              </div>
              {kassenbericht.gesamtSchwund > 0 && (
                <div className={styles.kassenCard} title="Wert der abgeschriebenen Ware – kein Geldfluss, zählt nicht in den Gewinn">
                  <span className={styles.kassenLabel}>Schwund</span>
                  <span className={styles.kassenWert}>{kassenbericht.gesamtSchwund.toFixed(2)} €</span>
                </div>
              )}
            </div>
            {kassenChartData && (
              <div className={styles.chartWrapper}>
                <Bar data={kassenChartData} options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'top' },
                    title: { display: false },
                  },
                  scales: {
                    y: { beginAtZero: true, ticks: { callback: (v) => `${v} €` } },
                  },
                }} />
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}

      {/* Oberkategorien verwalten */}
      {modal === 'oberkategorien' && (
        <div className={styles.modalOverlay} onClick={() => setModal('none')}>
          <div className={`${styles.modal} ${styles.modalLarge}`} onClick={e => e.stopPropagation()}>
            <h2>Oberkategorien</h2>
            {actionError && <div className={styles.errorMessage}>{actionError}</div>}

            <p className={styles.mehrFelderHinweis}>
              Eine Oberkategorie fasst mehrere Marken zusammen – etwa „Bier" über Augustiner,
              Tegernseer und was gerade zum Probieren dasteht. Der Soll-Bestand gilt für die
              Gruppe als Ganzes: Nachbestellt wird, wenn insgesamt zu wenig da ist, nicht
              sobald eine einzelne Marke leer ist.
            </p>

            {oberkategorien.length > 0 && (
              <div className={styles.inventurListe}>
                {oberkategorien.map(g => (
                  <div key={g.id} className={styles.inventurZeile}>
                    <div className={styles.inventurName}>
                      <strong>{g.name}</strong>
                      <span className={styles.einkaufMeta}>
                        {g.sortenAnzahl} Sorte{g.sortenAnzahl === 1 ? '' : 'n'} ·{' '}
                        {g.aktuellerBestand.toFixed(1)} Kästen gesamt
                        {g.sollBestand > 0
                          ? ` · ${g.bestandFuerSoll.toFixed(1)} von ${g.sollBestand} auf den Soll`
                          : ' · kein Soll'}
                      </span>
                    </div>
                    <button
                      className={styles.stornoBtn}
                      title="Bearbeiten"
                      onClick={() => {
                        setEditGruppeId(g.id);
                        setGruppeForm({ name: g.name, sollBestand: g.sollBestand, warnschwelle: g.warnschwelle });
                        setActionError(null);
                      }}
                    >
                      <i className="fas fa-pen"></i>
                    </button>
                    <button
                      className={styles.stornoBtn}
                      title="Entfernen"
                      disabled={actionLoading}
                      onClick={() => handleGruppeLoeschen(g)}
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ fontSize: '0.9375rem', margin: '0.5rem 0' }}>
              {editGruppeId !== null ? 'Oberkategorie bearbeiten' : 'Neue Oberkategorie'}
            </h3>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Name</label>
                <input
                  type="text"
                  value={gruppeForm.name}
                  onChange={e => setGruppeForm({ ...gruppeForm, name: e.target.value })}
                  placeholder="z.B. Bier"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Soll-Bestand (Kästen)</label>
                <input
                  type="number" min={0} max={500}
                  value={gruppeForm.sollBestand}
                  placeholder="0"
                  onChange={e => setGruppeForm({ ...gruppeForm, sollBestand: zahlOderLeer(e.target.value) })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Warnschwelle (Kästen)</label>
                <input
                  type="number" min={0} max={500}
                  value={gruppeForm.warnschwelle}
                  placeholder="0"
                  onChange={e => setGruppeForm({ ...gruppeForm, warnschwelle: zahlOderLeer(e.target.value) })}
                />
              </div>
            </div>

            <div className={styles.modalActions}>
              {editGruppeId !== null && (
                <button
                  className={styles.btnSecondary}
                  onClick={() => { setEditGruppeId(null); setGruppeForm({ name: '', sollBestand: '', warnschwelle: '' }); }}
                >
                  Neu statt bearbeiten
                </button>
              )}
              <button className={styles.btnSecondary} onClick={() => setModal('none')}>Schliessen</button>
              <button
                className={styles.btnPrimary}
                onClick={handleGruppeSubmit}
                disabled={actionLoading || !gruppeForm.name.trim()}
              >
                {editGruppeId !== null ? 'Speichern' : 'Anlegen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inventur */}
      {modal === 'inventur' && (
        <div className={styles.modalOverlay} onClick={() => setModal('none')}>
          <div className={`${styles.modal} ${styles.modalLarge}`} onClick={e => e.stopPropagation()}>
            <h2>Inventur</h2>
            {actionError && <div className={styles.errorMessage}>{actionError}</div>}

            {inventurErgebnis ? (
              <>
                {inventurErgebnis.length === 0 ? (
                  <div className={styles.hinweisBox}>
                    <i className="fas fa-circle-check"></i>
                    <span>Keine Abweichungen – der Bestand stimmt.</span>
                  </div>
                ) : (
                  <>
                    <p className={styles.mehrFelderHinweis}>
                      {inventurErgebnis.length} Abweichung{inventurErgebnis.length === 1 ? '' : 'en'} gebucht.
                      Sie stehen als eigene Zeilen im Verlauf.
                    </p>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <thead>
                          <tr><th>Sorte</th><th>War</th><th>Gezählt</th><th>Differenz</th></tr>
                        </thead>
                        <tbody>
                          {inventurErgebnis.map(a => (
                            <tr key={a.sorteId}>
                              <td>{a.sorteName}</td>
                              <td>{a.vorher} Fl.</td>
                              <td>{a.gezaehlt} Fl.</td>
                              <td className={a.differenz < 0 ? styles.stockValueNull : styles.stockValueWarn}>
                                {a.differenz > 0 ? '+' : ''}{a.differenz} Fl.
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <div className={styles.modalActions}>
                  <button className={styles.btnPrimary} onClick={() => setModal('none')}>Schliessen</button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.mehrFelderHinweis}>
                  Gezählte <strong>Flaschen</strong> je Sorte eintragen – vorbelegt ist der aktuelle
                  Stand. Jede Abweichung wird als eigene Buchung festgehalten, damit am Jahresende
                  nachvollziehbar bleibt, wo etwas gefehlt hat.
                </p>

                <div className={styles.inventurListe}>
                  {bestand.map(b => {
                    const gezaehlt = inventurZaehlung[b.sorte.id];
                    const differenz = typeof gezaehlt === 'number' ? gezaehlt - b.lager : 0;
                    return (
                      <div key={b.sorte.id} className={styles.inventurZeile}>
                        <div className={styles.inventurName}>
                          <strong>{b.sorte.name}</strong>
                          <span className={styles.einkaufMeta}>
                            Soll: {formatBestand(b.lager, b.sorte.flaschenProKasten)}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          className={styles.inventurFeld}
                          value={gezaehlt ?? ''}
                          placeholder="—"
                          aria-label={`Gezählte Flaschen ${b.sorte.name}`}
                          onChange={e => setInventurZaehlung(prev => ({
                            ...prev,
                            [b.sorte.id]: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0),
                          }))}
                        />
                        <span className={`${styles.inventurDiff} ${differenz === 0 ? '' : differenz < 0 ? styles.stockValueNull : styles.stockValueWarn}`}>
                          {typeof gezaehlt === 'number' && differenz !== 0 ? `${differenz > 0 ? '+' : ''}${differenz}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className={styles.formGroup}>
                  <label>Notiz</label>
                  <input
                    type="text"
                    value={inventurNotiz}
                    onChange={e => setInventurNotiz(e.target.value)}
                    placeholder="z.B. Jahresinventur 2026"
                  />
                </div>

                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setModal('none')}>Abbrechen</button>
                  <button className={styles.btnPrimary} onClick={handleInventurSubmit} disabled={actionLoading}>
                    {actionLoading ? 'Übernehmen…' : 'Zählung übernehmen'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Neue Sorte / Sorte bearbeiten */}
      {modal === 'neueSorte' && (
        <div className={styles.modalOverlay} onClick={() => { setNeueSorteAusCode(null); setModal('none'); }}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>{editSorteId ? 'Sorte bearbeiten' : 'Neue Sorte anlegen'}</h2>
            {neueSorteAusCode && (
              <p className={styles.mehrFelderHinweis}>
                Aus dem Scan von <code>{neueSorteAusCode}</code> – der Barcode ist schon hinterlegt.
              </p>
            )}
            {actionError && <div className={styles.errorMessage}>{actionError}</div>}
            <div className={styles.formGroup}>
              <label>Name</label>
              <input
                type="text"
                value={sorteForm.name}
                onChange={e => setSorteForm({ ...sorteForm, name: e.target.value })}
                placeholder="z.B. Augustiner Hell"
              />
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Kategorie</label>
                <select
                  value={sorteForm.kategorie}
                  onChange={e => setSorteForm({ ...sorteForm, kategorie: e.target.value as Kategorie })}
                >
                  <option value="alkoholfrei">Alkoholfrei</option>
                  <option value="alkoholisch">Alkoholisch</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Oberkategorie</label>
                <select
                  value={sorteForm.oberkategorieId ?? ''}
                  onChange={e => setSorteForm({
                    ...sorteForm,
                    oberkategorieId: e.target.value ? Number(e.target.value) : null,
                  })}
                >
                  <option value="">— eigenständig —</option>
                  {oberkategorien.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>

            {sorteForm.oberkategorieId !== null && (
              <p className={styles.mehrFelderHinweis}>
                Diese Sorte zählt auf den Soll-Bestand der Oberkategorie ein und löst
                selbst keine Nachbestellung aus – genau richtig für ein Bier, das nur mal
                zum Probieren im Keller steht. Soll sie zusätzlich einzeln überwacht
                werden, trag unten einen eigenen Soll-Bestand ein.
              </p>
            )}

            <div className={styles.formGroup}>
              <label>Gebinde</label>
              <div className={styles.gebindeWahl}>
                {GEBINDE.map(g => (
                  <button
                    key={g.wert}
                    type="button"
                    className={`${styles.gebindeBtn} ${sorteForm.flaschenProKasten === g.wert ? styles.gebindeBtnAktiv : ''}`}
                    onClick={() => setSorteForm({ ...sorteForm, flaschenProKasten: g.wert })}
                  >
                    {g.label}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={100}
                  className={styles.gebindeEigen}
                  value={sorteForm.flaschenProKasten}
                  onChange={e => setSorteForm({ ...sorteForm, flaschenProKasten: parseInt(e.target.value) || 1 })}
                  aria-label="Flaschen pro Kasten"
                  title="Flaschen pro Kasten"
                />
              </div>
            </div>

            {namensDublette && (
              <div className={styles.hinweisBox}>
                <i className="fas fa-circle-info"></i>
                <span>Es gibt schon eine Sorte <strong>{namensDublette}</strong>. Anlegen geht trotzdem.</span>
              </div>
            )}

            <details className={styles.mehrFelder} open={editSorteId !== null}>
              <summary>Preise, Schwellen und Barcodes</summary>

              <p className={styles.mehrFelderHinweis}>
                Alles hier ist freiwillig. Leer heisst: Warnschwelle {SORTE_VORGABEN.warnschwelle},
                Soll-Bestand {sorteForm.oberkategorieId !== null
                  ? '0 – die Oberkategorie übernimmt das'
                  : `${SORTE_VORGABEN.sollBestand} Kästen`}, Preise noch offen. Der
                Einkaufspreis trägt sich beim ersten Einbuchen von selbst nach.
              </p>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Warnschwelle (Kästen)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={sorteForm.warnschwelle}
                    placeholder={String(SORTE_VORGABEN.warnschwelle)}
                    onChange={e => setSorteForm({ ...sorteForm, warnschwelle: zahlOderLeer(e.target.value) })}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Soll-Bestand (Kästen)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={sorteForm.sollBestand}
                    placeholder={String(SORTE_VORGABEN.sollBestand)}
                    onChange={e => setSorteForm({ ...sorteForm, sollBestand: zahlOderLeer(e.target.value) })}
                  />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Einkaufspreis (€/Kasten)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={sorteForm.einkaufspreis}
                    placeholder="noch offen"
                    onChange={e => setSorteForm({ ...sorteForm, einkaufspreis: zahlOderLeer(e.target.value, true) })}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Verkaufspreis (€/Flasche)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={sorteForm.verkaufspreis}
                    placeholder="noch offen"
                    onChange={e => setSorteForm({ ...sorteForm, verkaufspreis: zahlOderLeer(e.target.value, true) })}
                  />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Barcodes (EAN, kommagetrennt – für Scan-Einlagerung)</label>
                <input
                  type="text"
                  value={(sorteForm.barcodes ?? []).join(', ')}
                  onChange={e => setSorteForm({ ...sorteForm, barcodes: e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) })}
                  placeholder="z.B. 4001686386002, 4001686386019"
                />
              </div>
            </details>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => { setNeueSorteAusCode(null); setModal('none'); }}>Abbrechen</button>
              <button className={styles.btnPrimary} onClick={handleSorteSubmit} disabled={actionLoading || !sorteForm.name.trim()}>
                {actionLoading ? 'Speichern...' : editSorteId ? 'Speichern' : 'Anlegen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Buchung erfassen */}
      {modal === 'buchung' && (
        <div className={styles.modalOverlay} onClick={() => setModal('none')}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>Buchung erfassen</h2>
            {actionError && <div className={styles.errorMessage}>{actionError}</div>}
            <div className={styles.formGroup}>
              <label>Sorte</label>
              <select
                value={buchungForm.sorteId}
                onChange={e => setBuchungForm({ ...buchungForm, sorteId: parseInt(e.target.value) })}
              >
                {sorten.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Typ</label>
                <select
                  value={buchungForm.typ}
                  onChange={e => setBuchungForm({ ...buchungForm, typ: e.target.value as BuchungsTyp })}
                >
                  <option value="eingang">Eingang (Lieferung)</option>
                  <option value="ausgang">Ausgang (Verkauf)</option>
                  <option value="schwund">Schwund / Bruch (kein Verkauf)</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Menge (Kästen)</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={buchungForm.menge}
                  onChange={e => setBuchungForm({ ...buchungForm, menge: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>
            <div className={styles.formGroup}>
              <label>Notiz (optional)</label>
              <textarea
                value={buchungForm.notiz || ''}
                onChange={e => setBuchungForm({ ...buchungForm, notiz: e.target.value })}
                placeholder="z.B. Lieferung Getränke Müller"
                rows={2}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModal('none')}>Abbrechen</button>
              <button className={styles.btnPrimary} onClick={handleBuchungSubmit} disabled={actionLoading || !buchungForm.sorteId}>
                {actionLoading ? 'Buchen...' : 'Buchen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bestand korrigieren */}
      {modal === 'bestandKorrektur' && (
        <div className={styles.modalOverlay} onClick={() => setModal('none')}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>Bestand korrigieren: {bestandKorrektur.sorteName}</h2>
            {actionError && <div className={styles.errorMessage}>{actionError}</div>}
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Flaschen im Lager</label>
                <input
                  type="number"
                  min={0}
                  value={bestandKorrektur.lager}
                  onChange={e => setBestandKorrektur({ ...bestandKorrektur, lager: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModal('none')}>Abbrechen</button>
              <button className={styles.btnPrimary} onClick={handleBestandKorrekturSubmit} disabled={actionLoading}>
                {actionLoading ? 'Speichern...' : 'Bestand setzen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'event' && (
        <div className={styles.modalOverlay} onClick={() => setModal('none')}>
          <div className={`${styles.modal} ${styles.modalLarge}`} onClick={e => e.stopPropagation()}>
            <h2>{editEventId ? 'Event bearbeiten' : 'Besonderes Event anlegen'}</h2>
            {actionError && <div className={styles.errorMessage}>{actionError}</div>}

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Name</label>
                <input
                  type="text"
                  value={eventForm.name}
                  onChange={e => setEventForm({ ...eventForm, name: e.target.value })}
                  placeholder="z.B. Sommerfest 2026"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Datum</label>
                <GermanDateInput
                  name="datum"
                  value={eventForm.datum}
                  onChange={(e) => setEventForm({ ...eventForm, datum: e.target.value })}
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Status</label>
                <select
                  value={eventForm.status}
                  onChange={e => setEventForm({ ...eventForm, status: e.target.value as EventStatus })}
                >
                  {EVENT_STATI.map(status => (
                    <option key={status} value={status}>{EVENT_STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Hinweis</label>
                <input
                  type="text"
                  value={eventForm.notiz || ''}
                  onChange={e => setEventForm({ ...eventForm, notiz: e.target.value })}
                  placeholder="Kurzinfo oder Zuständigkeit"
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <div className={styles.eventFormHeader}>
                <label>Was muss gekauft werden?</label>
                <button type="button" className={styles.btnSecondary} onClick={addEventItem}>
                  <i className="fas fa-plus"></i> Position
                </button>
              </div>

              <div className={styles.eventFormList}>
                {eventForm.items.length === 0 ? (
                  <div className={styles.eventItemsEmpty}>Noch keine Positionen hinterlegt</div>
                ) : (
                  eventForm.items.map((item, index) => (
                    <div key={item.id} className={styles.eventFormItemCard}>
                      <div className={styles.eventFormItemHeader}>
                        <strong>Position {index + 1}</strong>
                        <button
                          type="button"
                          className={`${styles.quickBtn} ${styles.btnDelete}`}
                          onClick={() => removeEventItem(item.id)}
                          title="Position entfernen"
                        >
                          <i className="fas fa-trash" style={{ fontSize: '0.6875rem' }}></i>
                        </button>
                      </div>

                      <div className={styles.eventFormItemGrid}>
                        <div className={styles.formGroup}>
                          <label>Typ</label>
                          <select
                            value={item.typ}
                            onChange={e => handleEventItemTypeChange(item.id, e.target.value as EventPositionTyp)}
                          >
                            {EVENT_POSITION_TYPEN.map(type => (
                              <option key={type} value={type}>{EVENT_POSITION_LABELS[type]}</option>
                            ))}
                          </select>
                        </div>

                        {item.typ === 'sorte' ? (
                          <div className={styles.formGroup}>
                            <label>Getränkesorte</label>
                            <select
                              value={item.sorteId ?? ''}
                              onChange={e => handleEventSorteChange(item.id, parseInt(e.target.value, 10))}
                              disabled={sorten.length === 0}
                            >
                              {sorten.length === 0 ? (
                                <option value="">Keine Sorten vorhanden</option>
                              ) : (
                                sorten.map(sorte => (
                                  <option key={sorte.id} value={sorte.id}>{sorte.name}</option>
                                ))
                              )}
                            </select>
                          </div>
                        ) : (
                          <div className={styles.formGroup}>
                            <label>Artikel</label>
                            <input
                              type="text"
                              value={item.artikelName}
                              onChange={e => updateEventItem(item.id, { artikelName: e.target.value })}
                              placeholder="z.B. Becher, Servietten, Eis"
                            />
                          </div>
                        )}

                        <div className={styles.formGroup}>
                          <label>Menge</label>
                          <input
                            type="number"
                            min={0.1}
                            step={0.1}
                            value={item.menge}
                            onChange={e => updateEventItem(item.id, { menge: parseFloat(e.target.value) || 0 })}
                          />
                        </div>

                        <div className={styles.formGroup}>
                          <label>Einheit</label>
                          <input
                            type="text"
                            value={item.einheit}
                            onChange={e => updateEventItem(item.id, { einheit: e.target.value })}
                            placeholder={item.typ === 'sorte' ? 'Kästen' : 'Stück'}
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModal('none')}>Abbrechen</button>
              <button className={styles.btnPrimary} onClick={handleEventSubmit} disabled={actionLoading}>
                {actionLoading ? 'Speichern...' : editEventId ? 'Speichern' : 'Event anlegen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
