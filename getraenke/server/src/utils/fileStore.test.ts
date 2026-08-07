import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  loadJsonFile,
  saveJsonFile,
  withFileLock,
  laufendeSchreibvorgaenge,
  raeumeAbbruchReste,
  DatenDefektError,
} from './fileStore';

const tempDatei = async (inhalt?: string): Promise<string> => {
  const ordner = await fs.mkdtemp(path.join(os.tmpdir(), 'getraenke-test-'));
  const datei = path.join(ordner, 'daten.json');
  if (inhalt !== undefined) await fs.writeFile(datei, inhalt, 'utf-8');
  return datei;
};

test('Fehlende Datei liefert den Fallback – das ist der erste Start', async () => {
  const datei = await tempDatei();
  assert.deepEqual(await loadJsonFile(datei, { sorten: [] }), { sorten: [] });
});

test('Kaputte Datei wirft, statt still leere Daten zu liefern', async () => {
  const datei = await tempDatei('{ das ist kein json');
  await assert.rejects(() => loadJsonFile(datei, { sorten: [] }), DatenDefektError);
});

test('Leere Datei gilt als Defekt, nicht als leerer Bestand', async () => {
  const datei = await tempDatei('   \n');
  await assert.rejects(() => loadJsonFile(datei, { sorten: [] }), DatenDefektError);
});

test('Heile Datei wird gelesen', async () => {
  const datei = await tempDatei('{"sorten":[{"id":1}]}');
  assert.deepEqual(await loadJsonFile(datei, { sorten: [] }), { sorten: [{ id: 1 }] });
});

test('Schreiben und Lesen im Rundlauf', async () => {
  const datei = await tempDatei();
  await saveJsonFile(datei, { sorten: [{ id: 7 }] });
  assert.deepEqual(await loadJsonFile(datei, null), { sorten: [{ id: 7 }] });
});

test('Nach dem Schreiben bleibt keine Nebendatei liegen', async () => {
  const datei = await tempDatei();
  await saveJsonFile(datei, { a: 1 });
  await assert.rejects(() => fs.access(`${datei}.tmp`));
});

test('Reste eines Abbruchs lassen sich wegräumen', async () => {
  const datei = await tempDatei('{"a":1}');
  await fs.writeFile(`${datei}.tmp`, '{"halb', 'utf-8');

  assert.equal(await raeumeAbbruchReste(datei), true);
  await assert.rejects(() => fs.access(`${datei}.tmp`));
  // Die echte Datei bleibt unangetastet.
  assert.deepEqual(await loadJsonFile(datei, null), { a: 1 });
});

test('Aufräumen ohne Reste meldet einfach false', async () => {
  const datei = await tempDatei('{"a":1}');
  assert.equal(await raeumeAbbruchReste(datei), false);
});

test('Zwischenspeicher liefert dieselben Daten wie das Original', async () => {
  const datei = await tempDatei('{"sorten":[{"id":1,"name":"Cola"}]}');
  const ersteLesung = await loadJsonFile(datei, null);
  const zweiteLesung = await loadJsonFile(datei, null);
  assert.deepEqual(zweiteLesung, ersteLesung);
});

test('Zwischenspeicher gibt Kopien heraus, keine geteilte Referenz', async () => {
  // Sonst würde eine abgebrochene Buchung ihre Zwischenstände in den
  // Zwischenspeicher schreiben und der nächste Leser bekäme Phantomdaten.
  const datei = await tempDatei('{"sorten":[{"id":1,"name":"Cola"}]}');

  const a = await loadJsonFile<{ sorten: { id: number; name: string }[] }>(datei, { sorten: [] });
  a.sorten[0].name = 'VERÄNDERT';
  a.sorten.push({ id: 99, name: 'Phantom' });

  const b = await loadJsonFile<{ sorten: { id: number; name: string }[] }>(datei, { sorten: [] });
  assert.equal(b.sorten.length, 1);
  assert.equal(b.sorten[0].name, 'Cola');
});

test('Zwischenspeicher merkt, wenn die Datei ausgetauscht wurde', async () => {
  // Fall aus der Praxis: jemand kopiert eine Sicherung zurück, während das
  // Add-on läuft.
  const datei = await tempDatei('{"zaehler":1}');
  assert.deepEqual(await loadJsonFile(datei, null), { zaehler: 1 });

  await fs.writeFile(datei, '{"zaehler":2,"mehr":"platz"}', 'utf-8');
  assert.deepEqual(await loadJsonFile(datei, null), { zaehler: 2, mehr: 'platz' });
});

test('Schreiben verwirft den Zwischenspeicher', async () => {
  const datei = await tempDatei('{"zaehler":1}');
  await loadJsonFile(datei, null);

  await saveJsonFile(datei, { zaehler: 42 });
  assert.deepEqual(await loadJsonFile(datei, null), { zaehler: 42 });
});

test('Eine kaputte Datei wird nicht aus dem Zwischenspeicher geschönt', async () => {
  const datei = await tempDatei('{"zaehler":1}');
  await loadJsonFile(datei, null);

  await fs.writeFile(datei, '{ kaputt', 'utf-8');
  await assert.rejects(() => loadJsonFile(datei, null), DatenDefektError);
});

test('Die Sperre serialisiert gleichzeitige Schreibvorgänge', async () => {
  const datei = await tempDatei();
  const reihenfolge: string[] = [];

  const langsam = withFileLock(datei, async () => {
    reihenfolge.push('a-start');
    await new Promise(r => setTimeout(r, 30));
    reihenfolge.push('a-ende');
  });
  const schnell = withFileLock(datei, async () => {
    reihenfolge.push('b-start');
    reihenfolge.push('b-ende');
  });

  await Promise.all([langsam, schnell]);
  assert.deepEqual(reihenfolge, ['a-start', 'a-ende', 'b-start', 'b-ende']);
});

test('Gleichzeitige Buchungen gehen nicht verloren', async () => {
  const datei = await tempDatei('{"zaehler":0}');

  // Zwanzig parallele Lesen-Ändern-Schreiben-Vorgänge auf dieselbe Datei.
  await Promise.all(Array.from({ length: 20 }, () => withFileLock(datei, async () => {
    const daten = await loadJsonFile<{ zaehler: number }>(datei, { zaehler: 0 });
    daten.zaehler++;
    await saveJsonFile(datei, daten);
  })));

  const ergebnis = await loadJsonFile<{ zaehler: number }>(datei, { zaehler: 0 });
  assert.equal(ergebnis.zaehler, 20);
});

test('Offene Schreibvorgänge werden mitgezählt und wieder freigegeben', async () => {
  const datei = await tempDatei();
  assert.equal(laufendeSchreibvorgaenge(), 0);

  let drin = 0;
  await withFileLock(datei, async () => { drin = laufendeSchreibvorgaenge(); });

  assert.equal(drin, 1, 'während des Schreibens muss genau einer offen sein');
  assert.equal(laufendeSchreibvorgaenge(), 0, 'danach wieder null');
});

test('Auch ein Fehler gibt die Sperre wieder frei', async () => {
  const datei = await tempDatei();
  await assert.rejects(() => withFileLock(datei, async () => { throw new Error('kaputt'); }));
  assert.equal(laufendeSchreibvorgaenge(), 0);

  // Die Datei muss danach weiter benutzbar sein.
  await withFileLock(datei, async () => { await saveJsonFile(datei, { ok: true }); });
  assert.deepEqual(await loadJsonFile(datei, null), { ok: true });
});
