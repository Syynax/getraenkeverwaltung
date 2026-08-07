import { withFileLock, loadJsonFile, saveJsonFile } from './fileStore';

/**
 * Einmalige Umstellung auf "nur noch Lager".
 *
 * Die Automaten sind weg. Diese Migration entfernt die zugehörigen Felder aus
 * der Datei, damit kein toter Ballast mitgeschleppt wird:
 *
 * - `Sorte.automat` und `Sorte.automatKapazitaet` fallen weg
 * - `Bestand.automat` fällt weg; noch enthaltene Flaschen wandern ins Lager,
 *   damit auch bei nicht ganz leeren Automaten nichts verschwindet
 * - Buchungen bleiben unverändert. Alte `auffuellung`-Einträge und der
 *   Standort `automat` gehören zur Historie und werden weiter angezeigt.
 *
 * Vorher wird gesichert – dieselbe Namensform wie beim Import, damit im
 * Zweifel der alte Stand zurückgeholt werden kann.
 */

interface AltSorte extends Record<string, unknown> {
  automat?: unknown;
  automatKapazitaet?: unknown;
}

interface AltBestand extends Record<string, unknown> {
  lager?: unknown;
  automat?: unknown;
}

export interface AltDaten {
  sorten?: AltSorte[];
  bestand?: AltBestand[];
  [key: string]: unknown;
}

const zahl = (wert: unknown): number => (typeof wert === 'number' && Number.isFinite(wert) ? wert : 0);

/** Trägt eine Datei noch Automaten-Felder? */
export function hatAutomatFelder(daten: AltDaten): boolean {
  const sorten = Array.isArray(daten.sorten) ? daten.sorten : [];
  const bestand = Array.isArray(daten.bestand) ? daten.bestand : [];
  return sorten.some(s => 'automat' in s || 'automatKapazitaet' in s) || bestand.some(b => 'automat' in b);
}

/**
 * Entfernt die Automaten-Felder aus einem Datensatz. Rein und ohne Dateizugriff,
 * damit derselbe Code auch beim Import einer alten Sicherung greift.
 */
export function entferneAutomatFelder(daten: AltDaten): AltDaten {
  const sorten = Array.isArray(daten.sorten) ? daten.sorten : [];
  const bestand = Array.isArray(daten.bestand) ? daten.bestand : [];

  return {
    ...daten,
    sorten: sorten.map(sorte => {
      const { automat: _automat, automatKapazitaet: _kapazitaet, ...rest } = sorte;
      return rest;
    }),
    bestand: bestand.map(eintrag => {
      const { automat, ...rest } = eintrag;
      return { ...rest, lager: zahl(rest.lager) + zahl(automat) };
    }),
  };
}

export async function migriereAutomatWeg(datei: string): Promise<void> {
  await withFileLock(datei, async () => {
    const daten = await loadJsonFile<AltDaten | null>(datei, null);
    if (!daten) return;

    const sorten = Array.isArray(daten.sorten) ? daten.sorten : [];
    const bestand = Array.isArray(daten.bestand) ? daten.bestand : [];

    if (!hatAutomatFelder(daten)) return;

    const betroffeneSorten = sorten.filter(s => 'automat' in s || 'automatKapazitaet' in s);
    const betroffenerBestand = bestand.filter(b => 'automat' in b);

    const verschobeneFlaschen = betroffenerBestand.reduce((summe, b) => summe + zahl(b.automat), 0);

    const backup = `${datei}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await saveJsonFile(backup, daten);
    await saveJsonFile(datei, entferneAutomatFelder(daten));

    console.log(
      `↻ Automaten entfernt: ${betroffeneSorten.length} Sorten, ${betroffenerBestand.length} Bestände` +
      (verschobeneFlaschen > 0 ? `, ${verschobeneFlaschen} Flaschen ins Lager übernommen` : '') +
      `. Sicherung: ${backup}`,
    );
  });
}
