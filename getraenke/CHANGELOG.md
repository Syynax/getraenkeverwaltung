# Changelog

## 1.3.0

Die Automaten sind weg – geführt wird nur noch der Lagerbestand.

- Tab **Automaten**, die Automaten-Kachel in der Statusleiste und die
  Auffüllen-/Als-leer-Knöpfe auf den Sortenkarten entfallen
- Bei einer Sorte fallen die Felder **Automat** und **Automat-Kapazität** weg,
  bei der Bestandskorrektur das Feld **Automat**
- Buchen kennt nur noch **Eingang** und **Ausgang**, immer aufs Lager;
  „Automat auffüllen" gibt es nicht mehr
- **Bestellempfehlung** = `Soll-Bestand − Lagerbestand`. Der frühere Zuschlag
  von einem Kasten bei leerem Automaten fällt weg
- Beim ersten Start nach dem Update werden die Automaten-Felder aus
  `/data/getraenke.json` entfernt – vorher wird gesichert. Noch eingetragene
  Flaschen wandern ins Lager, es geht nichts verloren
- Alte Auffüll-Buchungen bleiben im Verlauf stehen. Statistik und Kassenbericht
  haben sie ohnehin nie mitgezählt, die Zahlen ändern sich also nicht
- Der Import räumt Sicherungen aus der Automaten-Zeit genauso auf

## 1.2.1

- Mehrere unbekannte Codes hintereinander gehen nicht mehr verloren: Jeder
  bekommt eine eigene Zeile mit eigener Sortenauswahl, statt dass der nächste
  Scan die vorherige Zuordnen-Box überschreibt
- Neuer **×**-Knopf, um einen offenen Code zu verwerfen
- Derselbe Code wird nicht doppelt in die Liste aufgenommen
- Ab 20 offenen Zuordnungen nimmt das Gerät nichts Neues mehr an und meldet das,
  statt still etwas zu verwerfen
- Kopplungscode: nach 10 Fehlversuchen 5 Minuten gesperrt – vorher liess sich
  der sechsstellige Code ungebremst durchprobieren

## 1.2.0

### Handy als Scanner

- Der Scannen-Tab hat drei Betriebsarten: **Hier scannen**, **Handy koppeln**
  (dieses Gerät bucht) und **Als Scanner** (dieses Gerät scannt nur)
- Kopplung über einen sechsstelligen Code, den das buchende Gerät anzeigt –
  damit braucht der Laptop keine eigene Kamera mehr
- Gescannte Codes erscheinen ohne merkliche Verzögerung auf dem buchenden Gerät
  (Long-Polling, keine zusätzliche Abhängigkeit)
- Das Handy vibriert kurz, wenn ein Code angekommen ist
- Kommen Codes schneller, als gebucht wird, laufen sie in eine Warteschlange
  statt verloren zu gehen
- Die Kopplung übersteht einen Wechsel auf einen anderen Unter-Tab und einen
  Reload – im Hintergrund wird weiter gebucht
- Die Kopplung lebt nur im Arbeitsspeicher und verfällt nach 30 Minuten ohne
  Aktivität

### Produktdatenbank

- Unbekannte Barcodes werden beim Scannen in der offenen Produktdatenbank
  **Open Food Facts** nachgeschlagen – Produktname und Marke stehen dann über
  der Sortenauswahl
- Die Sorte mit dem am besten passenden Namen ist automatisch vorausgewählt;
  bei mehrdeutigen Treffern bewusst keine Vorauswahl
- Gespeichert wird weiterhin nur, was über **Zuordnen & einbuchen** bestätigt
  wird – die Datenbank liefert nur einen Vorschlag
- Neue Option `produkt_lookup` (Standard `true`): abschaltbar für den
  Offline-Betrieb; ist sie aus oder die Datenbank nicht erreichbar, läuft der
  Scan unverändert weiter
- Treffer werden eine Woche zwischengespeichert, Fehlanzeigen eine Stunde

## 1.1.0

- Eigene Benutzeranmeldung vor der App – Konten werden im Add-on-Store unter
  **Konfiguration** gepflegt (`benutzer`: Name + Passwort, beliebig viele)
- `anmeldung` steuert, wann die Anmeldemaske kommt: `immer`,
  `nur_direktzugriff` (im Ingress reicht der Home-Assistant-Login) oder `aus`
- `sitzungsdauer_tage` legt fest, wie lange man angemeldet bleibt – die Sitzung
  übersteht Neustarts und Updates
- Nach 10 Fehlversuchen ist die Anmeldung 15 Minuten gesperrt
- Warnbalken, solange das Standardpasswort gesetzt oder kein Benutzer angelegt ist
- Benutzername mit Abmelden-Knopf in der Kopfleiste

## 1.0.0

Erste Version – ausgelagert aus dem Getränke-Tab der Feuerwehr-Einsatzstatistik.

- Bestand, Einkauf, Barcode-Scan, Automaten, Events und Auswertung vollständig übernommen
- Läuft als Home-Assistant-Add-on mit Ingress (Panel „Getränke" in der Seitenleiste)
- Daten liegen persistent unter `/data/getraenke.json`
- Sichern/Import als JSON – für Backup und die Übernahme der bestehenden Daten
- Titel und Untertitel über die Add-on-Optionen einstellbar
- Font Awesome ist mitgebaut, das Add-on braucht keinen Internetzugang
