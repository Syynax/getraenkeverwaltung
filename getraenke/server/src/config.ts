import fs from 'fs';
import path from 'path';

/**
 * Zentrale Laufzeit-Konfiguration.
 *
 * Im Add-on liest Home Assistant die Optionen aus dem Add-on-Store in
 * /data/options.json; run.sh reicht den Pfad über OPTIONS_FILE herein.
 * Lokal (ohne Home Assistant) greifen die Umgebungsvariablen bzw. die
 * Defaults hier. Die Benutzerliste kommt bewusst aus options.json und nicht
 * über bashio::config – verschachtelte Listen lassen sich in der Shell nicht
 * verlustfrei durchreichen.
 */

interface BenutzerOption {
  name?: unknown;
  passwort?: unknown;
}

interface AddonOptions {
  titel?: unknown;
  untertitel?: unknown;
  anmeldung?: unknown;
  sitzungsdauer_tage?: unknown;
  benutzer?: unknown;
  produkt_lookup?: unknown;
  log_level?: unknown;
}

function leseOptionen(): AddonOptions {
  const datei = process.env.OPTIONS_FILE;
  if (!datei) return {};
  try {
    const inhalt = JSON.parse(fs.readFileSync(datei, 'utf-8')) as unknown;
    if (inhalt && typeof inhalt === 'object' && !Array.isArray(inhalt)) {
      return inhalt as AddonOptions;
    }
  } catch (err) {
    console.warn(`Add-on-Optionen aus ${datei} nicht lesbar – es gelten die Defaults.`, err);
  }
  return {};
}

const optionen = leseOptionen();

const text = (wert: unknown): string | undefined =>
  typeof wert === 'string' && wert.trim() ? wert.trim() : undefined;

/** Ablageort der Getränkedaten. Im Add-on das persistente Volume /data. */
export const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.resolve(__dirname, '..', '..', 'data', 'getraenke.json');

/** Verzeichnis mit dem gebauten Frontend. */
export const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.resolve(__dirname, '..', '..', 'app', 'dist');

export const PORT = Number(process.env.PORT) || 8099;

export const APP_TITEL = text(optionen.titel) || process.env.APP_TITEL?.trim() || 'Getränkeverwaltung';
export const APP_UNTERTITEL = text(optionen.untertitel)
  ?? (process.env.APP_UNTERTITEL?.trim() || 'Lagerbestand, Einkauf & Kassenbericht');

const jaNein = (wert: unknown, standard: boolean): boolean => {
  if (typeof wert === 'boolean') return wert;
  if (typeof wert === 'string') return !['false', '0', 'nein', 'aus'].includes(wert.trim().toLowerCase());
  return standard;
};

/**
 * Barcodes in der öffentlichen Produktdatenbank (Open Food Facts) nachschlagen.
 * Das ist der einzige ausgehende Verbindungsaufbau des Add-ons – wer es rein
 * offline betreiben will, schaltet die Option ab. Der Scan funktioniert dann
 * unverändert weiter, nur ohne Namensvorschlag.
 */
export const PRODUKT_LOOKUP = jaNein(optionen.produkt_lookup ?? process.env.PRODUKT_LOOKUP, true);

export const LOG_LEVEL = (text(optionen.log_level) || process.env.LOG_LEVEL || 'info').toLowerCase();

/** Bei warning/error/fatal wird kein Request-Log geschrieben. */
export const LOG_REQUESTS = !['warning', 'error', 'fatal'].includes(LOG_LEVEL);

// --- Anmeldung ---------------------------------------------------------

export type AnmeldeModus = 'immer' | 'nur_direktzugriff' | 'aus';

export interface Benutzer {
  name: string;
  passwort: string;
}

function leseBenutzer(wert: unknown): Benutzer[] {
  if (!Array.isArray(wert)) return [];
  const benutzer: Benutzer[] = [];
  const gesehen = new Set<string>();

  for (const eintrag of wert as BenutzerOption[]) {
    if (!eintrag || typeof eintrag !== 'object') continue;
    const name = text(eintrag.name);
    const passwort = typeof eintrag.passwort === 'string' ? eintrag.passwort : '';
    if (!name || !passwort) {
      console.warn(`Benutzereintrag ohne Name oder Passwort wird ignoriert: ${JSON.stringify(eintrag.name)}`);
      continue;
    }
    const schluessel = name.toLowerCase();
    if (gesehen.has(schluessel)) {
      console.warn(`Benutzer "${name}" ist doppelt konfiguriert – nur der erste Eintrag zählt.`);
      continue;
    }
    gesehen.add(schluessel);
    benutzer.push({ name, passwort });
  }

  return benutzer;
}

export const BENUTZER: Benutzer[] = leseBenutzer(optionen.benutzer);

const modusRoh = (text(optionen.anmeldung) || process.env.ANMELDUNG || 'immer').toLowerCase();
const modusErlaubt: AnmeldeModus[] = ['immer', 'nur_direktzugriff', 'aus'];

export const ANMELDE_MODUS: AnmeldeModus = modusErlaubt.includes(modusRoh as AnmeldeModus)
  ? (modusRoh as AnmeldeModus)
  : 'immer';

const tageRoh = Number(optionen.sitzungsdauer_tage ?? process.env.SITZUNGSDAUER_TAGE ?? 30);
const tage = Number.isFinite(tageRoh) ? Math.min(365, Math.max(1, Math.trunc(tageRoh))) : 30;

/** Wie lange eine Anmeldung gültig bleibt, bevor neu angemeldet werden muss. */
export const SITZUNGSDAUER_MS = tage * 24 * 60 * 60 * 1000;

/**
 * Ist die Anmeldung eingeschaltet, aber kein Benutzer hinterlegt, wäre die App
 * für niemanden mehr erreichbar. Statt das Add-on unbenutzbar zu machen läuft
 * es offen weiter – die Warnung steht im Log und als Banner in der Oberfläche.
 */
export const ANMELDUNG_UNKONFIGURIERT = ANMELDE_MODUS !== 'aus' && BENUTZER.length === 0;

/** Das mitgelieferte Beispielpasswort taugt nicht für den Betrieb. */
const STANDARD_PASSWORT = 'bitte-aendern';
const MIT_STANDARDPASSWORT = BENUTZER.filter(b => b.passwort === STANDARD_PASSWORT).map(b => b.name);

export const ANMELDUNG_WARNUNG = ANMELDUNG_UNKONFIGURIERT
  ? 'Anmeldung ist eingeschaltet, aber in den Add-on-Optionen ist kein Benutzer hinterlegt. Das Add-on läuft ungeschützt.'
  : MIT_STANDARDPASSWORT.length > 0
    ? `Noch mit dem Standardpasswort eingerichtet: ${MIT_STANDARDPASSWORT.join(', ')}. Bitte in den Add-on-Optionen ändern.`
    : null;
