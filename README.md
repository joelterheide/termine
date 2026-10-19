# Helferliste

Eine schlichte Website, auf der man sich als Helfer für Termine und Aufgaben eintragen oder wieder absagen kann. Ähnlich wie TeamPlus, aber ohne App und ohne Anmeldung. Die Daten liegen in einem Google Sheet.

**Seite:** https://joelterheide.github.io/termine/

## Was sie kann

- **Termine** mit Datum, Ort und Info. Darunter Stationen (z. B. Glühweinstand, Kasse) mit eigenen Uhrzeiten, auch über mehrere Tage.
- **Aufgaben ohne festen Termin**, z. B. Kuchen backen oder Plakate aufhängen, optional mit „erledigen bis“.
- **Eintragen** mit Namen und optionaler Notiz („bringe Waffeleisen mit“), **absagen** über das × neben dem Namen.
- **Ein Klick:** Nach dem ersten Eintragen merkt sich der Browser den Namen. Danach trägt „Eintragen“ sofort ein, mit „Rückgängig“ für Fehlklicks. Den Namen kann man oben über „ändern“ wechseln.
- **Weitere Personen eintragen:** Mit „+ weitere Person“ unter dem Knopf trägt man z. B. Familienmitglieder ein. Das geht auch, wenn man selbst nicht eingetragen ist, und der eigene gespeicherte Name bleibt dabei unverändert.
- **Plätze begrenzen** (2/2 = voll) oder beliebig viele zulassen.
- **Meine Einträge:** Namen eingeben und alles auf einen Blick sehen, absagen, in den eigenen Kalender übernehmen.
- **Per WhatsApp teilen:** erzeugt einen fertigen Text mit den offenen Plätzen und dem Link.
- **Verwalten** mit Passwort: Termine, Schichten und Aufgaben anlegen, ändern, kopieren (z. B. für jeden Sonntag) und löschen.
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

Mit **Commit changes** speichern. Nach etwa einer Minute ist die Seite verbunden und der Demo-Hinweis verschwindet. In `config.js` lassen sich auch Überschrift und Unterzeile ändern.

### 4. Termine anlegen

Ganz unten auf der Seite auf **Verwalten** klicken und das Passwort eingeben. Dann **+ Neuer Termin**. Nach dem Speichern öffnet sich direkt „Schichten hinzufügen“.

Tipp: Bei „Zeiten“ kann man mehrere auf einmal angeben, z. B. `14-16, 16-18, 18-20`. Daraus werden drei Schichten mit der gleichen Station. Für einen zweiten Markttag einfach das Datum in der Schicht ändern.

## Im Alltag

- Den Link in der WhatsApp-Gruppe anpinnen oder in die Gruppenbeschreibung schreiben.
- **Offene Plätze per WhatsApp teilen** (oben bei den Terminen) erzeugt eine Übersicht zum Posten.
- Wiederkehrende Termine wie das Kirchcafé mit **Kopieren** auf das nächste Datum übertragen. Die Schichten werden mitkopiert, die Namen nicht.
- Im **Google Sheet** kann man alles direkt sehen und bearbeiten. Die Spalte *fuer* in „Eintragungen“ zeigt lesbar, wofür sich jemand eingetragen hat. Neue Zeilen ohne `id` bekommen automatisch eine. Blattnamen und Spaltenüberschriften nicht umbenennen. Eigene Zusatzspalten rechts daneben sind erlaubt.

## Gut zu wissen

- Wer den Link hat, kann sich eintragen und auch andere austragen, wie bei einer Liste am schwarzen Brett. Für eine Gemeindegruppe passt das meistens. Den Link deshalb nicht öffentlich posten.
- Die eingetragenen Namen sind für alle mit dem Link sichtbar. Der Vorname reicht.
- Das Passwort steht nur im Apps Script, **nie** in `config.js` oder sonst im Repo, denn das Repo ist öffentlich.
- Wenn `Code.gs` geändert wird (auch beim Passwortwechsel): **Bereitstellen → Bereitstellungen verwalten →** Stift → Version: **Neue Version** → Bereitstellen. Die URL bleibt gleich.
- Kosten entstehen keine.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css`, `app.js` | die Website |
| `config.js` | Einstellungen: Web-App-URL, Überschrift |
| `apps-script/Code.gs` | Server-Teil für Google Apps Script (im Demo-Modus nutzt die Seite dieselbe Logik im Browser) |
