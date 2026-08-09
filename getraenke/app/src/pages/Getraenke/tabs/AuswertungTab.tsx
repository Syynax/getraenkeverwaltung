import { Bar } from 'react-chartjs-2';
import type { ChartData } from 'chart.js';
import type { Buchung, Kassenbericht } from '../../../types/getraenke';
import { formatDatum, buchungTypLabel, mengeText } from '../hilfen';
import styles from '../Getraenke.module.css';

interface AuswertungTabProps {
  buchungen: (Buchung & { sorteName: string })[];
  kassenbericht: Kassenbericht | null;
  verbrauchsChart: ChartData<'bar'> | null;
  kassenChart: ChartData<'bar'> | null;
  /** Ein abgelehnter Storno muss hier sichtbar werden. */
  fehler: string | null;
  busy: boolean;
  onStornieren: (id: number, sorteName: string) => void;
}

const typKlasse = (typ: string): string => {
  switch (typ) {
    case 'eingang': return styles.typEingang;
    case 'ausgang': return styles.typAusgang;
    case 'schwund': return styles.typSchwund;
    case 'inventur': return styles.typInventur;
    default: return styles.typAuffuellung;
  }
};

/** Verlauf, Verbrauch und Kassenbericht. */
export const AuswertungTab: React.FC<AuswertungTabProps> = ({
  buchungen, kassenbericht, verbrauchsChart, kassenChart, fehler, busy, onStornieren,
}) => (
  <>
    <div className={styles.buchungenCard}>
      <h3><i className="fas fa-clock-rotate-left" style={{ marginRight: '0.5rem' }}></i>Letzte Buchungen</h3>
      {fehler && <div className={styles.errorMessage}>{fehler}</div>}

      {buchungen.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-inbox"></i>
          <p>Noch keine Buchungen vorhanden</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Datum</th><th>Sorte</th><th>Typ</th><th>Menge</th><th>Wer</th><th>Notiz</th><th></th>
              </tr>
            </thead>
            <tbody>
              {buchungen.slice(0, 20).map(b => (
                <tr key={b.id} className={b.storniert ? styles.buchungStorniert : ''}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDatum(b.datum)}</td>
                  <td>{b.sorteName}</td>
                  <td>
                    <span className={`${styles.buchungTyp} ${typKlasse(b.typ)}`}>
                      {buchungTypLabel(b.typ)}
                    </span>
                  </td>
                  {/* Bei Inventur und Auffüllung steht in menge eine Zahl in
                      Flaschen, sonst in Kästen. */}
                  <td>{mengeText(b)}</td>
                  <td>{b.benutzer || '—'}</td>
                  <td>
                    {b.notiz || '—'}
                    {b.archiviert && <span className={styles.archivHinweis}>Archiv</span>}
                    {b.storniert && (
                      <span className={styles.stornoHinweis}>
                        storniert{b.storniertVon ? ` von ${b.storniertVon}` : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    {/* Auch eine Inventur ist stornierbar – wer sich beim Zählen
                        vertut, muss das zurücknehmen können. Nur archivierte
                        Jahre sind zu. */}
                    {!b.storniert && !b.archiviert && (
                      <button
                        className={styles.stornoBtn}
                        title="Diese Buchung stornieren"
                        disabled={busy}
                        onClick={() => onStornieren(b.id, b.sorteName)}
                      >
                        <i className="fas fa-rotate-left"></i>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    {verbrauchsChart && (
      <div className={styles.chartCard}>
        <h3><i className="fas fa-chart-bar" style={{ marginRight: '0.5rem' }}></i>Verbrauchsstatistik</h3>
        <div className={styles.chartWrapper}>
          <Bar data={verbrauchsChart} options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' }, title: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
          }} />
        </div>
      </div>
    )}

    {kassenbericht && (
      <div className={styles.kassenberichtSection}>
        <div className={styles.chartCard}>
          <h3><i className="fas fa-euro-sign" style={{ marginRight: '0.5rem' }}></i>Kassenbericht</h3>
          <div className={styles.kassenSummary}>
            <div className={`${styles.kassenCard} ${styles.kassenEinnahmen}`}>
              <span className={styles.kassenLabel}>Einnahmen</span>
              <span className={styles.kassenWert}>{kassenbericht.gesamtEinnahmen.toFixed(2)} €</span>
            </div>
            <div className={`${styles.kassenCard} ${styles.kassenAusgaben}`}>
              <span className={styles.kassenLabel}>Ausgaben</span>
              <span className={styles.kassenWert}>{kassenbericht.gesamtAusgaben.toFixed(2)} €</span>
            </div>
            <div className={`${styles.kassenCard} ${kassenbericht.gesamtGewinn >= 0 ? styles.kassenGewinn : styles.kassenVerlust}`}>
              <span className={styles.kassenLabel}>{kassenbericht.gesamtGewinn >= 0 ? 'Gewinn' : 'Verlust'}</span>
              <span className={styles.kassenWert}>{kassenbericht.gesamtGewinn.toFixed(2)} €</span>
            </div>
            {kassenbericht.gesamtSchwund > 0 && (
              <div
                className={styles.kassenCard}
                title="Wert der abgeschriebenen Ware – kein Geldfluss, zählt nicht in den Gewinn"
              >
                <span className={styles.kassenLabel}>Schwund</span>
                <span className={styles.kassenWert}>{kassenbericht.gesamtSchwund.toFixed(2)} €</span>
              </div>
            )}
          </div>

          {kassenChart && (
            <div className={styles.chartWrapper}>
              <Bar data={kassenChart} options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' }, title: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => `${v} €` } } },
              }} />
            </div>
          )}
        </div>
      </div>
    )}
  </>
);
