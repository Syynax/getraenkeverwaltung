# Changelog

## 1.8.2

Zweiter Teil des Umbaus – an der Bedienung ändert sich weiterhin nichts.

- Die vier Tabs liegen jetzt in `tabs/`: Bestand, Einkauf, Events und Auswertung
- Der Einkauf hatte genug eigenen Zustand für einen eigenen Hook (`useEinkauf`):
  erfasste Mengen, Filter, Gruppierung und Summe an einem Ort statt über die
  Seite verteilt
- `Getraenke.tsx` von 2374 Zeilen (vor 1.8.1) auf 1118 – sie hält jetzt nur noch
  die Zustände, die mehrere Ansichten teilen, und verteilt sie

## 1.8.1

Reiner Umbau – an der Bedienung ändert sich nichts.

- Die Getränkeseite lag als eine Datei mit 2374 Zeilen vor. Konstanten und
  Hilfsfunktionen stehen jetzt in `hilfen.ts`, die sechs Dialoge in
  `dialoge/` – jeder mit klaren Eingaben statt Zugriff auf den Zustand der
  ganzen Seite
- 23 ungenutzte CSS-Klassen entfernt, teils Altlasten aus der Automaten-Zeit

## 1.8.0

### Buchungsarchiv

Bisher wuchsen die Buchungen für immer in einer Datei – und jede einzelne
Buchung schrieb sie komplett neu. Nach ein paar Jahren hätte jeder Klick auf
„+1 Kasten" zehntausende Altzeilen erneut auf die Speicherkarte geschrieben.

- **Abgeschlossene Jahre wandern beim Start nach `/data/archiv/buchungen-JJJJ.json`.**
  Die Trennung ist überschneidungsfrei: Eine Buchung liegt entweder im Archiv
  oder in der laufenden Datei
- Verlauf, Verbrauchsstatistik und Kassenbericht lesen das Archiv dazu – für die
  Auswertung ändert sich nichts, alle Jahre bleiben sichtbar
- **Sichern und Export enthalten weiterhin den vollständigen Bestand**
- Buchungsnummern zählen über das Archiv hinweg weiter, damit nach dem
  Auslagern keine Nummer ein zweites Mal vergeben wird
- Buchungen aus archivierten Jahren sind im Verlauf mit *Archiv* gekennzeichnet
  und lassen sich nicht mehr stornieren; der Versuch über die Schnittstelle
  erklärt auch, warum
- Ein Import leert das Archiv, weil die eingespielte Sicherung bereits alle
  Buchungen enthält

## 1.7.0

### Schneller

- **Der Server hält den geparsten Datenbestand vor.** Bisher las und zerlegte
  jede Anzeige die komplette Datei neu; ein Klick auf „+1 Kasten" löste ein
  knappes Dutzend vollständiger Lesevorgänge aus. Erkannt wird eine Änderung
  über Zeitstempel und Grösse – wer eine Sicherung zurückkopiert, während das
  Add-on läuft, bekommt trotzdem den neuen Stand
- **Die Oberfläche lädt gezielt nach statt alles.** Eine Buchung zieht nicht
  mehr Events und Stammdaten mit; ein Klick auf „+1 Kasten" macht statt neun nur
  noch sieben Anfragen, und die übrigen sind Treffer im Zwischenspeicher

### Einkauf

- **Der Gruppenbedarf steht jetzt im Einkauf-Tab**, wo die Mengen erfasst
  werden: „noch 6 von 7 Kästen zu verteilen", live mitzählend über alle Marken
  der Gruppe hinweg. Sind alle verteilt, wird die Zeile grün. Bisher stand die
  Zahl nur in der Einkaufsliste im Bestand-Tab – man musste sie sich merken
- Der Einkauf ist wie der Bestand nach Oberkategorien geblockt
- **Schnelle Klicks auf ± gehen nicht mehr verloren.** Vier Klicks kurz
  hintereinander zählten bisher als einer, weil jeder vom selben Ausgangswert
  ausging

### Kleinigkeiten

- **Auch eine Inventur lässt sich stornieren.** Die Schnittstelle konnte es
  schon, die Oberfläche blendete den Knopf aber aus – wer sich beim Zählen
  vertut, muss das zurücknehmen können
- Oberkategorien werden intern über ihre Id zusammengeführt statt über den
  Namen; ein wiederverwendeter Name bringt die Zuordnung nicht mehr durcheinander
- **109 Tests** statt 61: neu abgedeckt sind Anmeldung und Tokenprüfung, die
  Bremse gegen Passwort-Raten, die Sicherungsrotation, die Scan-Kopplung und der
  neue Zwischenspeicher

## 1.6.0

### Oberkategorien

- **Mehrere Marken laufen jetzt unter einem Dach**: „Bier" über Augustiner,
  Tegernseer und was gerade zum Probieren dasteht. Jede Marke bleibt eine eigene
  Sorte mit eigenen Barcodes, eigenem Preis und eigenem Bestand
- **Der Soll-Bestand gilt für die Gruppe.** Nachbestellt wird, wenn insgesamt zu
  wenig da ist – nicht sobald eine einzelne Marke leer ist. Ein Sixpack, das
  einmal zum Probieren gekauft wurde, steht damit nicht ewig auf der Einkaufsliste
- Verwaltung unter **Bestand → Oberkategorien**, Zuordnung im Sortenformular
- **Der Lagerbestand ist nach Oberkategorie gruppiert**, mit Summe je Gruppe
- Die Einkaufsliste zeigt eine Zeile je Gruppe statt einer je Marke, mit den
  zugehörigen Marken als Hinweis – gekauft wird eine davon
- Eine Sorte mit **eigenem** Soll-Bestand bleibt einzeln und zählt nicht auf die
  Gruppe; sonst käme sie doppelt in den Einkauf
- Wird beim Anlegen eine Oberkategorie gewählt und der Soll-Bestand leer
  gelassen, ist die Vorgabe **0** statt 4 – die Sorte zahlt dann auf die Gruppe ein
- Eine Oberkategorie zu entfernen löst nur die Klammer; die Sorten bleiben samt
  Bestand und Buchungen erhalten
- Sicherungen von vor 1.6.0 lassen sich unverändert importieren

## 1.5.0

### Die Daten sind sicherer

- **Eine beschädigte Datei führt nicht mehr zu Datenverlust.** Bisher lief das
  Add-on in so einem Fall mit leerem Bestand weiter – die erste Buchung hätte
  alles überschrieben. Jetzt startet es bewusst nicht, schreibt nichts und sagt
  im Protokoll, wo die Sicherungen liegen
- **Tägliche Sicherung** in `/data/sicherungen`, standardmässig 14 Stück.
  Neue Optionen `automatische_sicherung` und `sicherungen_behalten`
- Die alten Import-Sicherungen neben der Datendatei werden mit aufgeräumt,
  statt unbegrenzt zu wachsen
- **Schreibvorgänge werden auf die Platte durchgereicht** (`fsync`), damit ein
  Stromausfall nichts frisst, was schon bestätigt war
- **Sauberes Herunterfahren:** Auf das Stoppsignal von Home Assistant werden
  laufende Buchungen zu Ende gebracht, bevor sich das Add-on beendet
- Reste eines abgebrochenen Schreibvorgangs werden beim Start entfernt
- Beim Start steht im Protokoll, wie viele Sorten, Bestände und Buchungen
  geladen wurden

### Kassenbericht wird belastbar

- **Der Verkaufspreis wird jetzt historisch geführt.** Bisher rechnete der
  Kassenbericht immer mit dem heutigen Preis – eine Preiserhöhung veränderte
  rückwirkend die Einnahmen aller vergangenen Monate. Ab jetzt gilt der Preis,
  der bei der Buchung galt. Beim Einkaufspreis war das schon so
- **Neue Buchungsart Schwund / Bruch:** Ware verlässt das Lager ohne Einnahme.
  Der Kassenbericht weist den entgangenen Wert als eigene Kachel aus, ohne ihn
  in den Gewinn zu rechnen
- **Buchungen lassen sich stornieren.** Der Bestand wird zurückgedreht, die
  Buchung bleibt durchgestrichen im Verlauf stehen und zählt nirgends mehr mit.
  Würde der Bestand dadurch negativ, wird der Storno mit Begründung abgelehnt
- **Inventur:** Gezählte Flaschen je Sorte eintragen; jede Abweichung wird als
  eigene Buchung festgehalten statt den Bestand stillschweigend zu überschreiben
- Bei jeder Buchung steht, **wer** sie gemacht hat – sofern eine Anmeldung aktiv ist

### Unterbau

- Die Rechenregeln liegen jetzt als reine Funktionen in `domain/berechnung.ts`
  und sind mit **47 Tests** abgedeckt (`npm test`, ohne zusätzliche Abhängigkeit)
- Getestet werden Bestellempfehlung, Verbrauch, Kassenbericht, Bestandswirkung,
  die Automaten-Migration, der Sortenvorschlag und die Dateiablage samt Sperre

## 1.4.0

### Sorte anlegen

- **Neue Sorte direkt aus einem Scan**: In der Zuordnen-Box gibt es neben
  „Zuordnen & einbuchen" jetzt **Neue Sorte daraus anlegen**. Name und
  Gebindegrösse kommen – soweit vorhanden – aus dem Produkt-Lookup, der Barcode
  ist schon hinterlegt
- **Pflicht sind nur noch Name, Kategorie und Gebinde.** Warnschwelle,
  Soll-Bestand und die beiden Preise dürfen leer bleiben; der Server setzt dann
  2 Kästen, 4 Kästen und „Preis noch offen" ein. Der Einkaufspreis trägt sich
  beim ersten Einbuchen ohnehin selbst nach
- **Gebinde als Knöpfe** (20er, 24er, 12er, 11er, 6er) statt Zahleneingabe,
  daneben weiterhin ein freies Feld
- Preise, Schwellen und Barcodes sitzen zusammengeklappt hinter einem Aufklapper
- **Hinweis bei gleichem Namen**, bevor „Cola" zum zweiten Mal entsteht.
  Angelegt wird trotzdem – zwei Grössen derselben Marke sind erlaubt
- Beim Bearbeiten setzt ein leer gelassenes Feld den bisherigen Wert nicht mehr
  auf 0 zurück

### Einkauf

- **Standardmässig nur die Sorten, die nachbestellt werden sollen** – mit
  Umschalter auf alle Sorten. Zeilen mit erfasster Menge bleiben immer sichtbar
- **± statt Zahlenfeld** für die Kästen, einhändig bedienbar
- **Der Entwurf übersteht einen Reload**: erfasste Mengen und Preise liegen in
  der Sitzung, ein Neuladen im Getränkemarkt kostet sie nicht mehr
- Neuer Knopf **Mengen zurücksetzen**
- Soll-Bestand 0 heisst jetzt wirklich „nie nachbestellen" statt „nimm 4"

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
