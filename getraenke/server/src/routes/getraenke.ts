import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import type { GetraenkeData, Sorte, Bestand, Buchung, BesonderesEvent, EventPosition } from '../types/getraenke';
import { KATEGORIEN, BUCHUNGS_TYPEN_NEU, BUCHUNGS_STANDORTE_NEU, EVENT_STATI, EVENT_POSITION_TYPEN } from '../constants/getraenke';
import { withFileLock, loadJsonFile, saveJsonFile } from '../utils/fileStore';
import { erzeugeBremse, sperrText } from '../utils/bremse';
import { lookupProdukt, findeSortenVorschlag, type ProduktInfo } from '../services/produktLookup';
import { erzeugeSitzung, koppele, scanMelden, warteAufScans, beende } from '../services/scanSessions';
import { DATA_FILE, PRODUKT_LOOKUP } from '../config';

const router = Router();
const DATA_PATH = DATA_FILE;

// Validation middleware
const handleValidation = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validierungsfehler',
      details: errors.array().map(e => ({ field: e.type, message: e.msg }))
    });
  }
  next();
};

// --- Data helpers ---

async function loadData(): Promise<GetraenkeData> {
  const data = await loadJsonFile<Partial<GetraenkeData>>(DATA_PATH, {});
  return {
    sorten: data.sorten || [],
    bestand: data.bestand || [],
    buchungen: data.buchungen || [],
    events: data.events || [],
  };
}

async function saveData(data: GetraenkeData): Promise<void> {
  await saveJsonFile(DATA_PATH, data);
}

function nextId(items: { id: number }[]): number {
  if (items.length === 0) return 1;
  return Math.max(...items.map(i => i.id)) + 1;
}

/** Barcodes sind Ziffern; Code 128 kann auch Buchstaben enthalten. */
const BARCODE_MUSTER = /^[0-9A-Za-z._-]+$/;

/** Barcodes säubern: trimmen, Leereinträge/Dubletten entfernen, auf 20 begrenzen. */
function normalizeBarcodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    const s = (typeof v === 'string' ? v : String(v ?? '')).trim();
    if (s) seen.add(s);
  }
  return Array.from(seen).slice(0, 20);
}

function sortEvents(events: BesonderesEvent[]): BesonderesEvent[] {
  return [...events].sort((a, b) => a.datum.localeCompare(b.datum) || a.name.localeCompare(b.name));
}

function normalizeEventItems(items: unknown[], sorten: Sorte[]): EventPosition[] {
  return items.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw Object.assign(new Error(`Position ${index + 1} ist ungültig`), { status: 400 });
    }

    const rawItem = item as Record<string, unknown>;
    const id = typeof rawItem.id === 'number' && Number.isInteger(rawItem.id) && rawItem.id > 0
      ? rawItem.id
      : index + 1;
    const typ = rawItem.typ as EventPosition['typ'];
    const menge = typeof rawItem.menge === 'number' ? rawItem.menge : Number(rawItem.menge);
    const einheit = typeof rawItem.einheit === 'string' && rawItem.einheit.trim().length > 0
      ? rawItem.einheit.trim()
      : typ === 'sorte'
        ? 'Kästen'
        : 'Stück';

    if (typ === 'sorte') {
      const sorteId = typeof rawItem.sorteId === 'number' ? rawItem.sorteId : Number(rawItem.sorteId);
      const sorte = sorten.find(entry => entry.id === sorteId && entry.aktiv);

      if (!sorte) {
        throw Object.assign(new Error(`Position ${index + 1}: Sorte nicht gefunden`), { status: 400 });
      }

      return {
        id,
        typ,
        sorteId,
        artikelName: sorte.name,
        menge,
        einheit,
      };
    }

    const artikelName = typeof rawItem.artikelName === 'string' ? rawItem.artikelName.trim() : '';

    return {
      id,
      typ: 'frei',
      sorteId: null,
      artikelName,
      menge,
      einheit,
    };
  });
}

// --- Validation rules ---

const sorteValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name ist erforderlich')
    .isLength({ min: 1, max: 100 }).withMessage('Name muss 1-100 Zeichen haben'),
  body('kategorie')
    .trim()
    .notEmpty().withMessage('Kategorie ist erforderlich')
    .isIn([...KATEGORIEN]).withMessage('Ungültige Kategorie'),
  body('flaschenProKasten')
    .isInt({ min: 1, max: 100 }).withMessage('Flaschen pro Kasten muss 1-100 sein'),
  body('warnschwelle')
    .isInt({ min: 0, max: 100 }).withMessage('Warnschwelle muss 0-100 sein'),
  body('einkaufspreis')
    .isFloat({ min: 0, max: 10000 }).withMessage('Einkaufspreis muss 0-10000 sein'),
  body('verkaufspreis')
    .isFloat({ min: 0, max: 1000 }).withMessage('Verkaufspreis muss 0-1000 sein'),
  body('sollBestand')
    .isInt({ min: 0, max: 100 }).withMessage('Soll-Bestand muss 0-100 sein'),
  body('barcodes')
    .optional().isArray({ max: 20 }).withMessage('Max 20 Barcodes'),
  body('barcodes.*')
    .optional().isString().trim().isLength({ min: 1, max: 64 }).withMessage('Ungültiger Barcode'),
];

const buchungValidation = [
  body('sorteId')
    .isInt({ min: 1 }).withMessage('Ungültige Sorte'),
  // Nur noch Lager: 'auffuellung' und der Standort 'automat' existieren bloss
  // noch in Altbuchungen, neu anlegen lässt sich beides nicht mehr.
  body('typ')
    .trim()
    .notEmpty().withMessage('Typ ist erforderlich')
    .isIn([...BUCHUNGS_TYPEN_NEU]).withMessage('Ungültiger Buchungstyp'),
  body('menge')
    .isInt({ min: 1, max: 1000 }).withMessage('Menge muss 1-1000 sein'),
  body('standort')
    .trim()
    .notEmpty().withMessage('Standort ist erforderlich')
    .isIn([...BUCHUNGS_STANDORTE_NEU]).withMessage('Ungültiger Standort'),
  body('notiz')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 500 }).withMessage('Notiz max 500 Zeichen'),
  body('einkaufspreis')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 10000 }).withMessage('Einkaufspreis muss 0-10000 sein'),
];

const eventValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name ist erforderlich')
    .isLength({ min: 1, max: 100 }).withMessage('Name muss 1-100 Zeichen haben'),
  body('datum')
    .trim()
    .notEmpty().withMessage('Datum ist erforderlich')
    .isISO8601().withMessage('Ungültiges Datum'),
  body('status')
    .trim()
    .notEmpty().withMessage('Status ist erforderlich')
    .isIn([...EVENT_STATI]).withMessage('Ungültiger Status'),
  body('notiz')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 1000 }).withMessage('Notiz max 1000 Zeichen'),
  body('items')
    .isArray({ min: 0, max: 50 }).withMessage('Es sind maximal 50 Positionen erlaubt')
    .bail()
    .custom((items: unknown[]) => {
      items.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) {
          throw new Error(`Position ${index + 1} ist ungültig`);
        }

        const rawItem = item as Record<string, unknown>;
        const typ = typeof rawItem.typ === 'string' ? rawItem.typ.trim() : '';
        const menge = typeof rawItem.menge === 'number' ? rawItem.menge : Number(rawItem.menge);
        const einheit = typeof rawItem.einheit === 'string' ? rawItem.einheit.trim() : '';

        if (!EVENT_POSITION_TYPEN.includes(typ as (typeof EVENT_POSITION_TYPEN)[number])) {
          throw new Error(`Position ${index + 1}: Ungültiger Typ`);
        }

        if (!Number.isFinite(menge) || menge <= 0 || menge > 10000) {
          throw new Error(`Position ${index + 1}: Menge muss zwischen 0 und 10000 liegen`);
        }

        if (!einheit || einheit.length > 40) {
          throw new Error(`Position ${index + 1}: Einheit muss 1-40 Zeichen haben`);
        }

        if (typ === 'sorte') {
          const sorteId = typeof rawItem.sorteId === 'number' ? rawItem.sorteId : Number(rawItem.sorteId);

          if (!Number.isInteger(sorteId) || sorteId < 1) {
            throw new Error(`Position ${index + 1}: Sorte ist erforderlich`);
          }

          return;
        }

        const artikelName = typeof rawItem.artikelName === 'string' ? rawItem.artikelName.trim() : '';

        if (!artikelName || artikelName.length > 120) {
          throw new Error(`Position ${index + 1}: Artikelname muss 1-120 Zeichen haben`);
        }
      });

      return true;
    }),
];

// ===========================
// SORTEN
// ===========================

// GET /sorten - Alle aktiven Sorten
router.get('/sorten', async (_req: Request, res: Response) => {
  try {
    const data = await loadData();
    const aktive = data.sorten.filter(s => s.aktiv);
    res.json(aktive);
  } catch (err) {
    console.error('Fehler beim Laden der Sorten:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden der Sorten' });
  }
});

// POST /sorten - Neue Sorte anlegen
router.post('/sorten', [...sorteValidation, handleValidation], async (req: Request, res: Response) => {
  try {
    const neueSorte = await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const created: Sorte = {
        id: nextId(data.sorten),
        name: req.body.name.trim(),
        kategorie: req.body.kategorie,
        flaschenProKasten: req.body.flaschenProKasten,
        warnschwelle: req.body.warnschwelle,
        einkaufspreis: req.body.einkaufspreis,
        verkaufspreis: req.body.verkaufspreis,
        sollBestand: req.body.sollBestand,
        barcodes: normalizeBarcodes(req.body.barcodes),
        aktiv: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      data.sorten.push(created);
      data.bestand.push({ sorteId: created.id, lager: 0 });
      await saveData(data);
      return created;
    });

    res.status(201).json(neueSorte);
  } catch (err) {
    console.error('Fehler beim Anlegen der Sorte:', err);
    res.status(500).json({ error: 'Serverfehler beim Anlegen der Sorte' });
  }
});

// PUT /sorten/:id - Sorte bearbeiten
router.put('/sorten/:id', [param('id').isInt(), ...sorteValidation, handleValidation], async (req: Request, res: Response) => {
  try {
    const updated = await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const id = parseInt(req.params.id);
      const idx = data.sorten.findIndex(s => s.id === id);

      if (idx === -1) {
        throw Object.assign(new Error('Sorte nicht gefunden'), { status: 404 });
      }

      data.sorten[idx] = {
        ...data.sorten[idx],
        name: req.body.name.trim(),
        kategorie: req.body.kategorie,
        flaschenProKasten: req.body.flaschenProKasten,
        warnschwelle: req.body.warnschwelle,
        einkaufspreis: req.body.einkaufspreis,
        verkaufspreis: req.body.verkaufspreis,
        sollBestand: req.body.sollBestand,
        barcodes: normalizeBarcodes(req.body.barcodes),
        createdAt: data.sorten[idx].createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveData(data);
      return data.sorten[idx];
    });

    res.json(updated);
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Bearbeiten der Sorte:', err);
    res.status(500).json({ error: 'Serverfehler beim Bearbeiten der Sorte' });
  }
});

// DELETE /sorten/:id - Sorte deaktivieren (soft delete)
router.delete('/sorten/:id', [param('id').isInt(), handleValidation], async (req: Request, res: Response) => {
  try {
    await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const id = parseInt(req.params.id);
      const idx = data.sorten.findIndex(s => s.id === id);

      if (idx === -1) {
        throw Object.assign(new Error('Sorte nicht gefunden'), { status: 404 });
      }

      data.sorten[idx].aktiv = false;
      await saveData(data);
    });
    res.json({ message: 'Sorte deaktiviert' });
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Deaktivieren der Sorte:', err);
    res.status(500).json({ error: 'Serverfehler beim Deaktivieren der Sorte' });
  }
});

// ===========================
// PRODUKT-LOOKUP
// ===========================

interface LookupAntwort {
  code: string;
  /** Ist der Lookup in den Add-on-Optionen eingeschaltet? */
  aktiv: boolean;
  gefunden: boolean;
  produkt: ProduktInfo | null;
  /** Sorte, deren Name am besten zum Treffer passt – nur ein Vorschlag. */
  vorschlagSorteId: number | null;
  fehler: string | null;
}

// GET /lookup/:code - Barcode in der öffentlichen Produktdatenbank nachschlagen
router.get('/lookup/:code', [
  param('code')
    .trim()
    .isLength({ min: 4, max: 64 }).withMessage('Ungültiger Barcode')
    .matches(BARCODE_MUSTER).withMessage('Ungültiger Barcode'),
  handleValidation,
], async (req: Request, res: Response) => {
  const code = req.params.code.trim();
  const leer: LookupAntwort = {
    code,
    aktiv: PRODUKT_LOOKUP,
    gefunden: false,
    produkt: null,
    vorschlagSorteId: null,
    fehler: null,
  };

  if (!PRODUKT_LOOKUP) {
    return res.json(leer);
  }

  try {
    const produkt = await lookupProdukt(code);
    if (!produkt) {
      return res.json(leer);
    }

    const data = await loadData();
    const vorschlagSorteId = findeSortenVorschlag(produkt, data.sorten.filter(s => s.aktiv));
    res.json({ ...leer, gefunden: true, produkt, vorschlagSorteId });
  } catch (err) {
    // Kein Internet, Zeitüberschreitung o.ä.: Der Scan muss trotzdem
    // weitergehen – nur eben ohne Vorschlag statt mit einem Fehlerabbruch.
    console.warn(`Produkt-Lookup für ${code} fehlgeschlagen:`, err instanceof Error ? err.message : err);
    res.json({ ...leer, fehler: 'Produktdatenbank nicht erreichbar.' });
  }
});

// ===========================
// SCAN-KOPPLUNG (Handy scannt, anderes Gerät bucht)
// ===========================

const sitzungIdValidation = param('id')
  .trim()
  .isLength({ min: 32, max: 32 }).withMessage('Unbekannte Kopplung')
  .isHexadecimal().withMessage('Unbekannte Kopplung');

// POST /scan-sitzung - Kopplung starten, Code fürs Handy zurückgeben
router.post('/scan-sitzung', (_req: Request, res: Response) => {
  try {
    res.status(201).json(erzeugeSitzung());
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Starten der Kopplung:', err);
    res.status(500).json({ error: 'Serverfehler beim Starten der Kopplung' });
  }
});

/**
 * Der Kopplungscode hat nur sechs Ziffern. Ohne Bremse wäre er in wenigen
 * Minuten durchprobiert – kürzere Sperre als beim Login, weil eine Kopplung
 * ohnehin nur 30 Minuten lebt.
 */
const koppelBremse = erzeugeBremse(10, 5 * 60 * 1000);

// POST /scan-sitzung/beitreten - Handy koppelt sich über den angezeigten Code
router.post('/scan-sitzung/beitreten', [
  body('koppelCode').trim().matches(/^\d{6}$/).withMessage('Der Code besteht aus sechs Ziffern'),
  handleValidation,
], (req: Request, res: Response) => {
  const sperre = koppelBremse.sperre(req);
  if (sperre > 0) {
    return res.status(429).json({
      error: `Zu viele Fehlversuche. Bitte in ${sperrText(sperre)} erneut versuchen.`,
    });
  }

  const treffer = koppele(req.body.koppelCode);
  if (!treffer) {
    koppelBremse.fehlschlag(req);
    return res.status(404).json({ error: 'Kein Gerät mit diesem Code. Läuft die Kopplung noch?' });
  }

  koppelBremse.zuruecksetzen(req);
  res.json(treffer);
});

// POST /scan-sitzung/:id/scan - Handy meldet einen gescannten Barcode
router.post('/scan-sitzung/:id/scan', [
  sitzungIdValidation,
  body('code')
    .trim()
    .isLength({ min: 4, max: 64 }).withMessage('Ungültiger Barcode')
    .matches(BARCODE_MUSTER).withMessage('Ungültiger Barcode'),
  handleValidation,
], (req: Request, res: Response) => {
  const ereignis = scanMelden(req.params.id, req.body.code);
  if (!ereignis) {
    return res.status(404).json({ error: 'Die Kopplung ist beendet oder abgelaufen.' });
  }
  res.status(201).json(ereignis);
});

// GET /scan-sitzung/:id/warten - Empfänger wartet auf neue Scans (Long-Poll)
router.get('/scan-sitzung/:id/warten', [
  sitzungIdValidation,
  query('seit').optional().isInt({ min: 0 }).withMessage('Ungültiger Stand'),
  handleValidation,
], async (req: Request, res: Response) => {
  try {
    const seit = req.query.seit ? parseInt(req.query.seit as string, 10) : 0;
    res.json(await warteAufScans(req.params.id, seit));
  } catch (err) {
    console.error('Fehler beim Warten auf Scans:', err);
    res.status(500).json({ error: 'Serverfehler beim Warten auf Scans' });
  }
});

// DELETE /scan-sitzung/:id - Kopplung beenden
router.delete('/scan-sitzung/:id', [sitzungIdValidation, handleValidation], (req: Request, res: Response) => {
  beende(req.params.id);
  res.json({ message: 'Kopplung beendet' });
});

// ===========================
// BESTAND
// ===========================

// GET /bestand - Gesamtbestand mit Sorteninformationen
router.get('/bestand', async (_req: Request, res: Response) => {
  try {
    const data = await loadData();
    const aktiveSorten = data.sorten.filter(s => s.aktiv);

    const bestandMitSorten = aktiveSorten.map(sorte => {
      const b = data.bestand.find(b => b.sorteId === sorte.id) || { sorteId: sorte.id, lager: 0 };
      const gesamtKaesten = b.lager / sorte.flaschenProKasten;
      return {
        ...b,
        sorte,
        gesamt: b.lager,
        unterWarnschwelle: gesamtKaesten < sorte.warnschwelle,
      };
    });

    res.json(bestandMitSorten);
  } catch (err) {
    console.error('Fehler beim Laden des Bestands:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden des Bestands' });
  }
});

// PUT /bestand/:sorteId - Bestand direkt setzen
router.put('/bestand/:sorteId', [
  param('sorteId').isInt(),
  body('lager').isInt({ min: 0 }).withMessage('Lager muss >= 0 sein'),
  handleValidation,
], async (req: Request, res: Response) => {
  try {
    const neuerBestand = await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const sorteId = parseInt(req.params.sorteId);
      const sorte = data.sorten.find(s => s.id === sorteId && s.aktiv);

      if (!sorte) {
        throw Object.assign(new Error('Sorte nicht gefunden'), { status: 404 });
      }

      const idx = data.bestand.findIndex(b => b.sorteId === sorteId);
      const result: Bestand = {
        sorteId,
        lager: req.body.lager,
      };

      if (idx === -1) {
        data.bestand.push(result);
      } else {
        data.bestand[idx] = result;
      }

      await saveData(data);
      return result;
    });

    res.json(neuerBestand);
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Setzen des Bestands:', err);
    res.status(500).json({ error: 'Serverfehler beim Setzen des Bestands' });
  }
});

// ===========================
// BUCHUNGEN
// ===========================

// POST /buchen - Buchung durchführen
router.post('/buchen', [...buchungValidation, handleValidation], async (req: Request, res: Response) => {
  try {
    const result = await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const { sorteId, typ, menge, standort, notiz } = req.body;
      const einkaufspreisRaw = req.body.einkaufspreis;
      const einkaufspreis = einkaufspreisRaw !== undefined && einkaufspreisRaw !== null && einkaufspreisRaw !== ''
        ? Number(einkaufspreisRaw)
        : undefined;
      const hasEinkaufspreis = einkaufspreis !== undefined && Number.isFinite(einkaufspreis);

      const sorte = data.sorten.find(s => s.id === sorteId && s.aktiv);
      if (!sorte) {
        throw Object.assign(new Error('Sorte nicht gefunden'), { status: 404 });
      }

      let bestandIdx = data.bestand.findIndex(b => b.sorteId === sorteId);
      if (bestandIdx === -1) {
        data.bestand.push({ sorteId, lager: 0 });
        bestandIdx = data.bestand.length - 1;
      }
      const bestand = data.bestand[bestandIdx];

      let buchungsMenge = menge;

      if (typ === 'eingang') {
        bestand.lager += menge * sorte.flaschenProKasten;
        // Aktuellen Einkaufspreis auf der Sorte mitführen (für Anzeige/Empfehlung).
        if (hasEinkaufspreis) {
          sorte.einkaufspreis = einkaufspreis as number;
        }
      } else if (typ === 'ausgang') {
        const flaschenMenge = menge * sorte.flaschenProKasten;
        if (bestand.lager < flaschenMenge) {
          throw Object.assign(new Error(`Nicht genug Bestand im Lager (${bestand.lager} Flaschen vorhanden)`), { status: 400 });
        }
        bestand.lager -= flaschenMenge;
      }

      data.bestand[bestandIdx] = bestand;

      const buchung: Buchung = {
        id: nextId(data.buchungen),
        sorteId,
        datum: new Date().toISOString(),
        typ,
        menge: buchungsMenge,
        standort,
        notiz: notiz?.trim() || null,
        // Einkaufspreis nur bei Eingang mitspeichern (historisch korrekte Kosten).
        ...(typ === 'eingang' && hasEinkaufspreis ? { einkaufspreis: einkaufspreis as number } : {}),
      };
      data.buchungen.push(buchung);

      await saveData(data);
      return { buchung, bestand };
    });

    res.status(201).json(result);
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Buchen:', err);
    res.status(500).json({ error: 'Serverfehler beim Buchen' });
  }
});

// GET /buchungen - Buchungshistorie
router.get('/buchungen', [
  query('sorteId').optional().isInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  handleValidation,
], async (req: Request, res: Response) => {
  try {
    const data = await loadData();
    let buchungen = [...data.buchungen].reverse(); // neueste zuerst

    if (req.query.sorteId) {
      const sorteId = parseInt(req.query.sorteId as string);
      buchungen = buchungen.filter(b => b.sorteId === sorteId);
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    buchungen = buchungen.slice(0, limit);

    // Sortennamen mitgeben
    const mitSorten = buchungen.map(b => ({
      ...b,
      sorteName: data.sorten.find(s => s.id === b.sorteId)?.name || 'Unbekannt',
    }));

    res.json(mitSorten);
  } catch (err) {
    console.error('Fehler beim Laden der Buchungen:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden der Buchungen' });
  }
});

// GET /einkaufsliste - Sorten unter Warnschwelle
router.get('/einkaufsliste', async (_req: Request, res: Response) => {
  try {
    const data = await loadData();
    const aktiveSorten = data.sorten.filter(s => s.aktiv);

    const liste = aktiveSorten
      .map(sorte => {
        const b = data.bestand.find(b => b.sorteId === sorte.id) || { sorteId: sorte.id, lager: 0 };
        const gesamtKaesten = b.lager / sorte.flaschenProKasten;
        const sollBestand = sorte.sollBestand || 4;
        const empfohleneBestellung = Math.max(0, Math.ceil(sollBestand - gesamtKaesten));
        return {
          sorte,
          aktuellerBestand: gesamtKaesten,
          empfohleneBestellung,
        };
      })
      .filter(e => e.empfohleneBestellung > 0);

    res.json(liste);
  } catch (err) {
    console.error('Fehler beim Laden der Einkaufsliste:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden der Einkaufsliste' });
  }
});

// ===========================
// EVENTS
// ===========================

// GET /events - Besondere Events
router.get('/events', async (_req: Request, res: Response) => {
  try {
    const data = await loadData();
    res.json(sortEvents(data.events));
  } catch (err) {
    console.error('Fehler beim Laden der Events:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden der Events' });
  }
});

// POST /events - Neues Event anlegen
router.post('/events', [...eventValidation, handleValidation], async (req: Request, res: Response) => {
  try {
    const created = await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const now = new Date().toISOString();
      const event: BesonderesEvent = {
        id: nextId(data.events),
        name: req.body.name.trim(),
        datum: req.body.datum,
        status: req.body.status,
        notiz: req.body.notiz?.trim() || null,
        items: normalizeEventItems(req.body.items || [], data.sorten),
        createdAt: now,
        updatedAt: now,
      };

      data.events.push(event);
      await saveData(data);
      return event;
    });

    res.status(201).json(created);
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Anlegen des Events:', err);
    res.status(500).json({ error: 'Serverfehler beim Anlegen des Events' });
  }
});

// PUT /events/:id - Event bearbeiten
router.put('/events/:id', [param('id').isInt(), ...eventValidation, handleValidation], async (req: Request, res: Response) => {
  try {
    const updated = await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const id = parseInt(req.params.id, 10);
      const idx = data.events.findIndex(event => event.id === id);

      if (idx === -1) {
        throw Object.assign(new Error('Event nicht gefunden'), { status: 404 });
      }

      data.events[idx] = {
        ...data.events[idx],
        name: req.body.name.trim(),
        datum: req.body.datum,
        status: req.body.status,
        notiz: req.body.notiz?.trim() || null,
        items: normalizeEventItems(req.body.items || [], data.sorten),
        createdAt: data.events[idx].createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveData(data);
      return data.events[idx];
    });

    res.json(updated);
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Bearbeiten des Events:', err);
    res.status(500).json({ error: 'Serverfehler beim Bearbeiten des Events' });
  }
});

// DELETE /events/:id - Event löschen
router.delete('/events/:id', [param('id').isInt(), handleValidation], async (req: Request, res: Response) => {
  try {
    await withFileLock(DATA_PATH, async () => {
      const data = await loadData();
      const id = parseInt(req.params.id, 10);
      const idx = data.events.findIndex(event => event.id === id);

      if (idx === -1) {
        throw Object.assign(new Error('Event nicht gefunden'), { status: 404 });
      }

      data.events.splice(idx, 1);
      await saveData(data);
    });

    res.json({ message: 'Event gelöscht' });
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Fehler beim Löschen des Events:', err);
    res.status(500).json({ error: 'Serverfehler beim Löschen des Events' });
  }
});

// ===========================
// STATISTIK
// ===========================

// GET /statistik - Verbrauchsstatistik nach Monat
router.get('/statistik', async (_req: Request, res: Response) => {
  try {
    const data = await loadData();

    const monatMap: Record<string, { eingang: number; ausgang: number }> = {};
    const proSorte: Record<string, Record<string, { eingang: number; ausgang: number }>> = {};

    for (const b of data.buchungen) {
      const monat = b.datum.substring(0, 7); // YYYY-MM
      if (!monatMap[monat]) monatMap[monat] = { eingang: 0, ausgang: 0 };

      if (b.typ === 'eingang') monatMap[monat].eingang += b.menge;
      else if (b.typ === 'ausgang') monatMap[monat].ausgang += b.menge;

      const sorteName = data.sorten.find(s => s.id === b.sorteId)?.name || 'Unbekannt';
      if (!proSorte[sorteName]) proSorte[sorteName] = {};
      if (!proSorte[sorteName][monat]) proSorte[sorteName][monat] = { eingang: 0, ausgang: 0 };
      if (b.typ === 'eingang') proSorte[sorteName][monat].eingang += b.menge;
      else if (b.typ === 'ausgang') proSorte[sorteName][monat].ausgang += b.menge;
    }

    const gesamt = Object.entries(monatMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monat, vals]) => ({ monat, ...vals }));

    const proSorteResult: Record<string, { monat: string; eingang: number; ausgang: number }[]> = {};
    for (const [name, monate] of Object.entries(proSorte)) {
      proSorteResult[name] = Object.entries(monate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([monat, vals]) => ({ monat, ...vals }));
    }

    res.json({ gesamt, proSorte: proSorteResult });
  } catch (err) {
    console.error('Fehler beim Laden der Statistik:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden der Statistik' });
  }
});

// ===========================
// KASSENBERICHT
// ===========================

// GET /kassenbericht - Einnahmen & Ausgaben nach Monat
router.get('/kassenbericht', async (_req: Request, res: Response) => {
  try {
    const data = await loadData();

    const monatMap: Record<string, { einnahmen: number; ausgaben: number }> = {};

    for (const b of data.buchungen) {
      const monat = b.datum.substring(0, 7);
      const sorte = data.sorten.find(s => s.id === b.sorteId);
      if (!sorte) continue;

      if (!monatMap[monat]) monatMap[monat] = { einnahmen: 0, ausgaben: 0 };

      if (b.typ === 'eingang') {
        // Einkauf: Kosten = Menge * Einkaufspreis pro Kasten.
        // Bevorzugt den zum Eingang gespeicherten Preis (schwankende Preise),
        // Fallback auf den aktuellen Sorten-Preis für Alt-Buchungen.
        const preis = b.einkaufspreis ?? sorte.einkaufspreis ?? 0;
        monatMap[monat].ausgaben += b.menge * preis;
      } else if (b.typ === 'ausgang') {
        // Verkauf: Einnahmen = Menge * Flaschen pro Kasten * Verkaufspreis pro Flasche
        monatMap[monat].einnahmen += b.menge * sorte.flaschenProKasten * (sorte.verkaufspreis || 0);
      }
    }

    const monate = Object.entries(monatMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monat, vals]) => ({
        monat,
        einnahmen: Math.round(vals.einnahmen * 100) / 100,
        ausgaben: Math.round(vals.ausgaben * 100) / 100,
        gewinn: Math.round((vals.einnahmen - vals.ausgaben) * 100) / 100,
      }));

    const gesamtEinnahmen = Math.round(monate.reduce((s, m) => s + m.einnahmen, 0) * 100) / 100;
    const gesamtAusgaben = Math.round(monate.reduce((s, m) => s + m.ausgaben, 0) * 100) / 100;

    res.json({
      monate,
      gesamtEinnahmen,
      gesamtAusgaben,
      gesamtGewinn: Math.round((gesamtEinnahmen - gesamtAusgaben) * 100) / 100,
    });
  } catch (err) {
    console.error('Fehler beim Laden des Kassenberichts:', err);
    res.status(500).json({ error: 'Serverfehler beim Laden des Kassenberichts' });
  }
});

export default router;
