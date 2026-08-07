import test from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import type { Request } from 'express';

/**
 * `auth` liest seine Konfiguration beim Laden des Moduls. Deshalb muss die
 * Umgebung stehen, bevor es hereingezogen wird – daher der dynamische Import
 * statt eines gewöhnlichen `import` oben.
 */
const ordner = fsSync.mkdtempSync(path.join(os.tmpdir(), 'getraenke-auth-'));
fsSync.writeFileSync(
  path.join(ordner, 'options.json'),
  JSON.stringify({
    anmeldung: 'immer',
    sitzungsdauer_tage: 30,
    benutzer: [
      { name: 'Cedric', passwort: 'EinLangesPasswort' },
      { name: 'Kasse', passwort: 'NochEinsAnderes' },
    ],
  }),
  'utf-8',
);
process.env.OPTIONS_FILE = path.join(ordner, 'options.json');
process.env.DATA_FILE = path.join(ordner, 'getraenke.json');

const auth = () => import('./auth');

const anfrage = (kopf: Record<string, string> = {}) => ({ headers: kopf, ip: '10.0.0.1' } as unknown as Request);
const mitToken = (token: string) => anfrage({ authorization: `Bearer ${token}` });

// --- Anmeldedaten ---

test('Richtige Anmeldedaten werden erkannt', async () => {
  const { pruefeAnmeldedaten } = await auth();
  assert.equal(pruefeAnmeldedaten('Cedric', 'EinLangesPasswort'), 'Cedric');
});

test('Der Benutzername ist gross-/kleinschreibungsegal, das Passwort nicht', async () => {
  const { pruefeAnmeldedaten } = await auth();
  assert.equal(pruefeAnmeldedaten('cedric', 'EinLangesPasswort'), 'Cedric');
  assert.equal(pruefeAnmeldedaten('CEDRIC', 'EinLangesPasswort'), 'Cedric');
  assert.equal(pruefeAnmeldedaten('Cedric', 'einlangespasswort'), null);
});

test('Leerzeichen um den Namen stören nicht', async () => {
  const { pruefeAnmeldedaten } = await auth();
  assert.equal(pruefeAnmeldedaten('  Cedric  ', 'EinLangesPasswort'), 'Cedric');
});

test('Falsches Passwort und unbekannter Name werden abgewiesen', async () => {
  const { pruefeAnmeldedaten } = await auth();
  assert.equal(pruefeAnmeldedaten('Cedric', 'falsch'), null);
  assert.equal(pruefeAnmeldedaten('Niemand', 'EinLangesPasswort'), null);
  assert.equal(pruefeAnmeldedaten('', ''), null);
});

test('Das Passwort des einen öffnet nicht das Konto des anderen', async () => {
  const { pruefeAnmeldedaten } = await auth();
  assert.equal(pruefeAnmeldedaten('Cedric', 'NochEinsAnderes'), null);
});

// --- Token ---

test('Ein erzeugtes Token wird wiedererkannt', async () => {
  const { erzeugeToken, pruefeToken } = await auth();
  assert.equal(pruefeToken(erzeugeToken('Cedric')), 'Cedric');
});

test('Ein manipuliertes Token fällt durch', async () => {
  const { erzeugeToken, pruefeToken } = await auth();
  const token = erzeugeToken('Cedric');

  assert.equal(pruefeToken(`${token}x`), null, 'angehängtes Zeichen');
  assert.equal(pruefeToken(token.slice(0, -1)), null, 'abgeschnittenes Zeichen');
  assert.equal(pruefeToken(token.toUpperCase()), null, 'veränderte Schreibweise');
});

test('Eine ausgetauschte Nutzlast bei alter Signatur fällt durch', async () => {
  // Der klassische Angriff: Nutzlast auf einen anderen Benutzer umschreiben
  // und die Signatur unverändert lassen.
  const { erzeugeToken, pruefeToken } = await auth();
  const [, signatur] = erzeugeToken('Kasse').split('.');
  const gefaelscht = Buffer.from(JSON.stringify({ n: 'Cedric', exp: Date.now() + 60_000 })).toString('base64url');

  assert.equal(pruefeToken(`${gefaelscht}.${signatur}`), null);
});

test('Ein Token für einen unbekannten Benutzer gilt nicht', async () => {
  // Deckt den Fall ab, dass ein Konto aus den Add-on-Optionen entfernt wurde.
  const { erzeugeToken, pruefeToken } = await auth();
  assert.equal(pruefeToken(erzeugeToken('Ehemaliger')), null);
});

test('Unsinn als Token wirft nicht, sondern gilt schlicht nicht', async () => {
  const { pruefeToken } = await auth();
  for (const müll of ['', 'abc', 'a.b', '....', 'eyJhIjoxfQ', Buffer.from('{}').toString('base64url') + '.x']) {
    assert.equal(pruefeToken(müll), null, `"${müll}" darf nicht durchgehen`);
  }
  assert.equal(pruefeToken(undefined), null);
});

// --- Middleware ---

test('requireAuth lässt ein gültiges Token durch und merkt sich den Benutzer', async () => {
  const { requireAuth, erzeugeToken } = await auth();
  const req = mitToken(erzeugeToken('Cedric'));

  let weiter = false;
  requireAuth(req, {} as never, () => { weiter = true; });

  assert.equal(weiter, true);
  assert.equal((req as { benutzer?: string }).benutzer, 'Cedric');
});

test('requireAuth blockt ohne und mit falschem Token', async () => {
  const { requireAuth } = await auth();

  for (const req of [anfrage(), mitToken('kaputt'), anfrage({ authorization: 'Basic abc' })]) {
    let status = 0;
    let weiter = false;
    requireAuth(
      req,
      { status(c: number) { status = c; return { json() {} }; } } as never,
      () => { weiter = true; },
    );
    assert.equal(weiter, false);
    assert.equal(status, 401);
  }
});

test('Ingress-Anfragen werden am Kopf-Feld erkannt', async () => {
  const { istIngress } = await auth();
  assert.equal(istIngress(anfrage({ 'x-ingress-path': '/api/hassio_ingress/abc' })), true);
  assert.equal(istIngress(anfrage()), false);
});

test('Bei anmeldung: immer hilft der Ingress-Kopf nicht weiter', async () => {
  // Sonst könnte man die Anmeldung durch ein selbst gesetztes Kopf-Feld umgehen.
  const { anmeldungNoetig } = await auth();
  assert.equal(anmeldungNoetig(anfrage({ 'x-ingress-path': '/api/hassio_ingress/abc' })), true);
  assert.equal(anmeldungNoetig(anfrage()), true);
});
