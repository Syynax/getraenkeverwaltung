import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { erzeugeBremse, sperrText } from './bremse';

/** Minimaler Request-Ersatz – die Bremse liest nur die IP. */
const von = (ip: string) => ({ ip } as Request);

test('Bremse lässt die erlaubten Versuche durch', () => {
  const bremse = erzeugeBremse(3, 60_000);
  const anfrage = von('10.0.0.1');

  for (let i = 0; i < 3; i++) {
    assert.equal(bremse.sperre(anfrage), 0, `Versuch ${i + 1} muss frei sein`);
    bremse.fehlschlag(anfrage);
  }
});

test('Bremse greift nach dem letzten erlaubten Versuch', () => {
  const bremse = erzeugeBremse(3, 60_000);
  const anfrage = von('10.0.0.2');

  for (let i = 0; i < 3; i++) bremse.fehlschlag(anfrage);
  assert.ok(bremse.sperre(anfrage) > 0, 'nach 3 Fehlversuchen muss gesperrt sein');
});

test('Bremse meldet die Restzeit in Sekunden', () => {
  const bremse = erzeugeBremse(1, 60_000);
  const anfrage = von('10.0.0.3');

  bremse.fehlschlag(anfrage);
  const rest = bremse.sperre(anfrage);
  assert.ok(rest > 0 && rest <= 60, `Restzeit muss zwischen 1 und 60 liegen, war ${rest}`);
});

test('Ein Erfolg setzt den Zähler zurück', () => {
  const bremse = erzeugeBremse(3, 60_000);
  const anfrage = von('10.0.0.4');

  bremse.fehlschlag(anfrage);
  bremse.fehlschlag(anfrage);
  bremse.zuruecksetzen(anfrage);

  // Nach dem Zurücksetzen stehen wieder alle Versuche zur Verfügung.
  for (let i = 0; i < 3; i++) {
    assert.equal(bremse.sperre(anfrage), 0);
    bremse.fehlschlag(anfrage);
  }
  assert.ok(bremse.sperre(anfrage) > 0);
});

test('Bremse trennt nach Absender – ein Angreifer sperrt nicht die Wehr aus', () => {
  const bremse = erzeugeBremse(2, 60_000);
  const angreifer = von('203.0.113.9');
  const kamerad = von('192.168.1.50');

  bremse.fehlschlag(angreifer);
  bremse.fehlschlag(angreifer);

  assert.ok(bremse.sperre(angreifer) > 0);
  assert.equal(bremse.sperre(kamerad), 0, 'andere Absender bleiben frei');
});

test('Nach Ablauf der Sperre geht es weiter', async () => {
  const bremse = erzeugeBremse(1, 40);
  const anfrage = von('10.0.0.5');

  bremse.fehlschlag(anfrage);
  assert.ok(bremse.sperre(anfrage) > 0);

  await new Promise(r => setTimeout(r, 60));
  assert.equal(bremse.sperre(anfrage), 0);
});

test('Fehlende IP wird auf einen Sammeleintrag abgebildet, nicht ignoriert', () => {
  const bremse = erzeugeBremse(1, 60_000);
  const ohneIp = {} as Request;

  bremse.fehlschlag(ohneIp);
  assert.ok(bremse.sperre(ohneIp) > 0);
});

test('sperrText rundet auf ganze Minuten auf', () => {
  assert.equal(sperrText(1), '1 Minute');
  assert.equal(sperrText(60), '1 Minute');
  assert.equal(sperrText(61), '2 Minuten');
  assert.equal(sperrText(900), '15 Minuten');
});
