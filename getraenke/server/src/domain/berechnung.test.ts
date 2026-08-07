import test from 'node:test';
import assert from 'node:assert/strict';
import type { Sorte, Buchung } from '../types/getraenke';
import {
  empfohleneBestellung,
  unterWarnschwelle,
  verbrauchProMonat,
  kassenbericht,
  bestandsAenderung,
  istWirksam,
} from './berechnung';

const sorte = (teil: Partial<Sorte> = {}): Sorte => ({
  id: 1,
  name: 'Cola',
  kategorie: 'alkoholfrei',
  flaschenProKasten: 20,
  warnschwelle: 2,
  einkaufspreis: 10,
  verkaufspreis: 1,
  sollBestand: 4,
  aktiv: true,
  ...teil,
});

const buchung = (teil: Partial<Buchung> = {}): Buchung => ({
  id: 1,
  sorteId: 1,
  datum: '2026-03-15T10:00:00.000Z',
  typ: 'eingang',
  menge: 1,
  standort: 'lager',
  notiz: null,
  ...teil,
});

// --- Bestellempfehlung ---

test('Bestellempfehlung: leeres Lager braucht den vollen Soll-Bestand', () => {
  assert.equal(empfohleneBestellung(sorte({ sollBestand: 4 }), 0), 4);
});

test('Bestellempfehlung: volles Lager braucht nichts', () => {
  assert.equal(empfohleneBestellung(sorte({ sollBestand: 4 }), 80), 0);
});

test('Bestellempfehlung: mehr als das Soll ergibt keine negative Menge', () => {
  assert.equal(empfohleneBestellung(sorte({ sollBestand: 4 }), 200), 0);
});

test('Bestellempfehlung: angebrochene Kästen werden aufgerundet', () => {
  // 30 Flaschen = 1,5 Kästen, Soll 4 → es fehlen 2,5 → 3 Kästen
  assert.equal(empfohleneBestellung(sorte({ sollBestand: 4 }), 30), 3);
});

test('Bestellempfehlung: Soll-Bestand 0 heisst nie nachbestellen', () => {
  assert.equal(empfohleneBestellung(sorte({ sollBestand: 0 }), 0), 0);
});

test('Bestellempfehlung: fehlender Soll-Bestand fällt auf die Vorgabe zurück', () => {
  assert.equal(empfohleneBestellung(sorte({ sollBestand: undefined as unknown as number }), 0), 4);
});

test('Warnschwelle greift unterhalb, aber nicht genau auf der Schwelle', () => {
  assert.equal(unterWarnschwelle(sorte({ warnschwelle: 2 }), 39), true);
  assert.equal(unterWarnschwelle(sorte({ warnschwelle: 2 }), 40), false);
});

// --- Verbrauch ---

test('Verbrauch zählt Eingang und Ausgang je Monat', () => {
  const ergebnis = verbrauchProMonat([
    buchung({ id: 1, typ: 'eingang', menge: 5, datum: '2026-01-10T00:00:00.000Z' }),
    buchung({ id: 2, typ: 'ausgang', menge: 2, datum: '2026-01-20T00:00:00.000Z' }),
    buchung({ id: 3, typ: 'eingang', menge: 1, datum: '2026-02-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(ergebnis, [
    { monat: '2026-01', eingang: 5, ausgang: 2 },
    { monat: '2026-02', eingang: 1, ausgang: 0 },
  ]);
});

test('Verbrauch: Schwund zählt als Abgang', () => {
  const ergebnis = verbrauchProMonat([buchung({ typ: 'schwund', menge: 3 })]);
  assert.equal(ergebnis[0].ausgang, 3);
});

test('Verbrauch: Inventur verschiebt keinen Verbrauch', () => {
  assert.deepEqual(verbrauchProMonat([buchung({ typ: 'inventur', menge: -7 })]), []);
});

test('Verbrauch: stornierte Buchungen zählen nicht mit', () => {
  const ergebnis = verbrauchProMonat([
    buchung({ id: 1, typ: 'eingang', menge: 5 }),
    buchung({ id: 2, typ: 'eingang', menge: 99, storniert: true }),
  ]);
  assert.equal(ergebnis[0].eingang, 5);
});

// --- Kassenbericht ---

test('Kassenbericht: Einnahmen aus Menge, Gebinde und Flaschenpreis', () => {
  const bericht = kassenbericht(
    [buchung({ typ: 'ausgang', menge: 2, verkaufspreis: 1 })],
    [sorte({ flaschenProKasten: 20 })],
  );
  // 2 Kästen × 20 Flaschen × 1,00 €
  assert.equal(bericht.gesamtEinnahmen, 40);
  assert.equal(bericht.gesamtAusgaben, 0);
});

test('Kassenbericht: der auf der Buchung gespeicherte Verkaufspreis gewinnt', () => {
  // Genau der Punkt, der vorher fehlte: die Sorte kostet heute 2 €, damals 1 €.
  const bericht = kassenbericht(
    [buchung({ typ: 'ausgang', menge: 1, verkaufspreis: 1 })],
    [sorte({ verkaufspreis: 2, flaschenProKasten: 20 })],
  );
  assert.equal(bericht.gesamtEinnahmen, 20);
});

test('Kassenbericht: Altbuchung ohne Preis nimmt den aktuellen Sortenpreis', () => {
  const bericht = kassenbericht(
    [buchung({ typ: 'ausgang', menge: 1 })],
    [sorte({ verkaufspreis: 2, flaschenProKasten: 20 })],
  );
  assert.equal(bericht.gesamtEinnahmen, 40);
});

test('Kassenbericht: Einkaufspreis wird ebenfalls historisch gelesen', () => {
  const bericht = kassenbericht(
    [buchung({ typ: 'eingang', menge: 3, einkaufspreis: 10 })],
    [sorte({ einkaufspreis: 99 })],
  );
  assert.equal(bericht.gesamtAusgaben, 30);
});

test('Kassenbericht: Schwund bringt keine Einnahmen, wird aber ausgewiesen', () => {
  const bericht = kassenbericht(
    [buchung({ typ: 'schwund', menge: 1, verkaufspreis: 1 })],
    [sorte({ flaschenProKasten: 20 })],
  );
  assert.equal(bericht.gesamtEinnahmen, 0);
  assert.equal(bericht.gesamtSchwund, 20);
  assert.equal(bericht.gesamtGewinn, 0);
});

test('Kassenbericht: Gewinn ist Einnahmen minus Ausgaben', () => {
  const bericht = kassenbericht(
    [
      buchung({ id: 1, typ: 'eingang', menge: 1, einkaufspreis: 10 }),
      buchung({ id: 2, typ: 'ausgang', menge: 1, verkaufspreis: 1 }),
    ],
    [sorte({ flaschenProKasten: 20 })],
  );
  assert.equal(bericht.gesamtGewinn, 10);
});

test('Kassenbericht: stornierte Buchungen fallen raus', () => {
  const bericht = kassenbericht(
    [buchung({ typ: 'ausgang', menge: 5, verkaufspreis: 1, storniert: true })],
    [sorte()],
  );
  assert.equal(bericht.gesamtEinnahmen, 0);
  assert.deepEqual(bericht.monate, []);
});

test('Kassenbericht: Buchung ohne passende Sorte wird übersprungen', () => {
  const bericht = kassenbericht([buchung({ sorteId: 99, typ: 'ausgang' })], [sorte({ id: 1 })]);
  assert.deepEqual(bericht.monate, []);
});

test('Kassenbericht: Beträge werden auf Cent gerundet', () => {
  const bericht = kassenbericht(
    [buchung({ typ: 'ausgang', menge: 1, verkaufspreis: 0.333 })],
    [sorte({ flaschenProKasten: 3 })],
  );
  assert.equal(bericht.gesamtEinnahmen, 1);
});

// --- Bestandswirkung ---

test('Bestandswirkung: Eingang füllt, Ausgang und Schwund leeren', () => {
  const s = sorte({ flaschenProKasten: 20 });
  assert.equal(bestandsAenderung(buchung({ typ: 'eingang', menge: 2 }), s), 40);
  assert.equal(bestandsAenderung(buchung({ typ: 'ausgang', menge: 2 }), s), -40);
  assert.equal(bestandsAenderung(buchung({ typ: 'schwund', menge: 1 }), s), -20);
});

test('Bestandswirkung: bei der Inventur steht die Differenz schon in Flaschen', () => {
  assert.equal(bestandsAenderung(buchung({ typ: 'inventur', menge: -7 }), sorte()), -7);
});

test('Bestandswirkung: ein Storno hebt die Buchung genau auf', () => {
  const s = sorte({ flaschenProKasten: 20 });
  const b = buchung({ typ: 'ausgang', menge: 3 });
  assert.equal(bestandsAenderung(b, s) + -bestandsAenderung(b, s), 0);
});

test('istWirksam erkennt stornierte Buchungen', () => {
  assert.equal(istWirksam(buchung()), true);
  assert.equal(istWirksam(buchung({ storniert: true })), false);
});
