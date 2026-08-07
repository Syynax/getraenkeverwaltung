# Getränkeverwaltung

Getränkebestand, Einkauf, Events und Kassenbericht – ausgelagert aus
der Feuerwehr-Einsatzstatistik in ein eigenständiges Home-Assistant-Add-on.

## Was das Add-on kann

| Tab | Inhalt |
| --- | --- |
| **Bestand** | Kästen pro Sorte im Lager, nach Oberkategorien gruppiert, Schnellbuchung ±1 Kasten, Einkaufsliste mit Bestellempfehlung |
| **Einkauf** | Kompletten Einkauf mit Menge und Preis je Kasten auf einmal ins Lager buchen; zeigt standardmässig nur, was nachbestellt werden soll |
| **Scannen** | Flaschen-Barcode scannen → 1 Kasten dieser Sorte ins Lager; wahlweise mit einem Handy als gekoppeltem Scanner; unbekannte Codes werden in einer offenen Produktdatenbank nachgeschlagen und lassen sich einer Sorte zuordnen |
| **Events** | Sommerfest & Co. mit eigener Einkaufsliste (Getränkesorten + freie Artikel), druckbar |
| **Auswertung** | Letzte Buchungen, Verbrauch pro Monat, Kassenbericht (Einnahmen/Ausgaben/Gewinn) |

## Installation

1. In Home Assistant: **Einstellungen → Add-ons → Add-on-Store**
2. Oben rechts **⋮ → Repositories** und die URL dieses Repositories eintragen
3. Add-on **Getränkeverwaltung** auswählen und **Installieren**
4. **Starten** – danach erscheint „Getränke" in der Seitenleiste

## Konfiguration

Alles wird im Add-on-Store unter **Konfiguration** eingestellt – es gibt keine
Einstellung, für die man in Dateien müsste.

```yaml
titel: FF Musterdorf – Getränke
untertitel: Lagerbestand, Einkauf & Kassenbericht
anmeldung: immer
sitzungsdauer_tage: 30
benutzer:
  - name: cedric
    passwort: EinLangesPasswort
  - name: kasse
    passwort: NochEinsAnderes
produkt_lookup: true
automatische_sicherung: true
sicherungen_behalten: 14
log_level: info
```

| Option | Bedeutung |
| --- | --- |
| `titel` | Überschrift in der Kopfleiste und im Browser-Tab |
| `untertitel` | Kleine Zeile darunter, darf leer bleiben |
| `anmeldung` | Wann die Anmeldemaske kommt – siehe unten |
| `sitzungsdauer_tage` | Wie lange man angemeldet bleibt (1–365, Standard 30) |
| `benutzer` | Liste aus Name + Passwort; über **+** kommen weitere dazu |
| `produkt_lookup` | Unbekannte Barcodes bei Open Food Facts nachschlagen (Standard `true`) |
| `automatische_sicherung` | Täglich eine Kopie in `/data/sicherungen` ablegen (Standard `true`) |
| `sicherungen_behalten` | Wie viele Tagessicherungen aufgehoben werden (1–365, Standard 14) |
| `log_level` | Ab `warning` werden keine Request-Logs mehr geschrieben |

## Anmeldung

Das Add-on bringt eine eigene Benutzeranmeldung mit. Die Konten stehen in den
Add-on-Optionen – ein Eintrag pro Person, angelegt über das **+** in der
Benutzerliste. Passwörter werden im Konfigurationsdialog verdeckt eingegeben.

| `anmeldung` | Verhalten |
| --- | --- |
| `immer` (Standard) | Anmeldemaske überall, auch im Ingress-Panel |
| `nur_direktzugriff` | Im Ingress-Panel reicht der Home-Assistant-Login; über Port 8099 bzw. eine eigene Subdomain wird angemeldet |
| `aus` | Keine Anmeldung – nur sinnvoll, wenn ausschliesslich der Ingress genutzt wird |

Nach dem ersten Start gilt `admin` / `bitte-aendern`. **Sofort ändern** – solange
das Standardpasswort gesetzt ist, steht ein oranger Warnbalken über der App und
eine Warnung im Add-on-Log.

Weitere Details:

- Die Anmeldung bleibt `sitzungsdauer_tage` lang bestehen, auch über Neustarts
  und Add-on-Updates hinweg. Der dafür nötige Schlüssel liegt in
  `/data/.session-secret`.
- Wird ein Benutzer aus den Optionen entfernt, ist dessen Sitzung sofort
  ungültig. Ein Passwortwechsel beendet laufende Sitzungen dagegen **nicht** –
  wer alle rauswerfen will, löscht `/data/.session-secret` und startet neu.
- Nach 10 Fehlversuchen ist die Anmeldung von dieser IP aus 15 Minuten gesperrt.
- Ist `anmeldung` eingeschaltet, aber **kein** Benutzer hinterlegt, läuft das
  Add-on offen weiter (sonst käme niemand mehr rein) und zeigt einen Warnbalken.

Der Benutzername steht oben rechts; ein Klick darauf meldet ab.

## Oberkategorien – mehrere Marken unter einem Dach

Eine Oberkategorie fasst Marken zusammen: **Bier** über Augustiner, Tegernseer
und was gerade zum Probieren dasteht. Jede Marke bleibt eine eigene Sorte mit
eigenen Barcodes, eigenem Preis und eigenem Bestand – die Klammer sitzt darüber.

Der Nutzen steckt im **Soll-Bestand der Gruppe**: Nachbestellt wird, wenn
insgesamt zu wenig Bier da ist – nicht sobald eine einzelne Marke leer ist. Ein
Sixpack, das einmal zum Probieren gekauft wurde, soll schliesslich nicht ewig auf
der Einkaufsliste stehen.

Anzulegen unter **Bestand → Oberkategorien**. Beim Anlegen einer Sorte wählt man
sie im Feld **Oberkategorie**.

### Wer zahlt auf den Gruppen-Soll ein

| Sorte | Verhalten |
| --- | --- |
| in einer Gruppe, **ohne** eigenen Soll-Bestand | zählt auf den Gruppen-Soll, löst selbst nichts aus |
| in einer Gruppe, **mit** eigenem Soll-Bestand | wird einzeln nachbestellt und zählt **nicht** auf die Gruppe |
| ohne Gruppe, mit Soll-Bestand | wie bisher einzeln |
| ohne Gruppe, ohne Soll-Bestand | taucht nie in der Einkaufsliste auf |

Die zweite Zeile ist Absicht: Ein Stammbier mit eigenem Soll wird ohnehin
nachbestellt. Zählte es auch noch auf die Gruppe, käme es doppelt in den Einkauf.

Wählt man beim Anlegen eine Oberkategorie und lässt den Soll-Bestand leer, ist
die Vorgabe deshalb **0** – die Sorte zahlt dann auf die Gruppe ein. Ohne Gruppe
bleibt die Vorgabe bei 4 Kästen.

### Zwei Zahlen, zwei Bedeutungen

Im Bestand steht über jeder Gruppe, wie viel **insgesamt** dasteht – das ist die
Zahl fürs Regal. Der Dialog **Oberkategorien** zeigt zusätzlich, welcher Teil
davon auf den Soll zählt, etwa „5,0 Kästen gesamt · 2,0 von 10 auf den Soll".
Die Einkaufsliste rechnet mit der zweiten Zahl.

### Eine Oberkategorie entfernen

Die Sorten darin bleiben samt Bestand und Buchungen erhalten und stehen danach
einzeln. Weg ist nur die Klammer.

## Sorten anlegen

Pflicht sind nur **Name**, **Kategorie** und **Gebinde**. Für das Gebinde stehen
die üblichen Grössen als Knöpfe bereit, daneben bleibt ein freies Feld.

Alles Weitere – Warnschwelle, Soll-Bestand, Einkaufs- und Verkaufspreis – steckt
zusammengeklappt hinter **Preise, Schwellen und Barcodes** und darf leer bleiben.
Dann gilt:

| Feld | Vorgabe, wenn leer |
| --- | --- |
| Warnschwelle | 2 Kästen |
| Soll-Bestand | 4 Kästen |
| Einkaufspreis | offen – wird beim ersten Einbuchen automatisch gesetzt |
| Verkaufspreis | offen – für den Kassenbericht später nachtragen |

**Soll-Bestand 0** heisst „nie nachbestellen" – die Sorte taucht dann nicht mehr
in der Einkaufsliste auf.

Der schnellste Weg führt über den Scanner: Ist ein Barcode unbekannt, steht in
der Zuordnen-Box neben „Zuordnen & einbuchen" auch **Neue Sorte daraus anlegen**.
Name und Gebinde kommen dann aus der Produktdatenbank, der Barcode ist schon
hinterlegt – meist bleibt nur noch Bestätigen.

## Einkaufen

Der Einkauf-Tab zeigt standardmässig nur die Sorten, für die eine Bestellung
ansteht; über **Alle Sorten** kommt man an jede andere heran. Eine Zeile, in der
schon eine Menge steht, bleibt immer sichtbar.

Die Menge wird über **−** und **+** erfasst, der Preis je Kasten ist mit dem
zuletzt bekannten vorbelegt. **Einkauf verbuchen** legt für jede Zeile mit Menge
einen Eingang an und schreibt den Preis auf der Sorte fort.

Der Entwurf übersteht ein Neuladen der Seite – im Getränkemarkt mit wackligem
Netz geht damit nichts verloren. **Mengen zurücksetzen** leert ihn wieder.

## Wo die Daten liegen und wie sie gesichert werden

Der Bestand liegt in `/data/getraenke.json`. `/data` ist das persistente Volume
des Add-ons: **Stoppen, Neustarten und Updates überstehen die Daten unverändert.**
Gelöscht wird `/data` nur beim **Deinstallieren** des Add-ons.

Damit das auch bei einem Stromausfall hält, ist einiges eingebaut:

- **Atomar geschrieben.** Jede Änderung geht erst in eine Nebendatei, wird auf
  die Platte durchgereicht (`fsync`) und dann umbenannt. Ein Absturz mitten im
  Schreiben lässt immer die vollständige alte Datei zurück, nie eine halbe.
- **Sauberes Herunterfahren.** Auf das Stoppsignal von Home Assistant nimmt das
  Add-on keine neuen Anfragen mehr an, bringt laufende Buchungen zu Ende und
  beendet sich erst dann.
- **Keine stille Leerung.** Ist die Datei beschädigt, startet das Add-on
  **bewusst nicht** und schreibt nichts. Im Protokoll steht, was los ist und wo
  die Sicherungen liegen. Früher wäre in so einem Fall mit leerem Bestand
  weitergelaufen – und die erste Buchung hätte alles überschrieben.
- **Tägliche Sicherung** unter `/data/sicherungen/getraenke-JJJJ-MM-TT.json`,
  standardmässig 14 Stück. Geschrieben wird höchstens eine pro Kalendertag.
- Beim Start steht im Protokoll, wie viele Sorten, Bestände und Buchungen
  geladen wurden – ein Blick genügt, um zu sehen, dass alles da ist.

### Kaputte Datei wiederherstellen

1. Im **Protokoll** des Add-ons nachsehen, welche Datei betroffen ist
2. Add-on stoppen
3. Über den Dateizugriff (z.B. das Add-on „File editor") die jüngste Datei aus
   `/data/sicherungen/` nach `/data/getraenke.json` kopieren
4. Add-on starten – im Protokoll erscheinen wieder die geladenen Zahlen

Alternativ eine heruntergeladene **Sicherung** über den Import einspielen.

## Daten aus der Einsatzstatistik übernehmen

Der Datenbestand liegt im Add-on unter `/data/getraenke.json` und übersteht
Neustarts und Updates. Die bestehenden Daten holst du so herüber:

1. In der Einsatzstatistik die Datei `data/getraenke.json` kopieren
2. Im Add-on oben rechts auf **Import** klicken und diese Datei auswählen
3. Bestätigen – der bisherige Stand wird vorher automatisch als
   `/data/getraenke.json.backup-<zeitstempel>` gesichert

> Sicherungen aus der Automaten-Zeit lassen sich weiterhin importieren. Die
> Automaten-Felder werden dabei automatisch entfernt; Flaschen, die dort noch
> eingetragen sind, wandern ins Lager.

**Sichern** lädt jederzeit den kompletten Bestand als JSON herunter. Dieselbe
Datei kann per Import wieder eingespielt werden – so läuft auch ein Umzug auf
eine andere Home-Assistant-Instanz.

> Nach dem Umzug in der Einsatzstatistik den Getränke-Tab entfernen oder als
> „nur lesen" markieren, damit nicht an zwei Stellen gebucht wird.

## Barcode-Scanner

Der Scanner nutzt die Kamera des Geräts über die `BarcodeDetector`-API. Damit
das funktioniert, müssen zwei Dinge stimmen:

- **Sicherer Kontext:** Kamerazugriff gibt es nur über `https://` oder direkt
  über `localhost`. Wer Home Assistant über `http://homeassistant.local:8123`
  aufruft, bekommt keine Kamera.
- **Browser-Unterstützung:** Chrome/Edge/Android ja, Safari und iOS derzeit
  nicht.

### Mit Cloudflare Tunnel

Wird Home Assistant über einen Cloudflare Tunnel per `https://` erreicht, ist
die erste Bedingung erfüllt – der Scanner läuft dann direkt im Ingress-Panel.
Der Ingress liegt auf derselben Origin wie Home Assistant, deshalb greift die
Permissions-Policy-Vorgabe `camera=self` und der iframe darf die Kamera nutzen.
Beim ersten Start fragt der Browser einmalig nach der Freigabe; sie gilt für die
Tunnel-Domain, nicht für `homeassistant.local`.

Wichtig dabei:

- Über die Tunnel-Domain aufrufen, nicht über die lokale `http://`-Adresse –
  sonst fehlt der sichere Kontext trotz Tunnel.
- Der optionale Port 8099 ist über den Tunnel **nicht** erreichbar und wird auch
  nicht gebraucht. Ihn zusätzlich zu veröffentlichen hieße: ungeschützter
  Vollzugriff aus dem Internet. Nicht tun.

### Fallback ohne Tunnel

Bleibt die Kamera im Ingress-Fenster blockiert, das Add-on im lokalen Netz über
den optionalen Port direkt öffnen (`http://<home-assistant>:8099`) – dafür in
den Add-on-Einstellungen unter **Netzwerk** den Port 8099 freigeben. Über `http`
gibt es allerdings ebenfalls keine Kamera; das hilft nur, wenn der Port per
eigenem Reverse Proxy mit `https` bedient wird.

Unabhängig davon funktioniert im Scannen-Tab immer die **manuelle Eingabe** des
Barcodes.

### Produktdatenbank (`produkt_lookup`)

Trifft der Scanner auf einen Code, der noch keiner Sorte zugeordnet ist, fragt
das Add-on ihn bei **Open Food Facts** nach – einer offenen Produktdatenbank
(ODbL, ohne Schlüssel oder Anmeldung). Steht dort ein Treffer, erscheint über
der Sortenauswahl der Produktname („Coca-Cola Zero, 0,33 l"), und die Sorte mit
dem am besten passenden Namen ist bereits vorausgewählt. Aus „blind aus der
Liste suchen" wird damit ein Bestätigen.

Was die Datenbank **nicht** abnimmt:

- Die Zuordnung `Barcode → Sorte` bleibt eure Entscheidung. Gespeichert wird
  weiterhin nur, was ihr über **Zuordnen & einbuchen** bestätigt.
- **Kasten-Barcodes** (ITF-14 auf dem Tray) stehen in keiner öffentlichen
  Datenbank. Deshalb wird weiterhin die Flaschen-EAN gescannt.
- **Regionale Brauereien** fehlen bei Open Food Facts häufig – dann kommt der
  Hinweis „nicht gefunden" und es geht manuell weiter wie bisher.

### Handy als Scanner koppeln

Wer am Laptop bucht, aber dort keine Kamera hat, koppelt ein Android-Handy als
Scanner. Der Scannen-Tab hat dafür drei Betriebsarten:

| Modus | Rolle |
| --- | --- |
| **Hier scannen** | Dieses Gerät scannt und bucht – wie bisher |
| **Handy koppeln** | Dieses Gerät bucht, gescannt wird auf dem Handy |
| **Als Scanner** | Dieses Gerät scannt nur und schickt die Codes weiter |

So läuft es ab:

1. Am buchenden Gerät **Handy koppeln → Kopplung starten**. Es erscheint ein
   sechsstelliger Code.
2. Am Handy denselben Tab öffnen, **Als Scanner** wählen und den Code eintippen.
3. Kamera starten und losscannen. Jede erkannte Flasche erscheint sofort auf dem
   buchenden Gerät und wird dort verbucht; das Handy vibriert kurz zur Bestätigung.

Unbekannte Codes landen auf dem buchenden Gerät, wo die Sortenliste und die
Tastatur sind – jeder in einer eigenen Zeile, die stehen bleibt, bis sie
zugeordnet oder über das **×** verworfen wird. Das Handy scannt derweil einfach
weiter; auch mehrere unbekannte Flaschen hintereinander gehen so nicht verloren.
Über 20 offene Zuordnungen nimmt das Gerät nichts Neues mehr an und sagt das
auch – dann erst die Liste abarbeiten.

Wichtig zu wissen:

- Die Kopplung liegt nur im Arbeitsspeicher und verfällt nach 30 Minuten ohne
  Aktivität. Ein Neustart des Add-ons beendet sie ebenfalls – dann einfach neu
  koppeln.
- Ein Wechsel auf einen anderen Unter-Tab (z. B. **Bestand**) unterbricht nichts:
  Es wird im Hintergrund weiter gebucht. Auch ein Reload nimmt die Kopplung
  wieder auf, ohne bereits gebuchte Scans zu wiederholen.
- Der Code bleibt gültig, solange die Kopplung läuft. Nach einem Reload am Handy
  kann man sich damit wieder verbinden.
- Beide Geräte müssen am Add-on angemeldet sein; die Kopplung selbst überträgt
  nur Barcodes.
- Die `https`-Bedingung für die Kamera gilt jetzt nur noch fürs Handy. Der
  Laptop braucht keine.
- Scannt das Handy schneller, als gebucht wird, laufen die Codes in eine
  Warteschlange und werden der Reihe nach abgearbeitet. Bekannte Flaschen werden
  direkt gebucht, unbekannte sammeln sich in der Zuordnen-Liste.
- Nach 10 Fehlversuchen beim Kopplungscode ist das Verbinden von diesem Gerät
  aus 5 Minuten gesperrt.
- Ein iPhone taugt auch hier nicht als Scanner: Safari bringt die nötige
  `BarcodeDetector`-API nicht mit.

Der Produkt-Lookup ist der einzige Verbindungsaufbau des Add-ons nach draußen. Übertragen
wird dabei nur der Barcode, keine Bestands- oder Benutzerdaten. Treffer werden
eine Woche zwischengespeichert, derselbe Code kostet also nur eine Abfrage. Wer
das Add-on strikt offline betreiben will, setzt `produkt_lookup: false` – der
Scan funktioniert dann unverändert, nur ohne Vorschlag. Ist die Datenbank gerade
nicht erreichbar, steht das als Hinweis in der Zuordnen-Box und der Scan läuft
normal weiter.

## Buchen, Stornieren, Inventur

Es gibt drei Buchungsarten:

| Art | Wirkung |
| --- | --- |
| **Eingang** | Ware kommt ins Lager, zählt als Ausgabe im Kassenbericht |
| **Ausgang** | Verkauf, zählt als Einnahme |
| **Schwund / Bruch** | Ware verlässt das Lager, **ohne** Einnahme – etwa kaputte Flaschen oder Freigetränke |

Schwund taucht im Kassenbericht als eigene Kachel auf: der Wert, der in der
Kasse fehlt. In den Gewinn geht er nicht ein, denn es ist kein Geld geflossen.

**Stornieren:** In **Auswertung → Letzte Buchungen** hat jede Zeile einen
Rückwärtspfeil. Der dreht die Bestandswirkung zurück; die Buchung bleibt
durchgestrichen stehen und zählt nirgends mehr mit. Gelöscht wird nichts – eine
Kassenprüfung soll sehen können, dass korrigiert wurde. Würde der Bestand durch
den Storno negativ, wird er abgelehnt; dann ist die Ware zwischenzeitlich
ausgebucht worden und der Weg führt über **Bestand korrigieren**.

**Inventur:** Im Bestand-Tab oben rechts. Für jede Sorte die gezählten
**Flaschen** eintragen – vorbelegt ist der aktuelle Stand, wer nichts ändert,
bestätigt ihn. Jede Abweichung wird als eigene Buchung vom Typ *Inventur*
festgehalten, statt den Bestand stillschweigend zu überschreiben. So bleibt am
Jahresende nachvollziehbar, wo etwas gefehlt hat. Inventurbuchungen sind
geldneutral und verändern weder Kassenbericht noch Verbrauchsstatistik.

Ist eine Anmeldung aktiv, steht bei jeder Buchung, wer sie gemacht hat.

## Rechenregeln

- Bestände werden intern in **Flaschen** geführt, gebucht wird in **Kästen**
  (`Flaschen pro Kasten` je Sorte).
- **Bestellempfehlung** = `Soll-Bestand − aktueller Bestand`, aufgerundet.
- **Kassenbericht:** Ausgaben = Menge × Einkaufspreis je Kasten. Einnahmen =
  Menge × Flaschen pro Kasten × Verkaufspreis je Flasche.
- **Beide Preise werden historisch geführt:** Es zählt der Preis, der zum
  Zeitpunkt der Buchung galt und dort mitgespeichert wurde. Eine spätere
  Preisänderung verschiebt die Zahlen vergangener Monate deshalb nicht mehr.
  Buchungen aus der Zeit vor Version 1.5.0 haben keinen gespeicherten
  Verkaufspreis; für sie gilt weiterhin der aktuelle Sortenpreis.

## Sicherheit

Zwei Schichten: der Ingress ist durch die Home-Assistant-Anmeldung geschützt,
darüber hinaus hat das Add-on seine eigene Benutzeranmeldung (siehe oben).

Wer den Port 8099 freigibt oder eine eigene Subdomain darauf zeigen lässt,
umgeht den Home-Assistant-Login komplett – dann steht nur noch die Anmeldung des
Add-ons davor. Dafür gilt:

- `anmeldung` auf `immer` oder `nur_direktzugriff` lassen, niemals `aus`
- ordentliche Passwörter vergeben, nicht `bitte-aendern`
- die Verbindung per `https` absichern (Cloudflare Tunnel o.ä.), sonst gehen
  Passwörter im Klartext über die Leitung

Die Passwörter stehen als Klartext in den Add-on-Optionen – so wie bei
Home-Assistant-Add-ons üblich. Wer die Add-on-Konfiguration sehen kann, ist
ohnehin Home-Assistant-Administrator.

## Fehlersuche

| Symptom | Ursache / Lösung |
| --- | --- |
| Seite bleibt leer | Add-on-Log prüfen (**Protokoll**-Tab); startet der Node-Prozess? |
| „Kamera nicht verfügbar" | Kein https bzw. Browser ohne `BarcodeDetector` – siehe oben. Mit Cloudflare Tunnel: über die Tunnel-Domain aufrufen, nicht über die lokale `http`-Adresse |
| Import meldet „kein gültiges JSON" | Es wurde eine andere Datei als `getraenke.json` gewählt |
| Daten nach Update weg | Nur wenn das Add-on **deinstalliert** wurde – dabei wird `/data` gelöscht. Vorher immer **Sichern** |
| Add-on startet nicht, Protokoll meldet „Datenbestand ist beschädigt" | Absicht – so bleibt die Datei reparierbar. Siehe „Kaputte Datei wiederherstellen" |
| Storno wird abgelehnt | Der Bestand würde negativ; die Ware ist schon ausgebucht. Stattdessen **Bestand korrigieren** |
| „Benutzername oder Passwort stimmt nicht" | Konto in den Add-on-Optionen prüfen; nach Änderungen das Add-on **neu starten** |
| „Zu viele Fehlversuche" | 15 Minuten warten oder das Add-on neu starten |
| Ständig wieder abgemeldet | `/data/.session-secret` nicht schreibbar – siehe Add-on-Log |
| Warnbalken „läuft ungeschützt" | In den Optionen unter `benutzer` mindestens ein Konto anlegen |
