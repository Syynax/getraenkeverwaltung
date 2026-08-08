import { KATEGORIEN, BUCHUNGS_TYPEN, BUCHUNGS_STANDORTE, EVENT_STATI, EVENT_POSITION_TYPEN } from '../constants/getraenke';

export type Kategorie = (typeof KATEGORIEN)[number];
export type BuchungsTyp = (typeof BUCHUNGS_TYPEN)[number];
export type BuchungsStandort = (typeof BUCHUNGS_STANDORTE)[number];
export type EventStatus = (typeof EVENT_STATI)[number];
export type EventPositionTyp = (typeof EVENT_POSITION_TYPEN)[number];

/**
 * Klammer über mehrere Marken, z.B. „Bier" über Augustiner, Tegernseer und was
 * gerade zum Probieren dasteht. Der Soll-Bestand gilt für die Gruppe als
 * Ganzes – so löst nicht jede einmalig gekaufte Marke eine Nachbestellung aus.
 */
export interface Oberkategorie {
  id: number;
  name: string;
  sollBestand: number;
  warnschwelle: number;
  aktiv: boolean;
}

/** Oberkategorie samt errechnetem Bestand, wie sie die API liefert. */
export interface OberkategorieMitBestand extends Oberkategorie {
  sortenAnzahl: number;
  /** Alles, was in der Gruppe steht – die Zahl fürs Regal. */
  aktuellerBestand: number;
  /** Nur Sorten ohne eigenen Soll – daran misst sich der Bedarf der Gruppe. */
  bestandFuerSoll: number;
  unterWarnschwelle: boolean;
}

export interface OberkategorieFormData {
  name: string;
  sollBestand: number | '';
  warnschwelle: number | '';
}

export interface Sorte {
  id: number;
  name: string;
  kategorie: Kategorie;
  oberkategorieId?: number | null;
  flaschenProKasten: number;
  warnschwelle: number;
  einkaufspreis: number;
  verkaufspreis: number;
  sollBestand: number;
  /** Hinterlegte Flaschen-Barcodes (EAN) zum Einlagern per Scan. */
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
  /** Einkaufspreis €/Kasten zum Zeitpunkt des Eingangs (nur bei typ 'eingang'). */
  einkaufspreis?: number;
  /** Verkaufspreis €/Flasche zum Zeitpunkt des Abgangs – hält den Kassenbericht
   *  bei späteren Preisänderungen historisch korrekt. */
  verkaufspreis?: number;
  /** Wer gebucht hat, sofern eine Anmeldung aktiv ist. */
  benutzer?: string;
  storniert?: boolean;
  storniertAm?: string;
  storniertVon?: string;
  /** Aus einem abgeschlossenen Jahr – nur lesbar, kein Storno mehr möglich. */
  archiviert?: boolean;
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

export interface BestandMitSorte extends Bestand {
  sorte: Sorte;
  gesamt: number;
  unterWarnschwelle: boolean;
  /** Oberkategorie der Sorte, oder null für eine eigenständige Sorte. */
  oberkategorieId: number | null;
  oberkategorieName: string | null;
}

/**
 * Pflicht sind nur Name, Kategorie und Gebindegrösse. Die übrigen Felder dürfen
 * leer bleiben – der Server setzt dann seine Vorgaben ein.
 */
export interface SorteFormData {
  name: string;
  kategorie: Kategorie;
  /** null = eigenständige Sorte ohne Oberkategorie. */
  oberkategorieId: number | null;
  flaschenProKasten: number;
  warnschwelle: number | '';
  einkaufspreis: number | '';
  verkaufspreis: number | '';
  sollBestand: number | '';
  barcodes?: string[];
}

export interface BuchungFormData {
  sorteId: number;
  typ: BuchungsTyp;
  menge: number;
  standort: BuchungsStandort;
  notiz?: string;
  /** Einkaufspreis €/Kasten (nur bei typ 'eingang'). */
  einkaufspreis?: number;
}

export interface EventPositionFormData {
  id: number;
  typ: EventPositionTyp;
  sorteId: number | null;
  artikelName: string;
  menge: number;
  einheit: string;
}

export interface BesonderesEventFormData {
  name: string;
  datum: string;
  status: EventStatus;
  notiz?: string;
  items: EventPositionFormData[];
}

export interface EinkaufslistenEintrag {
  sorte: Sorte;
  aktuellerBestand: number;
  empfohleneBestellung: number;
}

/** Bedarf einer ganzen Oberkategorie – welche Marke es wird, entscheidet der Einkauf. */
export interface GruppenBedarf {
  oberkategorie: Oberkategorie;
  sorten: Sorte[];
  aktuellerBestand: number;
  empfohleneBestellung: number;
}

export interface Einkaufsliste {
  sorten: EinkaufslistenEintrag[];
  gruppen: GruppenBedarf[];
}

export interface VerbrauchsMonat {
  monat: string;
  eingang: number;
  ausgang: number;
}

export interface VerbrauchsStatistik {
  gesamt: VerbrauchsMonat[];
  proSorte: Record<string, VerbrauchsMonat[]>;
}

export interface KassenberichtMonat {
  monat: string;
  einnahmen: number;
  ausgaben: number;
  /** Wert der Ware, die als Schwund abgeschrieben wurde. Kein Geldfluss. */
  schwund: number;
  gewinn: number;
}

export interface Kassenbericht {
  monate: KassenberichtMonat[];
  gesamtEinnahmen: number;
  gesamtAusgaben: number;
  gesamtSchwund: number;
  gesamtGewinn: number;
}

/** Eine Zeile der Inventurzählung. */
export interface InventurZeile {
  sorteId: number;
  flaschen: number;
}

export interface InventurAbweichung {
  sorteId: number;
  sorteName: string;
  vorher: number;
  gezaehlt: number;
  differenz: number;
}

export interface InventurErgebnis {
  abweichungen: InventurAbweichung[];
  gezaehlteSorten: number;
}

/** Kompletter Datenbestand – Format von /api/export und /api/import. */
export interface GetraenkeExport {
  sorten: Sorte[];
  bestand: Bestand[];
  buchungen: Buchung[];
  events: BesonderesEvent[];
}

/** Produkttreffer aus der öffentlichen Datenbank (Open Food Facts). */
export interface ProduktInfo {
  name: string;
  marke: string | null;
  menge: string | null;
  quelle: string;
}

/** Antwort von /api/getraenke/lookup/:code – reine Hilfestellung beim Zuordnen. */
export interface BarcodeLookup {
  code: string;
  /** Ist der Lookup in den Add-on-Optionen eingeschaltet? */
  aktiv: boolean;
  gefunden: boolean;
  produkt: ProduktInfo | null;
  /** Sorte, deren Name am besten zum Treffer passt. */
  vorschlagSorteId: number | null;
  fehler: string | null;
}

/** Kopplung „Handy scannt, anderes Gerät bucht". */
export interface ScanSitzung {
  id: string;
  /** Sechsstelliger Code, den das Empfängergerät anzeigt. */
  koppelCode: string;
}

export interface ScanEreignis {
  id: number;
  code: string;
  zeit: string;
}

/** Antwort des Long-Polls – kommt beim ersten Scan sofort zurück. */
export interface ScanWarteErgebnis {
  aktiv: boolean;
  gekoppelt: boolean;
  letzteId: number;
  ereignisse: ScanEreignis[];
}

/** Aus den Add-on-Optionen gesetzte Beschriftung. */
export interface AppConfig {
  titel: string;
  untertitel: string;
}

/** Antwort von /api/auth/status – steuert, ob die Anmeldemaske erscheint. */
export interface AuthStatus {
  anmeldungNoetig: boolean;
  angemeldet: boolean;
  benutzer: string | null;
  warnung: string | null;
}
