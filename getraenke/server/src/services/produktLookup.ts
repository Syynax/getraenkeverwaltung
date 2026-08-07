/**
 * Barcode → Produktdaten aus Open Food Facts.
 *
 * Open Food Facts ist eine offene Produktdatenbank (ODbL, kein API-Schlüssel).
 * Die Abdeckung deutscher Getränke ist gut, regionale Brauereien und
 * Kasten-/Tray-Codes fehlen aber häufig. Ein Treffer ist deshalb immer nur ein
 * Vorschlag – verbindlich bleibt die Zuordnung in `Sorte.barcodes`.
 *
 * Das ist der einzige ausgehende Verbindungsaufbau des Add-ons. Ohne Internet
 * (oder mit `produkt_lookup: false`) läuft der Scan wie bisher weiter, nur eben
 * ohne Namensvorschlag.
 */

const API_URL = 'https://world.openfoodfacts.org/api/v2/product';

/** Open Food Facts bittet um einen sprechenden User-Agent je Anwendung. */
const USER_AGENT = 'HomeAssistant-Getraenke-Addon/1.2 (Home Assistant Add-on)';

const TIMEOUT_MS = 5000;

/** Treffer lange halten – eine EAN wechselt praktisch nie das Produkt. */
const TTL_TREFFER_MS = 7 * 24 * 60 * 60 * 1000;

/** Fehlanzeigen kürzer halten: die Datenbank wächst durch ihre Community. */
const TTL_LEER_MS = 60 * 60 * 1000;

const CACHE_MAX = 500;

export interface ProduktInfo {
  name: string;
  marke: string | null;
  menge: string | null;
  quelle: string;
}

interface CacheEintrag {
  produkt: ProduktInfo | null;
  gueltigBis: number;
}

/** Prozessweiter Cache – ein wiederholter Scan kostet keine Abfrage. */
const cache = new Map<string, CacheEintrag>();

function ausCache(code: string): CacheEintrag | undefined {
  const eintrag = cache.get(code);
  if (!eintrag) return undefined;
  if (eintrag.gueltigBis < Date.now()) {
    cache.delete(code);
    return undefined;
  }
  return eintrag;
}

function inCache(code: string, produkt: ProduktInfo | null): void {
  // Map merkt sich die Einfügereihenfolge – bei Überlauf fliegt der älteste raus.
  if (cache.size >= CACHE_MAX) {
    const aeltester = cache.keys().next().value;
    if (aeltester !== undefined) cache.delete(aeltester);
  }
  cache.set(code, {
    produkt,
    gueltigBis: Date.now() + (produkt ? TTL_TREFFER_MS : TTL_LEER_MS),
  });
}

interface OffProdukt {
  product_name?: unknown;
  product_name_de?: unknown;
  brands?: unknown;
  quantity?: unknown;
}

const text = (wert: unknown): string | null => {
  if (typeof wert !== 'string') return null;
  const gekuerzt = wert.trim();
  return gekuerzt ? gekuerzt : null;
};

function baueProdukt(roh: OffProdukt): ProduktInfo | null {
  const name = text(roh.product_name_de) ?? text(roh.product_name);
  // "brands" ist eine Komma-Liste ("Coca-Cola,Coke") – die erste Marke genügt.
  const marke = text(text(roh.brands)?.split(',')[0]);

  if (!name && !marke) return null;

  return {
    name: name ?? (marke as string),
    marke,
    menge: text(roh.quantity),
    quelle: 'Open Food Facts',
  };
}

/**
 * Schlägt einen Barcode nach. `null` heisst „dort nicht bekannt".
 * Netz- und Serverfehler werden geworfen, damit die Oberfläche „nicht gefunden"
 * von „nicht erreichbar" unterscheiden kann.
 */
export async function lookupProdukt(code: string): Promise<ProduktInfo | null> {
  const gecacht = ausCache(code);
  if (gecacht) return gecacht.produkt;

  const felder = 'product_name,product_name_de,brands,quantity';
  const antwort = await fetch(`${API_URL}/${encodeURIComponent(code)}.json?fields=${felder}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // 404 ist keine Störung, sondern das Ergebnis „Barcode unbekannt".
  if (antwort.status === 404) {
    inCache(code, null);
    return null;
  }

  if (!antwort.ok) {
    throw new Error(`Open Food Facts antwortete mit ${antwort.status}`);
  }

  const daten = await antwort.json() as { status?: unknown; product?: OffProdukt };
  const produkt = daten.status === 1 && daten.product ? baueProdukt(daten.product) : null;
  inCache(code, produkt);
  return produkt;
}

/** Füllwörter, die zwischen zwei Getränken nicht unterscheiden. */
const STOPWORTE = new Set([
  'der', 'die', 'das', 'und', 'mit', 'ohne', 'von', 'vom',
  'flasche', 'flaschen', 'kasten', 'kiste', 'glas', 'dose',
  'mehrweg', 'einweg', 'pet', 'liter', 'ltr',
]);

function normalisiere(wert: string): string {
  return wert
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(wert: string): string[] {
  return normalisiere(wert)
    .split(' ')
    .filter(t => t.length >= 3 && !STOPWORTE.has(t));
}

/**
 * Sucht die Sorte, deren Name am besten zum gefundenen Produkt passt.
 *
 * Bewertet wird, wie viele Wörter des Sortennamens im Produktnamen vorkommen –
 * bei Gleichstand gewinnt die spezifischere Sorte („Cola Zero" vor „Cola").
 * Bleibt es mehrdeutig, wird bewusst nichts vorgeschlagen: eine falsche
 * Vorauswahl kostet mehr als gar keine.
 */
export function findeSortenVorschlag(
  produkt: ProduktInfo,
  sorten: { id: number; name: string }[],
): number | null {
  const produktTokens = new Set([
    ...tokens(produkt.name),
    ...(produkt.marke ? tokens(produkt.marke) : []),
  ]);
  if (produktTokens.size === 0) return null;

  const bewertet = sorten
    .map(sorte => {
      const eigene = tokens(sorte.name);
      const treffer = eigene.filter(t => produktTokens.has(t)).length;
      return { id: sorte.id, treffer, anteil: eigene.length > 0 ? treffer / eigene.length : 0 };
    })
    .filter(e => e.anteil >= 0.5 && e.treffer > 0)
    .sort((a, b) => b.anteil - a.anteil || b.treffer - a.treffer);

  if (bewertet.length === 0) return null;

  const [bester, zweiter] = bewertet;
  if (zweiter && zweiter.anteil === bester.anteil && zweiter.treffer === bester.treffer) {
    return null;
  }

  return bester.id;
}
