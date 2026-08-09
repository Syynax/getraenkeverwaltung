import type { BesonderesEvent, EventPosition, EventStatus } from '../../../types/getraenke';
import { EVENT_STATUS_LABELS, EVENT_POSITION_LABELS, formatEventDatum } from '../hilfen';
import styles from '../Getraenke.module.css';

interface EventsTabProps {
  events: BesonderesEvent[];
  offeneEvents: number;
  positionenGesamt: number;
  /** Auflösung einer Position auf einen anzeigbaren Namen (Sorte oder freier Artikel). */
  positionsName: (item: EventPosition) => string;
  statusKlasse: (status: EventStatus) => string;
  onNeu: () => void;
  onBearbeiten: (event: BesonderesEvent) => void;
  onDrucken: (event: BesonderesEvent) => void;
  onLoeschen: (id: number) => void;
}

/** Besondere Events mit eigener Einkaufsliste, je Event eine Karte. */
export const EventsTab: React.FC<EventsTabProps> = ({
  events, offeneEvents, positionenGesamt, positionsName, statusKlasse,
  onNeu, onBearbeiten, onDrucken, onLoeschen,
}) => (
  <section className={styles.eventsSection}>
    <div className={styles.sectionHeader}>
      <div>
        <h3><i className="fas fa-calendar-days" style={{ marginRight: '0.5rem' }}></i>Besondere Events</h3>
        <p className={styles.sectionSubtext}>
          {events.length} Events, {offeneEvents} offen, {positionenGesamt} Positionen
        </p>
      </div>
      <button className={styles.btnWarning} onClick={onNeu}>
        <i className="fas fa-plus"></i> Event anlegen
      </button>
    </div>

    {events.length === 0 ? (
      <div className={styles.eventEmptyState}>
        <i className="fas fa-list-check"></i>
        <p>Noch keine besonderen Events angelegt</p>
        <span>Lege ein Event an und hinterlege dort separat, was eingekauft werden muss.</span>
      </div>
    ) : (
      <div className={styles.eventsGrid}>
        {events.map(event => (
          <article key={event.id} className={styles.eventCard}>
            <div className={styles.eventCardHeader}>
              <div>
                <h4>{event.name}</h4>
                <div className={styles.eventMeta}>
                  <span>{formatEventDatum(event.datum)}</span>
                  <span>{event.items.length} Positionen</span>
                </div>
              </div>
              <span className={`${styles.eventStatusBadge} ${statusKlasse(event.status)}`}>
                {EVENT_STATUS_LABELS[event.status]}
              </span>
            </div>

            {event.notiz && <p className={styles.eventNotiz}>{event.notiz}</p>}

            <div className={styles.eventItemsList}>
              {event.items.length === 0 ? (
                <div className={styles.eventItemsEmpty}>Noch keine Positionen hinterlegt</div>
              ) : (
                event.items.map(item => (
                  <div key={item.id} className={styles.eventItemRow}>
                    <div>
                      <span className={styles.eventItemName}>{positionsName(item)}</span>
                      <span className={styles.eventItemMeta}>{EVENT_POSITION_LABELS[item.typ]}</span>
                    </div>
                    <span className={styles.eventItemAmount}>{item.menge} {item.einheit}</span>
                  </div>
                ))
              )}
            </div>

            <div className={styles.eventActions}>
              <button className={styles.btnSecondary} onClick={() => onDrucken(event)}>
                <i className="fas fa-print"></i> Drucken
              </button>
              <button className={styles.btnSecondary} onClick={() => onBearbeiten(event)}>
                <i className="fas fa-pen"></i> Bearbeiten
              </button>
              <button className={styles.btnDanger} onClick={() => onLoeschen(event.id)}>
                <i className="fas fa-trash"></i> Löschen
              </button>
            </div>
          </article>
        ))}
      </div>
    )}
  </section>
);
