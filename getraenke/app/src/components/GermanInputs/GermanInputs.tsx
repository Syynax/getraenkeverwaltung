import { useEffect, useId, useRef, useState } from 'react';
import styles from './GermanInputs.module.css';

/**
 * Datums-Eingabe im deutschen Format TT.MM.JJJJ.
 * Speichert intern als ISO yyyy-MM-dd (über onChange-Synthetik-Event).
 * Kleines Kalender-Icon öffnet den nativen Picker als Fallback.
 */
interface GermanDateInputProps {
  id?: string;
  name: string;
  value: string; // ISO yyyy-MM-dd
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  className?: string;
  required?: boolean;
  ariaInvalid?: boolean;
}

function isoToDe(iso: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function deToIso(de: string): string | null {
  const trimmed = de.trim();
  if (!trimmed) return '';
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(trimmed);
  if (!m) return null;
  const d = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  let y = m[3];
  if (y.length === 2) y = (Number(y) >= 50 ? '19' : '20') + y;
  const iso = `${y}-${mo}-${d}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return iso;
}

export const GermanDateInput: React.FC<GermanDateInputProps> = ({
  id,
  name,
  value,
  onChange,
  className,
  required,
  ariaInvalid,
}) => {
  const autoId = useId();
  const inputId = id ?? `${autoId}-de-date`;
  const [text, setText] = useState(() => isoToDe(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(isoToDe(value));
  }, [value]);

  const emit = (iso: string) => {
    onChange({
      target: { name, value: iso, type: 'date' },
      currentTarget: { name, value: iso, type: 'date' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  };

  const handleBlur = () => {
    const iso = deToIso(text);
    if (iso === null) {
      // invalid: revert to last known good
      setText(isoToDe(value));
    } else if (iso !== value) {
      emit(iso);
    }
  };

  const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value;
    setText(isoToDe(iso));
    emit(iso);
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fallthrough */ }
    }
    el.focus();
    el.click();
  };

  return (
    <div className={styles.wrapper}>
      <input
        type="text"
        id={inputId}
        name={name}
        inputMode="numeric"
        autoComplete="off"
        placeholder="TT.MM.JJJJ"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        className={`${styles.textInput} ${className ?? ''}`}
        required={required}
        aria-invalid={ariaInvalid}
        maxLength={10}
      />
      <button
        type="button"
        className={styles.pickerBtn}
        onClick={openPicker}
        aria-label="Datum aus Kalender auswählen"
        tabIndex={-1}
      >
        <i className="fas fa-calendar-alt" aria-hidden="true"></i>
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value}
        onChange={handlePickerChange}
        className={styles.hiddenPicker}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
};

/**
 * Zeit-Eingabe im 24h-Format HH:MM.
 */
interface GermanTimeInputProps {
  id?: string;
  name: string;
  value: string; // HH:MM
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  className?: string;
  required?: boolean;
  ariaInvalid?: boolean;
}

function normalizeTime(t: string): string | null {
  const trimmed = t.trim();
  if (!trimmed) return '';
  // accept "9", "9:5", "09:05", "0905", "9.5"
  let h: string;
  let m: string;
  const colonMatch = /^(\d{1,2})[.:](\d{1,2})$/.exec(trimmed);
  const fourDigit = /^(\d{2})(\d{2})$/.exec(trimmed);
  const hourOnly = /^(\d{1,2})$/.exec(trimmed);
  if (colonMatch) {
    [, h, m] = colonMatch;
  } else if (fourDigit) {
    [, h, m] = fourDigit;
  } else if (hourOnly) {
    h = hourOnly[1]; m = '00';
  } else {
    return null;
  }
  const hi = Number(h), mi = Number(m);
  if (!Number.isFinite(hi) || !Number.isFinite(mi)) return null;
  if (hi < 0 || hi > 23 || mi < 0 || mi > 59) return null;
  return `${String(hi).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export const GermanTimeInput: React.FC<GermanTimeInputProps> = ({
  id,
  name,
  value,
  onChange,
  className,
  required,
  ariaInvalid,
}) => {
  const autoId = useId();
  const inputId = id ?? `${autoId}-de-time`;
  const [text, setText] = useState(value);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const emit = (val: string) => {
    onChange({
      target: { name, value: val, type: 'time' },
      currentTarget: { name, value: val, type: 'time' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  };

  const handleBlur = () => {
    const norm = normalizeTime(text);
    if (norm === null) {
      setText(value);
    } else if (norm !== value) {
      setText(norm);
      emit(norm);
    } else {
      setText(norm);
    }
  };

  const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setText(v);
    emit(v);
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fallthrough */ }
    }
    el.focus();
    el.click();
  };

  return (
    <div className={styles.wrapper}>
      <input
        type="text"
        id={inputId}
        name={name}
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:MM"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        className={`${styles.textInput} ${className ?? ''}`}
        required={required}
        aria-invalid={ariaInvalid}
        maxLength={5}
      />
      <button
        type="button"
        className={styles.pickerBtn}
        onClick={openPicker}
        aria-label="Uhrzeit aus Liste auswählen"
        tabIndex={-1}
      >
        <i className="fas fa-clock" aria-hidden="true"></i>
      </button>
      <input
        ref={pickerRef}
        type="time"
        value={value}
        onChange={handlePickerChange}
        className={styles.hiddenPicker}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
};
