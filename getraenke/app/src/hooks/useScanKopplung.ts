import { useCallback, useEffect, useRef, useState } from 'react';
import { starteScanSitzung, warteAufScans, beendeScanSitzung } from '../services/api';

/**
 * Kopplung „Handy scannt, dieses Gerät bucht".
 *
 * Der Hook hängt bewusst an der Getränke-Seite und nicht am Scan-Tab: Ein
 * Wechsel auf „Bestand" hängt den Tab aus, die Kopplung soll aber weiterlaufen
 * und Codes weiter verbuchen.
 *
 * Zusätzlich liegt der Stand in der sessionStorage, damit ein Reload die
 * Kopplung nicht zerreisst. Mitgespeichert wird, bis zu welchem Scan schon
 * gebucht wurde – sonst würden beim Wiederaufnehmen alle serverseitig noch
 * gepufferten Codes ein zweites Mal gebucht.
 */

const SPEICHER_SCHLUESSEL = 'getraenke.scanKopplung';

interface GemerkteKopplung {
  id: string;
  koppelCode: string;
  seit: number;
}

const laden = (): GemerkteKopplung | null => {
  try {
    const roh = sessionStorage.getItem(SPEICHER_SCHLUESSEL);
    if (!roh) return null;
    const wert = JSON.parse(roh) as Partial<GemerkteKopplung>;
    if (typeof wert.id === 'string' && typeof wert.koppelCode === 'string') {
      return { id: wert.id, koppelCode: wert.koppelCode, seit: typeof wert.seit === 'number' ? wert.seit : 0 };
    }
  } catch {
    /* defekter oder gesperrter Speicher – dann eben ohne */
  }
  return null;
};

const merken = (wert: GemerkteKopplung | null): void => {
  try {
    if (wert) sessionStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(wert));
    else sessionStorage.removeItem(SPEICHER_SCHLUESSEL);
  } catch {
    /* privater Modus o.ä. – dann gilt die Kopplung nur, solange die Seite offen ist */
  }
};

export interface ScanKopplung {
  sitzung: { id: string; koppelCode: string } | null;
  /** Hat sich schon ein Handy gemeldet? */
  gekoppelt: boolean;
  /** Die zuletzt empfangenen Codes, neueste zuerst. */
  empfangen: string[];
  fehler: string | null;
  starten: () => Promise<void>;
  beenden: () => Promise<void>;
  /** Einen lokal gescannten Code in dieselbe Warteschlange geben. */
  verarbeite: (code: string) => void;
}

export const useScanKopplung = (onCode: (code: string) => void | Promise<void>): ScanKopplung => {
  const [sitzung, setSitzung] = useState<{ id: string; koppelCode: string } | null>(() => {
    const gemerkt = laden();
    return gemerkt ? { id: gemerkt.id, koppelCode: gemerkt.koppelCode } : null;
  });
  const [gekoppelt, setGekoppelt] = useState(false);
  const [empfangen, setEmpfangen] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  // --- Codes der Reihe nach abarbeiten ---
  //
  // Ein Handy scannt schneller, als hier gebucht wird. Die Warteschlange sorgt
  // dafür, dass kein Code verloren geht: Es läuft immer nur eine Buchung, die
  // nächste startet danach.

  const warteschlangeRef = useRef<string[]>([]);
  const laufendRef = useRef(false);
  const onCodeRef = useRef(onCode);
  useEffect(() => { onCodeRef.current = onCode; });

  const abarbeiten = useCallback(async () => {
    if (laufendRef.current) return;
    laufendRef.current = true;
    try {
      while (warteschlangeRef.current.length > 0) {
        const naechster = warteschlangeRef.current.shift();
        if (naechster) await onCodeRef.current(naechster);
      }
    } finally {
      laufendRef.current = false;
    }
  }, []);

  const verarbeite = useCallback((code: string) => {
    const c = code.trim();
    if (!c) return;
    warteschlangeRef.current.push(c);
    void abarbeiten();
  }, [abarbeiten]);

  // --- Auf Scans des Handys warten (Long-Poll) ---

  useEffect(() => {
    if (!sitzung) return;

    const controller = new AbortController();
    let aktiv = true;

    // Nach Reload oder Tab-Wechsel dort weitermachen, wo aufgehört wurde.
    const gemerkt = laden();
    let seit = gemerkt?.id === sitzung.id ? gemerkt.seit : 0;

    const schleife = async () => {
      while (aktiv) {
        try {
          const ergebnis = await warteAufScans(sitzung.id, seit, controller.signal);
          if (!aktiv) return;

          if (!ergebnis.aktiv) {
            merken(null);
            setSitzung(null);
            setGekoppelt(false);
            setFehler('Die Kopplung ist abgelaufen. Bitte neu starten.');
            return;
          }

          setGekoppelt(ergebnis.gekoppelt);

          if (ergebnis.ereignisse.length > 0) {
            const codes = ergebnis.ereignisse.map(e => e.code);
            for (const code of codes) verarbeite(code);
            setEmpfangen(prev => [...codes.slice().reverse(), ...prev].slice(0, 10));
          }

          // Erst vormerken, nachdem die Codes in der Warteschlange stehen.
          seit = ergebnis.letzteId;
          merken({ id: sitzung.id, koppelCode: sitzung.koppelCode, seit });
        } catch {
          if (!aktiv) return;
          // Kurz warten, damit ein Serverfehler keine Dauerschleife auslöst.
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    };

    void schleife();
    return () => { aktiv = false; controller.abort(); };
  }, [sitzung, verarbeite]);

  const starten = useCallback(async () => {
    setFehler(null);
    setEmpfangen([]);
    setGekoppelt(false);
    try {
      const neu = await starteScanSitzung();
      merken({ ...neu, seit: 0 });
      setSitzung(neu);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Kopplung konnte nicht gestartet werden.');
    }
  }, []);

  const beenden = useCallback(async () => {
    const offen = sitzung;
    merken(null);
    setSitzung(null);
    setGekoppelt(false);
    setEmpfangen([]);
    if (!offen) return;
    try {
      await beendeScanSitzung(offen.id);
    } catch {
      /* Läuft sie serverseitig weiter, verfällt sie von selbst. */
    }
  }, [sitzung]);

  return { sitzung, gekoppelt, empfangen, fehler, starten, beenden, verarbeite };
};
