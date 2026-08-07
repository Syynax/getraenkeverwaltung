import { useEffect, useRef, useState } from 'react';
import type { Sorte, ProduktInfo } from '../../types/getraenke';
import type { ScanKopplung } from '../../hooks/useScanKopplung';
import { tritteScanSitzungBei, meldeScan } from '../../services/api';
import styles from './Getraenke.module.css';

/** Kurze Rückmeldung zur letzten Buchung. */
export interface ScanFeedback {
  type: 'ok' | 'error';
  message: string;
}

/**
 * Ein gescannter Code, den keine Sorte kennt. Diese bleiben als Liste stehen,
 * bis sie zugeordnet oder verworfen werden – ein schnell scannendes Handy
 * liefert mehrere unbekannte Codes hintereinander, und jeder einzelne soll
 * zuordenbar bleiben.
 */
export interface OffenerCode {
  code: string;
  /** Läuft die Abfrage der Produktdatenbank gerade noch? */
  produktLaeuft: boolean;
  /** Ist der Lookup überhaupt eingeschaltet? Sonst keine Hinweise dazu zeigen. */
  produktAktiv: boolean;
  /** Treffer aus der öffentlichen Produktdatenbank. */
  produkt: ProduktInfo | null;
  /** Vorgeschlagene Sorte, abgeleitet aus dem Produktnamen. */
  vorschlagSorteId: number | null;
  produktFehler: string | null;
}

interface ScanTabProps {
  sorten: Sorte[];
  feedback: ScanFeedback | null;
  offeneCodes: OffenerCode[];
  busy: boolean;
  kopplung: ScanKopplung;
  onAssign: (code: string, sorteId: number) => void;
  onVerwerfen: (code: string) => void;
  /** Öffnet das Sorten-Formular, vorbelegt aus dem Produkt-Lookup. */
  onNeueSorte: (offen: OffenerCode) => void;
}

/**
 * `direkt`    – dieses Gerät scannt und bucht (wie bisher)
 * `empfangen` – dieses Gerät bucht, gescannt wird auf einem gekoppelten Handy
 * `senden`    – dieses Gerät ist nur Scanner für ein gekoppeltes Gerät
 */
type ScanModus = 'direkt' | 'empfangen' | 'senden';

const MODI: { id: ScanModus; label: string; icon: string }[] = [
  { id: 'direkt', label: 'Hier scannen', icon: 'fa-barcode' },
  { id: 'empfangen', label: 'Handy koppeln', icon: 'fa-laptop' },
  { id: 'senden', label: 'Als Scanner', icon: 'fa-mobile-screen-button' },
];

const MODUS_TEXT: Record<ScanModus, string> = {
  direkt: 'Barcode einer Flasche scannen – es wird automatisch 1 Kasten dieser Sorte ins Lager gebucht.',
  empfangen: 'Ein gekoppeltes Handy scannt, gebucht wird hier. Praktisch, wenn dieses Gerät keine Kamera hat.',
  senden: 'Dieses Gerät scannt nur und schickt die Codes weiter – gebucht wird auf dem gekoppelten Gerät.',
};

/** Damit ein Reload am Handy nicht die Verbindung kostet. */
const SENDER_SCHLUESSEL = 'getraenke.scanSender';

const ladeSender = (): string | null => {
  try {
    return sessionStorage.getItem(SENDER_SCHLUESSEL);
  } catch {
    return null;
  }
};

const merkeSender = (id: string | null): void => {
  try {
    if (id) sessionStorage.setItem(SENDER_SCHLUESSEL, id);
    else sessionStorage.removeItem(SENDER_SCHLUESSEL);
  } catch {
    /* privater Modus o.ä. */
  }
};

// Minimale Typen für die native BarcodeDetector-API (noch nicht in lib.dom).
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor { new (options?: { formats?: string[] }): BarcodeDetectorLike }

const getDetectorCtor = (): BarcodeDetectorCtor | undefined =>
  (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

export const ScanTab: React.FC<ScanTabProps> = ({
  sorten,
  feedback,
  offeneCodes,
  busy,
  kopplung,
  onAssign,
  onVerwerfen,
  onNeueSorte,
}) => {
  const supported = typeof getDetectorCtor() === 'function';
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  /** Sortenauswahl je offenem Code – eine pro Zeile. */
  const [auswahl, setAuswahl] = useState<Record<string, number | ''>>({});

  // Beim Öffnen in den Modus zurückfallen, der noch läuft.
  const [modus, setModus] = useState<ScanModus>(() => {
    if (ladeSender()) return 'senden';
    return kopplung.sitzung ? 'empfangen' : 'direkt';
  });

  // Sender-Seite (Handy)
  const [koppelEingabe, setKoppelEingabe] = useState('');
  const [sendeSitzungId, setSendeSitzungId] = useState<string | null>(() => ladeSender());
  const [gesendet, setGesendet] = useState<{ code: string; fehler: boolean }[]>([]);
  const [koppelFehler, setKoppelFehler] = useState<string | null>(null);

  const stop = () => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  // Kamera beim Verlassen der Ansicht freigeben.
  useEffect(() => () => stop(), []);

  // Beim Moduswechsel ebenfalls – sonst leuchtet die Kamera im Hintergrund weiter.
  useEffect(() => { stop(); }, [modus]);

  // Auswahl mit der Liste synchron halten: neue Codes bekommen einen leeren
  // Eintrag, erledigte fliegen raus. Sobald der Lookup einen Vorschlag liefert,
  // wird er übernommen – aber nur in eine noch leere Auswahl, damit eine von
  // Hand getroffene Entscheidung nicht überschrieben wird.
  useEffect(() => {
    setAuswahl(prev => {
      const naechste: Record<string, number | ''> = {};
      let geaendert = false;

      for (const offen of offeneCodes) {
        const bisher = prev[offen.code];
        if (bisher === undefined) {
          naechste[offen.code] = offen.vorschlagSorteId ?? '';
          geaendert = true;
        } else if (bisher === '' && offen.vorschlagSorteId != null) {
          naechste[offen.code] = offen.vorschlagSorteId;
          geaendert = true;
        } else {
          naechste[offen.code] = bisher;
        }
      }

      if (Object.keys(prev).length !== Object.keys(naechste).length) geaendert = true;
      return geaendert ? naechste : prev;
    });
  }, [offeneCodes]);

  // --- Sender: Codes ans gekoppelte Gerät schicken ---

  const verbinden = async () => {
    const code = koppelEingabe.trim();
    if (!/^\d{6}$/.test(code)) {
      setKoppelFehler('Bitte den sechsstelligen Code vom anderen Gerät eingeben.');
      return;
    }
    try {
      const { id } = await tritteScanSitzungBei(code);
      merkeSender(id);
      setSendeSitzungId(id);
      setKoppelFehler(null);
      setGesendet([]);
    } catch (err) {
      setKoppelFehler(err instanceof Error ? err.message : 'Kopplung fehlgeschlagen.');
    }
  };

  const trennen = () => {
    stop();
    merkeSender(null);
    setSendeSitzungId(null);
    setKoppelEingabe('');
    setKoppelFehler(null);
    setGesendet([]);
  };

  const sendeCode = async (code: string) => {
    if (!sendeSitzungId) return;
    try {
      await meldeScan(sendeSitzungId, code);
      // Kurzes Rütteln als Rückmeldung – man schaut beim Scannen nicht aufs Display.
      navigator.vibrate?.(60);
      setKoppelFehler(null);
      setGesendet(prev => [{ code, fehler: false }, ...prev].slice(0, 10));
    } catch (err) {
      setGesendet(prev => [{ code, fehler: true }, ...prev].slice(0, 10));
      setKoppelFehler(err instanceof Error ? err.message : 'Code konnte nicht gesendet werden.');
    }
  };

  // --- Gemeinsamer Einstieg für Kamera und manuelle Eingabe ---

  const verarbeiteCode = (code: string) => {
    const c = code.trim();
    if (!c) return;
    if (modus === 'senden') {
      void sendeCode(c);
      return;
    }
    kopplung.verarbeite(c);
  };

  // Der Kamera-Loop greift über einen Ref zu, damit ein Moduswechsel ihn nicht
  // neu starten muss.
  const verarbeiteRef = useRef(verarbeiteCode);
  useEffect(() => { verarbeiteRef.current = verarbeiteCode; });

  const start = async () => {
    const Ctor = getDetectorCtor();
    if (!Ctor) return;
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
      const tick = async () => {
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue?.trim();
            if (value) {
              const now = Date.now();
              // Gleichen Code nicht mehrfach in 2,5 s feuern (Doppelbuchung vermeiden).
              if (value !== lastRef.current.code || now - lastRef.current.t > 2500) {
                lastRef.current = { code: value, t: now };
                verarbeiteRef.current(value);
              }
            }
          } catch { /* einzelne Frames ignorieren */ }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCamError('Kamera nicht verfügbar oder Zugriff abgelehnt.');
      stop();
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    verarbeiteCode(manualCode);
    setManualCode('');
  };

  const scannerSichtbar = modus === 'direkt' || (modus === 'senden' && sendeSitzungId !== null);

  return (
    <div className={styles.tableCard}>
      <h3><i className="fas fa-barcode" style={{ marginRight: '0.5rem' }}></i>Per Scan einlagern</h3>
      <p className={styles.sectionSubtext} style={{ marginBottom: '1rem' }}>{MODUS_TEXT[modus]}</p>

      <div className={styles.scanModi}>
        {MODI.map(m => (
          <button
            key={m.id}
            className={`${styles.scanModus} ${modus === m.id ? styles.scanModusAktiv : ''}`}
            onClick={() => setModus(m.id)}
          >
            <i className={`fas ${m.icon}`}></i> {m.label}
          </button>
        ))}
      </div>

      {/* Rückmeldung der Buchung – nur auf dem buchenden Gerät. */}
      {modus !== 'senden' && feedback && (
        <div className={`${styles.scanFeedback} ${feedback.type === 'ok' ? styles.scanOk : styles.scanError}`}>
          <i className={`fas ${feedback.type === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Unbekannte Codes → jeder einzeln einer Sorte zuzuordnen */}
      {modus !== 'senden' && offeneCodes.length > 0 && (
        <>
          {offeneCodes.length > 1 && (
            <div className={`${styles.scanFeedback} ${styles.scanUnknown}`}>
              <i className="fas fa-circle-question"></i>
              <span>{offeneCodes.length} unbekannte Codes warten auf Zuordnung.</span>
            </div>
          )}

          <div className={styles.scanOffeneListe}>
            {offeneCodes.map(offen => {
              const gewaehlt = auswahl[offen.code] ?? '';
              return (
                <div key={offen.code} className={styles.scanAssign}>
                  <div className={styles.scanAssignKopf}>
                    <span>Code <code>{offen.code}</code> zuordnen:</span>
                    <button
                      className={styles.scanVerwerfen}
                      onClick={() => onVerwerfen(offen.code)}
                      title="Diesen Code verwerfen"
                      aria-label={`Code ${offen.code} verwerfen`}
                    >
                      <i className="fas fa-xmark"></i>
                    </button>
                  </div>

                  {/* Produktdatenbank: nur Vorschlag, die Zuordnung bleibt manuell. */}
                  {offen.produktLaeuft && (
                    <div className={styles.scanProduktHinweis}>
                      <i className="fas fa-spinner fa-spin"></i> Produktdatenbank wird abgefragt…
                    </div>
                  )}
                  {offen.produkt && (
                    <div className={styles.scanProdukt}>
                      <i className="fas fa-database"></i>
                      <div>
                        <strong>{offen.produkt.name}</strong>
                        <span className={styles.scanProduktMeta}>
                          {[offen.produkt.marke, offen.produkt.menge].filter(Boolean).join(' · ')}
                          {offen.produkt.marke || offen.produkt.menge ? ' — ' : ''}
                          laut {offen.produkt.quelle}
                        </span>
                      </div>
                    </div>
                  )}
                  {offen.produktFehler && (
                    <div className={styles.scanProduktHinweis}>
                      <i className="fas fa-plug-circle-xmark"></i> {offen.produktFehler}
                    </div>
                  )}
                  {offen.produktAktiv && !offen.produktLaeuft && !offen.produkt && !offen.produktFehler && (
                    <div className={styles.scanProduktHinweis}>
                      <i className="fas fa-circle-info"></i> In der Produktdatenbank nicht gefunden – bitte selbst zuordnen.
                    </div>
                  )}

                  <div className={styles.scanAssignRow}>
                    <select
                      value={gewaehlt}
                      onChange={e => setAuswahl(prev => ({
                        ...prev,
                        [offen.code]: e.target.value ? Number(e.target.value) : '',
                      }))}
                    >
                      <option value="">— Sorte wählen —</option>
                      {sorten.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button
                      className={styles.btnPrimary}
                      disabled={busy || gewaehlt === ''}
                      onClick={() => { if (gewaehlt !== '') onAssign(offen.code, gewaehlt); }}
                    >
                      Zuordnen & einbuchen
                    </button>
                  </div>

                  {/* Kein Treffer in der Liste? Dann gibt es die Sorte noch nicht. */}
                  <button
                    className={styles.scanNeueSorte}
                    onClick={() => onNeueSorte(offen)}
                    disabled={busy}
                  >
                    <i className="fas fa-plus"></i> Neue Sorte daraus anlegen
                    {offen.produkt && <span className={styles.scanNeueSorteMeta}>Name kommt aus dem Treffer</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Empfänger: Kopplungscode anzeigen und auf Scans warten */}
      {modus === 'empfangen' && (
        <div className={styles.scanKopplung}>
          {kopplung.fehler && <div className={styles.scanHintError}>{kopplung.fehler}</div>}

          {!kopplung.sitzung ? (
            <>
              <p className={styles.scanProduktHinweis}>
                Startet eine Kopplung und zeigt einen Code an. Am Handy: <strong>Getränke → Scannen →
                Als Scanner</strong>, dort den Code eingeben.
              </p>
              <button className={styles.btnPrimary} onClick={kopplung.starten}>
                <i className="fas fa-link"></i> Kopplung starten
              </button>
            </>
          ) : (
            <>
              <div className={styles.scanKoppelCode}>
                <span className={styles.scanKoppelLabel}>Code am Handy eingeben</span>
                <strong>{kopplung.sitzung.koppelCode}</strong>
              </div>

              <div className={`${styles.scanKoppelStatus} ${kopplung.gekoppelt ? styles.scanKoppelVerbunden : ''}`}>
                <i className={`fas ${kopplung.gekoppelt ? 'fa-circle-check' : 'fa-spinner fa-spin'}`}></i>
                {kopplung.gekoppelt
                  ? 'Handy verbunden – jede gescannte Flasche wird hier gebucht.'
                  : 'Warte auf das Handy…'}
              </div>

              {kopplung.empfangen.length > 0 && (
                <ul className={styles.scanListe}>
                  {kopplung.empfangen.map((code, i) => (
                    <li key={`${code}-${i}`}><i className="fas fa-arrow-down"></i> {code}</li>
                  ))}
                </ul>
              )}

              <button className={styles.btnSecondary} onClick={kopplung.beenden}>
                <i className="fas fa-link-slash"></i> Kopplung beenden
              </button>
            </>
          )}
        </div>
      )}

      {/* Sender: mit dem angezeigten Code verbinden */}
      {modus === 'senden' && !sendeSitzungId && (
        <div className={styles.scanKopplung}>
          <p className={styles.scanProduktHinweis}>
            Den sechsstelligen Code eingeben, der auf dem buchenden Gerät unter
            <strong> Handy koppeln</strong> steht.
          </p>
          <div className={styles.scanAssignRow}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={koppelEingabe}
              onChange={e => setKoppelEingabe(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className={styles.scanKoppelEingabe}
            />
            <button className={styles.btnPrimary} onClick={verbinden} disabled={koppelEingabe.length !== 6}>
              <i className="fas fa-link"></i> Verbinden
            </button>
          </div>
          {koppelFehler && <div className={styles.scanHintError}>{koppelFehler}</div>}
        </div>
      )}

      {modus === 'senden' && sendeSitzungId && (
        <div className={styles.scanKopplung}>
          <div className={`${styles.scanKoppelStatus} ${styles.scanKoppelVerbunden}`}>
            <i className="fas fa-circle-check"></i> Verbunden – gescannte Codes gehen ans andere Gerät.
          </div>
          {koppelFehler && <div className={styles.scanHintError}>{koppelFehler}</div>}
          {gesendet.length > 0 && (
            <ul className={styles.scanListe}>
              {gesendet.map((e, i) => (
                <li key={`${e.code}-${i}`} className={e.fehler ? styles.scanListeFehler : ''}>
                  <i className={`fas ${e.fehler ? 'fa-circle-exclamation' : 'fa-paper-plane'}`}></i> {e.code}
                </li>
              ))}
            </ul>
          )}
          <button className={styles.btnSecondary} onClick={trennen}>
            <i className="fas fa-link-slash"></i> Trennen
          </button>
        </div>
      )}

      {/* Kamera-Scanner */}
      {scannerSichtbar && (supported ? (
        <div className={styles.scanCamWrap}>
          <video ref={videoRef} className={styles.scanVideo} muted playsInline />
          {!scanning && <div className={styles.scanOverlay}><i className="fas fa-camera"></i> Kamera aus</div>}
          {scanning && <div className={styles.scanReticle} />}
          <div className={styles.scanCamActions}>
            {!scanning
              ? <button className={styles.btnPrimary} onClick={start}><i className="fas fa-camera"></i> Kamera starten</button>
              : <button className={styles.btnSecondary} onClick={stop}><i className="fas fa-stop"></i> Stoppen</button>}
          </div>
          {camError && <div className={styles.scanHintError}>{camError}</div>}
        </div>
      ) : (
        <div className={styles.scanHintError}>
          Dieser Browser unterstützt keinen Kamera-Barcode-Scanner (z. B. iPhone/Safari). Bitte den Code
          unten manuell eingeben – oder unter <strong>Handy koppeln</strong> ein Android-Handy als
          Scanner verwenden.
        </div>
      ))}

      {/* Manuelle Eingabe */}
      {scannerSichtbar && (
        <form onSubmit={submitManual} className={styles.scanManual}>
          <input
            type="text"
            inputMode="numeric"
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            placeholder="Barcode manuell eingeben…"
          />
          <button type="submit" className={styles.btnSecondary} disabled={busy || !manualCode.trim()}>
            <i className="fas fa-keyboard"></i> {modus === 'senden' ? 'Senden' : 'Einbuchen'}
          </button>
        </form>
      )}
    </div>
  );
};
