# Getränkeverwaltung – Home-Assistant-Add-on

Getränkebestand, Einkauf, Events und Kassenbericht für die Feuerwehr. Läuft als
Add-on in Home Assistant und erscheint als eigener Punkt „Getränke" in der
Seitenleiste.

Ausgelagert aus der Feuerwehr-Einsatzstatistik, damit die Getränkekasse ohne den
Rest der Statistik läuft.

## Was drin ist

| Tab | Inhalt |
| --- | --- |
| **Bestand** | Kästen pro Sorte im Lager, nach Oberkategorien gruppiert, Schnellbuchung ±1 Kasten, Einkaufsliste mit Bestellempfehlung |
| **Einkauf** | Kompletten Einkauf mit Menge und Preis je Kasten auf einmal ins Lager buchen |
| **Scannen** | Flaschen-Barcode scannen → 1 Kasten ins Lager. Wahlweise mit einem Handy als gekoppeltem Scanner; unbekannte Codes werden in einer offenen Produktdatenbank nachgeschlagen |
| **Events** | Sommerfest & Co. mit eigener Einkaufsliste (Getränkesorten + freie Artikel), druckbar |
| **Auswertung** | Letzte Buchungen, Verbrauch pro Monat, Kassenbericht (Einnahmen/Ausgaben/Gewinn) |

Dazu:

- **Eigene Anmeldung** – Konten werden im Add-on-Store gepflegt, nicht in Dateien
- **Daten bleiben lokal** unter `/data/getraenke.json` und überstehen Stopp,
  Neustart und Update. Täglich eine automatische Sicherung, dazu Sichern und
  Import als JSON
- **Kein Internet nötig** – bis auf den abschaltbaren Produkt-Lookup läuft alles offline,
  Font Awesome ist mitgebaut

## Installation

1. In Home Assistant: **Einstellungen → Add-ons → Add-on-Store**
2. Oben rechts **⋮ → Repositories**
3. Diese URL eintragen und hinzufügen:

   ```
   https://github.com/Syynax/getraenkeverwaltung
   ```

4. Add-on **Getränkeverwaltung** auswählen, **Installieren**, **Starten**

Der erste Start dauert ein paar Minuten – das Image wird lokal gebaut.

> **Direkt nach dem Start das Passwort ändern.** Ausgeliefert wird
> `admin` / `bitte-aendern`; solange das gesetzt ist, steht ein Warnbalken über
> der App.

## Konfiguration

Alles wird im Add-on-Store unter **Konfiguration** eingestellt:

```yaml
titel: FF Musterdorf – Getränke
untertitel: Lagerbestand, Einkauf & Kassenbericht
anmeldung: immer
sitzungsdauer_tage: 30
benutzer:
  - name: cedric
    passwort: EinLangesPasswort
produkt_lookup: true
automatische_sicherung: true
sicherungen_behalten: 14
log_level: info
```

Die vollständige Beschreibung aller Optionen, der Anmeldung, des Barcode-Scanners
und der Rechenregeln steht in **[getraenke/DOCS.md](getraenke/DOCS.md)** – das ist
auch der Text, den Home Assistant im Add-on unter „Dokumentation" anzeigt.

## Aufbau

```
repository.yaml        Add-on-Repository für Home Assistant
getraenke/
├── config.yaml        Add-on-Metadaten (Ingress, Optionen, Ports)
├── build.yaml         Basis-Images je Architektur
├── Dockerfile         Zweistufiger Build: kompilieren → schlankes Runtime-Image
├── run.sh             Startskript, liest die Optionen über bashio
├── app/               Frontend (React + Vite)
└── server/            Backend (Express + TypeScript), Ablage als JSON-Datei
```

Zur Laufzeit bedient ein einziger Node-Prozess auf Port 8099 sowohl die API unter
`/api` als auch das gebaute Frontend.

## Lokal entwickeln

Alle Befehle vom Wurzelverzeichnis des Repositories aus. Erst beides bauen:

```bash
cd getraenke/server && npm install && npm run build && cd ../app && npm install && npm run build
```

Dann das Backend starten – es liefert die gebaute App gleich mit:

```bash
cd getraenke/server && DATA_FILE=../../data/getraenke.json PUBLIC_DIR=../app/dist PORT=8099 npm start
```

Danach läuft die komplette App unter http://localhost:8099. `DATA_FILE` bestimmt,
wo die Daten liegen; das Verzeichnis `data/` ist von Git ausgenommen.

Die Add-on-Optionen kommen im Container aus `/data/options.json`. Lokal legt man
sich dafür eine eigene Datei an und zeigt mit `OPTIONS_FILE` darauf – ohne die
gelten die Defaults, also unter anderem Anmeldung aus:

```bash
cd getraenke/server && OPTIONS_FILE=../../options.local.json DATA_FILE=../../data/getraenke.json PUBLIC_DIR=../app/dist npm start
```

Tests laufen ohne zusätzliche Abhängigkeit über den eingebauten Node-Runner:

```bash
cd getraenke/server && npm test
```

Abgedeckt sind die Rechenregeln (`src/domain/berechnung.ts`), Anmeldung und
Tokenprüfung, die Bremse gegen Passwort-Raten, die Sicherungsrotation, die
Scan-Kopplung, der Sortenvorschlag aus dem Produkt-Lookup, die
Automaten-Migration und die Dateiablage samt Sperre, Zwischenspeicher und
Defekterkennung.

Für Frontend-Entwicklung mit Hot-Reload zusätzlich im Ordner `getraenke/app`:

```bash
cd getraenke/app && npm run dev
```

Läuft dann auf Port 5174 und leitet `/api` auf 8099 weiter.

## Warum die Pfade relativ sind

Home Assistant liefert Add-ons über den Ingress unter
`/api/hassio_ingress/<token>/` aus. Deshalb baut Vite mit `base: './'` und die
API-Basis wird zur Laufzeit aus `window.location.pathname` abgeleitet
(`app/src/services/api.ts`). Ein absolutes `/api` würde beim Home-Assistant-Core
landen statt beim Add-on.

Aus demselben Grund steckt die Sitzung in einem Token im `localStorage` und nicht
in einem Cookie – der Ingress-Pfad wechselt, ein Cookie-Path liefe ins Leere.

## Änderungen

Siehe **[getraenke/CHANGELOG.md](getraenke/CHANGELOG.md)**. Aktuell: **1.7.0**.
