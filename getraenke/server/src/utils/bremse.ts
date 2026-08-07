import type { Request } from 'express';

/**
 * Einfache Zähler-Bremse gegen Raten von Codes und Passwörtern.
 *
 * Bewusst nur im Arbeitsspeicher und ohne zusätzliche Abhängigkeit: Das Add-on
 * bedient eine Feuerwehr, keine Öffentlichkeit – es geht darum, das Durchprobieren
 * von sechsstelligen Codes unattraktiv zu machen, nicht um Schutz vor einem Botnetz.
 * Ein Neustart setzt alle Zähler zurück, das ist hier verkraftbar.
 */

export interface Bremse {
  /** Restliche Sperrzeit in Sekunden, 0 wenn frei. */
  sperre(req: Request): number;
  fehlschlag(req: Request): void;
  zuruecksetzen(req: Request): void;
}

export function erzeugeBremse(maxVersuche: number, sperreMs: number): Bremse {
  const versuche = new Map<string, { anzahl: number; letzter: number }>();

  const schluessel = (req: Request): string => req.ip || 'unbekannt';

  return {
    sperre(req) {
      const key = schluessel(req);
      const eintrag = versuche.get(key);
      if (!eintrag || eintrag.anzahl < maxVersuche) return 0;

      const rest = eintrag.letzter + sperreMs - Date.now();
      if (rest <= 0) {
        versuche.delete(key);
        return 0;
      }
      return Math.ceil(rest / 1000);
    },

    fehlschlag(req) {
      const key = schluessel(req);
      const jetzt = Date.now();
      const eintrag = versuche.get(key);

      // Alte Einträge aufräumen, damit die Map nicht unbegrenzt wächst.
      for (const [k, v] of versuche) {
        if (jetzt - v.letzter > sperreMs) versuche.delete(k);
      }

      if (!eintrag || jetzt - eintrag.letzter > sperreMs) {
        versuche.set(key, { anzahl: 1, letzter: jetzt });
      } else {
        versuche.set(key, { anzahl: eintrag.anzahl + 1, letzter: jetzt });
      }
    },

    zuruecksetzen(req) {
      versuche.delete(schluessel(req));
    },
  };
}

/** Formuliert die Wartezeit für eine Fehlermeldung. */
export function sperrText(sekunden: number): string {
  const minuten = Math.ceil(sekunden / 60);
  return `${minuten} Minute${minuten === 1 ? '' : 'n'}`;
}
