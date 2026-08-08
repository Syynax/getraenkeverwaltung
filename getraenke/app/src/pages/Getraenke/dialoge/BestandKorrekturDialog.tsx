import type { BestandKorrekturState } from '../hilfen';
import styles from '../Getraenke.module.css';

interface BestandKorrekturDialogProps {
  stand: BestandKorrekturState;
  onChange: (stand: BestandKorrekturState) => void;
  fehler: string | null;
  busy: boolean;
  onAbbrechen: () => void;
  onSpeichern: () => void;
}

/**
 * Bestand einer Sorte direkt setzen – ohne Buchung, also ohne Wirkung auf
 * Verlauf und Kassenbericht. Für dokumentierte Abweichungen gibt es die Inventur.
 */
export const BestandKorrekturDialog: React.FC<BestandKorrekturDialogProps> = ({
  stand, onChange, fehler, busy, onAbbrechen, onSpeichern,
}) => (
  <div className={styles.modalOverlay} onClick={onAbbrechen}>
    <div className={styles.modal} onClick={e => e.stopPropagation()}>
      <h2>Bestand korrigieren: {stand.sorteName}</h2>
      {fehler && <div className={styles.errorMessage}>{fehler}</div>}

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Flaschen im Lager</label>
          <input
            type="number"
            min={0}
            value={stand.lager}
            onChange={e => onChange({ ...stand, lager: parseInt(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className={styles.modalActions}>
        <button className={styles.btnSecondary} onClick={onAbbrechen}>Abbrechen</button>
        <button className={styles.btnPrimary} onClick={onSpeichern} disabled={busy}>
          {busy ? 'Speichern...' : 'Bestand setzen'}
        </button>
      </div>
    </div>
  </div>
);
