import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { sichereTaeglich, raeumeImportSicherungen, sicherungsOrdner } from './sicherung';

const heute = () => new Date().toISOString().slice(0, 10);

const mitDaten = async (inhalt = '{"sorten":[{"id":1}]}'): Promise<string> => {
  const ordner = await fs.mkdtemp(path.join(os.tmpdir(), 'getraenke-sicherung-'));
  const datei = path.join(ordner, 'getraenke.json');
  await fs.writeFile(datei, inhalt, 'utf-8');
  return datei;
};

const dateienIm = async (ordner: string): Promise<string[]> => {
  try {
    return (await fs.readdir(ordner)).sort();
  } catch {
    return [];
  }
};

test('Sicherung legt eine Kopie mit dem Datum im Namen an', async () => {
  const datei = await mitDaten();
  const pfad = await sichereTaeglich(datei, 14);

  assert.ok(pfad, 'es muss eine Sicherung entstehen');
  assert.equal(path.basename(pfad), `getraenke-${heute()}.json`);
  assert.equal(await fs.readFile(pfad, 'utf-8'), '{"sorten":[{"id":1}]}');
});

test('Zweimal am selben Tag legt nur eine Sicherung an', async () => {
  const datei = await mitDaten();

  assert.ok(await sichereTaeglich(datei, 14));
  assert.equal(await sichereTaeglich(datei, 14), null, 'die zweite muss ausbleiben');
  assert.equal((await dateienIm(sicherungsOrdner(datei))).length, 1);
});

test('Ohne Datendatei gibt es nichts zu sichern', async () => {
  const ordner = await fs.mkdtemp(path.join(os.tmpdir(), 'getraenke-leer-'));
  assert.equal(await sichereTaeglich(path.join(ordner, 'fehlt.json'), 14), null);
});

test('Eine leere Datei wird nicht gesichert', async () => {
  // Sonst würde ein abgebrochener Schreibvorgang die gute Sicherung des Tages
  // durch eine leere ersetzen.
  const datei = await mitDaten('   \n');
  assert.equal(await sichereTaeglich(datei, 14), null);
});

test('Rotation behält die jüngsten Sicherungen', async () => {
  const datei = await mitDaten();
  const ordner = sicherungsOrdner(datei);
  await fs.mkdir(ordner, { recursive: true });

  for (const tag of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) {
    await fs.writeFile(path.join(ordner, `getraenke-${tag}.json`), '{}', 'utf-8');
  }

  await sichereTaeglich(datei, 3);

  const uebrig = await dateienIm(ordner);
  assert.equal(uebrig.length, 3);
  assert.ok(uebrig.includes(`getraenke-${heute()}.json`), 'die neue muss bleiben');
  assert.ok(!uebrig.includes('getraenke-2026-01-01.json'), 'die älteste muss weichen');
});

test('Rotation fasst fremde Dateien im Ordner nicht an', async () => {
  const datei = await mitDaten();
  const ordner = sicherungsOrdner(datei);
  await fs.mkdir(ordner, { recursive: true });
  await fs.writeFile(path.join(ordner, 'notiz.txt'), 'hallo', 'utf-8');
  await fs.writeFile(path.join(ordner, 'getraenke-2026-01-01.json'), '{}', 'utf-8');

  await sichereTaeglich(datei, 1);

  const uebrig = await dateienIm(ordner);
  assert.ok(uebrig.includes('notiz.txt'), 'fremde Dateien bleiben unberührt');
  assert.ok(uebrig.includes(`getraenke-${heute()}.json`));
});

test('Import-Sicherungen werden auf die gewünschte Zahl gestutzt', async () => {
  const datei = await mitDaten();
  const ordner = path.dirname(datei);

  for (const stempel of ['2026-01-01T10-00-00-000Z', '2026-02-01T10-00-00-000Z', '2026-03-01T10-00-00-000Z']) {
    await fs.writeFile(`${datei}.backup-${stempel}`, '{}', 'utf-8');
  }

  const geloescht = await raeumeImportSicherungen(datei, 1);
  assert.equal(geloescht, 2);

  const uebrig = (await dateienIm(ordner)).filter(n => n.includes('.backup-'));
  assert.deepEqual(uebrig, ['getraenke.json.backup-2026-03-01T10-00-00-000Z']);
});

test('Aufräumen ohne Sicherungen tut nichts', async () => {
  const datei = await mitDaten();
  assert.equal(await raeumeImportSicherungen(datei, 5), 0);
});

test('Die Datendatei selbst wird beim Aufräumen nie gelöscht', async () => {
  const datei = await mitDaten();
  await fs.writeFile(`${datei}.backup-2026-01-01T00-00-00-000Z`, '{}', 'utf-8');

  await raeumeImportSicherungen(datei, 0);
  assert.equal(await fs.readFile(datei, 'utf-8'), '{"sorten":[{"id":1}]}');
});
