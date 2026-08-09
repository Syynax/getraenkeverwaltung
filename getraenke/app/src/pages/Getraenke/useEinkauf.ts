import { useState, useEffect, useMemo } from 'react';
import type { BestandMitSorte, Einkaufsliste } from '../../types/getraenke';
import { ladeEinkaufDraft, merkeEinkaufDraft, type EinkaufDraft } from './hilfen';

/**
 * Der Zustand des Einkauf-Tabs an einem Ort.
 *
 * Er hängt an mehr Teilen als die übrigen Ansichten – erfasste Mengen, der
 * Filter, die Gruppierung und die Summe greifen ineinander. Als eigener Hook
 * bleibt der Tab eine reine Darstellung und die Seite muss davon nichts wissen.
 */

export interface EinkaufsZeile {
  schluessel: string;
  name: string;
  /** Bei einer Gruppe: die Marken, aus denen gewählt werden kann. */
  hinweis: string | null;
  aktuellerBestand: number;
  empfohleneBestellung: number;
}

export interface EinkaufsBlock {
  id: number | null;
  name: string | null;
  eintraege: BestandMitSorte[];
  /** Gruppenbedarf, sofern die Oberkategorie einen offenen Soll hat. */
  bedarf: Einkaufsliste['gruppen'][number] | undefined;
  erfasst: number;
  offen: number;
}

export const useEinkauf = (bestand: BestandMitSorte[], einkaufsliste: Einkaufsliste) => {
  // Liegt in der sessionStorage, damit ein Reload im Getränkemarkt nicht die
  // halbe Bestellung kostet.
  const [draft, setDraft] = useState<EinkaufDraft>(ladeEinkaufDraft);
  const [nurNachbestellen, setNurNachbestellen] = useState(true);

  useEffect(() => { merkeEinkaufDraft(draft); }, [draft]);

  const empfehlungJeSorte = useMemo(
    () => new Map(einkaufsliste.sorten.map(e => [e.sorte.id, e.empfohleneBestellung])),
    [einkaufsliste],
  );

  /** Ausgangswert einer Zeile – nimmt den Entwurf entgegen statt ihn zu lesen. */
  const zeileAus = (b: BestandMitSorte, aus: EinkaufDraft) => aus[b.sorte.id] ?? {
    menge: empfehlungJeSorte.get(b.sorte.id) ?? 0,
    preis: b.sorte.einkaufspreis ?? 0,
  };

  const zeile = (b: BestandMitSorte) => zeileAus(b, draft);

  const setzeZeile = (b: BestandMitSorte, patch: Partial<{ menge: number; preis: number }>) => {
    setDraft(prev => ({ ...prev, [b.sorte.id]: { ...zeileAus(b, prev), ...patch } }));
  };

  /**
   * Menge relativ verändern. Muss aus `prev` rechnen: Vier schnelle Klicks auf
   * „+" landen im selben Render-Durchlauf und würden sonst alle denselben
   * Ausgangswert sehen – drei davon gingen verloren.
   */
  const aendereMenge = (b: BestandMitSorte, delta: number) => {
    setDraft(prev => {
      const alt = zeileAus(b, prev);
      return { ...prev, [b.sorte.id]: { ...alt, menge: Math.max(0, alt.menge + delta) } };
    });
  };

  /**
   * Einkaufsliste zum Anzeigen, Kopieren und Drucken: eigenständige Sorten und
   * Gruppen in einer gemeinsamen Form.
   */
  const zeilen = useMemo<EinkaufsZeile[]>(() => [
    ...einkaufsliste.sorten.map(e => ({
      schluessel: `s${e.sorte.id}`,
      name: e.sorte.name,
      hinweis: null,
      aktuellerBestand: e.aktuellerBestand,
      empfohleneBestellung: e.empfohleneBestellung,
    })),
    ...einkaufsliste.gruppen.map(g => ({
      schluessel: `g${g.oberkategorie.id}`,
      name: g.oberkategorie.name,
      hinweis: g.sorten.map(s => s.name).join(', '),
      aktuellerBestand: g.aktuellerBestand,
      empfohleneBestellung: g.empfohleneBestellung,
    })),
  ], [einkaufsliste]);

  /**
   * Sorten, die zu einer Gruppe mit Bedarf gehören. Vorbelegt wird bei ihnen
   * keine Menge – welche Marke es wird, entscheidet der Einkauf. Sichtbar
   * bleiben müssen sie trotzdem.
   */
  const gruppenSorten = useMemo(() => {
    const ids = new Set<number>();
    for (const g of einkaufsliste.gruppen) for (const s of g.sorten) ids.add(s.id);
    return ids;
  }, [einkaufsliste]);

  // Standardmässig nur zeigen, was ansteht – plus alles, wo schon eine Menge
  // drinsteht, sonst würde eine erfasste Zeile beim Filtern verschwinden.
  const offen = useMemo(() => bestand.filter(b =>
    (empfehlungJeSorte.get(b.sorte.id) ?? 0) > 0
    || (draft[b.sorte.id]?.menge ?? 0) > 0
    || gruppenSorten.has(b.sorte.id),
  ), [bestand, empfehlungJeSorte, draft, gruppenSorten]);

  const sichtbar = nurNachbestellen ? offen : bestand;

  /**
   * Nach Oberkategorie geblockt, damit der Gruppenbedarf dort steht, wo die
   * Mengen erfasst werden – und beim Hochsteppen live herunterzählt.
   */
  const bloecke = useMemo<EinkaufsBlock[]>(() => {
    const bedarfJeGruppe = new Map(einkaufsliste.gruppen.map(g => [g.oberkategorie.id, g]));
    const gesammelt = new Map<number | null, { id: number | null; name: string | null; eintraege: BestandMitSorte[] }>();

    for (const b of sichtbar) {
      const schluessel = b.oberkategorieId;
      const vorhanden = gesammelt.get(schluessel);
      if (vorhanden) vorhanden.eintraege.push(b);
      else gesammelt.set(schluessel, { id: schluessel, name: b.oberkategorieName, eintraege: [b] });
    }

    return [...gesammelt.values()].sort((a, b) => {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return a.name.localeCompare(b.name, 'de');
    }).map(block => {
      const bedarf = block.id != null ? bedarfJeGruppe.get(block.id) : undefined;
      const erfasst = block.eintraege.reduce((summe, b) => summe + zeileAus(b, draft).menge, 0);
      return {
        ...block,
        bedarf,
        erfasst,
        offen: bedarf ? Math.max(0, bedarf.empfohleneBestellung - erfasst) : 0,
      };
    });
    // zeileAus hängt nur an empfehlungJeSorte und dem übergebenen Entwurf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sichtbar, einkaufsliste, draft, empfehlungJeSorte]);

  const summe = useMemo(() =>
    bestand.reduce((s, b) => {
      const z = zeileAus(b, draft);
      return s + (z.menge > 0 ? z.menge * z.preis : 0);
    }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bestand, draft, empfehlungJeSorte],
  );

  /** Was tatsächlich gebucht wird: alle Zeilen mit Menge. */
  const zuBuchen = () => bestand
    .map(b => {
      const z = zeileAus(b, draft);
      return { sorteId: b.sorte.id, menge: z.menge, einkaufspreis: z.preis };
    })
    .filter(i => i.menge > 0);

  return {
    draft,
    leeren: () => setDraft({}),
    nurNachbestellen,
    setNurNachbestellen,
    zeile,
    setzeZeile,
    aendereMenge,
    empfehlungJeSorte,
    zeilen,
    offen,
    sichtbar,
    bloecke,
    summe,
    zuBuchen,
  };
};
