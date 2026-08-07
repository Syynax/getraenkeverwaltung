import fs from 'fs/promises';
import path from 'path';

// In-memory mutex per file path — serializes concurrent read-modify-write operations
const locks = new Map<string, Promise<void>>();

/** Wie viele Schreibvorgänge gerade laufen – fürs saubere Herunterfahren. */
let offeneSchreibvorgaenge = 0;

export function laufendeSchreibvorgaenge(): number {
  return offeneSchreibvorgaenge;
}

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(filePath) ?? Promise.resolve();

  let resolve: () => void;
  const current = new Promise<void>(r => { resolve = r; });
  locks.set(filePath, current);

  await previous;
  offeneSchreibvorgaenge++;
  try {
    return await fn();
  } finally {
    offeneSchreibvorgaenge--;
    resolve!();
    if (locks.get(filePath) === current) {
      locks.delete(filePath);
    }
  }
}

/**
 * Räumt die Nebendatei eines abgebrochenen Schreibvorgangs weg. Sie ist immer
 * unvollständig – die echte Datei ist dann noch der Stand von davor.
 */
export async function raeumeAbbruchReste(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(`${filePath}.tmp`);
    return true;
  } catch {
    return false;
  }
}

/** Wird geworfen, wenn eine vorhandene Datei nicht lesbar ist. */
export class DatenDefektError extends Error {
  constructor(public readonly datei: string, public readonly ursache: unknown) {
    super(`Die Datei ${datei} ist vorhanden, aber nicht lesbar: ${ursache instanceof Error ? ursache.message : ursache}`);
    this.name = 'DatenDefektError';
  }
}

/**
 * Lädt eine JSON-Datei.
 *
 * Der Fallback greift **nur**, wenn die Datei gar nicht existiert – also beim
 * allerersten Start. Ist sie vorhanden, aber beschädigt, wird geworfen statt
 * stillschweigend mit leerem Bestand weiterzulaufen: sonst würde die nächste
 * Buchung den leeren Stand über die noch reparierbare Datei schreiben und der
 * gesamte Getränkebestand wäre weg.
 */
export async function loadJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback;
    throw new DatenDefektError(filePath, err);
  }

  // Leere Datei: kann durch einen abgebrochenen Schreibvorgang entstehen.
  // Sie ist nicht "kein Bestand", sondern ein Defekt.
  if (raw.trim() === '') {
    throw new DatenDefektError(filePath, new Error('Die Datei ist leer'));
  }

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new DatenDefektError(filePath, err);
  }
}

/**
 * Schreibt atomar und dauerhaft: erst in eine Nebendatei, die auf die Platte
 * durchgereicht wird, dann umbenennen. Ein Absturz oder ein gestopptes Add-on
 * mitten im Schreiben lässt damit immer die alte, vollständige Datei zurück –
 * nie eine halbe.
 */
export async function saveJsonFile(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  const inhalt = JSON.stringify(data, null, 2);

  const datei = await fs.open(tmpPath, 'w');
  try {
    await datei.writeFile(inhalt, 'utf-8');
    // Ohne fsync liegt der Inhalt nur im Cache des Betriebssystems und wäre bei
    // einem Stromausfall trotz erfolgreichem rename weg.
    await datei.sync();
  } finally {
    await datei.close();
  }

  await fs.rename(tmpPath, filePath);

  // Auch das Verzeichnis muss durchgereicht werden, damit der neue Name hält.
  try {
    const verzeichnis = await fs.open(path.dirname(filePath), 'r');
    try {
      await verzeichnis.sync();
    } finally {
      await verzeichnis.close();
    }
  } catch {
    // Auf manchen Dateisystemen (u.a. Windows) lässt sich ein Verzeichnis nicht
    // öffnen. Der rename ist dort trotzdem atomar – kein Grund abzubrechen.
  }
}
