import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Buchung, GetraenkeData } from '../types/getraenke';
import {
  archiviereAbgeschlosseneJahre,
  ladeArchivBuchungen,
  ladeAlleBuchungen,
  findeImArchiv,
  hoechsteBuchungsId,
  leereArchiv,
  archivOrdner,
  jahrVon,
} from './archiv';
import { loadJsonFile } from './fileStore';

const buchung = (id: number, jahr: number, teil: Partial<Buchung> = {}): Buchung => ({
  id,
  sorteId: 1,
  datum: `${jahr}-06-15T10:00:00.000Z`,
  typ: 'eingang',
  menge: 1,
  standort: 'lager',
  notiz: null,
  ...teil,
});

const mitBuchungen = async (buchungen: Buchung[]): Promise<string> => {
  const ordner = await fs.mkdtemp(path.join(os.tmpdir(), 'getraenke-archiv-'));
  const datei = path.join(ordner, 'getraenke.json');
  const daten: GetraenkeData = { sorten: [], bestand: [], buchungen, events: [], oberkategorien: [] };
  await fs.writeFile(datei, JSON.stringify(daten), 'utf-8');
  return datei;
};

const laufende = async (datei: string): Promise<Buchung[]> =>
  (await loadJsonFile<GetraenkeData>(datei, { sorten: [], bestand: [], buchungen: [], events: [], oberkategorien: [] })).buchungen;

// --- Jahreserkennung ---

test('Jahr wird aus dem Datum gelesen', () => {
  assert.equal(jahrVon(buchung(1, 2024)), 2024);
});

test('Unbrauchbare Daten ergeben kein Jahr', () => {
  assert.equal(jahrVon({ ...buchung(1, 2024), datum: 'kaputt' }), null);
  assert.equal(jahrVon({ ...buchung(1, 2024), datum: '' }), null);
  assert.equal(jahrVon({ ...buchung(1, 2024), datum: undefined as unknown as string }), null);
});

// --- Archivieren ---

test('Abgeschlossene Jahre wandern ins Archiv, das laufende bleibt', async () => {
  const datei = await mitBuchungen([
    buchung(1, 2024), buchung(2, 2024), buchung(3, 2025), buchung(4, 2026),
  ]);

  const ergebnis = await archiviereAbgeschlosseneJahre(datei, 2026);
  assert.deepEqual(ergebnis.jahre, [2024, 2025]);
  assert.equal(ergebnis.verschoben, 3);

  assert.deepEqual((await laufende(datei)).map(b => b.id), [4]);
  assert.deepEqual((await ladeArchivBuchungen(datei)).map(b => b.id), [1, 2, 3]);
});

test('Jedes Jahr bekommt eine eigene Datei', async () => {
  const datei = await mitBuchungen([buchung(1, 2024), buchung(2, 2025)]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  const dateien = (await fs.readdir(archivOrdner(datei))).sort();
  assert.deepEqual(dateien, ['buchungen-2024.json', 'buchungen-2025.json']);
});

test('Ohne abgeschlossene Jahre passiert nichts', async () => {
  const datei = await mitBuchungen([buchung(1, 2026), buchung(2, 2026)]);
  const ergebnis = await archiviereAbgeschlosseneJahre(datei, 2026);

  assert.deepEqual(ergebnis, { jahre: [], verschoben: 0 });
  assert.deepEqual((await laufende(datei)).map(b => b.id), [1, 2]);
});

test('Buchungen ohne brauchbares Datum bleiben liegen', async () => {
  // Lieber eine Zeile zu viel in der laufenden Datei als eine verlorene.
  const datei = await mitBuchungen([
    { ...buchung(1, 2024), datum: 'unbrauchbar' },
    buchung(2, 2024),
  ]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  assert.deepEqual((await laufende(datei)).map(b => b.id), [1]);
  assert.deepEqual((await ladeArchivBuchungen(datei)).map(b => b.id), [2]);
});

test('Zweimal archivieren erzeugt keine Dubletten', async () => {
  const datei = await mitBuchungen([buchung(1, 2024), buchung(2, 2024)]);

  await archiviereAbgeschlosseneJahre(datei, 2026);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  assert.deepEqual((await ladeArchivBuchungen(datei)).map(b => b.id), [1, 2]);
});

test('Ein späterer Lauf hängt an, statt das Archiv zu überschreiben', async () => {
  const datei = await mitBuchungen([buchung(1, 2024)]);
  await archiviereAbgeschlosseneJahre(datei, 2025);

  // Ein Jahr später kommt 2025 dazu – 2024 muss erhalten bleiben.
  const daten = await loadJsonFile<GetraenkeData>(datei, null as never);
  daten.buchungen.push(buchung(2, 2025));
  await fs.writeFile(datei, JSON.stringify(daten), 'utf-8');

  await archiviereAbgeschlosseneJahre(datei, 2026);
  assert.deepEqual((await ladeArchivBuchungen(datei)).map(b => b.id), [1, 2]);
});

test('Stornierte Buchungen behalten ihre Markierung im Archiv', async () => {
  const datei = await mitBuchungen([buchung(1, 2024, { storniert: true, storniertVon: 'Cedric' })]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  const [archiviert] = await ladeArchivBuchungen(datei);
  assert.equal(archiviert.storniert, true);
  assert.equal(archiviert.storniertVon, 'Cedric');
});

test('Preise überstehen das Archivieren – der Kassenbericht hängt daran', async () => {
  const datei = await mitBuchungen([
    buchung(1, 2024, { typ: 'eingang', einkaufspreis: 12.5 }),
    buchung(2, 2024, { typ: 'ausgang', verkaufspreis: 1.2 }),
  ]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  const archiv = await ladeArchivBuchungen(datei);
  assert.equal(archiv[0].einkaufspreis, 12.5);
  assert.equal(archiv[1].verkaufspreis, 1.2);
});

// --- Lesen ---

test('Ohne Archiv liefert das Lesen eine leere Liste', async () => {
  const datei = await mitBuchungen([buchung(1, 2026)]);
  assert.deepEqual(await ladeArchivBuchungen(datei), []);
});

test('Alle Buchungen sind Archiv plus laufende, ohne Überschneidung', async () => {
  const datei = await mitBuchungen([buchung(1, 2024), buchung(2, 2025), buchung(3, 2026)]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  const alle = await ladeAlleBuchungen(datei, await laufende(datei));
  assert.deepEqual(alle.map(b => b.id), [1, 2, 3]);
  assert.equal(new Set(alle.map(b => b.id)).size, 3, 'keine Dubletten');
});

test('Eine archivierte Buchung ist auffindbar', async () => {
  const datei = await mitBuchungen([buchung(7, 2024)]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  const treffer = await findeImArchiv(datei, 7);
  assert.equal(treffer?.id, 7);
  assert.equal(await findeImArchiv(datei, 999), null);
});

// --- Archiv leeren (Import) ---

test('Archiv leeren entfernt alle Jahresdateien', async () => {
  const datei = await mitBuchungen([buchung(1, 2024), buchung(2, 2025)]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  assert.equal(await leereArchiv(datei), 2);
  assert.deepEqual(await ladeArchivBuchungen(datei), []);
});

test('Archiv leeren ohne Archiv ist folgenlos', async () => {
  const datei = await mitBuchungen([buchung(1, 2026)]);
  assert.equal(await leereArchiv(datei), 0);
});

test('Nach dem Leeren zählt nichts Altes mehr mit', async () => {
  // Der Fall aus der Praxis: Eine Sicherung wird eingespielt. Sie enthält
  // bereits alle Buchungen – bliebe das alte Archiv liegen, zählte der
  // Kassenbericht jede archivierte Buchung doppelt.
  const datei = await mitBuchungen([buchung(1, 2024), buchung(2, 2024), buchung(3, 2026)]);
  await archiviereAbgeschlosseneJahre(datei, 2026);
  assert.equal((await ladeAlleBuchungen(datei, await laufende(datei))).length, 3);

  await leereArchiv(datei);

  // Jetzt steht der volle Satz wieder in der laufenden Datei, wie nach einem Import.
  const daten = await loadJsonFile<GetraenkeData>(datei, null as never);
  daten.buchungen = [buchung(1, 2024), buchung(2, 2024), buchung(3, 2026)];
  await fs.writeFile(datei, JSON.stringify(daten), 'utf-8');

  const alle = await ladeAlleBuchungen(datei, await laufende(datei));
  assert.equal(alle.length, 3, 'keine Doppelzählung');
  assert.deepEqual(alle.map(b => b.id), [1, 2, 3]);
});

// --- Ids ---

test('Ids werden über das Archiv hinweg weitergezählt', async () => {
  // Der gefährlichste Fall: Nach dem Auslagern ist die laufende Liste leer.
  // Ohne Blick ins Archiv begänne die Nummerierung wieder bei 1 und träfe
  // bestehende Buchungen.
  const datei = await mitBuchungen([buchung(1, 2024), buchung(2, 2024), buchung(3, 2024)]);
  await archiviereAbgeschlosseneJahre(datei, 2026);

  assert.deepEqual(await laufende(datei), []);
  assert.equal(await hoechsteBuchungsId(datei, await laufende(datei)), 3);
});

test('Die höchste Id gewinnt, egal ob sie im Archiv oder laufend liegt', async () => {
  const datei = await mitBuchungen([buchung(1, 2024), buchung(9, 2026)]);
  await archiviereAbgeschlosseneJahre(datei, 2026);
  assert.equal(await hoechsteBuchungsId(datei, await laufende(datei)), 9);
});

test('Ohne jede Buchung ist die höchste Id 0', async () => {
  const datei = await mitBuchungen([]);
  assert.equal(await hoechsteBuchungsId(datei, []), 0);
});
