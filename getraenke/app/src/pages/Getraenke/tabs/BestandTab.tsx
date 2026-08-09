import type { BestandMitSorte, OberkategorieMitBestand, BuchungsTyp } from '../../../types/getraenke';
import type { EinkaufsZeile } from '../useEinkauf';
import { formatBestand } from '../hilfen';
import styles from '../Getraenke.module.css';

/** Eine Sortengruppe im Lagerbestand, samt Summe über alle Marken darin. */
export interface BestandsBlock {
  id: number | null;
  name: string | null;
  eintraege: BestandMitSorte[];
  info: OberkategorieMitBestand | undefined;
  kaesten: number;
}

interface BestandTabProps {
  bestand: BestandMitSorte[];
  bloecke: BestandsBlock[];
  einkaufZeilen: EinkaufsZeile[];
  einkaufslisteRef: React.RefObject<HTMLDivElement | null>;
  onOberkategorien: () => void;
  onInventur: () => void;
  onBestandKorrektur: (b: BestandMitSorte) => void;
  onSorteBearbeiten: (b: BestandMitSorte) => void;
  onSorteDeaktivieren: (id: number) => void;
  onSchnellbuchung: (sorteId: number, typ: BuchungsTyp) => void;
  onEinkaufslisteKopieren: () => void;
  onEinkaufslisteDrucken: () => void;
}

/** Lagerbestand nach Oberkategorien geblockt, daneben die Einkaufsliste. */
export const BestandTab: React.FC<BestandTabProps> = ({
  bestand, bloecke, einkaufZeilen, einkaufslisteRef,
  onOberkategorien, onInventur, onBestandKorrektur, onSorteBearbeiten,
  onSorteDeaktivieren, onSchnellbuchung, onEinkaufslisteKopieren, onEinkaufslisteDrucken,
}) => (
  <div className={styles.mainGrid}>
    <div className={styles.tableCard}>
      <div className={styles.sectionHeader}>
        <h3><i className="fas fa-warehouse" style={{ marginRight: '0.5rem' }}></i>Lagerbestand</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className={styles.btnSecondary} onClick={onOberkategorien}>
            <i className="fas fa-layer-group"></i> Oberkategorien
          </button>
          {bestand.length > 0 && (
            <button className={styles.btnSecondary} onClick={onInventur}>
              <i className="fas fa-clipboard-check"></i> Inventur
            </button>
          )}
        </div>
      </div>

      {bestand.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-box-open"></i>
          <p>Keine Sorten vorhanden. Lege oben eine neue Sorte an.</p>
        </div>
      ) : (
        bloecke.map(gruppe => (
          <div key={gruppe.id ?? '__eigen'} className={styles.gruppenBlock}>
            {/* Kopfzeile nur, wenn es überhaupt Oberkategorien gibt. */}
            {(gruppe.name || bloecke.length > 1) && (
              <div className={styles.gruppenKopf}>
                <span className={styles.gruppenName}>
                  {gruppe.name ? (
                    <><i className="fas fa-layer-group"></i> {gruppe.name}</>
                  ) : (
                    <><i className="fas fa-bottle-water"></i> Einzelne Sorten</>
                  )}
                </span>
                {/* Nur der Gesamtbestand – der Soll-Vergleich steht in der
                    Einkaufsliste und bezieht sich auf eine andere Teilmenge. */}
                <span className={`${styles.gruppenSumme} ${gruppe.info?.unterWarnschwelle ? styles.stockValueWarn : ''}`}>
                  {gruppe.kaesten.toFixed(1)} Kästen
                </span>
              </div>
            )}

            <div className={styles.sorteGrid}>
              {gruppe.eintraege.map(b => {
                const fpk = b.sorte.flaschenProKasten;
                const lagerCls = b.lager === 0
                  ? styles.stockValueNull
                  : b.unterWarnschwelle ? styles.stockValueWarn : '';
                return (
                  <div
                    key={b.sorte.id}
                    className={`${styles.sorteCard} ${b.gesamt === 0 ? styles.sorteCardDanger : b.unterWarnschwelle ? styles.sorteCardWarn : ''}`}
                  >
                    <div className={styles.sorteCardHeader}>
                      <div className={styles.sorteCardTitle}>
                        <i
                          className={`fas ${b.sorte.kategorie === 'alkoholfrei' ? 'fa-glass-water' : 'fa-beer-mug-empty'}`}
                          style={{ color: b.sorte.kategorie === 'alkoholfrei' ? '#3b82f6' : '#d97706' }}
                        ></i>
                        <strong title={b.sorte.name}>{b.sorte.name}</strong>
                      </div>
                      <details className={styles.cardMenu}>
                        <summary title="Mehr"><i className="fas fa-ellipsis-vertical"></i></summary>
                        <div className={styles.menuList}>
                          <button className={styles.menuItem} onClick={() => onBestandKorrektur(b)}>
                            <i className="fas fa-sliders"></i> Bestand korrigieren
                          </button>
                          <button className={styles.menuItem} onClick={() => onSorteBearbeiten(b)}>
                            <i className="fas fa-pen"></i> Sorte bearbeiten
                          </button>
                          <button
                            className={`${styles.menuItem} ${styles.menuItemDanger}`}
                            onClick={() => onSorteDeaktivieren(b.sorte.id)}
                          >
                            <i className="fas fa-trash"></i> Deaktivieren
                          </button>
                        </div>
                      </details>
                    </div>

                    <div className={styles.stockRow}>
                      <div className={styles.stockInfo}>
                        <span className={styles.stockLabel}>Lager</span>
                        <span className={`${styles.stockValue} ${lagerCls}`}>{formatBestand(b.lager, fpk)}</span>
                      </div>
                      <div className={styles.stepper}>
                        <button
                          className={`${styles.stepBtn} ${styles.btnMinus}`}
                          title="1 Kasten entnehmen"
                          disabled={b.lager < fpk}
                          onClick={() => onSchnellbuchung(b.sorte.id, 'ausgang')}
                        >−</button>
                        <button
                          className={`${styles.stepBtn} ${styles.btnPlus}`}
                          title="1 Kasten einbuchen"
                          onClick={() => onSchnellbuchung(b.sorte.id, 'eingang')}
                        >+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>

    {/* Einkaufsliste */}
    <div className={styles.einkaufslisteCard} ref={einkaufslisteRef}>
      <div className={styles.einkaufslisteHeader}>
        <h3><i className="fas fa-cart-shopping" style={{ marginRight: '0.5rem' }}></i>Einkaufsliste</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {einkaufZeilen.length > 0 && (
            <>
              <span className={styles.einkaufsBadge}>{einkaufZeilen.length}</span>
              <button className={`${styles.quickBtn} ${styles.btnEdit}`} title="Kopieren" onClick={onEinkaufslisteKopieren}>
                <i className="fas fa-copy" style={{ fontSize: '0.6875rem' }}></i>
              </button>
              <button className={`${styles.quickBtn} ${styles.btnSettings}`} title="Drucken" onClick={onEinkaufslisteDrucken}>
                <i className="fas fa-print" style={{ fontSize: '0.6875rem' }}></i>
              </button>
            </>
          )}
        </div>
      </div>

      {einkaufZeilen.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-check-circle" style={{ color: '#10b981' }}></i>
          <p>Alles auf Lager!</p>
        </div>
      ) : (
        einkaufZeilen.map(e => (
          <div key={e.schluessel} className={styles.einkaufsItem}>
            <div className={styles.einkaufsItemInfo}>
              <span className={styles.einkaufsItemName}>
                {e.name}
                {e.hinweis && <span className={styles.gruppenMarke}>Gruppe</span>}
              </span>
              <span className={styles.einkaufsItemDetail}>
                Bestand: {e.aktuellerBestand.toFixed(1)} Kästen
                {e.hinweis && <> · {e.hinweis}</>}
              </span>
            </div>
            <div className={styles.einkaufsItemMenge}>
              <span className={styles.einkaufsMengeValue}>{e.empfohleneBestellung}</span>
              <span className={styles.einkaufsMengeLabel}>Kästen</span>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);
