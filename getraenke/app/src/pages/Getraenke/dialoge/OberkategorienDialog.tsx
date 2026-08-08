import type { OberkategorieFormData, OberkategorieMitBestand } from '../../../types/getraenke';
import { zahlOderLeer } from '../hilfen';
import styles from '../Getraenke.module.css';

interface OberkategorienDialogProps {
  gruppen: OberkategorieMitBestand[];
  form: OberkategorieFormData;
  onChange: (form: OberkategorieFormData) => void;
  /** Id der Gruppe, die gerade bearbeitet wird – null heisst „neu anlegen". */
  bearbeitet: number | null;
  onBearbeiten: (g: OberkategorieMitBestand) => void;
  onNeuStattBearbeiten: () => void;
  onLoeschen: (g: OberkategorieMitBestand) => void;
  fehler: string | null;
  busy: boolean;
  onSchliessen: () => void;
  onSpeichern: () => void;
}

const leer: OberkategorieFormData = { name: '', sollBestand: '', warnschwelle: '' };
export const leereGruppe = (): OberkategorieFormData => ({ ...leer });

/** Oberkategorien anlegen, bearbeiten und entfernen – Liste und Formular in einem. */
export const OberkategorienDialog: React.FC<OberkategorienDialogProps> = ({
  gruppen, form, onChange, bearbeitet, onBearbeiten, onNeuStattBearbeiten,
  onLoeschen, fehler, busy, onSchliessen, onSpeichern,
}) => (
  <div className={styles.modalOverlay} onClick={onSchliessen}>
    <div className={`${styles.modal} ${styles.modalLarge}`} onClick={e => e.stopPropagation()}>
      <h2>Oberkategorien</h2>
      {fehler && <div className={styles.errorMessage}>{fehler}</div>}

      <p className={styles.mehrFelderHinweis}>
        Eine Oberkategorie fasst mehrere Marken zusammen – etwa „Bier" über Augustiner,
        Tegernseer und was gerade zum Probieren dasteht. Der Soll-Bestand gilt für die
        Gruppe als Ganzes: Nachbestellt wird, wenn insgesamt zu wenig da ist, nicht
        sobald eine einzelne Marke leer ist.
      </p>

      {gruppen.length > 0 && (
        <div className={styles.inventurListe}>
          {gruppen.map(g => (
            <div key={g.id} className={styles.inventurZeile}>
              <div className={styles.inventurName}>
                <strong>{g.name}</strong>
                {/* Zwei Zahlen mit verschiedener Bedeutung: alles im Regal und
                    der Teil, an dem sich der Bedarf misst. */}
                <span className={styles.einkaufMeta}>
                  {g.sortenAnzahl} Sorte{g.sortenAnzahl === 1 ? '' : 'n'} ·{' '}
                  {g.aktuellerBestand.toFixed(1)} Kästen gesamt
                  {g.sollBestand > 0
                    ? ` · ${g.bestandFuerSoll.toFixed(1)} von ${g.sollBestand} auf den Soll`
                    : ' · kein Soll'}
                </span>
              </div>
              <button className={styles.stornoBtn} title="Bearbeiten" onClick={() => onBearbeiten(g)}>
                <i className="fas fa-pen"></i>
              </button>
              <button
                className={styles.stornoBtn}
                title="Entfernen"
                disabled={busy}
                onClick={() => onLoeschen(g)}
              >
                <i className="fas fa-trash"></i>
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: '0.9375rem', margin: '0.5rem 0' }}>
        {bearbeitet !== null ? 'Oberkategorie bearbeiten' : 'Neue Oberkategorie'}
      </h3>
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => onChange({ ...form, name: e.target.value })}
            placeholder="z.B. Bier"
          />
        </div>
        <div className={styles.formGroup}>
          <label>Soll-Bestand (Kästen)</label>
          <input
            type="number" min={0} max={500}
            value={form.sollBestand}
            placeholder="0"
            onChange={e => onChange({ ...form, sollBestand: zahlOderLeer(e.target.value) })}
          />
        </div>
        <div className={styles.formGroup}>
          <label>Warnschwelle (Kästen)</label>
          <input
            type="number" min={0} max={500}
            value={form.warnschwelle}
            placeholder="0"
            onChange={e => onChange({ ...form, warnschwelle: zahlOderLeer(e.target.value) })}
          />
        </div>
      </div>

      <div className={styles.modalActions}>
        {bearbeitet !== null && (
          <button className={styles.btnSecondary} onClick={onNeuStattBearbeiten}>
            Neu statt bearbeiten
          </button>
        )}
        <button className={styles.btnSecondary} onClick={onSchliessen}>Schliessen</button>
        <button
          className={styles.btnPrimary}
          onClick={onSpeichern}
          disabled={busy || !form.name.trim()}
        >
          {bearbeitet !== null ? 'Speichern' : 'Anlegen'}
        </button>
      </div>
    </div>
  </div>
);
