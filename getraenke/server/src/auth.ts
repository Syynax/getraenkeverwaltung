import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import {
  BENUTZER,
  ANMELDE_MODUS,
  ANMELDUNG_UNKONFIGURIERT,
  SITZUNGSDAUER_MS,
  DATA_FILE,
} from './config';
import { erzeugeBremse } from './utils/bremse';

/**
 * Anmeldung für die Getränkeverwaltung.
 *
 * Bewusst ohne Session-Store und ohne Cookies: die Sitzung steckt in einem
 * signierten Token, das das Frontend im localStorage hält und als
 * "Authorization: Bearer …" mitschickt. Cookies wären unter dem
 * Home-Assistant-Ingress unangenehm – dessen Pfad (/api/hassio_ingress/<token>/)
 * wechselt, ein Cookie-Path würde damit regelmässig ins Leere laufen.
 */

const SECRET_DATEI = path.join(path.dirname(DATA_FILE), '.session-secret');

/**
 * Der Schlüssel liegt neben den Daten in /data, damit Anmeldungen einen
 * Neustart oder ein Add-on-Update überleben. Klappt das Schreiben nicht,
 * läuft das Add-on trotzdem – dann gelten Anmeldungen nur bis zum Neustart.
 */
function ladeOderErzeugeSecret(): Buffer {
  try {
    const vorhanden = fs.readFileSync(SECRET_DATEI);
    if (vorhanden.length >= 32) return vorhanden;
  } catch {
    /* erster Start – wird gleich angelegt */
  }

  const secret = crypto.randomBytes(48);
  try {
    fs.mkdirSync(path.dirname(SECRET_DATEI), { recursive: true });
    fs.writeFileSync(SECRET_DATEI, secret, { mode: 0o600 });
  } catch (err) {
    console.warn('Sitzungsschlüssel konnte nicht gespeichert werden – Anmeldungen gelten nur bis zum Neustart.', err);
  }
  return secret;
}

const SECRET = ladeOderErzeugeSecret();

function signiere(nutzlast: string): string {
  return crypto.createHmac('sha256', SECRET).update(nutzlast).digest('base64url');
}

/** Vergleich ohne Laufzeit-Unterschied – über den Hash, damit die Länge egal ist. */
function gleich(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function erzeugeToken(name: string): string {
  const nutzlast = Buffer.from(
    JSON.stringify({ n: name, exp: Date.now() + SITZUNGSDAUER_MS }),
  ).toString('base64url');
  return `${nutzlast}.${signiere(nutzlast)}`;
}

/** Gibt den Benutzernamen zurück, oder null wenn das Token ungültig/abgelaufen ist. */
export function pruefeToken(token: string | undefined): string | null {
  if (!token) return null;

  const [nutzlast, signatur] = token.split('.');
  if (!nutzlast || !signatur) return null;

  const erwartet = Buffer.from(signiere(nutzlast));
  const geliefert = Buffer.from(signatur);
  if (erwartet.length !== geliefert.length) return null;
  if (!crypto.timingSafeEqual(erwartet, geliefert)) return null;

  try {
    const daten = JSON.parse(Buffer.from(nutzlast, 'base64url').toString('utf-8')) as {
      n?: unknown;
      exp?: unknown;
    };
    if (typeof daten.n !== 'string' || typeof daten.exp !== 'number') return null;
    if (Date.now() > daten.exp) return null;
    // Der Benutzer kann zwischenzeitlich aus den Add-on-Optionen entfernt worden sein.
    if (!BENUTZER.some(b => b.name === daten.n)) return null;
    return daten.n;
  } catch {
    return null;
  }
}

/**
 * Prüft Name und Passwort. Es werden immer alle Einträge durchlaufen, damit
 * die Antwortzeit nicht verrät, ob es den Benutzernamen überhaupt gibt.
 */
export function pruefeAnmeldedaten(name: string, passwort: string): string | null {
  const gesucht = name.trim().toLowerCase();
  let treffer: string | null = null;

  for (const benutzer of BENUTZER) {
    const nameOk = gleich(benutzer.name.toLowerCase(), gesucht);
    const passwortOk = gleich(benutzer.passwort, passwort);
    if (nameOk && passwortOk) treffer = benutzer.name;
  }

  return treffer;
}

/**
 * Requests durch den Home-Assistant-Ingress tragen den Pfad-Header des
 * Supervisors. Der Aufrufer ist damit bereits an Home Assistant angemeldet.
 */
export function istIngress(req: Request): boolean {
  return typeof req.headers['x-ingress-path'] === 'string';
}

export function anmeldungNoetig(req: Request): boolean {
  if (ANMELDE_MODUS === 'aus' || ANMELDUNG_UNKONFIGURIERT) return false;
  if (ANMELDE_MODUS === 'nur_direktzugriff' && istIngress(req)) return false;
  return true;
}

// --- Bremse gegen Passwort-Raten ---------------------------------------

const loginBremse = erzeugeBremse(10, 15 * 60 * 1000);

/** Restliche Sperrzeit in Sekunden, 0 wenn nicht gesperrt. */
export function loginSperre(req: Request): number {
  return loginBremse.sperre(req);
}

export function loginFehlgeschlagen(req: Request): void {
  loginBremse.fehlschlag(req);
}

export function loginErfolgreich(req: Request): void {
  loginBremse.zuruecksetzen(req);
}

// --- Middleware --------------------------------------------------------

export interface AuthRequest extends Request {
  benutzer?: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!anmeldungNoetig(req)) {
    next();
    return;
  }

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const name = pruefeToken(token);

  if (!name) {
    res.status(401).json({ error: 'Nicht angemeldet' });
    return;
  }

  (req as AuthRequest).benutzer = name;
  next();
}
