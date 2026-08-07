import { useState } from 'react';
import { login } from '../../services/api';
import styles from './Login.module.css';

interface LoginProps {
  titel: string;
  untertitel: string;
  onAngemeldet: (benutzer: string) => void;
}

export const Login: React.FC<LoginProps> = ({ titel, untertitel, onAngemeldet }) => {
  const [name, setName] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const absenden = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !passwort) return;

    setBusy(true);
    setFehler(null);
    try {
      const benutzer = await login(name, passwort);
      setPasswort('');
      onAngemeldet(benutzer);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={absenden}>
        <div className={styles.brand}>
          <i className="fas fa-bottle-water" aria-hidden="true"></i>
          <div style={{ minWidth: 0 }}>
            <h1 className={styles.titel}>{titel}</h1>
            {untertitel && <p className={styles.untertitel}>{untertitel}</p>}
          </div>
        </div>

        {fehler && (
          <div className={styles.fehler} role="alert">
            <i className="fas fa-circle-exclamation" aria-hidden="true"></i>
            <span>{fehler}</span>
          </div>
        )}

        <div className={styles.feld}>
          <label htmlFor="login-name">Benutzername</label>
          <input
            id="login-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className={styles.feld}>
          <label htmlFor="login-passwort">Passwort</label>
          <input
            id="login-passwort"
            type="password"
            value={passwort}
            onChange={e => setPasswort(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit" className={styles.btn} disabled={busy || !name.trim() || !passwort}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-right-to-bracket'}`} aria-hidden="true"></i>
          {busy ? 'Anmelden …' : 'Anmelden'}
        </button>

        <p className={styles.hinweis}>
          Benutzer werden in den Add-on-Optionen in Home&nbsp;Assistant gepflegt.
        </p>
      </form>
    </div>
  );
};
