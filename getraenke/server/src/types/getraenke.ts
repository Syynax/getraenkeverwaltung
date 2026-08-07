import { KATEGORIEN, BUCHUNGS_TYPEN, BUCHUNGS_STANDORTE, EVENT_STATI, EVENT_POSITION_TYPEN } from '../constants/getraenke';

export type Kategorie = (typeof KATEGORIEN)[number];
export type BuchungsTyp = (typeof BUCHUNGS_TYPEN)[number];
export type BuchungsStandort = (typeof BUCHUNGS_STANDORTE)[number];
export type EventStatus = (typeof EVENT_STATI)[number];
export type EventPositionTyp = (typeof EVENT_POSITION_TYPEN)[number];

/**
 * Klammer über mehrere Marken, z.B. „Bier" über Augustiner, Tegernseer und was
 * gerade zum Probieren dasteht.
 *
 * Der Sinn steckt im Soll-Bestand: Es soll nicht jede einmalig gekaufte Marke
 * eine eigene Nachbestellung auslösen, sondern die Gruppe als Ganzes muss
 * gefüllt bleiben – welche Marke das ist, entscheidet sich beim Einkauf.
 */
export interface Oberkategorie {
  id: number;
  name: string;
  /** Soll-Bestand in Kästen über alle Sorten der Gruppe zusammen. 0 = kein Bedarf. */
  sollBestand: number;
  /** Warnschwelle in Kästen für die Gruppe. */
  warnschwelle: number;
  aktiv: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Sorte {
  id: number;
  name: string;
  kategorie: Kategorie;
  /** Zugehörige Oberkategorie, oder null für eine eigenständige Sorte. */
  oberkategorieId?: number | null;
  flaschenProKasten: number;
  warnschwelle: number;
  einkaufspreis: number;
  verkaufspreis: number;
  sollBestand: number;
  /** Hinterlegte Flaschen-Barcodes (EAN). Zum Einlagern per Scan. */
  barcodes?: string[];
  aktiv: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Bestand {
  sorteId: number;
  lager: number;
}

export interface Buchung {
  id: number;
  sorteId: number;
  datum: string;
  typ: BuchungsTyp;
  menge: number;
  standort: BuchungsStandort;
  notiz: string | null;
  /** Einkaufspreis €/Kasten zum Zeitpunkt des Eingangs (nur bei typ 'eingang').
   *  Macht den Kassenbericht bei schwankenden Preisen historisch korrekt. */
  einkaufspreis?: number;
  /** Verkaufspreis €/Flasche zum Zeitpunkt des Abgangs (bei 'ausgang' und
   *  'schwund'). Ohne ihn würde eine spätere Preiserhöhung die Einnahmen
   *  vergangener Monate rückwirkend verändern. */
  verkaufspreis?: number;
  /** Wer gebucht hat – nur gesetzt, wenn eine Anmeldung aktiv ist. */
  benutzer?: string;
  /** Storniert: bleibt im Verlauf stehen, zählt aber nirgends mehr mit. */
  storniert?: boolean;
  storniertAm?: string;
  storniertVon?: string;
}

export interface EventPosition {
  id: number;
  typ: EventPositionTyp;
  sorteId: number | null;
  artikelName: string;
  menge: number;
  einheit: string;
}

export interface BesonderesEvent {
  id: number;
  name: string;
  datum: string;
  status: EventStatus;
  notiz: string | null;
  items: EventPosition[];
  createdAt?: string;
  updatedAt?: string;
}

export interface GetraenkeData {
  sorten: Sorte[];
  bestand: Bestand[];
  buchungen: Buchung[];
  events: BesonderesEvent[];
  /** Optional: Datenbestände von vor 1.6.0 haben das Feld noch nicht. */
  oberkategorien: Oberkategorie[];
}
