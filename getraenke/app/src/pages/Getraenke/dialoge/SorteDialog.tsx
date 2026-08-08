import type { SorteFormData, Kategorie, OberkategorieMitBestand } from '../../../types/getraenke';
import { GEBINDE, SORTE_VORGABEN, zahlOderLeer } from '../hilfen';
import styles from '../Getraenke.module.css';

interface SorteDialogProps {
  form: SorteFormData;
  onChange: (form: SorteFormData) => void;
  oberkategorien: OberkategorieMitBestand[];
  /** Gesetzt beim Bearbeiten – steuert Titel und den aufgeklappten Kürbereich. */
  bearbeitet: number | null;
  /** Barcode, aus dem die Sorte entstand, wenn sie aus einem Scan angelegt wird. */
  ausScanCode: string | null;
  /** Name einer schon vorhandenen Sorte mit gleichem Namen, sonst null. */
  namensDublette: string | null;
  fehler: string | null;
  busy: boolean;
  onAbbrechen: () => void;
  onSpeichern: () => void;
}

/**
 * Sorte anlegen oder bearbeiten.
 *
 * Pflicht sind nur Name, Kategorie und Gebinde – alles andere steckt
 * zusammengeklappt hinter „Preise, Schwellen und Barcodes" und darf leer
 * bleiben.
 */
export const SorteDialog: React.FC<SorteDialogProps> = ({
  form, onChange, oberkategorien, bearbeitet, ausScanCode, namensDublette,
  fehler, busy, onAbbrechen, onSpeichern,
}) => (
  <div className={styles.modalOverlay} onClick={onAbbrechen}>
    <div className={styles.modal} onClick={e => e.stopPropagation()}>
      <h2>{bearbeitet ? 'Sorte bearbeiten' : 'Neue Sorte anlegen'}</h2>

      {ausScanCode && (
        <p className={styles.mehrFelderHinweis}>
          Aus dem Scan von <code>{ausScanCode}</code> – der Barcode ist schon hinterlegt.
        </p>
      )}
      {fehler && <div className={styles.errorMessage}>{fehler}</div>}

      <div className={styles.formGroup}>
        <label>Name</label>
        <input
          type="text"
          value={form.name}
          onChange={e => onChange({ ...form, name: e.target.value })}
          placeholder="z.B. Augustiner Hell"
        />
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Kategorie</label>
          <select
            value={form.kategorie}
            onChange={e => onChange({ ...form, kategorie: e.target.value as Kategorie })}
          >
            <option value="alkoholfrei">Alkoholfrei</option>
            <option value="alkoholisch">Alkoholisch</option>
          </select>
        </div>
        <div className={styles.formGroup}>
          <label>Oberkategorie</label>
          <select
            value={form.oberkategorieId ?? ''}
            onChange={e => onChange({
              ...form,
              oberkategorieId: e.target.value ? Number(e.target.value) : null,
            })}
          >
            <option value="">— eigenständig —</option>
            {oberkategorien.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </div>

      {form.oberkategorieId !== null && (
        <p className={styles.mehrFelderHinweis}>
          Diese Sorte zählt auf den Soll-Bestand der Oberkategorie ein und löst
          selbst keine Nachbestellung aus – genau richtig für ein Bier, das nur mal
          zum Probieren im Keller steht. Soll sie zusätzlich einzeln überwacht
          werden, trag unten einen eigenen Soll-Bestand ein.
        </p>
      )}

      <div className={styles.formGroup}>
        <label>Gebinde</label>
        <div className={styles.gebindeWahl}>
          {GEBINDE.map(g => (
            <button
              key={g.wert}
              type="button"
              className={`${styles.gebindeBtn} ${form.flaschenProKasten === g.wert ? styles.gebindeBtnAktiv : ''}`}
              onClick={() => onChange({ ...form, flaschenProKasten: g.wert })}
            >
              {g.label}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={100}
            className={styles.gebindeEigen}
            value={form.flaschenProKasten}
            onChange={e => onChange({ ...form, flaschenProKasten: parseInt(e.target.value) || 1 })}
            aria-label="Flaschen pro Kasten"
            title="Flaschen pro Kasten"
          />
        </div>
      </div>

      {namensDublette && (
        <div className={styles.hinweisBox}>
          <i className="fas fa-circle-info"></i>
          <span>Es gibt schon eine Sorte <strong>{namensDublette}</strong>. Anlegen geht trotzdem.</span>
        </div>
      )}

      <details className={styles.mehrFelder} open={bearbeitet !== null}>
        <summary>Preise, Schwellen und Barcodes</summary>

        <p className={styles.mehrFelderHinweis}>
          Alles hier ist freiwillig. Leer heisst: Warnschwelle {SORTE_VORGABEN.warnschwelle},
          Soll-Bestand {form.oberkategorieId !== null
            ? '0 – die Oberkategorie übernimmt das'
            : `${SORTE_VORGABEN.sollBestand} Kästen`}, Preise noch offen. Der
          Einkaufspreis trägt sich beim ersten Einbuchen von selbst nach.
        </p>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label>Warnschwelle (Kästen)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.warnschwelle}
              placeholder={String(SORTE_VORGABEN.warnschwelle)}
              onChange={e => onChange({ ...form, warnschwelle: zahlOderLeer(e.target.value) })}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Soll-Bestand (Kästen)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.sollBestand}
              placeholder={String(SORTE_VORGABEN.sollBestand)}
              onChange={e => onChange({ ...form, sollBestand: zahlOderLeer(e.target.value) })}
            />
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label>Einkaufspreis (€/Kasten)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.einkaufspreis}
              placeholder="noch offen"
              onChange={e => onChange({ ...form, einkaufspreis: zahlOderLeer(e.target.value, true) })}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Verkaufspreis (€/Flasche)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.verkaufspreis}
              placeholder="noch offen"
              onChange={e => onChange({ ...form, verkaufspreis: zahlOderLeer(e.target.value, true) })}
            />
          </div>
        </div>

        <div className={styles.formGroup}>
          <label>Barcodes (EAN, kommagetrennt – für Scan-Einlagerung)</label>
          <input
            type="text"
            value={(form.barcodes ?? []).join(', ')}
            onChange={e => onChange({
              ...form,
              barcodes: e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
            })}
            placeholder="z.B. 4001686386002, 4001686386019"
          />
        </div>
      </details>

      <div className={styles.modalActions}>
        <button className={styles.btnSecondary} onClick={onAbbrechen}>Abbrechen</button>
        <button className={styles.btnPrimary} onClick={onSpeichern} disabled={busy || !form.name.trim()}>
          {busy ? 'Speichern...' : bearbeitet ? 'Speichern' : 'Anlegen'}
        </button>
      </div>
    </div>
  </div>
);
