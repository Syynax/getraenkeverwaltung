export const KATEGORIEN = ['alkoholfrei', 'alkoholisch'] as const;

/**
 * Die Automaten sind weg – geführt wird nur noch das Lager.
 *
 * `auffuellung` und der Standort `automat` bleiben in den Typen stehen, weil
 * Buchungen aus der Automaten-Zeit im Verlauf erhalten bleiben. Neu anlegen
 * lässt sich beides nicht mehr; dafür gelten die _NEU-Listen.
 */
export const BUCHUNGS_TYPEN = ['eingang', 'ausgang', 'auffuellung'] as const;
export const BUCHUNGS_STANDORTE = ['lager', 'automat'] as const;

export const BUCHUNGS_TYPEN_NEU = ['eingang', 'ausgang'] as const;
export const BUCHUNGS_STANDORTE_NEU = ['lager'] as const;

export const EVENT_STATI = ['geplant', 'in-bearbeitung', 'eingekauft', 'erledigt', 'abgesagt'] as const;
export const EVENT_POSITION_TYPEN = ['sorte', 'frei'] as const;
