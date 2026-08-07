import { useState, useEffect, useCallback } from 'react';
import type { Sorte, BestandMitSorte, Buchung, SorteFormData, BuchungFormData, BesonderesEvent, BesonderesEventFormData, Einkaufsliste, VerbrauchsStatistik, Kassenbericht, InventurZeile, InventurErgebnis, OberkategorieMitBestand, OberkategorieFormData } from '../types/getraenke';
import {
  getSorten,
  createSorte as apiCreateSorte,
  updateSorte as apiUpdateSorte,
  deleteSorte as apiDeleteSorte,
  getBestand,
  setBestand as apiSetBestand,
  createBuchung as apiCreateBuchung,
  getBuchungen,
  getEinkaufsliste,
  getEvents,
  createEvent as apiCreateEvent,
  updateEvent as apiUpdateEvent,
  deleteEvent as apiDeleteEvent,
  getVerbrauchsstatistik,
  getKassenbericht,
  storniereBuchung,
  bucheInventur,
  getOberkategorien,
  createOberkategorie as apiCreateOberkategorie,
  updateOberkategorie as apiUpdateOberkategorie,
  deleteOberkategorie as apiDeleteOberkategorie,
} from '../services/api';

export interface EinkaufBuchung {
  sorteId: number;
  menge: number;
  einkaufspreis?: number;
}

interface UseGetraenkeReturn {
  sorten: Sorte[];
  bestand: BestandMitSorte[];
  buchungen: (Buchung & { sorteName: string })[];
  einkaufsliste: Einkaufsliste;
  oberkategorien: OberkategorieMitBestand[];
  events: BesonderesEvent[];
  statistik: VerbrauchsStatistik | null;
  kassenbericht: Kassenbericht | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createSorte: (data: SorteFormData) => Promise<void>;
  updateSorte: (id: number, data: SorteFormData) => Promise<void>;
  deleteSorte: (id: number) => Promise<void>;
  setBestand: (sorteId: number, lager: number) => Promise<void>;
  buchen: (data: BuchungFormData) => Promise<void>;
  stornieren: (id: number) => Promise<void>;
  inventur: (zaehlung: InventurZeile[], notiz?: string) => Promise<InventurErgebnis>;
  verbucheEinkauf: (items: EinkaufBuchung[]) => Promise<void>;
  createEvent: (data: BesonderesEventFormData) => Promise<void>;
  updateEvent: (id: number, data: BesonderesEventFormData) => Promise<void>;
  deleteEvent: (id: number) => Promise<void>;
  createOberkategorie: (data: OberkategorieFormData) => Promise<void>;
  updateOberkategorie: (id: number, data: OberkategorieFormData) => Promise<void>;
  /** Gibt zurück, wie viele Sorten dabei aus der Gruppe gelöst wurden. */
  deleteOberkategorie: (id: number) => Promise<number>;
}

export const useGetraenke = (): UseGetraenkeReturn => {
  const [sorten, setSorten] = useState<Sorte[]>([]);
  const [bestand, setBestandState] = useState<BestandMitSorte[]>([]);
  const [buchungen, setBuchungen] = useState<(Buchung & { sorteName: string })[]>([]);
  const [einkaufsliste, setEinkaufsliste] = useState<Einkaufsliste>({ sorten: [], gruppen: [] });
  const [oberkategorien, setOberkategorien] = useState<OberkategorieMitBestand[]>([]);
  const [events, setEvents] = useState<BesonderesEvent[]>([]);
  const [statistik, setStatistik] = useState<VerbrauchsStatistik | null>(null);
  const [kassenbericht, setKassenbericht] = useState<Kassenbericht | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // silent = true: Hintergrund-Aktualisierung ohne Vollbild-Spinner (z.B. nach
  // einer Buchung). Nur der erste Load zeigt den Lade-Zustand.
  const fetchAll = useCallback(async (signal?: AbortSignal, silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const [sortenData, bestandData, buchungenData, einkaufsData, eventsData, statistikData, kassenberichtData, gruppenData] = await Promise.all([
        getSorten(signal),
        getBestand(signal),
        getBuchungen(undefined, 50, signal),
        getEinkaufsliste(signal),
        getEvents(signal),
        getVerbrauchsstatistik(signal),
        getKassenbericht(signal),
        getOberkategorien(signal),
      ]);
      setSorten(sortenData);
      setBestandState(bestandData);
      setBuchungen(buchungenData);
      setEinkaufsliste(einkaufsData);
      setEvents(eventsData);
      setStatistik(statistikData);
      setKassenbericht(kassenberichtData);
      setOberkategorien(gruppenData);
    } catch (err) {
      if (err instanceof Error && err.name === 'CanceledError') return;
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Getränkedaten');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAll(controller.signal);
    return () => controller.abort();
  }, [fetchAll]);

  const createSorte = useCallback(async (data: SorteFormData) => {
    await apiCreateSorte(data);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const updateSorte = useCallback(async (id: number, data: SorteFormData) => {
    await apiUpdateSorte(id, data);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const deleteSorte = useCallback(async (id: number) => {
    await apiDeleteSorte(id);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const setBestand = useCallback(async (sorteId: number, lager: number) => {
    await apiSetBestand(sorteId, { lager });
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const buchen = useCallback(async (data: BuchungFormData) => {
    const { bestand: neu } = await apiCreateBuchung(data);
    // Betroffene Sorte sofort aktualisieren (kein Flackern, kein Vollbild-Spinner).
    setBestandState(prev => prev.map(b => {
      if (b.sorte.id !== neu.sorteId) return b;
      const gesamtKaesten = neu.lager / b.sorte.flaschenProKasten;
      return {
        ...b,
        lager: neu.lager,
        gesamt: neu.lager,
        unterWarnschwelle: gesamtKaesten < b.sorte.warnschwelle,
      };
    }));
    // Buchungen/Einkaufsliste/Statistik im Hintergrund nachziehen (ohne Spinner).
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const createOberkategorie = useCallback(async (data: OberkategorieFormData) => {
    await apiCreateOberkategorie(data);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const updateOberkategorie = useCallback(async (id: number, data: OberkategorieFormData) => {
    await apiUpdateOberkategorie(id, data);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const deleteOberkategorie = useCallback(async (id: number) => {
    const { geloesteSorten } = await apiDeleteOberkategorie(id);
    await fetchAll(undefined, true);
    return geloesteSorten;
  }, [fetchAll]);

  const stornieren = useCallback(async (id: number) => {
    await storniereBuchung(id);
    // Storno berührt Bestand, Verlauf und Kasse – alles frisch holen.
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const inventur = useCallback(async (zaehlung: InventurZeile[], notiz?: string) => {
    const ergebnis = await bucheInventur(zaehlung, notiz);
    await fetchAll(undefined, true);
    return ergebnis;
  }, [fetchAll]);

  // Mehrere Lager-Eingänge auf einmal verbuchen (Einkauf), je mit eigenem
  // Einkaufspreis. Danach nur ein stiller Refetch.
  const verbucheEinkauf = useCallback(async (items: EinkaufBuchung[]) => {
    for (const item of items) {
      if (item.menge <= 0) continue;
      await apiCreateBuchung({
        sorteId: item.sorteId,
        typ: 'eingang',
        menge: item.menge,
        standort: 'lager',
        einkaufspreis: item.einkaufspreis,
        notiz: 'Einkauf',
      });
    }
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const createEvent = useCallback(async (data: BesonderesEventFormData) => {
    await apiCreateEvent(data);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const updateEvent = useCallback(async (id: number, data: BesonderesEventFormData) => {
    await apiUpdateEvent(id, data);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  const deleteEvent = useCallback(async (id: number) => {
    await apiDeleteEvent(id);
    await fetchAll(undefined, true);
  }, [fetchAll]);

  return {
    sorten,
    bestand,
    buchungen,
    einkaufsliste,
    oberkategorien,
    events,
    statistik,
    kassenbericht,
    loading,
    error,
    refetch: fetchAll,
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
    createOberkategorie,
    updateOberkategorie,
    deleteOberkategorie,
  };
};
