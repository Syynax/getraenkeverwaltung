import test from 'node:test';
import assert from 'node:assert/strict';
import type { Sorte, Buchung, Oberkategorie } from '../types/getraenke';
import {
  empfohleneBestellung,
  unterWarnschwelle,
  verbrauchProMonat,
  kassenbericht,
  bestandsAenderung,
  istWirksam,
  ermittleBedarf,
  gruppenBestand,
  gruppenBestandFuerSoll,
  gruppeUnterWarnschwelle,
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

// --- Oberkategorien ---

const gruppe = (teil: Partial<Oberkategorie> = {}): Oberkategorie => ({
  id: 1,
  name: 'Bier',
  sollBestand: 10,
  warnschwelle: 3,
  aktiv: true,
  ...teil,
});

/** Lager-Nachschlag aus einer einfachen Tabelle sorteId → Flaschen. */
const lager = (werte: Record<number, number>) => (id: number) => werte[id] ?? 0;

test('Gruppe: mehrere Marken zahlen zusammen auf den Gruppen-Soll ein', () => {
  const sorten = [
    sorte({ id: 1, name: 'Augustiner', sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
    sorte({ id: 2, name: 'Tegernseer', sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
  ];
  // 3 + 2 = 5 Kästen, Soll 10 → 5 fehlen
  const bedarf = ermittleBedarf(sorten, lager({ 1: 60, 2: 40 }), [gruppe()]);

  assert.deepEqual(bedarf.sorten, []);
  assert.equal(bedarf.gruppen.length, 1);
  assert.equal(bedarf.gruppen[0].oberkategorie.name, 'Bier');
  assert.equal(bedarf.gruppen[0].aktuellerBestand, 5);
  assert.equal(bedarf.gruppen[0].empfohleneBestellung, 5);
  assert.deepEqual(bedarf.gruppen[0].sorten.map(s => s.name), ['Augustiner', 'Tegernseer']);
});

test('Gruppe: ein einmaliges Probierbier löst keine eigene Nachbestellung aus', () => {
  const sorten = [sorte({ id: 1, name: 'Probier-IPA', sollBestand: 0, oberkategorieId: 1 })];
  const bedarf = ermittleBedarf(sorten, lager({ 1: 0 }), [gruppe({ sollBestand: 0 })]);

  assert.deepEqual(bedarf.sorten, []);
  assert.deepEqual(bedarf.gruppen, []);
});

test('Gruppe: volle Gruppe braucht nichts', () => {
  const sorten = [sorte({ id: 1, sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 })];
  const bedarf = ermittleBedarf(sorten, lager({ 1: 240 }), [gruppe({ sollBestand: 10 })]);
  assert.deepEqual(bedarf.gruppen, []);
});

test('Sorte mit eigenem Soll bleibt einzeln, auch wenn sie in einer Gruppe steckt', () => {
  const sorten = [
    sorte({ id: 1, name: 'Stammbier', sollBestand: 6, oberkategorieId: 1, flaschenProKasten: 20 }),
    sorte({ id: 2, name: 'Probierbier', sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
  ];
  const bedarf = ermittleBedarf(sorten, lager({ 1: 20, 2: 20 }), [gruppe({ sollBestand: 10 })]);

  assert.equal(bedarf.sorten.length, 1);
  assert.equal(bedarf.sorten[0].sorte.name, 'Stammbier');
  assert.equal(bedarf.sorten[0].empfohleneBestellung, 5);

  // Das Stammbier zahlt nicht zusätzlich auf die Gruppe ein – sonst wäre es doppelt gezählt.
  assert.equal(bedarf.gruppen[0].aktuellerBestand, 1);
  assert.equal(bedarf.gruppen[0].empfohleneBestellung, 9);
});

test('Sorte ohne Soll und ohne Gruppe löst gar nichts aus', () => {
  const bedarf = ermittleBedarf([sorte({ id: 1, sollBestand: 0, oberkategorieId: null })], lager({}), []);
  assert.deepEqual(bedarf.sorten, []);
  assert.deepEqual(bedarf.gruppen, []);
});

test('Gruppe: inaktive Sorten zählen nicht mit', () => {
  const sorten = [
    sorte({ id: 1, sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
    sorte({ id: 2, sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20, aktiv: false }),
  ];
  const bedarf = ermittleBedarf(sorten, lager({ 1: 20, 2: 200 }), [gruppe({ sollBestand: 10 })]);
  assert.equal(bedarf.gruppen[0].aktuellerBestand, 1);
});

test('Gruppe: eine deaktivierte Oberkategorie greift nicht mehr', () => {
  const sorten = [sorte({ id: 1, sollBestand: 0, oberkategorieId: 1 })];
  const bedarf = ermittleBedarf(sorten, lager({ 1: 0 }), [gruppe({ aktiv: false })]);
  assert.deepEqual(bedarf.gruppen, []);
});

test('Gruppe: verwaiste Zuordnung wird ignoriert, nicht zum Fehler', () => {
  const sorten = [sorte({ id: 1, sollBestand: 0, oberkategorieId: 99 })];
  const bedarf = ermittleBedarf(sorten, lager({ 1: 0 }), [gruppe({ id: 1 })]);
  assert.deepEqual(bedarf.gruppen, []);
});

test('Gruppe: angebrochene Kästen werden über die Gruppe aufgerundet', () => {
  const sorten = [
    sorte({ id: 1, sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
    sorte({ id: 2, sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
  ];
  // 0,5 + 0,5 Kästen = 1 ganzer Kasten → bei Soll 4 fehlen 3
  const bedarf = ermittleBedarf(sorten, lager({ 1: 10, 2: 10 }), [gruppe({ sollBestand: 4 })]);
  assert.equal(bedarf.gruppen[0].empfohleneBestellung, 3);
});

test('Gruppe: eine Marke in der Gruppe erscheint nie doppelt', () => {
  // Weder in sorten noch mehrfach in gruppen – sonst würde man zweimal bestellen.
  const sorten = [
    sorte({ id: 1, name: 'Augustiner', sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
  ];
  const bedarf = ermittleBedarf(sorten, lager({ 1: 0 }), [gruppe({ sollBestand: 10 })]);

  assert.equal(bedarf.sorten.length, 0);
  assert.equal(bedarf.gruppen.length, 1);
  assert.equal(bedarf.gruppen[0].sorten.filter(s => s.id === 1).length, 1);
});

test('Gruppenbestand summiert nur die eigene Gruppe', () => {
  const sorten = [
    sorte({ id: 1, oberkategorieId: 1, flaschenProKasten: 20 }),
    sorte({ id: 2, oberkategorieId: 2, flaschenProKasten: 20 }),
    sorte({ id: 3, oberkategorieId: null, flaschenProKasten: 20 }),
  ];
  assert.equal(gruppenBestand(1, sorten, lager({ 1: 40, 2: 60, 3: 80 })), 2);
});

test('Gruppenbestand für den Soll lässt Sorten mit eigenem Soll aussen vor', () => {
  const sorten = [
    sorte({ id: 1, name: 'Probierbier', sollBestand: 0, oberkategorieId: 1, flaschenProKasten: 20 }),
    sorte({ id: 2, name: 'Stammbier', sollBestand: 6, oberkategorieId: 1, flaschenProKasten: 20 }),
  ];
  const stand = lager({ 1: 40, 2: 60 });

  // Fürs Regal zählt alles, für den Gruppen-Soll nur das Probierbier.
  assert.equal(gruppenBestand(1, sorten, stand), 5);
  assert.equal(gruppenBestandFuerSoll(1, sorten, stand), 2);
});

test('Gruppen-Warnschwelle greift unterhalb, aber nicht darauf', () => {
  const sorten = [sorte({ id: 1, oberkategorieId: 1, flaschenProKasten: 20 })];
  const g = gruppe({ warnschwelle: 3 });
  assert.equal(gruppeUnterWarnschwelle(g, sorten, lager({ 1: 40 })), true);
  assert.equal(gruppeUnterWarnschwelle(g, sorten, lager({ 1: 60 })), false);
});

test('Gruppen-Warnschwelle 0 warnt nie', () => {
  const sorten = [sorte({ id: 1, oberkategorieId: 1 })];
  assert.equal(gruppeUnterWarnschwelle(gruppe({ warnschwelle: 0 }), sorten, lager({ 1: 0 })), false);
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
