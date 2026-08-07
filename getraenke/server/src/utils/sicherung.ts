import fs from 'fs/promises';
import path from 'path';

/**
 * Automatische Sicherungen der Getränkedaten.
 *
 * Liegen neben der Datendatei in `<datenverzeichnis>/sicherungen/`, also im
 * persistenten `/data` des Add-ons – sie überstehen damit Stopp, Neustart und
 * Update. Nur eine Deinstallation des Add-ons löscht sie mit.
 *
 * Gesichert wird einmal pro Kalendertag: beim Start und danach im Takt des
 * Prüfintervalls. Läuft das Add-on wochenlang durch, entsteht trotzdem jeden
 * Tag genau eine Datei.
 */

const ORDNER = 'sicherungen';
const PRAEFIX = 'getraenke-';

/**
 * Wie oft nachgesehen wird, ob für heute schon eine Sicherung liegt.
 * Stündlich, damit auch eine frische Installation zeitnah zu ihrer ersten
 * Sicherung kommt – geschrieben wird trotzdem höchstens eine pro Kalendertag.
 */
const PRUEF_INTERVALL_MS = 60 * 60 * 1000;

export function sicherungsOrdner(datenDatei: string): string {
  return path.join(path.dirname(datenDatei), ORDNER);
}

const tagesStempel = (): string => new Date().toISOString().slice(0, 10);

/**
 * Legt die Sicherung des Tages an, falls sie noch fehlt.
 * Gibt den Pfad zurück, oder null wenn heute schon eine existiert.
 */
export async function sichereTaeglich(datenDatei: string, behalten: number): Promise<string | null> {
  let inhalt: string;
  try {
    inhalt = await fs.readFile(datenDatei, 'utf-8');
  } catch {
    // Noch keine Daten – dann gibt es auch nichts zu sichern.
    return null;
  }

  if (inhalt.trim() === '') return null;

  const ordner = sicherungsOrdner(datenDatei);
  await fs.mkdir(ordner, { recursive: true });

  const ziel = path.join(ordner, `${PRAEFIX}${tagesStempel()}.json`);
  try {
    await fs.access(ziel);
    return null; // heute schon gesichert
  } catch {
    /* noch nicht vorhanden – wird jetzt geschrieben */
  }

  // Über eine Nebendatei, damit ein Abbruch keine halbe Sicherung hinterlässt.
  const tmp = `${ziel}.tmp`;
  await fs.writeFile(tmp, inhalt, 'utf-8');
  await fs.rename(tmp, ziel);

  await raeumeAuf(ordner, behalten);
  return ziel;
}

/** Behält die neuesten `behalten` Sicherungen, löscht den Rest. */
async function raeumeAuf(ordner: string, behalten: number): Promise<void> {
  if (behalten <= 0) return;

  const dateien = (await fs.readdir(ordner))
    .filter(name => name.startsWith(PRAEFIX) && name.endsWith('.json'))
    .sort(); // Dateiname enthält das Datum – alphabetisch ist chronologisch

  for (const alt of dateien.slice(0, Math.max(0, dateien.length - behalten))) {
    try {
      await fs.unlink(path.join(ordner, alt));
    } catch {
      /* schon weg oder gesperrt – kein Grund, den Start abzubrechen */
    }
  }
}

/**
 * Die punktuellen Sicherungen neben der Datendatei (`…json.backup-<zeit>`) legt
 * der Import an. Ohne Aufräumen wachsen sie unbegrenzt und füllen `/data`.
 */
export async function raeumeImportSicherungen(datenDatei: string, behalten: number): Promise<number> {
  const ordner = path.dirname(datenDatei);
  const praefix = `${path.basename(datenDatei)}.backup-`;

  let dateien: string[];
  try {
    dateien = (await fs.readdir(ordner)).filter(name => name.startsWith(praefix)).sort();
  } catch {
    return 0;
  }

  const zuViel = dateien.slice(0, Math.max(0, dateien.length - behalten));
  let geloescht = 0;
  for (const alt of zuViel) {
    try {
      await fs.unlink(path.join(ordner, alt));
      geloescht++;
    } catch {
      /* egal */
    }
  }
  return geloescht;
}

/** Startet die tägliche Sicherung und gibt eine Funktion zum Stoppen zurück. */
export function starteSicherungsTakt(datenDatei: string, behalten: number): () => void {
  const lauf = () => {
    void sichereTaeglich(datenDatei, behalten)
      .then(pfad => { if (pfad) console.log(`💾 Sicherung angelegt: ${pfad}`); })
      .catch(err => console.warn('Automatische Sicherung fehlgeschlagen:', err));
  };

  lauf();
  const timer = setInterval(lauf, PRUEF_INTERVALL_MS);
  // Ein offener Timer darf das Herunterfahren nicht aufhalten.
  timer.unref?.();
  return () => clearInterval(timer);
}
