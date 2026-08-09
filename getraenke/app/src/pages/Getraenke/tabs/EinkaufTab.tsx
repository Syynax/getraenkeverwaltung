import type { BestandMitSorte } from '../../../types/getraenke';
import type { useEinkauf } from '../useEinkauf';
import { formatBestand } from '../hilfen';
import styles from '../Getraenke.module.css';

interface EinkaufTabProps {
  bestand: BestandMitSorte[];
  einkauf: ReturnType<typeof useEinkauf>;
  fehler: string | null;
  busy: boolean;
  onVerbuchen: () => void;
}

/**
 * Einkauf erfassen: Mengen und Preise je Marke, nach Oberkategorien geblockt.
 * Über jeder Gruppe steht, wie viele Kästen noch zu verteilen sind.
 */
export const EinkaufTab: React.FC<EinkaufTabProps> = ({ bestand, einkauf, fehler, busy, onVerbuchen }) => (
  <div className={styles.tableCard}>
    <h3><i className="fas fa-cart-shopping" style={{ marginRight: '0.5rem' }}></i>Einkauf einbuchen</h3>
    <p className={styles.sectionSubtext} style={{ marginBottom: '1rem' }}>
      Menge in Kästen erfassen und den Preis je Kasten anpassen – wird als Eingang ins Lager
      gebucht. Vorbelegt mit der Bestellempfehlung und dem zuletzt bekannten Preis.
    </p>

    {fehler && <div className={styles.errorMessage}>{fehler}</div>}

    {bestand.length === 0 ? (
      <div className={styles.emptyState}>
        <i className="fas fa-box-open"></i>
        <p>Keine Sorten vorhanden. Lege zuerst eine Sorte an.</p>
      </div>
    ) : (
      <>
        <div className={styles.einkaufLeiste}>
          <div className={styles.einkaufFilter}>
            <button
              className={`${styles.einkaufFilterBtn} ${einkauf.nurNachbestellen ? styles.einkaufFilterAktiv : ''}`}
              onClick={() => einkauf.setNurNachbestellen(true)}
            >
              Nur nachbestellen ({einkauf.offen.length})
            </button>
            <button
              className={`${styles.einkaufFilterBtn} ${!einkauf.nurNachbestellen ? styles.einkaufFilterAktiv : ''}`}
              onClick={() => einkauf.setNurNachbestellen(false)}
            >
              Alle Sorten ({bestand.length})
            </button>
          </div>
          <button className={styles.einkaufLeer} onClick={einkauf.leeren} disabled={busy}>
            <i className="fas fa-eraser"></i> Mengen zurücksetzen
          </button>
        </div>

        {einkauf.sichtbar.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="fas fa-check"></i>
            <p>Nichts nachzubestellen. Über <strong>Alle Sorten</strong> kommst du trotzdem an jede Sorte.</p>
          </div>
        ) : (
          einkauf.bloecke.map(block => (
            <div key={block.id ?? '__eigen'} className={styles.gruppenBlock}>
              {(block.name || einkauf.bloecke.length > 1) && (
                <div className={styles.gruppenKopf}>
                  <span className={styles.gruppenName}>
                    {block.name ? (
                      <><i className="fas fa-layer-group"></i> {block.name}</>
                    ) : (
                      <><i className="fas fa-bottle-water"></i> Einzelne Sorten</>
                    )}
                  </span>
                  {/* Der Gruppenbedarf gehört genau hierhin: Er zählt beim
                      Hochsteppen live herunter, egal auf welche Marke. */}
                  {block.bedarf && (
                    <span className={`${styles.gruppenSumme} ${block.offen === 0 ? styles.gruppenErledigt : ''}`}>
                      {block.offen === 0
                        ? <><i className="fas fa-check"></i> {block.bedarf.empfohleneBestellung} Kästen verteilt</>
                        : <>noch {block.offen} von {block.bedarf.empfohleneBestellung} Kästen zu verteilen</>}
                    </span>
                  )}
                </div>
              )}

              <div className={styles.sorteGrid}>
                {block.eintraege.map(b => {
                  const zeile = einkauf.zeile(b);
                  const empf = einkauf.empfehlungJeSorte.get(b.sorte.id) ?? 0;
                  return (
                    <div key={b.sorte.id} className={`${styles.sorteCard} ${zeile.menge > 0 ? styles.einkaufCardActive : ''}`}>
                      <div className={styles.sorteCardHeader}>
                        <div className={styles.sorteCardTitle}>
                          <i
                            className={`fas ${b.sorte.kategorie === 'alkoholfrei' ? 'fa-glass-water' : 'fa-beer-mug-empty'}`}
                            style={{ color: b.sorte.kategorie === 'alkoholfrei' ? '#3b82f6' : '#d97706' }}
                          ></i>
                          <strong title={b.sorte.name}>{b.sorte.name}</strong>
                        </div>
                        {empf > 0 && (
                          <span className={styles.einkaufEmpf} title="Empfohlene Bestellung">Empf. {empf}</span>
                        )}
                      </div>
                      <div className={styles.einkaufMeta}>
                        Lager: {formatBestand(b.lager, b.sorte.flaschenProKasten)}
                      </div>

                      {/* Stepper statt Zahlenfeld: im Markt einhändig bedienbar. */}
                      <div className={styles.einkaufMengeRow}>
                        <span className={styles.stockLabel}>Kästen</span>
                        <div className={styles.stepper}>
                          <button
                            className={`${styles.stepBtn} ${styles.btnMinus}`}
                            title="Ein Kasten weniger"
                            disabled={zeile.menge <= 0}
                            onClick={() => einkauf.aendereMenge(b, -1)}
                          >−</button>
                          <input
                            type="number" min={0} step={1} inputMode="numeric"
                            className={styles.einkaufMenge}
                            value={zeile.menge}
                            onChange={e => einkauf.setzeZeile(b, { menge: Math.max(0, parseInt(e.target.value) || 0) })}
                            aria-label={`Kästen ${b.sorte.name}`}
                          />
                          <button
                            className={`${styles.stepBtn} ${styles.btnPlus}`}
                            title="Ein Kasten mehr"
                            onClick={() => einkauf.aendereMenge(b, +1)}
                          >+</button>
                        </div>
                      </div>

                      <div className={styles.formGroup}>
                        <label>Preis €/Kasten</label>
                        <input
                          type="number" min={0} step={0.01} inputMode="decimal"
                          value={zeile.preis}
                          onChange={e => einkauf.setzeZeile(b, { preis: Math.max(0, parseFloat(e.target.value) || 0) })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        <div className={styles.einkaufFooter}>
          <div className={styles.einkaufSumme}>
            Einkaufssumme: <strong>{einkauf.summe.toFixed(2)} €</strong>
          </div>
          <button className={styles.btnPrimary} onClick={onVerbuchen} disabled={busy}>
            <i className="fas fa-check"></i> {busy ? 'Verbuchen…' : 'Einkauf verbuchen'}
          </button>
        </div>
      </>
    )}
  </div>
);
