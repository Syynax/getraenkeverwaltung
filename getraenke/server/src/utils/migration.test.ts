import test from 'node:test';
import assert from 'node:assert/strict';
import { entferneAutomatFelder, hatAutomatFelder } from './migration';

test('Migration erkennt Altdaten an den Automaten-Feldern', () => {
  assert.equal(hatAutomatFelder({ sorten: [{ name: 'Cola', automat: 'softdrink' }] }), true);
  assert.equal(hatAutomatFelder({ bestand: [{ lager: 10, automat: 0 }] }), true);
  assert.equal(hatAutomatFelder({ sorten: [{ name: 'Cola' }], bestand: [{ lager: 10 }] }), false);
});

test('Migration entfernt die Sorten-Felder', () => {
  const nachher = entferneAutomatFelder({
    sorten: [{ id: 1, name: 'Cola', automat: 'softdrink', automatKapazitaet: 24 }],
  });
  assert.deepEqual(nachher.sorten, [{ id: 1, name: 'Cola' }]);
});

test('Migration schiebt Automat-Flaschen ins Lager', () => {
  const nachher = entferneAutomatFelder({ bestand: [{ sorteId: 1, lager: 48, automat: 12 }] });
  assert.deepEqual(nachher.bestand, [{ sorteId: 1, lager: 60 }]);
});

test('Migration verträgt fehlende oder unsinnige Werte', () => {
  const nachher = entferneAutomatFelder({
    bestand: [{ sorteId: 1 }, { sorteId: 2, lager: 5, automat: 'kaputt' }],
  });
  assert.deepEqual(nachher.bestand, [{ sorteId: 1, lager: 0 }, { sorteId: 2, lager: 5 }]);
});

test('Migration lässt Buchungen unangetastet', () => {
  const buchungen = [{ id: 1, typ: 'auffuellung', standort: 'automat' }];
  const nachher = entferneAutomatFelder({ buchungen });
  assert.deepEqual(nachher.buchungen, buchungen);
});

test('Migration ist wiederholbar – zweimal ändert nichts mehr', () => {
  const einmal = entferneAutomatFelder({ bestand: [{ sorteId: 1, lager: 48, automat: 12 }] });
  const zweimal = entferneAutomatFelder(einmal);
  assert.deepEqual(zweimal.bestand, einmal.bestand);
});
