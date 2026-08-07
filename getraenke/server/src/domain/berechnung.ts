import type { Sorte, Bestand, Buchung } from '../types/getraenke';

/**
 * Die Rechenregeln der Getränkekasse – bewusst als reine Funktionen ohne
 * Dateizugriff, damit sie sich einzeln prüfen lassen. Die Routen bereiten nur
 * noch die Daten auf und reichen sie hier durch.
 */

export const SORTE_VORGABEN = {
  warnschwelle: 2,
  sollBestand: 4,
  einkaufspreis: 0,
  verkaufspreis: 0,
} as const;

/** Zählt eine Buchung für Bestand, Statistik und Kasse? Stornierte nicht. */
export const istWirksam = (b: Buchung): boolean => b.storniert !== true;

/**
 * Bestellempfehlung in Kästen: was zum Soll-Bestand fehlt, aufgerundet.
 * Soll-Bestand 0 heisst „nie nachbestellen".
 */
export function empfohleneBestellung(sorte: Sorte, lagerFlaschen: number): number {
  const soll = sorte.sollBestand ?? SORTE_VORGABEN.sollBestand;
  if (soll <= 0) return 0;

  const proKasten = sorte.flaschenProKasten > 0 ? sorte.flaschenProKasten : 1;
  const vorhandeneKaesten = lagerFlaschen / proKasten;
  return Math.max(0, Math.ceil(soll - vorhandeneKaesten));
}

export function unterWarnschwelle(sorte: Sorte, lagerFlaschen: number): boolean {
  const proKasten = sorte.flaschenProKasten > 0 ? sorte.flaschenProKasten : 1;
  return lagerFlaschen / proKasten < (sorte.warnschwelle ?? SORTE_VORGABEN.warnschwelle);
}

export interface VerbrauchsMonat {
  monat: string;
  eingang: number;
  ausgang: number;
}

/**
 * Verbrauch je Monat in Kästen. Schwund zählt als Abgang – die Kästen sind
 * schliesslich aus dem Lager verschwunden. Inventurkorrekturen bleiben aussen
 * vor: sie verschieben keinen Verbrauch, sie berichtigen nur den Stand.
 */
export function verbrauchProMonat(buchungen: Buchung[]): VerbrauchsMonat[] {
  const proMonat = new Map<string, { eingang: number; ausgang: number }>();

  for (const b of buchungen) {
    if (!istWirksam(b)) continue;
    if (b.typ === 'inventur') continue;

    const monat = b.datum.slice(0, 7);
    const eintrag = proMonat.get(monat) ?? { eingang: 0, ausgang: 0 };

    if (b.typ === 'eingang') eintrag.eingang += b.menge;
    else if (b.typ === 'ausgang' || b.typ === 'schwund') eintrag.ausgang += b.menge;

    proMonat.set(monat, eintrag);
  }

  return [...proMonat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monat, werte]) => ({ monat, ...werte }));
}

export interface KassenMonat {
  monat: string;
  einnahmen: number;
  ausgaben: number;
  schwund: number;
  gewinn: number;
}

const runde = (wert: number): number => Math.round(wert * 100) / 100;

/**
 * Einnahmen, Ausgaben und entgangener Wert je Monat.
 *
 * Beide Preise werden **historisch** gelesen: der auf der Buchung gespeicherte
 * gilt, der aktuelle Sortenpreis dient nur als Rückfallebene für Buchungen aus
 * der Zeit davor. Sonst würde eine Preiserhöhung heute die Zahlen aller
 * vergangenen Monate verändern.
 */
export function kassenbericht(buchungen: Buchung[], sorten: Sorte[]): {
  monate: KassenMonat[];
  gesamtEinnahmen: number;
  gesamtAusgaben: number;
  gesamtSchwund: number;
  gesamtGewinn: number;
} {
  const proSorte = new Map(sorten.map(s => [s.id, s]));
  const proMonat = new Map<string, { einnahmen: number; ausgaben: number; schwund: number }>();

  for (const b of buchungen) {
    if (!istWirksam(b)) continue;

    const sorte = proSorte.get(b.sorteId);
    if (!sorte) continue;

    const monat = b.datum.slice(0, 7);
    const eintrag = proMonat.get(monat) ?? { einnahmen: 0, ausgaben: 0, schwund: 0 };

    if (b.typ === 'eingang') {
      const preis = b.einkaufspreis ?? sorte.einkaufspreis ?? 0;
      eintrag.ausgaben += b.menge * preis;
    } else if (b.typ === 'ausgang') {
      const preis = b.verkaufspreis ?? sorte.verkaufspreis ?? 0;
      eintrag.einnahmen += b.menge * sorte.flaschenProKasten * preis;
    } else if (b.typ === 'schwund') {
      // Kein Geld geflossen – aber der Wert fehlt in der Kasse und gehört sichtbar.
      const preis = b.verkaufspreis ?? sorte.verkaufspreis ?? 0;
      eintrag.schwund += b.menge * sorte.flaschenProKasten * preis;
    }

    proMonat.set(monat, eintrag);
  }

  const monate = [...proMonat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monat, w]) => ({
      monat,
      einnahmen: runde(w.einnahmen),
      ausgaben: runde(w.ausgaben),
      schwund: runde(w.schwund),
      gewinn: runde(w.einnahmen - w.ausgaben),
    }));

  return {
    monate,
    gesamtEinnahmen: runde(monate.reduce((s, m) => s + m.einnahmen, 0)),
    gesamtAusgaben: runde(monate.reduce((s, m) => s + m.ausgaben, 0)),
    gesamtSchwund: runde(monate.reduce((s, m) => s + m.schwund, 0)),
    gesamtGewinn: runde(monate.reduce((s, m) => s + m.gewinn, 0)),
  };
}

/**
 * Wie sich eine Buchung auf den Lagerbestand auswirkt, in Flaschen.
 * Positiv heisst mehr im Lager.
 */
export function bestandsAenderung(buchung: Buchung, sorte: Sorte): number {
  switch (buchung.typ) {
    case 'eingang':
      return buchung.menge * sorte.flaschenProKasten;
    case 'ausgang':
    case 'schwund':
      return -buchung.menge * sorte.flaschenProKasten;
    case 'inventur':
      // Bei der Inventur steht in menge bereits die Differenz in Flaschen.
      return buchung.menge;
    default:
      return 0;
  }
}

/** Lagerstand einer Sorte, aus dem Bestand gelesen. */
export const lagerVon = (bestand: Bestand[], sorteId: number): number =>
  bestand.find(b => b.sorteId === sorteId)?.lager ?? 0;
