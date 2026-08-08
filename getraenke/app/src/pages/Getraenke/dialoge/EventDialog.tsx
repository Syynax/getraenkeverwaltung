import type {
  Sorte, BesonderesEventFormData, EventPositionFormData,
  EventStatus, EventPositionTyp,
} from '../../../types/getraenke';
import { EVENT_STATI, EVENT_POSITION_TYPEN } from '../../../constants/getraenke';
import { EVENT_STATUS_LABELS, EVENT_POSITION_LABELS } from '../hilfen';
import { GermanDateInput } from '../../../components';
import styles from '../Getraenke.module.css';

interface EventDialogProps {
  form: BesonderesEventFormData;
  onChange: (form: BesonderesEventFormData) => void;
  sorten: Sorte[];
  /** Gesetzt beim Bearbeiten – steuert Titel und Beschriftung des Knopfs. */
  bearbeitet: number | null;
  onPositionHinzu: () => void;
  onPositionWeg: (itemId: number) => void;
  onPositionAendern: (itemId: number, patch: Partial<EventPositionFormData>) => void;
  onPositionTyp: (itemId: number, typ: EventPositionTyp) => void;
  onPositionSorte: (itemId: number, sorteId: number) => void;
  fehler: string | null;
  busy: boolean;
  onAbbrechen: () => void;
  onSpeichern: () => void;
}

/** Besonderes Event mit eigener Einkaufsliste – Getränkesorten und freie Artikel. */
export const EventDialog: React.FC<EventDialogProps> = ({
  form, onChange, sorten, bearbeitet,
  onPositionHinzu, onPositionWeg, onPositionAendern, onPositionTyp, onPositionSorte,
  fehler, busy, onAbbrechen, onSpeichern,
}) => (
  <div className={styles.modalOverlay} onClick={onAbbrechen}>
    <div className={`${styles.modal} ${styles.modalLarge}`} onClick={e => e.stopPropagation()}>
      <h2>{bearbeitet ? 'Event bearbeiten' : 'Besonderes Event anlegen'}</h2>
      {fehler && <div className={styles.errorMessage}>{fehler}</div>}

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => onChange({ ...form, name: e.target.value })}
            placeholder="z.B. Sommerfest 2026"
          />
        </div>
        <div className={styles.formGroup}>
          <label>Datum</label>
          <GermanDateInput
            name="datum"
            value={form.datum}
            onChange={e => onChange({ ...form, datum: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Status</label>
          <select
            value={form.status}
            onChange={e => onChange({ ...form, status: e.target.value as EventStatus })}
          >
            {EVENT_STATI.map(status => (
              <option key={status} value={status}>{EVENT_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label>Hinweis</label>
          <input
            type="text"
            value={form.notiz || ''}
            onChange={e => onChange({ ...form, notiz: e.target.value })}
            placeholder="Kurzinfo oder Zuständigkeit"
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <div className={styles.eventFormHeader}>
          <label>Was muss gekauft werden?</label>
          <button type="button" className={styles.btnSecondary} onClick={onPositionHinzu}>
            <i className="fas fa-plus"></i> Position
          </button>
        </div>

        <div className={styles.eventFormList}>
          {form.items.length === 0 ? (
            <div className={styles.eventItemsEmpty}>Noch keine Positionen hinterlegt</div>
          ) : (
            form.items.map((item, index) => (
              <div key={item.id} className={styles.eventFormItemCard}>
                <div className={styles.eventFormItemHeader}>
                  <strong>Position {index + 1}</strong>
                  <button
                    type="button"
                    className={`${styles.quickBtn} ${styles.btnDelete}`}
                    onClick={() => onPositionWeg(item.id)}
                    title="Position entfernen"
                  >
                    <i className="fas fa-trash" style={{ fontSize: '0.6875rem' }}></i>
                  </button>
                </div>

                <div className={styles.eventFormItemGrid}>
                  <div className={styles.formGroup}>
                    <label>Typ</label>
                    <select
                      value={item.typ}
                      onChange={e => onPositionTyp(item.id, e.target.value as EventPositionTyp)}
                    >
                      {EVENT_POSITION_TYPEN.map(type => (
                        <option key={type} value={type}>{EVENT_POSITION_LABELS[type]}</option>
                      ))}
                    </select>
                  </div>

                  {item.typ === 'sorte' ? (
                    <div className={styles.formGroup}>
                      <label>Getränkesorte</label>
                      <select
                        value={item.sorteId ?? ''}
                        onChange={e => onPositionSorte(item.id, parseInt(e.target.value, 10))}
                        disabled={sorten.length === 0}
                      >
                        {sorten.length === 0 ? (
                          <option value="">Keine Sorten vorhanden</option>
                        ) : (
                          sorten.map(sorte => (
                            <option key={sorte.id} value={sorte.id}>{sorte.name}</option>
                          ))
                        )}
                      </select>
                    </div>
                  ) : (
                    <div className={styles.formGroup}>
                      <label>Artikel</label>
                      <input
                        type="text"
                        value={item.artikelName}
                        onChange={e => onPositionAendern(item.id, { artikelName: e.target.value })}
                        placeholder="z.B. Becher, Servietten, Eis"
                      />
                    </div>
                  )}

                  <div className={styles.formGroup}>
                    <label>Menge</label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={item.menge}
                      onChange={e => onPositionAendern(item.id, { menge: parseFloat(e.target.value) || 0 })}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Einheit</label>
                    <input
                      type="text"
                      value={item.einheit}
                      onChange={e => onPositionAendern(item.id, { einheit: e.target.value })}
                      placeholder={item.typ === 'sorte' ? 'Kästen' : 'Stück'}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={styles.modalActions}>
        <button className={styles.btnSecondary} onClick={onAbbrechen}>Abbrechen</button>
        <button className={styles.btnPrimary} onClick={onSpeichern} disabled={busy}>
          {busy ? 'Speichern...' : bearbeitet ? 'Speichern' : 'Event anlegen'}
        </button>
      </div>
    </div>
  </div>
);
