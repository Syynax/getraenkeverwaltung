import { useState, useMemo, useRef } from 'react';
import { useGetraenke } from '../../hooks/useGetraenke';
import { useScanKopplung } from '../../hooks/useScanKopplung';
import { EVENT_STATI, EVENT_POSITION_TYPEN } from '../../constants/getraenke';
import type { Sorte, SorteFormData, BuchungFormData, BestandMitSorte, Kategorie, BuchungsTyp, EventStatus, EventPositionTyp, EventPosition, BesonderesEvent, EventPositionFormData, BesonderesEventFormData } from '../../types/getraenke';
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

type ModalType = 'none' | 'neueSorte' | 'buchung' | 'bestandKorrektur' | 'event';
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
    verbucheEinkauf,
    createEvent,
    updateEvent,
    deleteEvent,
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
    flaschenProKasten: 20,
    warnschwelle: 2,
    einkaufspreis: 0,
    verkaufspreis: 0,
    sollBestand: 4,
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
  const [einkaufDraft, setEinkaufDraft] = useState<Record<number, { menge: number; preis: number }>>({});

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

  // Einkaufsliste ref for export
  const einkaufslisteRef = useRef<HTMLDivElement>(null);

  // Computed data
  const stats = useMemo(() => {
    const lagerFlaschen = bestand.reduce((sum, b) => sum + b.lager, 0);
    const warnungen = einkaufsliste.length;
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
    setSorteForm({ name: '', kategorie: 'alkoholfrei', flaschenProKasten: 20, warnschwelle: 2, einkaufspreis: 0, verkaufspreis: 0, sollBestand: 4, barcodes: [] });
    setEditSorteId(null);
    setActionError(null);
    setModal('neueSorte');
  };

  const openEditSorte = (b: BestandMitSorte) => {
    setSorteForm({
      name: b.sorte.name,
      kategorie: b.sorte.kategorie,
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
      }
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
    () => new Map(einkaufsliste.map(e => [e.sorte.id, e.empfohleneBestellung])),
    [einkaufsliste]
  );

  const getEinkaufRow = (b: BestandMitSorte) => einkaufDraft[b.sorte.id] ?? {
    menge: einkaufEmpfMap.get(b.sorte.id) ?? 0,
    preis: b.sorte.einkaufspreis ?? 0,
  };

  const setEinkaufRow = (b: BestandMitSorte, patch: Partial<{ menge: number; preis: number }>) => {
    setEinkaufDraft(prev => ({ ...prev, [b.sorte.id]: { ...getEinkaufRow(b), ...patch } }));
  };

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
      case 'auffuellung': return 'Auffüllung';
      default: return typ;
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
    if (einkaufsliste.length === 0) return;
    const lines = ['Einkaufsliste - Getränke', '========================', ''];
    for (const e of einkaufsliste) {
      lines.push(`${e.sorte.name}: ${e.empfohleneBestellung} Kästen (Bestand: ${Number(e.aktuellerBestand).toFixed(1)} Kästen)`);
    }
    lines.push('', `Erstellt am: ${new Date().toLocaleDateString('de-DE')}`);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text)
      .then(() => alert('Einkaufsliste in die Zwischenablage kopiert!'))
      .catch(() => alert('Kopieren nicht möglich. Bitte Liste manuell markieren.'));
  };

  const handlePrintEinkaufsliste = () => {
    if (einkaufsliste.length === 0) return;
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
        <tbody>${einkaufsliste.map(e => `<tr><td>${escapePrintHtml(e.sorte.name)}</td><td>${escapePrintHtml(`${Number(e.aktuellerBestand).toFixed(1)} Kästen`)}</td><td><strong>${escapePrintHtml(`${e.empfohleneBestellung} Kästen`)}</strong></td></tr>`).join('')}</tbody>
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
          <h3><i className="fas fa-warehouse" style={{ marginRight: '0.5rem' }}></i>Lagerbestand</h3>
          {bestand.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-box-open"></i>
              <p>Keine Sorten vorhanden. Lege oben eine neue Sorte an.</p>
            </div>
          ) : (
            <div className={styles.sorteGrid}>
              {bestand.map(b => {
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
          )}
        </div>

        {/* Einkaufsliste */}
        <div className={styles.einkaufslisteCard} ref={einkaufslisteRef}>
          <div className={styles.einkaufslisteHeader}>
            <h3><i className="fas fa-cart-shopping" style={{ marginRight: '0.5rem' }}></i>Einkaufsliste</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {einkaufsliste.length > 0 && (
                <>
                  <span className={styles.einkaufsBadge}>{einkaufsliste.length}</span>
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
          {einkaufsliste.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-check-circle" style={{ color: '#10b981' }}></i>
              <p>Alles auf Lager!</p>
            </div>
          ) : (
            einkaufsliste.map(e => (
              <div key={e.sorte.id} className={styles.einkaufsItem}>
                <div className={styles.einkaufsItemInfo}>
                  <span className={styles.einkaufsItemName}>{e.sorte.name}</span>
                  <span className={styles.einkaufsItemDetail}>
                    Bestand: {Number(e.aktuellerBestand).toFixed(1)} Kästen
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
            <div className={styles.sorteGrid}>
              {bestand.map(b => {
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
                    <div className={styles.formRow}>
                      <div className={styles.formGroup}>
                        <label>Kästen</label>
                        <input
                          type="number" min={0} step={1} inputMode="numeric"
                          value={row.menge}
                          onChange={e => setEinkaufRow(b, { menge: Math.max(0, parseInt(e.target.value) || 0) })}
                        />
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
                  </div>
                );
              })}
            </div>

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
                  <th>Standort</th>
                  <th>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {buchungen.slice(0, 20).map(b => (
                  <tr key={b.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDatum(b.datum)}</td>
                    <td>{b.sorteName}</td>
                    <td>
                      <span className={`${styles.buchungTyp} ${
                        b.typ === 'eingang' ? styles.typEingang :
                        b.typ === 'ausgang' ? styles.typAusgang :
                        styles.typAuffuellung
                      }`}>
                        {buchungTypLabel(b.typ)}
                      </span>
                    </td>
                    {/* Auffüllungen und der Standort "Automat" stammen aus der
                        Automaten-Zeit und bleiben nur noch im Verlauf stehen. */}
                    <td>{b.menge} {b.typ === 'auffuellung' ? 'Fl.' : 'Kästen'}</td>
                    <td>{b.standort === 'lager' ? 'Lager' : 'Automat'}</td>
                    <td>{b.notiz || '—'}</td>
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

      {/* Neue Sorte / Sorte bearbeiten */}
      {modal === 'neueSorte' && (
        <div className={styles.modalOverlay} onClick={() => setModal('none')}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>{editSorteId ? 'Sorte bearbeiten' : 'Neue Sorte anlegen'}</h2>
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
                <label>Flaschen pro Kasten</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={sorteForm.flaschenProKasten}
                  onChange={e => setSorteForm({ ...sorteForm, flaschenProKasten: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Warnschwelle (Kästen)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={sorteForm.warnschwelle}
                  onChange={e => setSorteForm({ ...sorteForm, warnschwelle: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Soll-Bestand (Kästen)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={sorteForm.sollBestand}
                  onChange={e => setSorteForm({ ...sorteForm, sollBestand: parseInt(e.target.value) || 0 })}
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
                  onChange={e => setSorteForm({ ...sorteForm, einkaufspreis: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Verkaufspreis (€/Flasche)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={sorteForm.verkaufspreis}
                  onChange={e => setSorteForm({ ...sorteForm, verkaufspreis: parseFloat(e.target.value) || 0 })}
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
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setModal('none')}>Abbrechen</button>
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
                  <option value="ausgang">Ausgang (Entnahme)</option>
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
