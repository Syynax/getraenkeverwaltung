import type { Sorte, BuchungFormData, BuchungsTyp } from '../../../types/getraenke';
import styles from '../Getraenke.module.css';

interface BuchungDialogProps {
  sorten: Sorte[];
  form: BuchungFormData;
  onChange: (form: BuchungFormData) => void;
  fehler: string | null;
  busy: boolean;
  onAbbrechen: () => void;
  onSpeichern: () => void;
}

/** Eingang, Ausgang oder Schwund von Hand erfassen. */
export const BuchungDialog: React.FC<BuchungDialogProps> = ({
  sorten, form, onChange, fehler, busy, onAbbrechen, onSpeichern,
}) => (
  <div className={styles.modalOverlay} onClick={onAbbrechen}>
    <div className={styles.modal} onClick={e => e.stopPropagation()}>
      <h2>Buchung erfassen</h2>
      {fehler && <div className={styles.errorMessage}>{fehler}</div>}

      <div className={styles.formGroup}>
        <label>Sorte</label>
        <select
          value={form.sorteId}
          onChange={e => onChange({ ...form, sorteId: parseInt(e.target.value) })}
        >
          {sorten.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Typ</label>
          <select
            value={form.typ}
            onChange={e => onChange({ ...form, typ: e.target.value as BuchungsTyp })}
          >
            <option value="eingang">Eingang (Lieferung)</option>
            <option value="ausgang">Ausgang (Verkauf)</option>
            <option value="schwund">Schwund / Bruch (kein Verkauf)</option>
          </select>
        </div>
        <div className={styles.formGroup}>
          <label>Menge (Kästen)</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={form.menge}
            onChange={e => onChange({ ...form, menge: parseInt(e.target.value) || 1 })}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>Notiz (optional)</label>
        <textarea
          value={form.notiz || ''}
          onChange={e => onChange({ ...form, notiz: e.target.value })}
          placeholder="z.B. Lieferung Getränke Müller"
          rows={2}
        />
      </div>

      <div className={styles.modalActions}>
        <button className={styles.btnSecondary} onClick={onAbbrechen}>Abbrechen</button>
        <button className={styles.btnPrimary} onClick={onSpeichern} disabled={busy || !form.sorteId}>
          {busy ? 'Buchen...' : 'Buchen'}
        </button>
      </div>
    </div>
  </div>
);
