/**
 * Kurzlebige Scan-Kopplungen: Ein Handy scannt, ein anderes Gerät bucht.
 *
 * Alles liegt bewusst nur im Arbeitsspeicher – ein gescannter Code ist nach dem
 * Einbuchen wertlos, und ein Add-on-Neustart darf die Kopplung wegwerfen.
 *
 * Übertragen wird per Long-Polling: Der Empfänger stellt eine normale
 * GET-Anfrage, die bis zu WARTE_MS offen bleibt und beim ersten Scan sofort
 * beantwortet wird. Das fühlt sich an wie WebSockets, kommt aber ohne neue
 * Abhängigkeit aus, läuft unverändert durch den Home-Assistant-Ingress und
 * nutzt die bestehende Anmeldung per Authorization-Header.
 */
import { randomBytes, randomInt } from 'crypto';

/** Wie lange eine Kopplung ohne Aktivität lebt. */
const ABLAUF_MS = 30 * 60 * 1000;

/** So lange bleibt eine Warte-Anfrage offen, bevor sie leer zurückkommt. */
const WARTE_MS = 25_000;

/** Mehr als eine Handvoll gleichzeitiger Kopplungen ergibt hier keinen Sinn. */
const MAX_SITZUNGEN = 20;

/** Nur die letzten Scans vorhalten – der Empfänger holt sie sofort ab. */
const MAX_EREIGNISSE = 50;

export interface ScanEreignis {
  id: number;
  code: string;
  zeit: string;
}

export interface WarteErgebnis {
  /** Falsch, sobald die Kopplung beendet oder abgelaufen ist. */
  aktiv: boolean;
  /** Hat sich schon ein Handy gemeldet? */
  gekoppelt: boolean;
  letzteId: number;
  ereignisse: ScanEreignis[];
}

interface Warter {
  wecken: () => void;
}

interface Sitzung {
  id: string;
  koppelCode: string;
  ereignisse: ScanEreignis[];
  naechsteId: number;
  gekoppelt: boolean;
  gueltigBis: number;
  warter: Set<Warter>;
}

const sitzungen = new Map<string, Sitzung>();

function wecke(sitzung: Sitzung): void {
  for (const warter of sitzung.warter) warter.wecken();
  sitzung.warter.clear();
}

/** Abgelaufene Kopplungen entfernen. Lazy statt per Intervall – kein Timer, der ewig läuft. */
function aufraeumen(): void {
  const jetzt = Date.now();
  for (const [id, sitzung] of sitzungen) {
    if (sitzung.gueltigBis < jetzt) {
      sitzungen.delete(id);
      wecke(sitzung);
    }
  }
}

/** Holt eine Kopplung und verlängert dabei ihre Lebensdauer. */
function hole(id: string): Sitzung | null {
  const sitzung = sitzungen.get(id);
  if (!sitzung) return null;
  if (sitzung.gueltigBis < Date.now()) {
    sitzungen.delete(id);
    wecke(sitzung);
    return null;
  }
  sitzung.gueltigBis = Date.now() + ABLAUF_MS;
  return sitzung;
}

function freierKoppelCode(): string {
  // Kollisionen sind bei so wenigen Sitzungen unwahrscheinlich – geprüft wird
  // trotzdem, sonst landet ein Handy in der falschen Kopplung.
  for (let versuch = 0; versuch < 50; versuch++) {
    const code = String(randomInt(100000, 1000000));
    if (![...sitzungen.values()].some(s => s.koppelCode === code)) return code;
  }
  throw new Error('Kein freier Kopplungscode gefunden');
}

/** Startet eine Kopplung. Der Code wird auf dem Empfängergerät angezeigt. */
export function erzeugeSitzung(): { id: string; koppelCode: string } {
  aufraeumen();

  if (sitzungen.size >= MAX_SITZUNGEN) {
    throw Object.assign(
      new Error('Zu viele offene Kopplungen. Bitte zuerst eine bestehende beenden.'),
      { status: 429 },
    );
  }

  const sitzung: Sitzung = {
    id: randomBytes(16).toString('hex'),
    koppelCode: freierKoppelCode(),
    ereignisse: [],
    naechsteId: 1,
    gekoppelt: false,
    gueltigBis: Date.now() + ABLAUF_MS,
    warter: new Set(),
  };

  sitzungen.set(sitzung.id, sitzung);
  return { id: sitzung.id, koppelCode: sitzung.koppelCode };
}

/**
 * Handy koppelt sich über den angezeigten Code ein. Der Code bleibt für die
 * ganze Lebensdauer gültig – nach einem Reload am Handy klappt so das erneute
 * Verbinden, ohne dass am Laptop etwas passieren muss.
 */
export function koppele(koppelCode: string): { id: string } | null {
  aufraeumen();
  for (const sitzung of sitzungen.values()) {
    if (sitzung.koppelCode === koppelCode) {
      sitzung.gekoppelt = true;
      sitzung.gueltigBis = Date.now() + ABLAUF_MS;
      wecke(sitzung);
      return { id: sitzung.id };
    }
  }
  return null;
}

/** Handy meldet einen gescannten Barcode. */
export function scanMelden(id: string, code: string): ScanEreignis | null {
  const sitzung = hole(id);
  if (!sitzung) return null;

  const ereignis: ScanEreignis = {
    id: sitzung.naechsteId++,
    code,
    zeit: new Date().toISOString(),
  };

  sitzung.gekoppelt = true;
  sitzung.ereignisse.push(ereignis);
  if (sitzung.ereignisse.length > MAX_EREIGNISSE) {
    sitzung.ereignisse.splice(0, sitzung.ereignisse.length - MAX_EREIGNISSE);
  }

  wecke(sitzung);
  return ereignis;
}

/**
 * Wartet auf Scans, die neuer sind als `seit`. Liegt schon etwas vor, kommt die
 * Antwort sofort; sonst bleibt sie bis zu WARTE_MS offen.
 *
 * Bricht der Empfänger zwischendurch ab, bleibt sein Warter höchstens bis zum
 * Zeitgeber liegen – das Schreiben auf die geschlossene Verbindung verpufft.
 */
export async function warteAufScans(id: string, seit: number): Promise<WarteErgebnis> {
  const leer: WarteErgebnis = { aktiv: false, gekoppelt: false, letzteId: seit, ereignisse: [] };

  const sitzung = hole(id);
  if (!sitzung) return leer;

  if (sitzung.ereignisse.every(e => e.id <= seit)) {
    await new Promise<void>(resolve => {
      const warter: Warter = { wecken: resolve };
      const zeitgeber = setTimeout(() => {
        sitzung.warter.delete(warter);
        resolve();
      }, WARTE_MS);
      warter.wecken = () => {
        clearTimeout(zeitgeber);
        resolve();
      };
      sitzung.warter.add(warter);
    });
  }

  // Während des Wartens kann die Kopplung beendet worden sein.
  const aktuell = hole(id);
  if (!aktuell) return leer;

  const neue = aktuell.ereignisse.filter(e => e.id > seit);
  return {
    aktiv: true,
    gekoppelt: aktuell.gekoppelt,
    letzteId: neue.length > 0 ? neue[neue.length - 1].id : seit,
    ereignisse: neue,
  };
}

/** Kopplung beenden – wartende Anfragen kommen sofort mit `aktiv: false` zurück. */
export function beende(id: string): void {
  const sitzung = sitzungen.get(id);
  if (!sitzung) return;
  sitzungen.delete(id);
  wecke(sitzung);
}
