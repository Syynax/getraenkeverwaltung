import test from 'node:test';
import assert from 'node:assert/strict';
import { findeSortenVorschlag } from './produktLookup';

const sorten = [
  { id: 1, name: 'Cola' },
  { id: 2, name: 'Cola Zero' },
  { id: 3, name: 'Augustiner Hell' },
];

test('Sortenvorschlag findet den eindeutigen Treffer', () => {
  const treffer = findeSortenVorschlag(
    { name: 'Augustiner Hell 0,5l', marke: 'Augustiner', menge: null, quelle: 'Test' },
    sorten,
  );
  assert.equal(treffer, 3);
});

test('Sortenvorschlag bevorzugt die genauere Sorte', () => {
  const treffer = findeSortenVorschlag(
    { name: 'Coca-Cola Zero Sugar', marke: 'Cola', menge: null, quelle: 'Test' },
    sorten,
  );
  assert.equal(treffer, 2);
});

test('Sortenvorschlag schweigt bei Gleichstand', () => {
  const treffer = findeSortenVorschlag(
    { name: 'Limonade', marke: null, menge: null, quelle: 'Test' },
    [{ id: 1, name: 'Limonade Zitrone' }, { id: 2, name: 'Limonade Orange' }],
  );
  assert.equal(treffer, null);
});

test('Sortenvorschlag schweigt ohne Treffer', () => {
  const treffer = findeSortenVorschlag(
    { name: 'Kartoffelsalat', marke: null, menge: null, quelle: 'Test' },
    sorten,
  );
  assert.equal(treffer, null);
});

test('Sortenvorschlag ignoriert Füllwörter und Umlaute', () => {
  const treffer = findeSortenVorschlag(
    { name: 'Käsebier Mehrweg Flasche', marke: null, menge: null, quelle: 'Test' },
    [{ id: 7, name: 'Käsebier' }],
  );
  assert.equal(treffer, 7);
});
