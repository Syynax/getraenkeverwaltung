import type { Sorte, Bestand, Buchung, Oberkategorie } from '../types/getraenke';

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

/** Kästen einer Sorte aus dem Flaschenbestand. */
export const kaesten = (sorte: Sorte, lagerFlaschen: number): number =>
  lagerFlaschen / (sorte.flaschenProKasten > 0 ? sorte.flaschenProKasten : 1);

export interface SortenBedarf {
  sorte: Sorte;
  aktuellerBestand: number;
  empfohleneBestellung: number;
}

export interface GruppenBedarf {
  oberkategorie: Oberkategorie;
  /** Die Sorten der Gruppe, die auf den Gruppen-Soll einzahlen. */
  sorten: Sorte[];
  aktuellerBestand: number;
  empfohleneBestellung: number;
}

/**
 * Was nachbestellt werden sollte – getrennt nach eigenständigen Sorten und
 * Gruppen.
 *
 * Die Aufteilung folgt einer Regel: Eine Sorte mit eigenem Soll-Bestand wird
 * einzeln geführt, wie bisher. Eine Sorte **ohne** eigenen Soll-Bestand, die
 * einer Oberkategorie angehört, zahlt auf deren Soll ein. Genau das braucht
 * man für Probierbiere: Sie sollen keine eigene Nachbestellung auslösen, aber
 * mitzählen, wenn es darum geht, ob genug Bier da ist.
 *
 * Eine Sorte ohne eigenen Soll und ohne Gruppe löst gar nichts aus.
 */
export function ermittleBedarf(
  sorten: Sorte[],
  lagerJeSorte: (sorteId: number) => number,
  oberkategorien: Oberkategorie[],
): { sorten: SortenBedarf[]; gruppen: GruppenBedarf[] } {
  const aktiveSorten = sorten.filter(s => s.aktiv);
  const gruppenNachId = new Map(oberkategorien.filter(g => g.aktiv).map(g => [g.id, g]));

  const einzeln: SortenBedarf[] = [];
  const gruppenInhalt = new Map<number, Sorte[]>();

  for (const sorte of aktiveSorten) {
    const eigenerSoll = sorte.sollBestand ?? SORTE_VORGABEN.sollBestand;
    const gruppe = sorte.oberkategorieId != null ? gruppenNachId.get(sorte.oberkategorieId) : undefined;

    if (eigenerSoll > 0) {
      const lager = lagerJeSorte(sorte.id);
      const empfehlung = empfohleneBestellung(sorte, lager);
      if (empfehlung > 0) {
        einzeln.push({ sorte, aktuellerBestand: kaesten(sorte, lager), empfohleneBestellung: empfehlung });
      }
      continue;
    }

    // Kein eigener Soll: zahlt auf die Gruppe ein, sofern es eine gibt.
    if (gruppe) {
      const bisher = gruppenInhalt.get(gruppe.id) ?? [];
      bisher.push(sorte);
      gruppenInhalt.set(gruppe.id, bisher);
    }
  }

  const gruppen: GruppenBedarf[] = [];
  for (const [gruppenId, gruppenSorten] of gruppenInhalt) {
    const gruppe = gruppenNachId.get(gruppenId);
    if (!gruppe || gruppe.sollBestand <= 0) continue;

    const bestandKaesten = gruppenSorten.reduce(
      (summe, s) => summe + kaesten(s, lagerJeSorte(s.id)),
      0,
    );
    const empfehlung = Math.max(0, Math.ceil(gruppe.sollBestand - bestandKaesten));
    if (empfehlung > 0) {
      gruppen.push({
        oberkategorie: gruppe,
        sorten: gruppenSorten,
        aktuellerBestand: bestandKaesten,
        empfohleneBestellung: empfehlung,
      });
    }
  }

  return {
    sorten: einzeln,
    gruppen: gruppen.sort((a, b) => a.oberkategorie.name.localeCompare(b.oberkategorie.name, 'de')),
  };
}

/** Bestand einer Gruppe in Kästen, über alle zugehörigen Sorten. */
export function gruppenBestand(
  gruppenId: number,
  sorten: Sorte[],
  lagerJeSorte: (sorteId: number) => number,
): number {
  return sorten
    .filter(s => s.aktiv && s.oberkategorieId === gruppenId)
    .reduce((summe, s) => summe + kaesten(s, lagerJeSorte(s.id)), 0);
}

/**
 * Der Teil des Gruppenbestands, der auf den Gruppen-Soll zählt: nur Sorten ohne
 * eigenen Soll-Bestand.
 *
 * Das weicht bewusst von `gruppenBestand` ab. Eine Sorte mit eigenem Soll wird
 * schon einzeln nachbestellt; zählte sie auch auf die Gruppe, käme sie doppelt
 * in den Einkauf. Für die reine Anzeige „wie viel Bier steht da" ist dagegen
 * der Gesamtbestand die richtige Zahl – deshalb gibt es beide.
 */
export function gruppenBestandFuerSoll(
  gruppenId: number,
  sorten: Sorte[],
  lagerJeSorte: (sorteId: number) => number,
): number {
  return sorten
    .filter(s => s.aktiv
      && s.oberkategorieId === gruppenId
      && (s.sollBestand ?? SORTE_VORGABEN.sollBestand) <= 0)
    .reduce((summe, s) => summe + kaesten(s, lagerJeSorte(s.id)), 0);
}

/** Liegt eine Gruppe unter ihrer Warnschwelle? */
export function gruppeUnterWarnschwelle(
  gruppe: Oberkategorie,
  sorten: Sorte[],
  lagerJeSorte: (sorteId: number) => number,
): boolean {
  if (gruppe.warnschwelle <= 0) return false;
  return gruppenBestand(gruppe.id, sorten, lagerJeSorte) < gruppe.warnschwelle;
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
