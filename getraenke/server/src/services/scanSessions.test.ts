import test from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeSitzung, koppele, scanMelden, warteAufScans, beende } from './scanSessions';

test('Kopplung liefert Id und sechsstelligen Code', () => {
  const { id, koppelCode } = erzeugeSitzung();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.match(koppelCode, /^\d{6}$/);
  beende(id);
});

test('Zwei Kopplungen bekommen verschiedene Codes', () => {
  const a = erzeugeSitzung();
  const b = erzeugeSitzung();
  assert.notEqual(a.koppelCode, b.koppelCode);
  assert.notEqual(a.id, b.id);
  beende(a.id);
  beende(b.id);
});

test('Beitreten über den richtigen Code trifft die richtige Kopplung', () => {
  const a = erzeugeSitzung();
  const b = erzeugeSitzung();

  assert.deepEqual(koppele(a.koppelCode), { id: a.id });
  assert.deepEqual(koppele(b.koppelCode), { id: b.id });

  beende(a.id);
  beende(b.id);
});

test('Ein unbekannter Code führt nirgendwohin', () => {
  assert.equal(koppele('000000'), null);
});

test('Ein gemeldeter Scan kommt beim Empfänger an', async () => {
  const { id } = erzeugeSitzung();

  const ereignis = scanMelden(id, '4001686301203');
  assert.ok(ereignis);
  assert.equal(ereignis.code, '4001686301203');

  const ergebnis = await warteAufScans(id, 0);
  assert.equal(ergebnis.aktiv, true);
  assert.equal(ergebnis.ereignisse.length, 1);
  assert.equal(ergebnis.ereignisse[0].code, '4001686301203');

  beende(id);
});

test('Schon abgeholte Scans kommen nicht ein zweites Mal', async () => {
  const { id } = erzeugeSitzung();
  scanMelden(id, '111');
  scanMelden(id, '222');

  const erste = await warteAufScans(id, 0);
  assert.deepEqual(erste.ereignisse.map(e => e.code), ['111', '222']);

  // Mit dem Stand der ersten Abholung darf nichts Altes nachkommen.
  scanMelden(id, '333');
  const zweite = await warteAufScans(id, erste.letzteId);
  assert.deepEqual(zweite.ereignisse.map(e => e.code), ['333']);

  beende(id);
});

test('Mehrere Scans behalten ihre Reihenfolge', async () => {
  const { id } = erzeugeSitzung();
  for (const code of ['a1', 'b2', 'c3']) scanMelden(id, code);

  const ergebnis = await warteAufScans(id, 0);
  assert.deepEqual(ergebnis.ereignisse.map(e => e.code), ['a1', 'b2', 'c3']);
  beende(id);
});

test('Scan auf eine unbekannte Kopplung schlägt fehl statt still zu verpuffen', () => {
  assert.equal(scanMelden('f'.repeat(32), '123'), null);
});

test('Ein wartender Empfänger wird von einem Scan sofort geweckt', async () => {
  const { id } = erzeugeSitzung();

  // Wartet, weil noch nichts vorliegt – und muss durch den Scan aufwachen,
  // lange bevor der 25-Sekunden-Zeitgeber greift.
  const wartet = warteAufScans(id, 0);
  setTimeout(() => scanMelden(id, '4711'), 20);

  const start = Date.now();
  const ergebnis = await wartet;
  const gedauert = Date.now() - start;

  assert.deepEqual(ergebnis.ereignisse.map(e => e.code), ['4711']);
  assert.ok(gedauert < 2000, `muss sofort aufwachen, dauerte aber ${gedauert} ms`);
  beende(id);
});

test('Beenden weckt Wartende mit aktiv: false', async () => {
  const { id } = erzeugeSitzung();

  const wartet = warteAufScans(id, 0);
  setTimeout(() => beende(id), 20);

  const ergebnis = await wartet;
  assert.equal(ergebnis.aktiv, false);
});

test('Nach dem Beenden nimmt die Kopplung nichts mehr an', async () => {
  const { id, koppelCode } = erzeugeSitzung();
  beende(id);

  assert.equal(scanMelden(id, '123'), null);
  assert.equal(koppele(koppelCode), null);
  assert.equal((await warteAufScans(id, 0)).aktiv, false);
});

test('Erst nach dem Beitreten gilt eine Kopplung als verbunden', async () => {
  const { id, koppelCode } = erzeugeSitzung();

  assert.equal((await warteAufScans(id, 0)).gekoppelt, false);
  koppele(koppelCode);
  assert.equal((await warteAufScans(id, 0)).gekoppelt, true);

  beende(id);
});
