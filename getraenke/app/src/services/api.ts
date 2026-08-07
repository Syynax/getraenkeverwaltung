import axios from 'axios';
import type {
  Sorte,
  SorteFormData,
  BestandMitSorte,
  Bestand,
  Buchung,
  BuchungFormData,
  BesonderesEvent,
  BesonderesEventFormData,
  BarcodeLookup,
  ScanSitzung,
  ScanEreignis,
  ScanWarteErgebnis,
  VerbrauchsStatistik,
  Kassenbericht,
  GetraenkeExport,
  AppConfig,
  AuthStatus,
  InventurZeile,
  InventurErgebnis,
  Einkaufsliste,
  Oberkategorie,
  OberkategorieMitBestand,
  OberkategorieFormData,
} from '../types/getraenke';

/**
 * Home Assistant liefert das Add-on über den Ingress unter
 * /api/hassio_ingress/<token>/ aus. Die API-Basis muss deshalb relativ zum
 * aktuellen Dokumentpfad gebildet werden – ein absolutes "/api" würde am
 * Home-Assistant-Core landen statt beim Add-on.
 */
function resolveApiBase(): string {
  const override = import.meta.env.VITE_API_URL;
  if (override) return override;

  const { pathname } = window.location;
  const dir = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]*$/, '');
  return `${dir}api`;
}

const api = axios.create({
  baseURL: resolveApiBase(),
  headers: { 'Content-Type': 'application/json' },
});

// --- Sitzung ---
//
// Das Token liegt im localStorage statt in einem Cookie: unter dem Ingress
// wechselt der Pfad (/api/hassio_ingress/<token>/), ein Cookie-Path würde
// dadurch regelmässig ins Leere laufen.

const TOKEN_KEY = 'getraenke.token';

/** Wird gefeuert, wenn das Backend 401 meldet – App zeigt dann die Anmeldemaske. */
export const ABGEMELDET_EVENT = 'getraenke:abgemeldet';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* privater Modus o.ä. – dann gilt die Anmeldung nur für diese Seite */
  }
}

api.interceptors.request.use(config => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Fehlermeldungen des Backends durchreichen statt "Request failed with status 400".
api.interceptors.response.use(
  response => response,
  error => {
    // Abgelaufene oder ungültige Sitzung: Token wegwerfen und die App informieren.
    if (error?.response?.status === 401 && !error.config?.url?.includes('/auth/')) {
      setToken(null);
      window.dispatchEvent(new CustomEvent(ABGEMELDET_EVENT));
    }
    const message = error?.response?.data?.error;
    if (typeof message === 'string' && message) {
      return Promise.reject(new Error(message));
    }
    return Promise.reject(error);
  },
);

// --- Sorten ---

export const getSorten = async (signal?: AbortSignal): Promise<Sorte[]> => {
  const response = await api.get<Sorte[]>('/getraenke/sorten', { signal });
  return response.data;
};

export const createSorte = async (data: SorteFormData): Promise<Sorte> => {
  const response = await api.post<Sorte>('/getraenke/sorten', data);
  return response.data;
};

export const updateSorte = async (id: number, data: SorteFormData): Promise<Sorte> => {
  const response = await api.put<Sorte>(`/getraenke/sorten/${id}`, data);
  return response.data;
};

export const deleteSorte = async (id: number): Promise<void> => {
  await api.delete(`/getraenke/sorten/${id}`);
};

// --- Bestand ---

export const getBestand = async (signal?: AbortSignal): Promise<BestandMitSorte[]> => {
  const response = await api.get<BestandMitSorte[]>('/getraenke/bestand', { signal });
  return response.data;
};

export const setBestand = async (sorteId: number, data: { lager: number }): Promise<Bestand> => {
  const response = await api.put<Bestand>(`/getraenke/bestand/${sorteId}`, data);
  return response.data;
};

// --- Buchungen ---

export const createBuchung = async (data: BuchungFormData): Promise<{ buchung: Buchung; bestand: Bestand }> => {
  const response = await api.post<{ buchung: Buchung; bestand: Bestand }>('/getraenke/buchen', data);
  return response.data;
};

export const getBuchungen = async (sorteId?: number, limit?: number, signal?: AbortSignal): Promise<(Buchung & { sorteName: string })[]> => {
  const params: Record<string, number> = {};
  if (sorteId) params.sorteId = sorteId;
  if (limit) params.limit = limit;
  const response = await api.get<(Buchung & { sorteName: string })[]>('/getraenke/buchungen', { params, signal });
  return response.data;
};

export const storniereBuchung = async (id: number): Promise<void> => {
  await api.post(`/getraenke/buchungen/${id}/stornieren`);
};

// --- Inventur ---

export const bucheInventur = async (zaehlung: InventurZeile[], notiz?: string): Promise<InventurErgebnis> => {
  const response = await api.post<InventurErgebnis>('/getraenke/inventur', { zaehlung, notiz: notiz ?? null });
  return response.data;
};

// --- Einkaufsliste ---

export const getEinkaufsliste = async (signal?: AbortSignal): Promise<Einkaufsliste> => {
  const response = await api.get<Einkaufsliste>('/getraenke/einkaufsliste', { signal });
  return response.data;
};

// --- Oberkategorien ---

export const getOberkategorien = async (signal?: AbortSignal): Promise<OberkategorieMitBestand[]> => {
  const response = await api.get<OberkategorieMitBestand[]>('/getraenke/oberkategorien', { signal });
  return response.data;
};

export const createOberkategorie = async (data: OberkategorieFormData): Promise<Oberkategorie> => {
  const response = await api.post<Oberkategorie>('/getraenke/oberkategorien', data);
  return response.data;
};

export const updateOberkategorie = async (id: number, data: OberkategorieFormData): Promise<Oberkategorie> => {
  const response = await api.put<Oberkategorie>(`/getraenke/oberkategorien/${id}`, data);
  return response.data;
};

export const deleteOberkategorie = async (id: number): Promise<{ geloesteSorten: number }> => {
  const response = await api.delete<{ geloesteSorten: number }>(`/getraenke/oberkategorien/${id}`);
  return response.data;
};

// --- Barcode-Lookup ---

/**
 * Schlägt einen Barcode in der öffentlichen Produktdatenbank nach. Der Aufruf
 * geht über das Backend (kein CORS, ein Cache, sprechender User-Agent) und ist
 * reine Hilfestellung – er darf den Scan nie blockieren.
 */
export const lookupBarcode = async (code: string, signal?: AbortSignal): Promise<BarcodeLookup> => {
  const response = await api.get<BarcodeLookup>(`/getraenke/lookup/${encodeURIComponent(code)}`, { signal });
  return response.data;
};

// --- Scan-Kopplung (Handy scannt, anderes Gerät bucht) ---

export const starteScanSitzung = async (): Promise<ScanSitzung> => {
  const response = await api.post<ScanSitzung>('/getraenke/scan-sitzung');
  return response.data;
};

export const tritteScanSitzungBei = async (koppelCode: string): Promise<{ id: string }> => {
  const response = await api.post<{ id: string }>('/getraenke/scan-sitzung/beitreten', { koppelCode });
  return response.data;
};

export const meldeScan = async (id: string, code: string): Promise<ScanEreignis> => {
  const response = await api.post<ScanEreignis>(`/getraenke/scan-sitzung/${id}/scan`, { code });
  return response.data;
};

/**
 * Long-Poll: Die Anfrage bleibt bis zu 25 Sekunden offen und kommt beim ersten
 * Scan sofort zurück. Deshalb hier bewusst kein Timeout – axios wartet.
 */
export const warteAufScans = async (id: string, seit: number, signal?: AbortSignal): Promise<ScanWarteErgebnis> => {
  const response = await api.get<ScanWarteErgebnis>(`/getraenke/scan-sitzung/${id}/warten`, {
    params: { seit },
    signal,
  });
  return response.data;
};

export const beendeScanSitzung = async (id: string): Promise<void> => {
  await api.delete(`/getraenke/scan-sitzung/${id}`);
};

// --- Besondere Events ---

export const getEvents = async (signal?: AbortSignal): Promise<BesonderesEvent[]> => {
  const response = await api.get<BesonderesEvent[]>('/getraenke/events', { signal });
  return response.data;
};

export const createEvent = async (data: BesonderesEventFormData): Promise<BesonderesEvent> => {
  const response = await api.post<BesonderesEvent>('/getraenke/events', data);
  return response.data;
};

export const updateEvent = async (id: number, data: BesonderesEventFormData): Promise<BesonderesEvent> => {
  const response = await api.put<BesonderesEvent>(`/getraenke/events/${id}`, data);
  return response.data;
};

export const deleteEvent = async (id: number): Promise<void> => {
  await api.delete(`/getraenke/events/${id}`);
};

// --- Statistik ---

export const getVerbrauchsstatistik = async (signal?: AbortSignal): Promise<VerbrauchsStatistik> => {
  const response = await api.get<VerbrauchsStatistik>('/getraenke/statistik', { signal });
  return response.data;
};

export const getKassenbericht = async (signal?: AbortSignal): Promise<Kassenbericht> => {
  const response = await api.get<Kassenbericht>('/getraenke/kassenbericht', { signal });
  return response.data;
};

// --- Anmeldung ---

export const getAuthStatus = async (signal?: AbortSignal): Promise<AuthStatus> => {
  const response = await api.get<AuthStatus>('/auth/status', { signal });
  return response.data;
};

export const login = async (name: string, passwort: string): Promise<string> => {
  const response = await api.post<{ token: string; benutzer: string }>('/auth/login', { name, passwort });
  setToken(response.data.token);
  return response.data.benutzer;
};

export const logout = async (): Promise<void> => {
  try {
    await api.post('/auth/logout');
  } catch {
    /* Abmelden darf nie fehlschlagen – das Token wird ohnehin verworfen. */
  }
  setToken(null);
};

// --- Add-on: Konfiguration, Backup & Umzug ---

export const getAppConfig = async (signal?: AbortSignal): Promise<AppConfig> => {
  const response = await api.get<AppConfig>('/config', { signal });
  return response.data;
};

export const exportDaten = async (): Promise<GetraenkeExport> => {
  const response = await api.get<GetraenkeExport>('/export');
  return response.data;
};

export const importDaten = async (daten: unknown): Promise<{ message: string; sorten: number; buchungen: number; events: number }> => {
  const response = await api.post('/import', daten);
  return response.data;
};
