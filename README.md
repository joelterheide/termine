# Jahresplan

Eine schlichte Website mit allen Terminen, Diensten und Aufgaben übers Jahr. Man trägt sich ein, wo man mithelfen kann, oder sagt wieder ab. Ähnlich wie TeamPlus, aber ohne App und ohne Anmeldung. Die Daten liegen in einem Google Sheet.

**Seite:** https://joelterheide.github.io/termine/

## Was sie kann

- **Termine** mit Datum, optional Bis-Datum für mehrere Tage, Uhrzeit (z. B. „14:00–16:00“ oder „19:00“), Ort und Info. Man trägt sich **direkt beim Termin** ein, optional mit Platzgrenze. Bei Bedarf kommen **Schichten** dazu (z. B. Aufbau, Glühweinstand, Kasse) mit eigenen Zeiten und Plätzen. Ohne das Häkchen „Direkt beim Termin eintragen“ trägt man sich nur bei den Schichten ein, oder der Termin dient nur zur Info.
- **Aufgaben ohne festen Termin**, z. B. Kuchen backen oder Plakate aufhängen, optional mit „erledigen bis“.
- **Unteraufgaben:** Eine Aufgabe kann in Teile aufgeteilt werden, z. B. „Weihnachtsbaum besorgen“ in „Baum aussuchen“, „Anhänger organisieren“ und „Aufstellen“. Für jeden Teil trägt man sich einzeln ein und hakt ihn ab, wenn er erledigt ist. Bei der Aufgabe steht dann „2 von 3 Unteraufgaben erledigt“. Die ganze Aufgabe hakt man zum Schluss selbst ab („Ganze Aufgabe erledigt“). Erst dann wandert sie nach unten unter „Erledigte Aufgaben“. Aufgaben ohne Unteraufgaben hakt man direkt ab. In der Verwaltung legt man über „+ Unteraufgaben“ mehrere auf einmal an, eine pro Zeile.
- **Eintragen** mit Namen und optionaler Notiz („bringe Waffeleisen mit“), **absagen** über das × neben dem Namen.
- **Farbige Termine und „Jugend extern“:** Normale Termine haben einen farbig hinterlegten Kopf. Termine mit dem Häkchen „Jugend extern“ stehen eingeklappt als eine graue Zeile in der Liste und klappen per Klick auf. Über „Jugend extern ausblenden“ oben bei den Terminen verschwinden sie ganz aus Liste und Tabelle. Jeder Browser merkt sich diese Einstellung.
- **Tabellenansicht:** Bei den Terminen über „Ansicht: Liste · Tabelle“ umschalten. Die Tabelle zeigt pro Termin eine Zeile mit Datum oder Zeitraum, Uhrzeit und Titel, nach Monaten gegliedert für die nächsten zwölf Monate. Die Schulferien stehen dazwischen, und bei jedem Monat steht, welche Gruppe Putzdienst hat. Die Tabelle lässt sich drucken. Direktlink: `…/termine/#tabelle`.
- **Archiv:** Vergangene Termine bleiben mit allen Namen erhalten. Unten bei den Terminen stehen sie unter „Vergangene Termine anzeigen“, nach Monaten gegliedert und das Neueste zuerst. Abgelaufene und erledigte Aufgaben sind genauso aufklappbar.
- **Ein Klick:** Nach dem ersten Eintragen merkt sich der Browser den Namen. Danach trägt „Eintragen“ sofort ein, mit „Rückgängig“ für Fehlklicks. Über „mit Notiz“ kann man beim Eintragen noch etwas dazuschreiben. Den Namen kann man oben über „ändern“ wechseln.
- **Weitere Personen eintragen:** Mit „+ weitere Person“ unter dem Knopf trägt man z. B. Familienmitglieder ein. Das geht auch, wenn man selbst nicht eingetragen ist, und der eigene gespeicherte Name bleibt dabei unverändert.
- **Terminabstimmungen:** mehrere mögliche Daten (optional mit Uhrzeit) zur Wahl stellen. Jeder klickt bei allen passenden Daten auf „Passt mir“. Am Tag nach „Abstimmen bis“ wird automatisch der Termin mit den meisten Stimmen angelegt, bei Gleichstand der frühere. Wer dafür gestimmt hat, steht dort gleich in der Liste „Teilnehmer“. Andere können sich dazu eintragen, und jeder kann wieder absagen. Über „festlegen“ kann man das auch vorher selbst entscheiden.
- **Reagiert sofort:** Google braucht pro Anfrage ein bis drei Sekunden. Die Seite zeigt Eintragen, Absagen und Abstimmen trotzdem sofort an und bestätigt im Hintergrund. Beim Öffnen erscheint direkt der zuletzt geladene Stand.
- **Plätze begrenzen** (2/2 = voll) oder beliebig viele zulassen.
- **Meine Einträge:** Namen eingeben und alles auf einen Blick sehen, absagen, in den eigenen Kalender übernehmen.
- **Per WhatsApp teilen:** erzeugt einen fertigen Text mit den offenen Plätzen und dem Link.
- **Verwalten** mit Passwort: Termine, Schichten, Aufgaben und Abstimmungen anlegen, ändern, kopieren (z. B. für jeden Sonntag) und löschen.
- Funktioniert auf dem Handy, im Dunkelmodus und lässt sich als Aushang drucken.

## Einrichten

Bis Schritt 3 erledigt ist, läuft die Seite im **Demo-Modus** mit Beispieldaten, die nur im eigenen Browser gespeichert werden.

### 1. GitHub Pages einschalten

Im Repo auf **Settings → Pages**. Unter „Build and deployment“ als Source **Deploy from a branch** wählen, Branch **main** und Ordner **/ (root)**, dann **Save**. Nach ein bis zwei Minuten ist die Seite unter der Adresse oben erreichbar.

### 2. Google-Skript anlegen

Das geht nur **am Computer im Browser**, denn in der Google-Sheets-App am Handy gibt es Apps Script nicht. Nimm am besten ein privates Google-Konto. Schulkonten sperren Apps Script oft oder erlauben „Zugriff: Jeder“ nicht.

1. **[script.new](https://script.new)** öffnen. Das legt direkt ein neues Apps-Script-Projekt an. Ein Google Sheet musst du vorher nicht anlegen, das macht das Skript selbst.
2. Oben links auf „Unbenanntes Projekt“ klicken und in „Helferliste“ umbenennen.
3. Im Editor steht `function myFunction() { … }`. Das komplett löschen und den Inhalt von [`apps-script/Code.gs`](apps-script/Code.gs) einfügen. Auf GitHub die Datei öffnen und oben rechts über dem Code den Knopf „Copy raw file“ nutzen.
4. Die Zeile `const PASSWORT = 'bitte-aendern';` auf ein eigenes Passwort ändern. Das ist das Passwort zum Verwalten. Dann speichern (Strg+S oder das Disketten-Symbol).
5. In der Leiste über dem Code im Auswahlfeld die Funktion **einrichten** wählen und auf **Ausführen** klicken. Google fragt nach Berechtigungen:
   **Berechtigungen prüfen → eigenes Konto wählen → „Erweitert“ → „Zu Helferliste wechseln (unsicher)“ → Zulassen** (falls Häkchen angezeigt werden: alle auswählen).
   Die Warnung ist bei selbst geschriebenen Skripten normal. Unten im **Ausführungsprotokoll** steht danach der Link zur neuen Tabelle „Helferliste – Daten“. Sie liegt in deinem Google Drive.
6. Oben rechts **Bereitstellen → Neue Bereitstellung** → beim Zahnrad **Web-App** wählen.
   - Ausführen als: **Ich**
   - Wer hat Zugriff: **Jeder**

   Dann **Bereitstellen** und die **Web-App-URL** kopieren. Sie endet auf `/exec`.

Wenn du lieber ein vorhandenes Google Sheet nutzen willst, öffne es am Computer und wähle in der Menüleiste **Erweiterungen → Apps Script**. Danach geht es ab Schritt 2 genauso weiter, und die Daten landen direkt in diesem Sheet.

### 3. URL in die Website eintragen

Auf GitHub die Datei [`config.js`](config.js) öffnen, auf den Stift klicken und die URL eintragen:

```js
api: 'https://script.google.com/macros/s/……/exec',
```

Mit **Commit changes** speichern. Nach etwa einer Minute ist die Seite verbunden und der Demo-Hinweis verschwindet. In `config.js` lassen sich außerdem einstellen:

- `titel`, `untertitel`: Überschrift und Unterzeile
- `ferien`: Bundesland für die Schulferien in der Tabelle, z. B. `'BY'` oder `'NI'`. Leer bedeutet: keine Ferien anzeigen. Die Daten kommen von [openholidaysapi.org](https://www.openholidaysapi.org).
- `putzdienst`: Gruppen, die reihum je einen Monat dran sind, z. B.
  ```js
  putzdienst: {
    gruppen: ['Gruppe 1', 'Gruppe 2', 'Gruppe 3'],
    ab: '2026-11',                         // Gruppe 1 hat im November 2026 Putzdienst
    monate: { '2027-08': 'kein Putzdienst' } // einzelne Monate abweichend
  },
  ```

### 4. Termine anlegen

Ganz unten auf der Seite auf **Verwalten** klicken und das Passwort eingeben. Dann **+ Neuer Termin**: Titel, Datum, bei Bedarf Bis-Datum und Uhrzeit. Mit dem Häkchen „Direkt beim Termin eintragen“ (vorausgewählt) können sich alle sofort eintragen. Braucht es verschiedene Aufgaben oder Zeiten, beim Termin zusätzlich **Schichten hinzufügen**.

Tipp: Bei „Zeiten“ kann man mehrere auf einmal angeben, z. B. `14-16, 16-18, 18-20`. Daraus werden drei Schichten mit der gleichen Station. Für einen zweiten Markttag einfach das Datum in der Schicht ändern.

## Im Alltag

- Den Link in der WhatsApp-Gruppe anpinnen oder in die Gruppenbeschreibung schreiben.
- **Offene Plätze per WhatsApp teilen** (oben bei den Terminen) erzeugt eine Übersicht zum Posten.
- Wiederkehrende Termine wie das Kirchcafé mit **Kopieren** auf das nächste Datum übertragen. Die Schichten werden mitkopiert, die Namen nicht.
- Im **Google Sheet** kann man alles direkt sehen und bearbeiten. Die Spalte *fuer* in „Eintragungen“ zeigt lesbar, wofür sich jemand eingetragen hat. Neue Zeilen ohne `id` bekommen automatisch eine. Blattnamen und Spaltenüberschriften nicht umbenennen. Eigene Zusatzspalten rechts daneben sind erlaubt. Direkte Änderungen im Sheet erscheinen auf der Website nach spätestens zwei Minuten, weil das Skript die Daten kurz zwischenspeichert.

## Gut zu wissen

- Wer den Link hat, kann sich eintragen und auch andere austragen, wie bei einer Liste am schwarzen Brett. Für eine Gemeindegruppe passt das meistens. Den Link deshalb nicht öffentlich posten.
- Die eingetragenen Namen sind für alle mit dem Link sichtbar. Der Vorname reicht.
- Das Passwort steht nur im Apps Script, **nie** in `config.js` oder sonst im Repo, denn das Repo ist öffentlich.
- **Neue Version von `Code.gs` einspielen:** Im Apps Script den gesamten Inhalt von `Code.gs` durch die neue Datei ersetzen und speichern. Dann **Bereitstellen → Bereitstellungen verwalten →** Stift → Version: **Neue Version** → Bereitstellen. Die URL bleibt gleich. Das Passwort wird gemerkt, die Zeile `const PASSWORT = 'bitte-aendern';` kann also so bleiben. Nur zum Ändern des Passworts trägst du dort ein neues ein.
- Kosten entstehen keine.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css`, `app.js` | die Website |
| `config.js` | Einstellungen: Web-App-URL, Überschrift |
| `apps-script/Code.gs` | Server-Teil für Google Apps Script (im Demo-Modus nutzt die Seite dieselbe Logik im Browser) |
