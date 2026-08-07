import { KATEGORIEN, BUCHUNGS_TYPEN, BUCHUNGS_STANDORTE, EVENT_STATI, EVENT_POSITION_TYPEN } from '../constants/getraenke';

export type Kategorie = (typeof KATEGORIEN)[number];
export type BuchungsTyp = (typeof BUCHUNGS_TYPEN)[number];
export type BuchungsStandort = (typeof BUCHUNGS_STANDORTE)[number];
export type EventStatus = (typeof EVENT_STATI)[number];
export type EventPositionTyp = (typeof EVENT_POSITION_TYPEN)[number];

export interface Sorte {
  id: number;
  name: string;
  kategorie: Kategorie;
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
}
