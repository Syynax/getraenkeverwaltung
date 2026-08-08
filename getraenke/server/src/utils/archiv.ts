import fs from 'fs/promises';
import path from 'path';
import type { Buchung, GetraenkeData } from '../types/getraenke';
import { withFileLock, loadJsonFile, saveJsonFile } from './fileStore';

/**
 * Buchungsarchiv.
 *
 * Die Buchungen wachsen für immer, und jede einzelne Buchung schreibt die
 * komplette Datei neu. Nach ein paar Jahren hiesse das: bei jedem Klick auf
 * „+1 Kasten" werden zehntausende Altzeilen erneut serialisiert und auf die
 * SD-Karte geschrieben.
 *
 * Deshalb wandern abgeschlossene Jahre nach `/data/archiv/buchungen-JJJJ.json`.
 * Die Trennung ist überschneidungsfrei: Eine Buchung liegt entweder im Archiv
 * oder in der laufenden Datei, nie in beiden. Sonst würde der Kassenbericht
 * doppelt zählen.
 *
 * Verlauf, Statistik und Kassenbericht lesen das Archiv bei Bedarf dazu – für
 * die Auswertung ändert sich also nichts.
 */

const ORDNER = 'archiv';
const PRAEFIX = 'buchungen-';

export function archivOrdner(datenDatei: string): string {
  return path.join(path.dirname(datenDatei), ORDNER);
}

const archivDatei = (datenDatei: string, jahr: number): string =>
  path.join(archivOrdner(datenDatei), `${PRAEFIX}${jahr}.json`);

/** Jahr einer Buchung, oder null wenn das Datum unbrauchbar ist. */
export function jahrVon(buchung: Buchung): number | null {
  const jahr = Number(String(buchung.datum ?? '').slice(0, 4));
  return Number.isInteger(jahr) && jahr > 1970 && jahr < 3000 ? jahr : null;
}

/**
 * Verschiebt alle Buchungen abgeschlossener Jahre ins Archiv.
 *
 * `aktuellesJahr` kommt von aussen, damit sich das Verhalten prüfen lässt,
 * ohne die Uhr zu stellen. Buchungen ohne brauchbares Datum bleiben liegen –
 * lieber eine Zeile zu viel in der laufenden Datei als eine verlorene.
 */
export async function archiviereAbgeschlosseneJahre(
  datenDatei: string,
  aktuellesJahr: number,
): Promise<{ jahre: number[]; verschoben: number }> {
  return withFileLock(datenDatei, async () => {
    const daten = await loadJsonFile<GetraenkeData | null>(datenDatei, null);
    if (!daten || !Array.isArray(daten.buchungen)) return { jahre: [], verschoben: 0 };

    const nachJahr = new Map<number, Buchung[]>();
    const bleiben: Buchung[] = [];

    for (const buchung of daten.buchungen) {
      const jahr = jahrVon(buchung);
      if (jahr === null || jahr >= aktuellesJahr) {
        bleiben.push(buchung);
        continue;
      }
      const bisher = nachJahr.get(jahr) ?? [];
      bisher.push(buchung);
      nachJahr.set(jahr, bisher);
    }

    if (nachJahr.size === 0) return { jahre: [], verschoben: 0 };

    await fs.mkdir(archivOrdner(datenDatei), { recursive: true });

    let verschoben = 0;
    for (const [jahr, buchungen] of [...nachJahr.entries()].sort(([a], [b]) => a - b)) {
      const ziel = archivDatei(datenDatei, jahr);
      const vorhanden = await loadJsonFile<Buchung[]>(ziel, []);

      // Nach Id zusammenführen: Ein abgebrochener Lauf darf beim nächsten Start
      // keine Dubletten erzeugen.
      const zusammen = new Map<number, Buchung>();
      for (const b of vorhanden) zusammen.set(b.id, b);
      for (const b of buchungen) zusammen.set(b.id, b);

      await saveJsonFile(ziel, [...zusammen.values()].sort((a, b) => a.id - b.id));
      verschoben += buchungen.length;
    }

    // Erst nachdem alle Archivdateien sicher geschrieben sind, wird gekürzt.
    daten.buchungen = bleiben;
    await saveJsonFile(datenDatei, daten);

    return { jahre: [...nachJahr.keys()].sort((a, b) => a - b), verschoben };
  });
}

/** Alle archivierten Buchungen, aufsteigend nach Id. */
export async function ladeArchivBuchungen(datenDatei: string): Promise<Buchung[]> {
  const ordner = archivOrdner(datenDatei);

  let dateien: string[];
  try {
    dateien = (await fs.readdir(ordner)).filter(n => n.startsWith(PRAEFIX) && n.endsWith('.json')).sort();
  } catch {
    return [];
  }

  const alle: Buchung[] = [];
  for (const name of dateien) {
    // loadJsonFile hält den geparsten Stand vor – wiederholte Aufrufe von
    // Statistik und Kassenbericht kosten deshalb nur je einen stat-Aufruf.
    const buchungen = await loadJsonFile<Buchung[]>(path.join(ordner, name), []);
    if (Array.isArray(buchungen)) alle.push(...buchungen);
  }

  return alle.sort((a, b) => a.id - b.id);
}

/** Archiv und laufende Buchungen zusammen – die Sicht für jede Auswertung. */
export async function ladeAlleBuchungen(datenDatei: string, laufende: Buchung[]): Promise<Buchung[]> {
  const archiv = await ladeArchivBuchungen(datenDatei);
  if (archiv.length === 0) return laufende;
  return [...archiv, ...laufende];
}

/**
 * Leert das Archiv.
 *
 * Pflicht beim Import: Der Import ersetzt den gesamten Datenbestand, und eine
 * Sicherung enthält immer **alle** Buchungen – auch die einst archivierten.
 * Bliebe das alte Archiv liegen, zählten Kassenbericht und Statistik jede
 * archivierte Buchung doppelt.
 */
export async function leereArchiv(datenDatei: string): Promise<number> {
  const ordner = archivOrdner(datenDatei);

  let dateien: string[];
  try {
    dateien = (await fs.readdir(ordner)).filter(n => n.startsWith(PRAEFIX) && n.endsWith('.json'));
  } catch {
    return 0;
  }

  let geloescht = 0;
  for (const name of dateien) {
    try {
      await fs.unlink(path.join(ordner, name));
      geloescht++;
    } catch {
      /* schon weg – dann ist das Ziel ohnehin erreicht */
    }
  }
  return geloescht;
}

/** Liegt diese Id im Archiv? Für verständliche Fehlermeldungen beim Storno. */
export async function findeImArchiv(datenDatei: string, id: number): Promise<Buchung | null> {
  const archiv = await ladeArchivBuchungen(datenDatei);
  return archiv.find(b => b.id === id) ?? null;
}

/**
 * Höchste jemals vergebene Id, auch über archivierte Buchungen hinweg.
 * Ohne das würde eine neue Buchung eine Id wiederverwenden, sobald das
 * Archiv die alten Zeilen aufgenommen hat.
 */
export async function hoechsteBuchungsId(datenDatei: string, laufende: Buchung[]): Promise<number> {
  const archiv = await ladeArchivBuchungen(datenDatei);
  let hoechste = 0;
  for (const b of archiv) if (b.id > hoechste) hoechste = b.id;
  for (const b of laufende) if (b.id > hoechste) hoechste = b.id;
  return hoechste;
}
