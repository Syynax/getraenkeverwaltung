import type { BestandMitSorte, InventurAbweichung } from '../../../types/getraenke';
import { formatBestand } from '../hilfen';
import styles from '../Getraenke.module.css';

interface InventurDialogProps {
  bestand: BestandMitSorte[];
  /** Gezählte Flaschen je Sorte; leer heisst „noch nicht gezählt". */
  zaehlung: Record<number, number | ''>;
  /**
   * Bewusst der React-Setter und nicht der fertige Wert: Zwei Eingaben im
   * selben Durchlauf würden sich sonst gegenseitig überschreiben – derselbe
   * Fehler, der die Einkaufs-Stepper Klicks kosten liess.
   */
  onZaehlung: React.Dispatch<React.SetStateAction<Record<number, number | ''>>>;
  notiz: string;
  onNotiz: (notiz: string) => void;
  /** Gesetzt, sobald gebucht wurde – dann zeigt der Dialog das Ergebnis. */
  ergebnis: InventurAbweichung[] | null;
  fehler: string | null;
  busy: boolean;
  onSchliessen: () => void;
  onUebernehmen: () => void;
}

/**
 * Inventur: gezählte Flaschen erfassen, Abweichungen als Buchungen festhalten.
 * Derselbe Dialog zeigt danach, was gebucht wurde.
 */
export const InventurDialog: React.FC<InventurDialogProps> = ({
  bestand, zaehlung, onZaehlung, notiz, onNotiz, ergebnis, fehler, busy, onSchliessen, onUebernehmen,
}) => (
  <div className={styles.modalOverlay} onClick={onSchliessen}>
    <div className={`${styles.modal} ${styles.modalLarge}`} onClick={e => e.stopPropagation()}>
      <h2>Inventur</h2>
      {fehler && <div className={styles.errorMessage}>{fehler}</div>}

      {ergebnis ? (
        <>
          {ergebnis.length === 0 ? (
            <div className={styles.hinweisBox}>
              <i className="fas fa-circle-check"></i>
              <span>Keine Abweichungen – der Bestand stimmt.</span>
            </div>
          ) : (
            <>
              <p className={styles.mehrFelderHinweis}>
                {ergebnis.length} Abweichung{ergebnis.length === 1 ? '' : 'en'} gebucht.
                Sie stehen als eigene Zeilen im Verlauf.
              </p>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Sorte</th><th>War</th><th>Gezählt</th><th>Differenz</th></tr>
                  </thead>
                  <tbody>
                    {ergebnis.map(a => (
                      <tr key={a.sorteId}>
                        <td>{a.sorteName}</td>
                        <td>{a.vorher} Fl.</td>
                        <td>{a.gezaehlt} Fl.</td>
                        <td className={a.differenz < 0 ? styles.stockValueNull : styles.stockValueWarn}>
                          {a.differenz > 0 ? '+' : ''}{a.differenz} Fl.
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className={styles.modalActions}>
            <button className={styles.btnPrimary} onClick={onSchliessen}>Schliessen</button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.mehrFelderHinweis}>
            Gezählte <strong>Flaschen</strong> je Sorte eintragen – vorbelegt ist der aktuelle
            Stand. Jede Abweichung wird als eigene Buchung festgehalten, damit am Jahresende
            nachvollziehbar bleibt, wo etwas gefehlt hat.
          </p>

          <div className={styles.inventurListe}>
            {bestand.map(b => {
              const gezaehlt = zaehlung[b.sorte.id];
              const differenz = typeof gezaehlt === 'number' ? gezaehlt - b.lager : 0;
              return (
                <div key={b.sorte.id} className={styles.inventurZeile}>
                  <div className={styles.inventurName}>
                    <strong>{b.sorte.name}</strong>
                    <span className={styles.einkaufMeta}>
                      Soll: {formatBestand(b.lager, b.sorte.flaschenProKasten)}
                    </span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className={styles.inventurFeld}
                    value={gezaehlt ?? ''}
                    placeholder="—"
                    aria-label={`Gezählte Flaschen ${b.sorte.name}`}
                    onChange={e => onZaehlung(prev => ({
                      ...prev,
                      [b.sorte.id]: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0),
                    }))}
                  />
                  <span className={`${styles.inventurDiff} ${differenz === 0 ? '' : differenz < 0 ? styles.stockValueNull : styles.stockValueWarn}`}>
                    {typeof gezaehlt === 'number' && differenz !== 0 ? `${differenz > 0 ? '+' : ''}${differenz}` : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <div className={styles.formGroup}>
            <label>Notiz</label>
            <input
              type="text"
              value={notiz}
              onChange={e => onNotiz(e.target.value)}
              placeholder="z.B. Jahresinventur 2026"
            />
          </div>

          <div className={styles.modalActions}>
            <button className={styles.btnSecondary} onClick={onSchliessen}>Abbrechen</button>
            <button className={styles.btnPrimary} onClick={onUebernehmen} disabled={busy}>
              {busy ? 'Übernehmen…' : 'Zählung übernehmen'}
            </button>
          </div>
        </>
      )}
    </div>
  </div>
);
