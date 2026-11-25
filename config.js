// Einstellungen des Jahresplans – diese Datei kannst du direkt auf GitHub bearbeiten.
window.HELFERLISTE = {
  // Web-App-URL aus Google Apps Script (endet auf /exec).
  // Leer lassen = Demo-Modus (Einträge werden nur im eigenen Browser gespeichert).
  api: 'https://script.google.com/macros/s/AKfycbyPDh6b85XQwHca94A7D2mgPPKqj60UHc1I0_l0183jahNXTmZrADtciBKCtceBhU0/exec',

  // Überschrift und Unterzeile der Seite
  titel: 'Jahresplan',
  untertitel: 'Alle Termine, Dienste und Aufgaben – trag dich ein, wo du mithelfen kannst.',

  // Schulferien in der Tabellenansicht: Kürzel des Bundeslands, z. B.
  // 'BY' Bayern, 'NI' Niedersachsen, 'BW' Baden-Württemberg, 'NW' Nordrhein-Westfalen.
  // Leer lassen ('') = keine Ferien anzeigen.
  ferien: 'BY',

  // „Für wen?“: Beim ersten Öffnen wählt jeder aus, für wen der Jahresplan sein soll,
  // und sieht dann nur, was ihn betrifft. Termine, Aufgaben und Abstimmungen bekommen
  // dazu im Formular das Feld „Für wen?“ (nichts angehakt = für alle).
  // Gruppen bitte von jung nach alt sortieren – dann geht im Formular „ab Gruppe …“.
  zielgruppen: {
    gruppen: ['Stachos', 'Barrakudas', 'Erdmännchen', 'Belugas', 'Wanderfalken', 'Pinguine'],
    teams: ['MAK', 'Team SoLa'],      // Arbeitsgruppen mit eigenen Terminen
    weitere: ['Eltern']               // Zielgruppen außerhalb der Jugend
  },

  // Putzdienst in der Tabellenansicht: Die Gruppen sind reihum je einen Monat dran,
  // die erste Gruppe im Monat „ab“ (JJJJ-MM). Leere Liste = kein Putzdienst anzeigen.
  // Unter „monate“ lassen sich einzelne Monate abweichend festlegen.
  putzdienst: {
    gruppen: ['Stachos', 'Barrakudas', 'Erdmännchen', 'Belugas', 'Wanderfalken', 'Pinguine'],            // z. B. ['Gruppe 1', 'Gruppe 2', 'Gruppe 3']
    ab: '2027-1',
    monate: {'2027-08': 'kein Putzdienst'}              // z. B. { '2027-08': 'kein Putzdienst' }
  },

  // Link zur Anleitung (wird nur im Demo-Modus angezeigt)
  anleitung: 'https://github.com/joelterheide/termine#einrichten'
};
