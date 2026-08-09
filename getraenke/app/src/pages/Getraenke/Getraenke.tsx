import { useState, useMemo, useRef } from 'react';
import { useGetraenke } from '../../hooks/useGetraenke';
import { useScanKopplung } from '../../hooks/useScanKopplung';
import type { Sorte, SorteFormData, BuchungFormData, BestandMitSorte, BuchungsTyp, EventStatus, EventPositionTyp, EventPosition, BesonderesEvent, EventPositionFormData, BesonderesEventFormData, InventurAbweichung, OberkategorieFormData, OberkategorieMitBestand } from '../../types/getraenke';
import { lookupBarcode } from '../../services/api';
import { ScanTab, type ScanFeedback, type OffenerCode } from './ScanTab';
import {
  MAX_OFFENE_CODES, SUB_TABS,
  EVENT_STATUS_LABELS, EVENT_POSITION_LABELS,
  leereSorte, gebindeAusMenge,

  formatEventDatum, formatMonat,
  escapePrintHtml,
  type ModalType, type SubTab, type BestandKorrekturState,
} from './hilfen';
import { BuchungDialog } from './dialoge/BuchungDialog';
import { BestandKorrekturDialog } from './dialoge/BestandKorrekturDialog';
import { OberkategorienDialog } from './dialoge/OberkategorienDialog';
import { InventurDialog } from './dialoge/InventurDialog';
import { SorteDialog } from './dialoge/SorteDialog';
import { EventDialog } from './dialoge/EventDialog';
import { BestandTab } from './tabs/BestandTab';
import { EinkaufTab } from './tabs/EinkaufTab';
import { EventsTab } from './tabs/EventsTab';
import { AuswertungTab } from './tabs/AuswertungTab';
import { useEinkauf } from './useEinkauf';
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

// Konstanten und reine Hilfsfunktionen liegen in hilfen.ts – siehe Import oben.

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

  // Der Einkauf hat genug eigenen Zustand für einen eigenen Hook.
  const einkauf = useEinkauf(bestand, einkaufsliste);

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
    const items = einkauf.zuBuchen();
    if (items.length === 0) {
      setActionError('Keine Mengen erfasst.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await verbucheEinkauf(items);
      einkauf.leeren();
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
    if (einkauf.zeilen.length === 0) return;
    const lines = ['Einkaufsliste - Getränke', '========================', ''];
    for (const e of einkauf.zeilen) {
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
    if (einkauf.zeilen.length === 0) return;
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
        <tbody>${einkauf.zeilen.map(e => `<tr><td>${escapePrintHtml(e.name)}${e.hinweis ? `<br><small>${escapePrintHtml(e.hinweis)}</small>` : ''}</td><td>${escapePrintHtml(`${e.aktuellerBestand.toFixed(1)} Kästen`)}</td><td><strong>${escapePrintHtml(`${e.empfohleneBestellung} Kästen`)}</strong></td></tr>`).join('')}</tbody>
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

      {activeTab === 'bestand' && (
        <BestandTab
          bestand={bestand}
          bloecke={bestandGruppiert}
          einkaufZeilen={einkauf.zeilen}
          einkaufslisteRef={einkaufslisteRef}
          onOberkategorien={openOberkategorien}
          onInventur={openInventur}
          onBestandKorrektur={openBestandKorrektur}
          onSorteBearbeiten={openEditSorte}
          onSorteDeaktivieren={handleDeleteSorte}
          onSchnellbuchung={handleQuickBuchung}
          onEinkaufslisteKopieren={handleExportEinkaufsliste}
          onEinkaufslisteDrucken={handlePrintEinkaufsliste}
        />
      )}

      {/* Einkauf: Lager bestücken + neue Preise erfassen */}
      {activeTab === 'einkauf' && (
        <EinkaufTab
          bestand={bestand}
          einkauf={einkauf}
          fehler={actionError}
          busy={actionLoading}
          onVerbuchen={handleEinkaufVerbuchen}
        />
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
        <EventsTab
          events={events}
          offeneEvents={offeneEvents}
          positionenGesamt={eventPositionenGesamt}
          positionsName={getEventItemName}
          statusKlasse={getEventStatusClass}
          onNeu={openNeuesEvent}
          onBearbeiten={openEditEvent}
          onDrucken={handlePrintEvent}
          onLoeschen={handleDeleteEvent}
        />
      )}

      {/* Auswertung: Buchungen + Statistik + Kassenbericht */}
      {activeTab === 'auswertung' && (
        <AuswertungTab
          buchungen={buchungen}
          kassenbericht={kassenbericht}
          verbrauchsChart={verbrauchsChartData}
          kassenChart={kassenChartData}
          fehler={modal === 'none' ? actionError : null}
          busy={actionLoading}
          onStornieren={handleStornieren}
        />
      )}

      {/* Oberkategorien verwalten */}
      {modal === 'oberkategorien' && (
        <OberkategorienDialog
          gruppen={oberkategorien}
          form={gruppeForm}
          onChange={setGruppeForm}
          bearbeitet={editGruppeId}
          onBearbeiten={g => {
            setEditGruppeId(g.id);
            setGruppeForm({ name: g.name, sollBestand: g.sollBestand, warnschwelle: g.warnschwelle });
            setActionError(null);
          }}
          onNeuStattBearbeiten={() => {
            setEditGruppeId(null);
            setGruppeForm({ name: '', sollBestand: '', warnschwelle: '' });
          }}
          onLoeschen={handleGruppeLoeschen}
          fehler={actionError}
          busy={actionLoading}
          onSchliessen={() => setModal('none')}
          onSpeichern={handleGruppeSubmit}
        />
      )}

      {/* Inventur */}
      {modal === 'inventur' && (
        <InventurDialog
          bestand={bestand}
          zaehlung={inventurZaehlung}
          onZaehlung={setInventurZaehlung}
          notiz={inventurNotiz}
          onNotiz={setInventurNotiz}
          ergebnis={inventurErgebnis}
          fehler={actionError}
          busy={actionLoading}
          onSchliessen={() => setModal('none')}
          onUebernehmen={handleInventurSubmit}
        />
      )}

      {/* Neue Sorte / Sorte bearbeiten */}
      {modal === 'neueSorte' && (
        <SorteDialog
          form={sorteForm}
          onChange={setSorteForm}
          oberkategorien={oberkategorien}
          bearbeitet={editSorteId}
          ausScanCode={neueSorteAusCode}
          namensDublette={namensDublette}
          fehler={actionError}
          busy={actionLoading}
          onAbbrechen={() => { setNeueSorteAusCode(null); setModal('none'); }}
          onSpeichern={handleSorteSubmit}
        />
      )}

      {/* Buchung erfassen */}
      {modal === 'buchung' && (
        <BuchungDialog
          sorten={sorten}
          form={buchungForm}
          onChange={setBuchungForm}
          fehler={actionError}
          busy={actionLoading}
          onAbbrechen={() => setModal('none')}
          onSpeichern={handleBuchungSubmit}
        />
      )}

      {modal === 'bestandKorrektur' && (
        <BestandKorrekturDialog
          stand={bestandKorrektur}
          onChange={setBestandKorrektur}
          fehler={actionError}
          busy={actionLoading}
          onAbbrechen={() => setModal('none')}
          onSpeichern={handleBestandKorrekturSubmit}
        />
      )}

      {modal === 'event' && (
        <EventDialog
          form={eventForm}
          onChange={setEventForm}
          sorten={sorten}
          bearbeitet={editEventId}
          onPositionHinzu={addEventItem}
          onPositionWeg={removeEventItem}
          onPositionAendern={updateEventItem}
          onPositionTyp={handleEventItemTypeChange}
          onPositionSorte={handleEventSorteChange}
          fehler={actionError}
          busy={actionLoading}
          onAbbrechen={() => setModal('none')}
          onSpeichern={handleEventSubmit}
        />
      )}
    </div>
  );
};
