import type {
  SorteFormData,
  EventStatus,
  EventPositionTyp,
} from '../../types/getraenke';

/**
 * Konstanten und reine Hilfsfunktionen der Getränkeseite.
 *
 * Alles hier ist frei von React und ohne Zustand – damit lässt es sich aus
 * jedem Tab und jedem Dialog benutzen, ohne dass eine Komponente von der
 * anderen abhängt.
 */

// --- Aufteilung der Seite ---

export type ModalType =
  | 'none' | 'neueSorte' | 'buchung' | 'bestandKorrektur'
  | 'event' | 'inventur' | 'oberkategorien';

export type SubTab = 'bestand' | 'einkauf' | 'scan' | 'events' | 'auswertung';

export const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'bestand', label: 'Bestand', icon: 'fa-warehouse' },
  { id: 'einkauf', label: 'Einkauf', icon: 'fa-cart-shopping' },
  { id: 'scan', label: 'Scannen', icon: 'fa-barcode' },
  { id: 'events', label: 'Events', icon: 'fa-calendar-days' },
  { id: 'auswertung', label: 'Auswertung', icon: 'fa-chart-bar' },
];

export interface BestandKorrekturState {
  sorteId: number;
  sorteName: string;
  lager: number;
}

// --- Sorten ---

/**
 * Deckel für gleichzeitig offene unbekannte Codes. Darüber wird nichts mehr
 * angenommen – lieber eine ehrliche Meldung als eine Liste, die niemand mehr
 * abarbeitet, oder ein stilles Verwerfen älterer Einträge.
 */
export const MAX_OFFENE_CODES = 20;

/** Übliche Gebindegrössen – deckt das meiste ab, daneben bleibt das freie Feld. */
export const GEBINDE: { wert: number; label: string }[] = [
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
export const SORTE_VORGABEN = { warnschwelle: 2, sollBestand: 4 } as const;

export const leereSorte = (): SorteFormData => ({
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

/** Leeres Feld bleibt leer, statt zu 0 zu werden – sonst kann man nichts offenlassen. */
export const zahlOderLeer = (roh: string, komma = false): number | '' => {
  if (roh.trim() === '') return '';
  const zahl = komma ? parseFloat(roh) : parseInt(roh, 10);
  return Number.isFinite(zahl) ? Math.max(0, zahl) : '';
};

/**
 * Open Food Facts liefert die Menge als Freitext („0,5 l", „20 x 0.5 l"). Steht
 * dort eine Stückzahl, ist das die Gebindegrösse – sonst bleibt es beim Default.
 */
export const gebindeAusMenge = (menge: string | null | undefined): number | null => {
  if (!menge) return null;
  const treffer = menge.match(/(\d{1,3})\s*[x×]/i);
  if (!treffer) return null;
  const zahl = parseInt(treffer[1], 10);
  return zahl >= 1 && zahl <= 100 ? zahl : null;
};

// --- Einkaufsentwurf ---

export type EinkaufDraft = Record<number, { menge: number; preis: number }>;

/**
 * Einkaufsentwurf über einen Reload retten. sessionStorage statt localStorage:
 * Ein Einkauf gehört zu dieser Sitzung – ein Tab, der Wochen später aufgeht,
 * soll nicht mit einer alten Bestellung starten.
 */
const EINKAUF_SCHLUESSEL = 'getraenke.einkaufDraft';

export const ladeEinkaufDraft = (): EinkaufDraft => {
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

export const merkeEinkaufDraft = (draft: EinkaufDraft): void => {
  try {
    if (Object.keys(draft).length === 0) sessionStorage.removeItem(EINKAUF_SCHLUESSEL);
    else sessionStorage.setItem(EINKAUF_SCHLUESSEL, JSON.stringify(draft));
  } catch {
    /* privater Modus o.ä. – dann gilt der Entwurf nur, solange die Seite offen ist */
  }
};

// --- Events ---

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  geplant: 'Geplant',
  'in-bearbeitung': 'In Bearbeitung',
  eingekauft: 'Eingekauft',
  erledigt: 'Erledigt',
  abgesagt: 'Abgesagt',
};

export const EVENT_POSITION_LABELS: Record<EventPositionTyp, string> = {
  sorte: 'Getränkesorte',
  frei: 'Freier Artikel',
};

// --- Anzeige ---

/** Einheitliche, klare Bestandsanzeige: „6 Kästen + 9 Fl" statt mehrdeutigem „6,9K". */
export const formatBestand = (flaschen: number, fpk: number): string => {
  if (fpk <= 0) return `${flaschen} Fl`;
  const kaesten = Math.floor(flaschen / fpk);
  const rest = flaschen % fpk;
  const kastenLabel = kaesten === 1 ? 'Kasten' : 'Kästen';
  if (kaesten > 0 && rest > 0) return `${kaesten} ${kastenLabel} + ${rest} Fl`;
  if (kaesten > 0) return `${kaesten} ${kastenLabel}`;
  return `${rest} Fl`;
};

export const formatDatum = (datum: string): string =>
  new Date(datum).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/**
 * Ein reines Tagesdatum („2026-08-08") wird bewusst von Hand zerlegt statt
 * durch `new Date()` geschickt: Das würde es als UTC-Mitternacht lesen und in
 * westlichen Zeitzonen einen Tag zurückspringen.
 */
export const formatEventDatum = (datum: string): string => {
  const datePart = datum.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [year, month, day] = datePart.split('-');
    return `${day}.${month}.${year}`;
  }

  return new Date(datum).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
};

export const formatMonat = (monat: string): string => {
  const [year, month] = monat.split('-');
  const monate = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  return `${monate[parseInt(month) - 1]} ${year}`;
};

export const buchungTypLabel = (typ: string): string => {
  switch (typ) {
    case 'eingang': return 'Eingang';
    case 'ausgang': return 'Ausgang';
    case 'schwund': return 'Schwund';
    case 'inventur': return 'Inventur';
    case 'auffuellung': return 'Auffüllung';
    default: return typ;
  }
};

/** Inventur und die alten Auffüllungen führen Flaschen, alles andere Kästen. */
export const mengeText = (b: { typ: string; menge: number }): string => {
  if (b.typ === 'inventur') return `${b.menge > 0 ? '+' : ''}${b.menge} Fl.`;
  return `${b.menge} ${b.typ === 'auffuellung' ? 'Fl.' : 'Kästen'}`;
};

/** Für die Druckansichten: alles entschärfen, was aus Namen und Notizen kommt. */
export const escapePrintHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
