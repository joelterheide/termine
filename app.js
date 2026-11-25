/* Jahresplan – Oberfläche
 * Lädt die Daten vom Google-Apps-Script (oder im Demo-Modus aus dem Browser)
 * und zeigt Termine, Aufgaben und die eigenen Einträge an. */
(function () {
  'use strict';

  var KONF = Object.assign(
    { api: '', titel: 'Jahresplan', untertitel: '', anleitung: '' },
    window.HELFERLISTE || {}
  );

  // ---------- Browser-Speicher (kann in privaten Fenstern fehlen) ----------

  function lies(art, k) {
    try { return window[art].getItem(k) || ''; } catch (e) { return ''; }
  }
  function merke(art, k, v) {
    try { if (v) window[art].setItem(k, v); else window[art].removeItem(k); } catch (e) { /* egal */ }
  }

  // ---------- Zielgruppen („Für wen?“) aus config.js ----------

  var ZG = (function () {
    var k = KONF.zielgruppen || {};
    function liste(x) {
      return (Array.isArray(x) ? x : []).map(function (n) { return String(n).trim(); }).filter(Boolean);
    }
    // ohne eigenen Eintrag in config.js: die Putzdienst-Gruppen und „Eltern“
    var gruppen = KONF.zielgruppen ? liste(k.gruppen) : liste((KONF.putzdienst || {}).gruppen);
    var teams = liste(k.teams);
    var weitere = KONF.zielgruppen ? liste(k.weitere) : (gruppen.length ? ['Eltern'] : []);
    return { gruppen: gruppen, teams: teams, weitere: weitere, alle: gruppen.concat(teams, weitere) };
  })();

  // 'Pinguine, MAK' → ['Pinguine', 'MAK']. „ab Pinguine“ steht für Pinguine und alle Gruppen,
  // die in config.js danach (älter) kommen – stimmt die Reihenfolge dort, stimmt es überall.
  function zgListe(w) {
    var aus = [];
    String(w == null ? '' : w).split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) {
      var ab = abGruppe(x);
      (ab < 0 ? [x] : ZG.gruppen.slice(ab)).forEach(function (n) {
        if (!aus.some(function (y) { return istGleich(y, n); })) aus.push(n);
      });
    });
    return aus;
  }
  // Index der Gruppe bei „ab …“, sonst -1 (auch wenn die Gruppe in config.js fehlt)
  function abGruppe(x) {
    var m = /^ab\s+(.+)$/i.exec(String(x).trim());
    if (!m) return -1;
    for (var i = 0; i < ZG.gruppen.length; i++) if (istGleich(ZG.gruppen[i], m[1].trim())) return i;
    return -1;
  }
  // Kurzform zum Anzeigen und Speichern: alle Gruppen → „alle Gruppen“, die letzten ab einer → „ab …“
  function zgKurz(liste, zumSpeichern) {
    var an = ZG.gruppen.map(function (n) { return liste.some(function (x) { return istGleich(x, n); }); });
    var rest = liste.filter(function (x) { return !ZG.gruppen.some(function (n) { return istGleich(n, x); }); });
    var erste = an.indexOf(true);
    if (erste < 0) return liste;
    var bisZumEnde = an.slice(erste).every(Boolean) && ZG.gruppen.length - erste >= 2;
    var gruppen;
    if (bisZumEnde && erste === 0) gruppen = zumSpeichern ? ZG.gruppen.slice() : ['alle Gruppen'];
    else if (bisZumEnde) gruppen = ['ab ' + ZG.gruppen[erste]];
    else gruppen = ZG.gruppen.filter(function (n, i) { return an[i]; });
    return gruppen.concat(rest);
  }
  function istGleich(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  // Profil: null = noch nicht gewählt, [] = alles anzeigen, sonst die gewählten Zielgruppen
  function leseProfil() {
    try {
      var p = JSON.parse(lies('localStorage', 'helferliste.profil') || 'null');
      return Array.isArray(p) ? p.map(String).filter(Boolean) : null;
    } catch (e) { return null; }
  }

  // ---------- Zustand ----------

  var z = {
    daten: null,          // Rohdaten vom Server
    sicht: null,          // aufbereitete Daten
    reiter: 'termine',
    offen: null,          // gerade geöffnetes Formular
    vergangene: false,
    ansicht: lies('localStorage', 'helferliste.ansicht') === 'tabelle' ? 'tabelle' : 'liste',
    passwort: lies('sessionStorage', 'helferliste.passwort'),
    name: lies('localStorage', 'helferliste.name'),
    ladefehler: '',
    version: 0,           // Version der Code.gs (0 = noch unbekannt, 1 = alt ohne Versionsangabe)
    springeZu: '',
    externAus: lies('localStorage', 'helferliste.externAus') === '1', // „Jugend extern“ ausblenden
    aufgeklappt: {},      // aufgeklappte Termine „Jugend extern“ (id → true)
    trotzdem: '',         // ausgeblendeter Termin/Aufgabe/Abstimmung, der per Link geöffnet wurde
    profil: leseProfil(), // für wen der Jahresplan angezeigt wird
    vorlage: null,        // geladene Vorlage zum Übernehmen von Terminen (Verwaltung)
    teamAufgaben: {}      // Verwaltung: beim Termin aufgeklappte Team-Aufgaben (id → true)
  };

  function setzeProfil(liste) {
    // Namen wie in config.js schreiben (Groß-/Kleinschreibung), unbekannte beibehalten
    z.profil = liste.map(function (n) {
      return ZG.alle.filter(function (b) { return istGleich(b, n); })[0] || n;
    });
    z.trotzdem = '';
    merke('localStorage', 'helferliste.profil', JSON.stringify(z.profil));
  }

  // Link mit ?fuer=Eltern (oder ?fuer=Pinguine,Team%20SoLa) stellt die Auswahl gleich ein
  (function () {
    try {
      var u = new URL(location.href);
      var f = u.searchParams.get('fuer');
      if (f === null) return;
      var liste = zgListe(f);
      if (liste.length === 1 && /^alle?$/i.test(liste[0])) liste = [];
      setzeProfil(liste);
      u.searchParams.delete('fuer');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* egal */ }
  })();

  var backend = KONF.api ? apiBackend(String(KONF.api).trim()) : demoBackend();

  // =====================================================================
  // Backend
  // =====================================================================

  function apiBackend(url) {
    function holen(optionen) {
      var ziel = optionen ? url : url + (url.indexOf('?') < 0 ? '?' : '&') + 'aktion=daten&_=' + Date.now();
      return fetch(ziel, optionen)
        .catch(function () { throw new Error('Keine Verbindung zum Server.'); })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          try { return JSON.parse(text); } catch (e) {
            throw new Error('Unerwartete Antwort vom Server. Ist die Web-App mit „Zugriff: Jeder“ bereitgestellt?');
          }
        });
    }
    return {
      demo: false,
      lesen: function () { return holen(); },
      // Als einfacher Text gesendet, damit der Browser keine CORS-Vorabfrage macht.
      senden: function (anfrage) { return holen({ method: 'POST', body: JSON.stringify(anfrage) }); }
    };
  }

  // Im Demo-Modus läuft dieselbe Logik wie im Apps Script, nur mit Speicherung im Browser.
  function demoBackend() {
    var SCHLUESSEL = 'helferliste.demo';
    var logik = null;
    var db = null;

    function ladeLogik() {
      if (!logik) {
        logik = fetch('apps-script/Code.gs')
          .then(function (r) { if (!r.ok) throw new Error('Code.gs nicht gefunden'); return r.text(); })
          .then(function (quelltext) {
            /* eslint-disable-next-line no-new-func */
            return new Function(quelltext + '\n;return { verarbeite: verarbeite, oeffentlich: oeffentlich };')();
          });
      }
      return logik;
    }

    function ausfuehren(anfrage) {
      return ladeLogik().then(function (L) {
        if (!db) {
          try { db = JSON.parse(lies('localStorage', SCHLUESSEL) || 'null'); } catch (e) { db = null; }
          if (!db) db = beispieldaten();
        }
        try {
          var erg = L.verarbeite(db, anfrage, { passwort: 'demo' });
          merke('localStorage', SCHLUESSEL, JSON.stringify(L.oeffentlich(db)));
          return { ok: true, meldung: erg.meldung, id: erg.id, daten: L.oeffentlich(db) };
        } catch (e) {
          return { ok: false, fehler: e.nutzerfehler ? e.message : 'Fehler: ' + e.message, daten: L.oeffentlich(db) };
        }
      });
    }

    return {
      demo: true,
      lesen: function () { return ausfuehren({ aktion: 'daten' }); },
      senden: ausfuehren,
      zuruecksetzen: function () { db = null; merke('localStorage', SCHLUESSEL, ''); }
    };
  }

  // =====================================================================
  // Datum und Zeit
  // =====================================================================

  var WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var MONAT = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
    'September', 'Oktober', 'November', 'Dezember'];

  function zz(n) { return (n < 10 ? '0' : '') + n; }
  function isoVon(d) { return d.getFullYear() + '-' + zz(d.getMonth() + 1) + '-' + zz(d.getDate()); }
  function heute() { return isoVon(new Date()); }
  function alsDatum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function plusTage(iso, n) {
    var d = alsDatum(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + n);
    return isoVon(d);
  }
  function tageBis(iso) {
    var d = alsDatum(iso);
    if (!d) return null;
    return Math.round((d - alsDatum(heute())) / 86400000);
  }

  // „Samstag, 28. November“ (Jahr nur, wenn nicht das aktuelle)
  function datumLang(iso) {
    var d = alsDatum(iso);
    if (!d) return iso || '';
    var t = WOCHENTAG[d.getDay()] + ', ' + d.getDate() + '. ' + MONAT[d.getMonth()];
    if (d.getFullYear() !== new Date().getFullYear()) t += ' ' + d.getFullYear();
    return t;
  }
  // „Sa 28.11.“
  function datumKurz(iso) {
    var d = alsDatum(iso);
    if (!d) return iso || '';
    return WT[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.';
  }
  function zeitraum(von, bis) {
    if (!von) return 'ohne Datum';
    if (!bis || bis === von) return datumLang(von);
    var a = alsDatum(von), b = alsDatum(bis);
    var anfang = WOCHENTAG[a.getDay()] + ', ' + a.getDate() + '.';
    if (a.getMonth() !== b.getMonth() || a.getFullYear() !== b.getFullYear()) anfang += ' ' + MONAT[a.getMonth()];
    return anfang + ' bis ' + datumLang(bis);
  }
  function relativ(iso) {
    var n = tageBis(iso);
    if (n === null) return '';
    if (n === 0) return 'heute';
    if (n === 1) return 'morgen';
    if (n === 2) return 'übermorgen';
    if (n > 0) return 'in ' + n + ' Tagen';
    return '';
  }
  function zeitText(s) {
    if (s.von && s.bis) return s.von + '–' + s.bis;
    if (s.von) return 'ab ' + s.von;
    return '';
  }

  // =====================================================================
  // Hilfen
  // =====================================================================

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function mitLinks(t) {
    return esc(t).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
  }
  function zahl(w) {
    var n = parseInt(w, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }
  function gleicherName(a, b) {
    var n = function (x) { return String(x || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
    return !!n(a) && n(a) === n(b);
  }
  function ich(name) { return gleicherName(name, z.name); }
  function admin() { return !!z.passwort; }
  function einzigartig(liste) {
    return liste.filter(function (x, i) { return liste.indexOf(x) === i; });
  }
  function freiePlaetze(eintrag) {
    var max = zahl(eintrag.anzahl);
    return max ? Math.max(0, max - eintrag.leute.length) : Infinity;
  }

  // =====================================================================
  // Daten aufbereiten
  // =====================================================================

  function aufbereiten(d) {
    var leute = {};
    d.Eintragungen.forEach(function (e) { (leute[e.bezug] = leute[e.bezug] || []).push(e); });
    Object.keys(leute).forEach(function (k) {
      leute[k].sort(function (a, b) { return String(a.zeitpunkt).localeCompare(String(b.zeitpunkt)); });
    });

    var termine = d.Termine.map(function (t) {
      var eigene = d.Schichten.filter(function (s) { return s.termin_id === t.id; });
      var schichten = eigene.map(function (s) {
        return Object.assign({}, s, { tag: s.datum || t.datum, leute: leute[s.id] || [] });
      });
      schichten.sort(function (a, b) {
        return String(a.tag).localeCompare(String(b.tag)) || String(a.von).localeCompare(String(b.von));
      });
      var tage = [t.datum, t.bis_datum].concat(schichten.map(function (s) { return s.tag; }))
        .filter(function (x) { return alsDatum(x); }).sort();
      var plaetze = t.plaetze == null ? '' : String(t.plaetze);
      var direkt = leute[t.id] || [];
      return Object.assign({}, t, {
        // von/bis heißen in der Tabelle „Uhrzeit“; hier stehen von/bis für den Zeitraum in Tagen
        uhrVon: t.von || '', uhrBis: t.bis || '',
        plaetze: plaetze,
        kategorie: t.kategorie || '',
        extern: istExtern(t),
        zg: zgListe(t.zielgruppen),
        aufgaben: [],         // zugeordnete Aufgaben (unten ergänzt)
        leute: direkt,
        direkt: plaetze !== '' || direkt.length > 0,
        schichten: schichten,
        stationen: einzigartig(eigene.map(function (s) { return s.station; })), // Reihenfolge wie angelegt
        von: tage[0] || '',
        bis: tage[tage.length - 1] || ''
      });
    });
    termine.sort(function (a, b) {
      return (a.von || '9999').localeCompare(b.von || '9999') || String(a.titel).localeCompare(String(b.titel));
    });

    // Aufgaben mit ihren Unteraufgaben (eltern_id). Unteraufgaben ohne vorhandene Hauptaufgabe zählen als eigene Aufgabe.
    var alle = d.Aufgaben.map(function (g) { return Object.assign({}, g, { leute: leute[g.id] || [] }); });
    var nachId = {};
    alle.forEach(function (g) { nachId[g.id] = g; });
    var aufgaben = alle.filter(function (g) { return !g.eltern_id || !nachId[g.eltern_id] || g.eltern_id === g.id; });
    aufgaben.forEach(function (g) {
      g.unter = alle.filter(function (u) { return u.eltern_id === g.id && u !== g; });
      g.erledigtZahl = g.unter.filter(function (u) { return u.erledigt; }).length;
      // Die ganze Aufgabe ist erst erledigt, wenn sie selbst abgehakt ist –
      // abgehakte Unteraufgaben zählen nur als Fortschritt.
      g.fertig = !!g.erledigt;
      // Zugeordneter Termin; ohne eigenes „Für wen?“ gilt das des Termins
      g.termin = g.termin_id ? finde(termine, g.termin_id) : null;
      g.zgEigen = zgListe(g.zielgruppen);
      g.zg = g.zgEigen.length ? g.zgEigen : (g.termin ? g.termin.zg : []);
      g.bisWann = g.frist || (g.termin ? g.termin.von : '');
    });
    aufgaben.sort(function (a, b) {
      if (a.bisWann && b.bisWann) return a.bisWann.localeCompare(b.bisWann);
      return a.bisWann ? -1 : b.bisWann ? 1 : 0;
    });
    aufgaben.forEach(function (g) { if (g.termin) g.termin.aufgaben.push(g); });

    var stimmen = {};
    d.Stimmen.forEach(function (v) { (stimmen[v.option_id] = stimmen[v.option_id] || []).push(v); });
    var abstimmungen = d.Abstimmungen.map(function (p) {
      var optionen = d.Optionen.filter(function (o) { return o.abstimmung_id === p.id; }).map(function (o) {
        var s = (stimmen[o.id] || []).slice().sort(function (a, b) { return String(a.zeitpunkt).localeCompare(String(b.zeitpunkt)); });
        return Object.assign({}, o, { stimmen: s });
      });
      optionen.sort(function (a, b) { return (a.datum + ' ' + a.von) < (b.datum + ' ' + b.von) ? -1 : 1; });
      var meiste = optionen.reduce(function (m, o) { return Math.max(m, o.stimmen.length); }, 0);
      return Object.assign({}, p, { optionen: optionen, meiste: meiste, zg: zgListe(p.zielgruppen) });
    });
    abstimmungen.sort(function (a, b) { return String(a.frist).localeCompare(String(b.frist)); });

    return { termine: termine, aufgaben: aufgaben, abstimmungen: abstimmungen };
  }

  function istVorbei(termin) { return termin.bis && termin.bis < heute(); }
  // Aufgabe mit Frist: nach der Frist; ohne Frist, aber zu einem Termin: nach dem Termin
  function istAbgelaufen(aufgabe) {
    if (aufgabe.frist) return aufgabe.frist < heute();
    return !!(aufgabe.termin && istVorbei(aufgabe.termin));
  }

  function kommendeTermine() { return z.sicht.termine.filter(function (t) { return !istVorbei(t); }); }

  // „Jugend extern“: wird eingeklappt und ohne Farbe gezeigt und lässt sich ganz ausblenden
  var EXTERN = 'Jugend extern';
  function istExtern(t) { return /jugend\s*extern/i.test(String(t.kategorie || '')); }
  // Passt ein Eintrag zur Auswahl „Für wen?“? Leer = für alle; die Verwaltung sieht alles.
  function profilAktiv() { return !admin() && !!z.profil && z.profil.length > 0; }
  function passt(liste) {
    if (!liste || !liste.length || !profilAktiv()) return true;
    return liste.some(function (x) { return z.profil.some(function (p) { return istGleich(p, x); }); });
  }
  // Wer im Team einer Team-Aufgabe ist, sieht auch den Termin dazu (z. B. Team SoLa das Sommerlager)
  function sichtbar(t) {
    if (z.trotzdem === t.id) return true;
    if (t.extern && z.externAus) return false;
    return fuerMich(t);
  }
  function fuerMich(t) {
    return passt(t.zg) || t.aufgaben.some(function (g) { return nurTeams(g.zg) && imTeam(g.zg); });
  }
  // Aufgaben nur für Teams (z. B. „Team SoLa“, „MAK“) sieht nur, wer das Team bei „Für wen?“ angehakt
  // hat oder schon eingetragen ist – auch bei „Alles anzeigen“. Die Verwaltung sieht sie unter „Aufgaben“.
  function nurTeams(liste) {
    return !!liste && liste.length > 0 && ZG.teams.length > 0 &&
      liste.every(function (x) { return ZG.teams.some(function (n) { return istGleich(n, x); }); });
  }
  function imTeam(liste) {
    return !!z.profil && liste.some(function (x) { return z.profil.some(function (p) { return istGleich(p, x); }); });
  }
  function binDabei(g) {
    return !!z.name && g.unter.reduce(function (l, u) { return l.concat(u.leute); }, g.leute).some(function (e) { return ich(e.name); });
  }
  function teamAufgabeFuerMich(g) { return imTeam(g.zg) || binDabei(g); }
  function aufgabeSichtbar(g) {
    if (z.trotzdem === g.id) return true;
    if (nurTeams(g.zg)) return admin() || teamAufgabeFuerMich(g);
    return passt(g.zg);
  }
  function sichtbareTermine() { return kommendeTermine().filter(sichtbar); }
  function offeneAufgaben() { return z.sicht.aufgaben.filter(function (g) { return aufgabeSichtbar(g) && !istAbgelaufen(g) && !g.fertig; }); }
  function erledigteAufgaben() { return z.sicht.aufgaben.filter(function (g) { return aufgabeSichtbar(g) && !istAbgelaufen(g) && g.fertig; }); }
  function erledigtText(x) {
    return 'am ' + datumKurz(x.erledigt) + (x.erledigt_von ? ' von ' + x.erledigt_von : '');
  }

  function meineEintraege() {
    var h = heute();
    var liste = [];
    z.sicht.termine.forEach(function (t) {
      if (!istVorbei(t)) {
        t.leute.forEach(function (e) {
          if (ich(e.name)) liste.push({ e: e, termin: t, schicht: null, sortierung: (t.von || '9999') + ' ' + (t.uhrVon || '') });
        });
      }
      t.schichten.forEach(function (s) {
        if (s.tag && s.tag < h) return;
        s.leute.forEach(function (e) {
          if (ich(e.name)) liste.push({ e: e, termin: t, schicht: s, sortierung: (s.tag || '9999') + ' ' + (s.von || '') });
        });
      });
    });
    z.sicht.aufgaben.forEach(function (g) {
      if (istAbgelaufen(g) || g.fertig) return;
      [g].concat(g.unter).forEach(function (x) {
        if (x.erledigt) return;
        x.leute.forEach(function (e) {
          if (ich(e.name)) liste.push({ e: e, aufgabe: g, unter: x === g ? null : x, sortierung: '~' + (g.frist || '9999') });
        });
      });
    });
    // Termine zuerst (nach Datum), dann Aufgaben – bewusst ohne localeCompare, das „~“ vor Ziffern sortiert
    return liste.sort(function (a, b) { return a.sortierung < b.sortierung ? -1 : a.sortierung > b.sortierung ? 1 : 0; });
  }

  // =====================================================================
  // Anzeige
  // =====================================================================

  function istOffen(art, id, termin) {
    var o = z.offen;
    if (!o || o.art !== art) return false;
    if (id !== undefined && (o.id || '') !== id) return false;
    if (termin !== undefined && (o.termin || '') !== termin) return false;
    return true;
  }

  // Formular, in dem gerade getippt wird (oder null)
  function aktivesFormular() {
    var el = document.activeElement;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.type === 'checkbox') return null;
    return el.form && el.form.getAttribute('data-form') ? el.form : null;
  }

  // Inhalt neu setzen. Das Formular, in dem gerade getippt wird, bleibt dabei als
  // dasselbe Element an seinem Platz – nur alles drumherum wird ausgetauscht. So geht
  // am Handy die Tastatur nicht zu und nichts Getipptes verloren, auch wenn währenddessen
  // eine Antwort vom Server ankommt.
  function setzeInhalt(behaelter, html) {
    var alt = aktivesFormular();
    if (!alt || !behaelter.contains(alt) || !ersetzeUmFormular(behaelter, html, alt)) behaelter.innerHTML = html;
  }

  function ersetzeUmFormular(behaelter, html, altForm) {
    var neu = document.createElement('div');
    neu.innerHTML = html;
    var schluessel = formSchluessel(altForm);
    var neuForm = null;
    neu.querySelectorAll('form[data-form]').forEach(function (f) { if (formSchluessel(f) === schluessel) neuForm = f; });
    if (!neuForm) return false; // Formular ist zu → normal neu zeichnen
    var pfadAlt = [], pfadNeu = [], x;
    for (x = altForm; x && x !== behaelter; x = x.parentNode) pfadAlt.unshift(x);
    for (x = neuForm; x && x !== neu; x = x.parentNode) pfadNeu.unshift(x);
    if (pfadAlt.length !== pfadNeu.length) return false;
    for (var i = 0; i < pfadAlt.length; i++) if (pfadAlt[i].tagName !== pfadNeu[i].tagName) return false;

    var elternAlt = behaelter, elternNeu = neu;
    pfadAlt.forEach(function (bleibt, i) {
      var ersatz = pfadNeu[i];
      // Geschwister vor und nach dem Pfad-Element durch die neuen ersetzen
      while (elternAlt.firstChild !== bleibt) elternAlt.removeChild(elternAlt.firstChild);
      while (bleibt.nextSibling) elternAlt.removeChild(bleibt.nextSibling);
      while (elternNeu.firstChild !== ersatz) elternAlt.insertBefore(elternNeu.firstChild, bleibt);
      while (ersatz.nextSibling) elternAlt.appendChild(ersatz.nextSibling);
      if (i < pfadAlt.length - 1) {
        // Attribute der umgebenden Elemente (z. B. Klassen) übernehmen
        Array.prototype.slice.call(bleibt.attributes).forEach(function (a) { if (!ersatz.hasAttribute(a.name)) bleibt.removeAttribute(a.name); });
        Array.prototype.slice.call(ersatz.attributes).forEach(function (a) { bleibt.setAttribute(a.name, a.value); });
      }
      elternAlt = bleibt;
      elternNeu = ersatz;
    });
    return true;
  }

  function render() {
    var gemerkt = merkeFormulare();
    var fokus = merkeFokus();

    document.title = KONF.titel;
    document.getElementById('titel').textContent = KONF.titel;
    var unter = document.getElementById('untertitel');
    unter.textContent = KONF.untertitel;
    unter.hidden = !KONF.untertitel;

    document.getElementById('hinweis').innerHTML = hinweisHtml();
    setzeInhalt(profilElement(), profilHtml());
    document.getElementById('reiter').innerHTML = reiterHtml();
    setzeInhalt(document.getElementById('fuss'), fussHtml());

    var inhalt = document.getElementById('inhalt');
    if (!z.sicht) {
      setzeInhalt(inhalt, z.ladefehler ? '' : '<p class="leer">Lade …</p>');
    } else if (z.reiter === 'aufgaben') {
      setzeInhalt(inhalt, aufgabenHtml());
    } else if (z.reiter === 'meine') {
      setzeInhalt(inhalt, meineHtml());
    } else {
      setzeInhalt(inhalt, termineHtml());
    }

    stelleFormulareWiederHer(gemerkt);
    stelleFokusWiederHer(fokus);

    if (z.springeZu && z.sicht) {
      var ziel = document.getElementById(z.springeZu);
      z.springeZu = '';
      if (ziel) {
        ziel.scrollIntoView({ block: 'start' });
        ziel.classList.add('markiert');
        setTimeout(function () { ziel.classList.remove('markiert'); }, 1800);
      }
    }
  }

  function profilElement() {
    var el = document.getElementById('profil');
    if (!el) { // ältere index.html im Browser-Speicher
      el = document.createElement('div');
      el.id = 'profil';
      var r = document.getElementById('reiter');
      r.parentNode.insertBefore(el, r);
    }
    return el;
  }

  // Auswahl „Für wen soll der Jahresplan sein?“ – beim ersten Öffnen und über „ändern“
  function profilHtml() {
    if (!ZG.alle.length || !z.sicht) return '';
    var erstes = z.profil === null;
    if (!erstes && !istOffen('profil')) {
      var text = z.profil.length ? z.profil.join(', ') : 'alle';
      return '<p class="profil-zeile">Jahresplan für: <strong>' + esc(text) + '</strong> · ' +
        '<button class="link" data-aktion="profil-aendern">ändern</button>' +
        (admin() && z.profil.length ? ' <span class="leise">(als Verwaltung siehst du trotzdem alles)</span>' : '') + '</p>';
    }
    var gewaehlt = z.profil || [];
    function boxen(titel, namen) {
      if (!namen.length) return '';
      return '<div class="fuer-teil"><span class="fuer-titel">' + titel + '</span>' + namen.map(function (n) {
        var an = gewaehlt.some(function (p) { return istGleich(p, n); });
        return '<label class="wahl-box"><input type="checkbox" name="fuer" value="' + esc(n) + '"' + (an ? ' checked' : '') + '> ' + esc(n) + '</label>';
      }).join('') + '</div>';
    }
    return '<form class="kasten profil" data-form="profil">' +
      '<h3>' + (erstes ? 'Für wen soll der Jahresplan sein?' : 'Jahresplan anpassen') + '</h3>' +
      '<p class="tipp">Du siehst dann nur die Termine und Aufgaben, die dich betreffen. Mehrere Häkchen sind möglich. ' +
      (ZG.teams.length ? 'Aufgaben eines Teams (z. B. ' + esc(ZG.teams[ZG.teams.length > 1 ? 1 : 0]) + ') siehst du nur, wenn du das Team anhakst. ' : '') +
      'Die Auswahl gilt nur in diesem Browser und lässt sich oben jederzeit ändern.</p>' +
      boxen('Gruppe', ZG.gruppen) + boxen('Team', ZG.teams) + boxen('Sonstige', ZG.weitere) +
      '<div class="knoepfe"><button type="submit" class="haupt">Übernehmen</button>' +
      '<button type="button" data-aktion="profil-alles">Alles anzeigen</button>' +
      (erstes ? '' : '<button type="button" data-aktion="schliessen">Abbrechen</button>') + '</div>' +
      (erstes ? '' : '<p class="tipp profil-link">Link, der den Jahresplan gleich mit dieser Auswahl öffnet (z. B. für Eltern): ' +
        '<button type="button" class="link" data-aktion="profil-link">Link kopieren</button></p>') +
      '</form>';
  }

  // Kleines Etikett „für Pinguine, MAK“ bei eingeschränkten Einträgen
  // „für Eltern“, aber „ab Pinguine“ statt „für ab Pinguine“
  function fuerSatz(text) { return /^ab\s/i.test(text) ? text : 'für ' + text; }
  function zgEtikett(liste) {
    if (!liste || !liste.length) return '';
    return ' <span class="etikett fuer">' + esc(fuerSatz(zgKurz(liste).join(', '))) + '</span>';
  }

  // Feld „Für wen?“ in den Verwaltungsformularen
  function fuerFeld(liste, hinweis) {
    if (!ZG.alle.length) return '';
    liste = liste || [];
    var extra = liste.filter(function (x) { return !ZG.alle.some(function (b) { return istGleich(b, x); }); });
    function box(n) {
      var an = liste.some(function (x) { return istGleich(x, n); });
      return '<label class="wahl-box"><input type="checkbox" name="fuer" value="' + esc(n) + '"' + (an ? ' checked' : '') + '> ' + esc(n) + '</label>';
    }
    function teil(titel, namen) {
      return namen.length ? '<div class="fuer-teil"><span class="fuer-titel">' + titel + '</span>' + namen.map(box).join('') + '</div>' : '';
    }
    return '<fieldset class="fuer"><legend>Für wen?</legend>' +
      '<span class="tipp">' + (hinweis || 'Nichts angehakt = für alle (auch Eltern).') + '</span>' +
      teil('Gruppen', ZG.gruppen) + teil('Teams', ZG.teams) + teil('Sonstige', ZG.weitere.concat(extra)) +
      (ZG.gruppen.length > 1 ? '<div class="fuer-schnell">Schnell: <button type="button" class="link" data-aktion="fuer-jugend">alle Gruppen</button>' +
        '<span class="trenn"> · </span><span class="ab-wahl">ab <select name="fuer_ab" aria-label="ab Gruppe"><option value="">Gruppe …</option>' +
        ZG.gruppen.map(function (n, i) { return '<option value="' + i + '">' + esc(n) + '</option>'; }).join('') + '</select></span>' +
        '<span class="trenn"> · </span><button type="button" class="link" data-aktion="fuer-keine">für alle</button></div>' : '') +
      '</fieldset>';
  }

  function fuerAuswahl(f) {
    return Array.prototype.filter.call(f.querySelectorAll('input[name=fuer]'), function (el) { return el.checked; })
      .map(function (el) { return el.value; });
  }

  // Hinweis im Formular, solange bei Google noch eine ältere Code.gs läuft
  function veraltetHinweis(minVersion, was) {
    if (backend.demo || !z.version || z.version >= minVersion) return '';
    return '<p class="warnung">' + was + ' erst gespeichert, wenn die neue Code.gs in Apps Script eingefügt und neu bereitgestellt ist.</p>';
  }

  function hinweisHtml() {
    if (z.ladefehler) {
      return '<div class="hinweis fehler">' +
        (z.sicht ? 'Gerade keine Verbindung zum Server – du siehst den zuletzt geladenen Stand. '
          : 'Die Daten konnten nicht geladen werden: ' + esc(z.ladefehler) + ' ') +
        '<button class="link" data-aktion="neu-laden">Erneut versuchen</button></div>';
    }
    if (backend.demo) {
      return '<div class="hinweis"><strong>Demo-Modus.</strong> Die Seite ist noch nicht mit einem Google Sheet verbunden. ' +
        'Einträge werden nur in diesem Browser gespeichert.' +
        (KONF.anleitung ? ' <a href="' + esc(KONF.anleitung) + '">Zur Anleitung</a>' : '') + '</div>';
    }
    return '';
  }

  function reiterHtml() {
    var anzahl = { termine: '', aufgaben: '', meine: '' };
    if (z.sicht) {
      anzahl.termine = sichtbareTermine().length;
      anzahl.aufgaben = offeneAufgaben().length;
      anzahl.meine = z.name ? meineEintraege().length : '';
    }
    return [['termine', 'Termine'], ['aufgaben', 'Aufgaben'], ['meine', 'Meine Einträge']].map(function (r) {
      return '<a href="#' + r[0] + '"' + (z.reiter === r[0] ? ' class="aktiv" aria-current="page"' : '') + '>' + r[1] +
        (anzahl[r[0]] !== '' ? '<span class="anzahl">' + anzahl[r[0]] + '</span>' : '') + '</a>';
    }).join('');
  }

  function fussHtml() {
    var teile = [];
    if (admin()) {
      teile.push('Verwaltung aktiv · ' +
        (vorlagenListe().length ? '<button class="link" data-aktion="import">Termine aus Vorlage übernehmen</button> · ' : '') +
        '<button class="link" data-aktion="abmelden">Abmelden</button>');
    } else if (istOffen('login')) {
      teile.push('<form data-form="login" class="zeile-form">' +
        '<input type="password" name="passwort" placeholder="Passwort" aria-label="Passwort" autocomplete="current-password" required>' +
        '<button type="submit">Anmelden</button>' +
        '<button type="button" data-aktion="schliessen">Abbrechen</button>' +
        (backend.demo ? '<span>Demo-Passwort: demo</span>' : '') + '</form>');
    } else {
      teile.push('<button class="link" data-aktion="login">Verwalten</button>');
    }
    if (backend.demo) teile.push('<button class="link" data-aktion="demo-reset">Demo zurücksetzen</button>');
    return istOffen('login') ? teile.join('<br>') : teile.join(' · ');
  }

  // ---------- Termine ----------

  function termineHtml() {
    // Link auf einen Termin oder eine Abstimmung: auch zeigen, wenn ausgeblendet; „Jugend extern“ aufklappen
    if (z.springeZu) {
      var zid = z.springeZu.replace(/^[tp]-/, '');
      var ziel = finde(z.sicht.termine, zid);
      if (ziel) {
        if (ziel.extern) z.aufgeklappt[ziel.id] = true;
        if (!sichtbar(ziel)) z.trotzdem = ziel.id;
      }
      var zielP = finde(z.sicht.abstimmungen, zid);
      if (zielP && !passt(zielP.zg)) z.trotzdem = zielP.id;
    }
    var vorlageHtml = istOffen('import') && admin() ? importHtml() : '';
    if (z.ansicht === 'tabelle') return ansichtHtml() + vorlageHtml + (istOffen('kalender') ? kalenderFormular() : '') + tabelleHtml();
    var kommend = sichtbareTermine();
    var vergangen = z.sicht.termine.filter(istVorbei).filter(sichtbar);
    if (z.springeZu && vergangen.some(function (t) { return 't-' + t.id === z.springeZu; })) z.vergangene = true;

    var offen = kommend.some(function (t) {
      return direktFrei(t) > 0 || t.schichten.some(function (s) { return s.tag >= heute() && freiePlaetze(s) > 0; });
    });
    var h = ansichtHtml() + alsHtml() + '<div class="leiste"><span>' +
      (offen ? '<button class="link" data-aktion="teilen-alle">Offene Plätze per WhatsApp teilen</button><span class="trenn"> · </span>' : '') +
      '<button class="link" data-aktion="kalender">Termine in den Kalender</button></span>' +
      (admin() ? '<span class="knoepfe"><button data-aktion="termin-neu">+ Neuer Termin</button>' +
        '<button data-aktion="abstimmung-neu">+ Abstimmung</button></span>' : '') +
      '</div>';

    h += vorlageHtml;
    if (istOffen('kalender')) h += kalenderFormular();
    if (istOffen('termin', '')) h += terminFormular(null);
    if (istOffen('abstimmung', '')) h += abstimmungFormular(null);

    var abst = abstimmungenHtml();
    if (abst) h += '<h2 class="abschnitt">Abstimmungen</h2>' + abst + '<h2 class="abschnitt">Termine</h2>';

    if (!kommend.length) h += '<p class="leer">Keine kommenden Termine.</p>';
    kommend.forEach(function (t) { h += terminHtml(t); });

    // Archiv: vergangene Termine, neueste zuerst, nach Monaten gegliedert
    if (vergangen.length) {
      h += '<p class="vergangen-schalter"><button class="link" data-aktion="vergangene">' +
        (z.vergangene ? 'Vergangene Termine ausblenden' : 'Vergangene Termine anzeigen (' + vergangen.length + ')') +
        '</button></p>';
      if (z.vergangene) {
        h += '<h2 class="abschnitt">Vergangene Termine</h2>';
        var monat = '';
        vergangen.slice().reverse().forEach(function (t) {
          var d = alsDatum(t.von);
          var m = d ? MONAT[d.getMonth()] + ' ' + d.getFullYear() : 'ohne Datum';
          if (m !== monat) { h += '<h3 class="monat">' + esc(m) + '</h3>'; monat = m; }
          h += terminHtml(t);
        });
      }
    }
    return h;
  }

  // ---------- Tabellenansicht: kompakte Übersicht mit Ferien und Putzdienst ----------

  function ansichtHtml() {
    var a = z.ansicht;
    function knopf(id, text) {
      return '<button class="link' + (a === id ? ' aktiv' : '') + '" data-aktion="ansicht" data-id="' + id + '"' +
        (a === id ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + text + '</button>';
    }
    // Schalter nur, wenn es kommende Termine „Jugend extern“ gibt
    var extern = kommendeTermine().filter(function (t) { return t.extern; }).length;
    var schalter = extern
      ? '<label class="filter"><input type="checkbox" data-aktion="extern-filter"' + (z.externAus ? ' checked' : '') + '> ' +
        EXTERN + ' ausblenden' + (z.externAus ? ' <span class="leise">(' + extern + ')</span>' : '') + '</label>'
      : '';
    return '<div class="ansicht"><span>Ansicht: ' + knopf('liste', 'Liste') + '<span class="trenn"> · </span>' + knopf('tabelle', 'Tabelle') +
      (a === 'tabelle' ? '<span class="trenn"> · </span><button class="link" data-aktion="drucken">Drucken</button>' +
        '<span class="trenn"> · </span><button class="link" data-aktion="kalender">In den Kalender</button>' : '') + '</span>' +
      schalter + '</div>';
  }

  var BUNDESLAND = {
    BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg',
    HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen',
    RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen'
  };
  var ferien = { liste: [], laedt: false, geladen: false, fehler: false };

  function monatPlus(jm, n) {
    var j = +jm.slice(0, 4);
    var m = +jm.slice(5, 7) - 1 + n;
    j += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return j + '-' + zz(m + 1);
  }

  // Schulferien von openholidaysapi.org (offen, ohne Schlüssel), eine Woche im Browser gemerkt
  function ladeFerien() {
    var land = String(KONF.ferien || '').toUpperCase();
    if (!BUNDESLAND[land]) { ferien.geladen = true; return; }
    var von = heute().slice(0, 7) + '-01';
    var bis = monatPlus(heute().slice(0, 7), 15) + '-01';
    var schluessel = 'helferliste.ferien.' + land;
    try {
      var c = JSON.parse(lies('localStorage', schluessel) || 'null');
      if (c && c.von <= von && c.bis >= bis && Date.now() - c.zeit < 7 * 86400000) {
        ferien.liste = c.liste; ferien.geladen = true; return;
      }
    } catch (e) { /* neu laden */ }
    ferien.laedt = true;
    fetch('https://openholidaysapi.org/SchoolHolidays?countryIsoCode=DE&subdivisionCode=DE-' + land +
      '&languageIsoCode=DE&validFrom=' + von + '&validTo=' + bis)
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (daten) {
        ferien.liste = (Array.isArray(daten) ? daten : []).map(function (f) {
          var namen = f.name || [];
          var de = namen.filter(function (n) { return n.language === 'DE'; })[0] || namen[0] || {};
          return { von: f.startDate, bis: f.endDate, name: de.text || 'Ferien' };
        }).filter(function (f) { return alsDatum(f.von) && alsDatum(f.bis); });
        ferien.laedt = false; ferien.geladen = true; ferien.fehler = false;
        merke('localStorage', schluessel, JSON.stringify({ von: von, bis: bis, zeit: Date.now(), liste: ferien.liste }));
        if (z.ansicht === 'tabelle') render();
      })
      .catch(function () {
        ferien.laedt = false; ferien.geladen = true; ferien.fehler = true;
        if (z.ansicht === 'tabelle') render();
      });
  }

  // Putzdienst: Gruppen reihum je Monat ab „ab“, einzelne Monate unter „monate“ festlegbar
  // 'JJJJ-M', 'JJJJ-MM', 'M.JJJJ' oder 'MM/JJJJ' → 'JJJJ-MM'
  function monatNorm(w) {
    var s = String(w == null ? '' : w).trim();
    var r = /^(\d{4})-(\d{1,2})$/.exec(s) || null;
    if (r) return +r[2] >= 1 && +r[2] <= 12 ? r[1] + '-' + zz(+r[2]) : '';
    r = /^(\d{1,2})[./](\d{4})$/.exec(s);
    if (r) return +r[1] >= 1 && +r[1] <= 12 ? r[2] + '-' + zz(+r[1]) : '';
    return '';
  }

  function putzdienst(jm) {
    var p = KONF.putzdienst || {};
    var monate = p.monate || {};
    for (var k in monate) {
      if (Object.prototype.hasOwnProperty.call(monate, k) && monatNorm(k) === jm && monate[k]) return String(monate[k]);
    }
    var g = Array.isArray(p.gruppen) ? p.gruppen : [];
    var ab = monatNorm(p.ab);
    if (!g.length || !ab) return '';
    var abstand = (+jm.slice(0, 4) - +ab.slice(0, 4)) * 12 + (+jm.slice(5, 7) - +ab.slice(5, 7));
    return abstand < 0 ? '' : String(g[abstand % g.length]);
  }

  function kurz(iso) { return datumKurz(iso).replace(' ', ' '); }
  function spanne(von, bis) { return !bis || bis === von ? kurz(von) : kurz(von) + '\u00a0– ' + kurz(bis); }

  // Uhrzeit für die Übersicht: aus den Schichten des ersten Tages, sonst „Beginn: …“ aus der Info
  function terminZeit(t) {
    if (t.uhrVon) return t.uhrVon + (t.uhrBis ? '–' + t.uhrBis : '');
    var ersterTag = t.schichten.filter(function (s) { return s.tag === t.von && s.von; });
    if (ersterTag.length) {
      var anfang = ersterTag.map(function (s) { return s.von; }).sort()[0];
      var enden = ersterTag.map(function (s) { return s.bis; }).filter(Boolean).sort();
      return t.von === t.bis && enden.length ? anfang + '–' + enden[enden.length - 1] : 'ab ' + anfang;
    }
    var m = /Beginn:\s*(\d{1,2}:\d{2})/.exec(t.info || '');
    return m ? 'ab ' + m[1] : '';
  }

  function meinePutzGruppe(name) {
    return !!z.profil && z.profil.some(function (p) { return istGleich(p, name); });
  }

  function tabelleHtml() {
    if (KONF.ferien && !ferien.geladen && !ferien.laedt) ladeFerien();
    var h0 = heute();
    var start = h0.slice(0, 7);
    var kommend = sichtbareTermine().filter(function (t) { return t.von; });
    var ende = monatPlus(start, 11);
    kommend.forEach(function (t) { if (t.von.slice(0, 7) > ende) ende = t.von.slice(0, 7); });

    var proMonat = {};
    function dazu(monat, e) { (proMonat[monat] = proMonat[monat] || []).push(e); }
    kommend.forEach(function (t) {
      var m = t.von.slice(0, 7);
      dazu(m < start ? start : m, { art: 'termin', sort: t.von + ' 1', t: t });
    });
    ferien.liste.forEach(function (f) {
      if (f.bis < h0) return;
      var m = f.von.slice(0, 7);
      if (m < start) m = start;
      if (m <= ende) dazu(m, { art: 'ferien', sort: f.von + ' 0', f: f });
    });

    var h = '<table class="uebersicht"><thead><tr><th scope="col">Datum</th><th scope="col">Uhrzeit</th><th scope="col">Termin</th></tr></thead><tbody>';
    for (var jm = start; jm <= ende; jm = monatPlus(jm, 1)) {
      var putz = putzdienst(jm);
      h += '<tr class="monat-zeile"><th colspan="3" scope="colgroup">' + MONAT[+jm.slice(5, 7) - 1] + ' ' + jm.slice(0, 4) +
        (putz ? '<span class="putz' + (meinePutzGruppe(putz) ? ' meins' : '') + '">Putzdienst: ' + esc(putz) +
          (meinePutzGruppe(putz) ? ' – deine Gruppe' : '') + '</span>' : '') + '</th></tr>';
      var liste = (proMonat[jm] || []).sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
      if (!liste.length) h += '<tr class="leer-zeile"><td colspan="3">keine Termine</td></tr>';
      liste.forEach(function (e) {
        if (e.art === 'ferien') {
          h += '<tr class="ferien"><td class="u-datum">' + esc(spanne(e.f.von, e.f.bis)) + '</td><td></td><td>' + esc(e.f.name) + '</td></tr>';
        } else {
          h += '<tr' + (e.t.extern ? ' class="extern"' : '') + '><td class="u-datum">' + esc(spanne(e.t.von, e.t.bis)) + '</td><td class="u-zeit">' + esc(terminZeit(e.t)) + '</td>' +
            '<td><a href="#t-' + esc(e.t.id) + '">' + esc(e.t.titel) + '</a>' +
            (e.t.extern ? ' <span class="etikett">' + EXTERN + '</span>' : '') + zgEtikett(e.t.zg) + '</td></tr>';
        }
      });
    }
    h += '</tbody></table>';

    var land = String(KONF.ferien || '').toUpperCase();
    if (BUNDESLAND[land]) {
      h += '<p class="quelle">' + (ferien.laedt ? 'Schulferien werden geladen …'
        : ferien.fehler ? 'Die Schulferien konnten gerade nicht geladen werden.'
          : 'Schulferien ' + BUNDESLAND[land] + ': openholidaysapi.org') + '</p>';
    }
    return h;
  }

  // ---------- Abstimmungen ----------

  function abstimmungenHtml() {
    var h = '';
    z.sicht.abstimmungen.forEach(function (p) {
      if (!passt(p.zg) && z.trotzdem !== p.id) return;
      if (!p.status) { h += abstimmungHtml(p); return; }
      var loeschen = admin() ? ' · <button class="link" data-aktion="abstimmung-loeschen" data-id="' + esc(p.id) + '">Abstimmung entfernen</button>' : '';
      if (p.status === 'festgelegt') {
        var t = finde(z.sicht.termine, p.termin_id);
        var o = finde(p.optionen, p.ergebnis);
        if (!t || istVorbei(t)) { if (admin()) h += '<p class="ergebnis leise">„' + esc(p.titel) + '“: Abstimmung abgeschlossen' + loeschen + '</p>'; return; }
        var mitListe = t.direkt || t.schichten.some(function (s) { return s.station === 'Teilnehmer'; });
        h += '<p class="ergebnis">„' + esc(p.titel) + '“ ist per Abstimmung auf <strong>' + esc(datumLang(t.datum)) + '</strong> festgelegt' +
          (o ? ' (' + o.stimmen.length + (o.stimmen.length === 1 ? ' Stimme' : ' Stimmen') + ')' : '') +
          (mitListe ? '. Wer dafür gestimmt hat, ist als Teilnehmer eingetragen' : '') +
          ' · <a href="#t-' + esc(t.id) + '">zum Termin</a>' + loeschen + '</p>';
      } else if (admin()) {
        h += '<p class="ergebnis leise">„' + esc(p.titel) + '“: Abstimmung ohne Stimmen beendet' + loeschen + '</p>';
      }
    });
    return h;
  }

  function abstimmungHtml(p) {
    var h = '<section class="termin abstimmung" id="p-' + esc(p.id) + '">';
    if (istOffen('abstimmung', p.id)) {
      h += abstimmungFormular(p);
    } else {
      var n = tageBis(p.frist);
      var noch = n === 0 ? 'heute letzter Tag' : n === 1 ? 'noch bis morgen' : n > 1 ? 'noch ' + n + ' Tage' : '';
      h += '<div class="t-datum">Abstimmung bis ' + esc(datumLang(p.frist)) + (noch ? ' · ' + noch : '') + zgEtikett(p.zg) + '</div>';
      h += '<h2>' + esc(p.titel) + '</h2>';
      if (p.ort) h += '<div class="t-ort">' + esc(p.ort) + '</div>';
      if (p.info) h += '<p class="info">' + mitLinks(p.info) + '</p>';
      h += '<p class="leise klein">Wähle alle Termine, die dir passen. Danach wird automatisch der mit den meisten Stimmen festgelegt, ' +
        'und wer dafür gestimmt hat, ist dort als Teilnehmer eingetragen.</p>';
    }
    h += '<div class="schichten">';
    p.optionen.forEach(function (o) { h += optionZeile(p, o); });
    h += '</div>';

    var links = ['<button class="link" data-aktion="teilen-abstimmung" data-id="' + esc(p.id) + '">Per WhatsApp teilen</button>'];
    if (admin()) {
      links.push('<button class="link" data-aktion="abstimmung-bearbeiten" data-id="' + esc(p.id) + '">Bearbeiten</button>');
      links.push('<button class="link" data-aktion="abstimmung-loeschen" data-id="' + esc(p.id) + '">Löschen</button>');
    }
    h += '<div class="t-links">' + links.join('<span class="trenn"> · </span>') + '</div>';
    return h + '</section>';
  }

  function optionZeile(p, o) {
    var meine = o.stimmen.filter(function (v) { return ich(v.name); })[0];
    var vorn = p.meiste > 0 && o.stimmen.length === p.meiste;
    var h = '<div class="zeile abst' + (vorn ? ' vorn' : '') + '">';
    h += '<span class="z-zeit">' + esc(datumKurz(o.datum) + (o.von ? ' · ' + o.von : '')) + '</span>';
    h += '<span class="z-zahl" title="' + o.stimmen.length + (o.stimmen.length === 1 ? ' Stimme' : ' Stimmen') + (vorn ? ', vorne' : '') + '">' + o.stimmen.length + '</span>';
    h += '<span class="z-namen">' + (o.stimmen.length ? o.stimmen.map(function (v) {
      return '<span class="person' + (ich(v.name) ? ' ich' : '') + (istTmp(v.id) ? ' wartet' : '') + '">' + esc(v.name) + '</span>';
    }).join(', ') : '<span class="leise">noch keine Stimme</span>') + '</span>';
    h += '<span class="z-aktion">';
    if (meine) {
      h += '<button class="gewaehlt" data-aktion="stimme-weg" data-id="' + esc(meine.id) + '" aria-pressed="true" title="Stimme zurücknehmen">✓ passt</button>';
    } else if (z.name) {
      h += '<button data-aktion="stimmen" data-option="' + esc(o.id) + '" aria-pressed="false" title="Als ' + esc(z.name) + ' abstimmen">Passt mir</button>';
    } else if (!istOffen('stimmen', o.id)) {
      h += '<button data-aktion="stimmen-name" data-option="' + esc(o.id) + '">Passt mir</button>';
    }
    if (admin()) {
      h += '<span class="verw"><button class="link" data-aktion="festlegen" data-id="' + esc(p.id) + '" data-option="' + esc(o.id) + '">festlegen</button>' +
        '<button class="link" data-aktion="option-loeschen" data-id="' + esc(o.id) + '">löschen</button></span>';
    }
    h += '</span></div>';
    if (istOffen('stimmen', o.id)) {
      h += '<form class="eintragen" data-form="stimmen" data-id="' + esc(o.id) + '">' +
        '<input name="name" placeholder="Dein Name" aria-label="Dein Name" maxlength="60" required autocomplete="name">' +
        '<span class="knoepfe"><button type="submit" class="haupt">Abstimmen</button>' +
        '<button type="button" data-aktion="schliessen">Abbrechen</button></span></form>';
    }
    return h;
  }

  function abstimmungFormular(p) {
    p = p || {};
    var zeilen = (z.offen && z.offen.zeilen) || (p.id ? 1 : 3);
    var h = '<form class="kasten" data-form="abstimmung" data-id="' + esc(p.id || '') + '">' +
      '<h3>' + (p.id ? 'Abstimmung bearbeiten' : 'Neue Terminabstimmung') + '</h3>' +
      veraltetHinweis(5, '„Für wen?“ wird') +
      '<label>Titel des Termins<input name="titel" required maxlength="120" value="' + esc(p.titel || '') + '" placeholder="z. B. Sommerfest"></label>' +
      '<div class="reihe"><label>Ort<input name="ort" maxlength="150" value="' + esc(p.ort || '') + '" placeholder="optional"></label>' +
      '<label>Abstimmen bis<input type="date" name="frist" required value="' + esc(p.frist || plusTage(heute(), 7)) + '"></label></div>' +
      '<label>Info<textarea name="info" rows="2" maxlength="2000" placeholder="optional">' + esc(p.info || '') + '</textarea></label>' +
      fuerFeld(p.zg, 'Nichts angehakt = für alle (auch Eltern). Der festgelegte Termin übernimmt die Auswahl.') +
      '<fieldset class="optionen"><legend>' + (p.id ? 'Weitere mögliche Termine hinzufügen' : 'Mögliche Termine') + '</legend>';
    for (var i = 0; i < zeilen; i++) {
      h += '<div class="reihe"><label>Datum<input type="date" name="odatum_' + i + '"></label>' +
        '<label>Uhrzeit (optional)<input type="time" name="ozeit_' + i + '"></label></div>';
    }
    h += '<button type="button" class="link" data-aktion="option-zeile">+ weiteres Datum</button></fieldset>' +
      '<p class="tipp">Am Tag nach „Abstimmen bis“ wird automatisch der Termin mit den meisten Stimmen angelegt, ' +
      'bei Gleichstand der frühere. Wer dafür gestimmt hat, steht dort gleich in der Liste „Teilnehmer“. ' +
      'Mit „festlegen“ kannst du auch vorher selbst entscheiden.</p>' +
      '<div class="knoepfe"><button type="submit" class="haupt">Speichern</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
    return h;
  }

  function abstimmungText(p) {
    var zeilen = ['*Abstimmung: ' + p.titel + '*'];
    if (p.ort) zeilen.push(p.ort);
    zeilen.push('Welche Termine passen dir? Bitte bis ' + datumLang(p.frist) + ' abstimmen:');
    p.optionen.forEach(function (o) { zeilen.push('• ' + datumLang(o.datum) + (o.von ? ', ' + o.von + ' Uhr' : '')); });
    zeilen.push('');
    zeilen.push('Abstimmen: ' + seitenLink('p-' + p.id));
    return zeilen.join('\n');
  }

  function terminHtml(t) {
    var vorbei = istVorbei(t);
    var bearbeiten = istOffen('termin', t.id);
    // „Jugend extern“: eingeklappt als eine Zeile, Klick klappt auf
    if (t.extern && !z.aufgeklappt[t.id] && !bearbeiten) {
      var uhrKurz = t.uhrVon ? t.uhrVon + (t.uhrBis ? '–' + t.uhrBis : '') : '';
      return '<section class="termin extern zu' + (vorbei ? ' vorbei' : '') + '" id="t-' + esc(t.id) + '">' +
        '<button class="extern-zeile" data-aktion="extern-auf" data-id="' + esc(t.id) + '" aria-expanded="false">' +
        '<span class="e-datum">' + esc(spanne(t.von, t.bis) + (uhrKurz ? ' · ' + uhrKurz : '')) + '</span>' +
        '<span class="e-titel">' + esc(t.titel) + '</span>' +
        '<span class="etikett">' + EXTERN + '</span></button></section>';
    }

    var h = '<section class="termin' + (vorbei ? ' vorbei' : '') + (t.extern ? ' extern' : '') + '" id="t-' + esc(t.id) + '">';

    if (bearbeiten) {
      h += terminFormular(t);
    } else {
      var rel = vorbei ? '' : relativ(t.von);
      var uhr = uhrText(t);
      h += '<div class="t-kopf">';
      h += '<div class="t-datum">' + esc(zeitraum(t.von, t.bis)) + (uhr ? ' · ' + esc(uhr) : '') + (rel ? ' · ' + rel : '') +
        (t.extern ? ' · <span class="etikett">' + EXTERN + '</span>' : '') + zgEtikett(t.zg) + '</div>';
      h += '<h2>' + esc(t.titel) + '</h2>';
      if (t.ort) h += '<div class="t-ort">' + esc(t.ort) + '</div>';
      h += '</div>';
      if (t.info) h += '<p class="info">' + mitLinks(t.info) + '</p>';
    }

    if (t.direkt) h += '<div class="schichten">' + direktZeile(t, vorbei) + '</div>';
    h += schichtenHtml(t);
    h += terminAufgabenHtml(t);
    if (istOffen('aufgabe', '', t.id)) h += aufgabeFormular(null, t.id);
    if (istOffen('schicht', '', t.id)) h += schichtFormular(t, null);
    if (istOffen('kopieren', t.id)) h += kopierFormular(t);

    var links = [];
    if (t.extern && !bearbeiten) links.push('<button class="link" data-aktion="extern-auf" data-id="' + esc(t.id) + '" aria-expanded="true">Einklappen</button>');
    if (!vorbei) links.push('<button class="link" data-aktion="teilen" data-id="' + esc(t.id) + '">Per WhatsApp teilen</button>');
    if (t.von) links.push('<button class="link" data-aktion="ics-termin" data-id="' + esc(t.id) + '">In den Kalender</button>');
    if (admin()) {
      links.push('<button class="link" data-aktion="termin-bearbeiten" data-id="' + esc(t.id) + '">Bearbeiten</button>');
      links.push('<button class="link" data-aktion="schicht-neu" data-termin="' + esc(t.id) + '">Schichten hinzufügen</button>');
      links.push('<button class="link" data-aktion="aufgabe-dazu" data-termin="' + esc(t.id) + '">+ Aufgabe dazu</button>');
      links.push('<button class="link" data-aktion="termin-kopieren" data-id="' + esc(t.id) + '">Kopieren</button>');
      links.push('<button class="link" data-aktion="termin-loeschen" data-id="' + esc(t.id) + '">Löschen</button>');
    }
    if (links.length) h += '<div class="t-links">' + links.join('<span class="trenn"> · </span>') + '</div>';
    return h + '</section>';
  }

  // Zugeordnete Aufgaben beim Termin, mit Stand und Link zur Aufgabe
  function terminAufgabenHtml(t) {
    // Team-Aufgaben beim Termin nur fürs Team; die Verwaltung kann sie aufklappen
    var team = t.aufgaben.filter(function (g) { return nurTeams(g.zg) && !teamAufgabeFuerMich(g) && z.trotzdem !== g.id; });
    var offen = admin() && z.teamAufgaben[t.id];
    var liste = t.aufgaben.filter(function (g) { return team.indexOf(g) < 0 ? aufgabeSichtbar(g) : offen; });
    var hinweis = '';
    if (admin() && team.length) {
      var fuer = einzigartig(team.map(function (g) { return zgKurz(g.zg).join(', '); }));
      hinweis = '<p class="t-team-hinweis leise klein">' + (team.length === 1 ? '1 Aufgabe' : team.length + ' Aufgaben') +
        ' nur für ' + esc(fuer.join(' / ')) + ' – sieht nur, wer das bei „Für wen?“ gewählt hat · ' +
        '<button class="link" data-aktion="team-aufgaben" data-id="' + esc(t.id) + '">' + (offen ? 'ausblenden' : 'anzeigen') + '</button></p>';
    }
    if (!liste.length) return hinweis ? '<div class="t-aufgaben">' + hinweis + '</div>' : '';
    return '<div class="t-aufgaben"><span class="t-aufgaben-titel">Aufgaben dazu</span><ul>' + liste.map(function (g) {
      var alleLeute = g.unter.reduce(function (l, u) { return l.concat(u.leute); }, g.leute);
      var dabei = alleLeute.some(function (e) { return ich(e.name); });
      var stand;
      if (g.fertig) stand = 'erledigt';
      else if (g.unter.length) stand = g.erledigtZahl + ' von ' + g.unter.length + ' erledigt';
      else stand = g.leute.length + '/' + (zahl(g.anzahl) || '∞');
      return '<li' + (g.fertig ? ' class="fertig"' : '') + '><a href="#a-' + esc(g.id) + '">' + esc(g.titel) + '</a>' +
        ' <span class="leise">' + esc(stand) + '</span>' + (dabei ? ' <span class="dabei">du bist dabei</span>' : '') + '</li>';
    }).join('') + '</ul>' + hinweis + '</div>';
  }

  // „14:00–16:00 Uhr“ oder „19:00 Uhr“
  function uhrText(t) {
    if (!t.uhrVon) return '';
    return t.uhrVon + (t.uhrBis ? '–' + t.uhrBis : '') + ' Uhr';
  }

  // Eintragen direkt beim Termin (ohne Schicht)
  function direktZeile(t, vorbei) {
    var max = zahl(t.plaetze);
    var n = t.leute.length;
    var voll = max > 0 && n >= max;
    var gesperrt = t.plaetze === ''; // Eintragen abgeschaltet, alte Namen bleiben sichtbar
    var h = '<div class="zeile ohne-zeit direkt' + (voll ? ' ist-voll' : '') + '">' +
      zahlHtml(n, max) +
      '<span class="z-namen">' + namenHtml(t.leute, vorbei) + '</span>' +
      '<span class="z-aktion">' + (gesperrt ? '' : aktionHtml(t.id, vorbei, voll, t.leute, true)) + '</span></div>';
    if (istOffen('eintragen', t.id) && !vorbei && !voll && !gesperrt) h += eintragFormular(t.id);
    return h;
  }

  function schichtenHtml(t) {
    if (!t.schichten.length) return '';
    var tage = einzigartig(t.schichten.map(function (s) { return s.tag; }));
    var mehrtaegig = tage.length > 1;
    var h = '<div class="schichten">';
    tage.forEach(function (tag) {
      if (mehrtaegig) h += '<div class="tag-kopf">' + esc(datumLang(tag)) + '</div>';
      var amTag = t.schichten.filter(function (s) { return s.tag === tag; });
      t.stationen.forEach(function (station) {
        var liste = amTag.filter(function (s) { return s.station === station; });
        if (!liste.length) return;
        h += '<div class="station">';
        if (station) h += '<h3>' + esc(station) + '</h3>';
        liste.forEach(function (s) { h += schichtZeile(t, s); });
        h += '</div>';
      });
    });
    return h + '</div>';
  }

  function schichtZeile(t, s) {
    if (istOffen('schicht', s.id)) return schichtFormular(t, s);
    var vorbei = s.tag && s.tag < heute();
    var max = zahl(s.anzahl);
    var n = s.leute.length;
    var voll = max > 0 && n >= max;

    var h = '<div class="zeile' + (voll ? ' ist-voll' : '') + '">';
    h += '<span class="z-zeit">' + esc(zeitText(s)) + '</span>';
    h += zahlHtml(n, max);
    h += '<span class="z-namen">' + namenHtml(s.leute, vorbei) +
      (s.info ? '<span class="z-info">' + esc(s.info) + '</span>' : '') + '</span>';
    h += '<span class="z-aktion">' + aktionHtml(s.id, vorbei, voll, s.leute, true);
    if (admin()) {
      h += '<span class="verw"><button class="link" data-aktion="schicht-bearbeiten" data-id="' + esc(s.id) + '" data-termin="' + esc(t.id) + '">ändern</button>' +
        '<button class="link" data-aktion="schicht-loeschen" data-id="' + esc(s.id) + '">löschen</button></span>';
    }
    h += '</span></div>';
    if (istOffen('eintragen', s.id) && !vorbei && !voll) h += eintragFormular(s.id);
    return h;
  }

  function zahlHtml(n, max) {
    var titel = max ? n + ' von ' + max + ' Plätzen belegt' : n + ' eingetragen, beliebig viele möglich';
    return '<span class="z-zahl" title="' + titel + '">' + n + '/' + (max || '∞') + '</span>';
  }

  // Ist ein Name im Browser gespeichert, trägt „Eintragen“ mit einem Klick ein.
  // Sonst öffnet sich das Formular (danach ist der Name gespeichert).
  // „+ weitere Person“ öffnet das Namensfeld, um andere einzutragen – auch ohne sich selbst einzutragen.
  function aktionHtml(bezug, vorbei, voll, leute, mitNotiz) {
    if (vorbei) return '<span class="leise">vorbei</span>';
    var dabei = leute.some(function (e) { return ich(e.name); });
    var eingetragen = '<span class="leise">eingetragen</span>';
    if (istOffen('eintragen', bezug)) return dabei ? eingetragen : '';
    if (voll) return dabei ? eingetragen : '<span class="leise">voll</span>';
    var b = esc(bezug);
    if (!z.name) return '<button data-aktion="eintragen" data-bezug="' + b + '">Eintragen</button>';

    var links = [];
    if (mitNotiz && !dabei) links.push('<button class="link" data-aktion="eintragen" data-bezug="' + b + '">mit Notiz</button>');
    links.push('<button class="link" data-aktion="weitere" data-bezug="' + b + '">+ weitere Person</button>');
    return (dabei ? eingetragen
      : '<button data-aktion="schnell-eintragen" data-bezug="' + b + '" title="Als ' + esc(z.name) + ' eintragen">Eintragen</button>') +
      '<span class="verw">' + links.join('') + '</span>';
  }

  function alsHtml() {
    if (istOffen('name')) {
      return '<form class="name-form als" data-form="name">' +
        '<input name="name" value="' + esc(z.name) + '" maxlength="60" autocomplete="name" aria-label="Dein Name" placeholder="Dein Name">' +
        '<button type="submit">Speichern</button>' +
        '<button type="button" data-aktion="schliessen">Abbrechen</button></form>';
    }
    if (!z.name) return '';
    return '<p class="als">Du trägst dich ein als <strong>' + esc(z.name) + '</strong> · ' +
      '<button class="link" data-aktion="name-aendern">ändern</button></p>';
  }

  function namenHtml(leute, vorbei) {
    if (!leute.length) return '<span class="leise">noch niemand</span>';
    return leute.map(function (e) {
      var wartet = istTmp(e.id);
      return '<span class="person' + (ich(e.name) ? ' ich' : '') + (wartet ? ' wartet' : '') + '">' + esc(e.name) +
        (e.notiz ? ' <span class="notiz">(' + esc(e.notiz) + ')</span>' : '') +
        (vorbei || wartet ? '' : '<button class="weg" data-aktion="austragen" data-id="' + esc(e.id) + '" title="absagen" aria-label="' + esc(e.name) + ' absagen">×</button>') +
        '</span>';
    }).join(', ');
  }

  function eintragFormular(bezug) {
    var weitere = !!(z.offen && z.offen.weitere);
    var text = weitere ? 'Name der Person' : 'Dein Name';
    return '<form class="eintragen" data-form="eintragen" data-id="' + esc(bezug) + '"' + (weitere ? ' data-weitere="1"' : '') + '>' +
      '<input name="name" placeholder="' + text + '" aria-label="' + text + '" maxlength="60" required' +
      (weitere ? ' autocomplete="off" value=""' : ' autocomplete="name" value="' + esc(z.name) + '"') + '>' +
      '<input name="notiz" placeholder="Notiz (optional)" aria-label="Notiz" maxlength="200">' +
      '<span class="knoepfe"><button type="submit" class="haupt">Eintragen</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></span></form>';
  }

  // ---------- Aufgaben ----------

  function aufgabenHtml() {
    // Link auf eine ausgeblendete Aufgabe: trotzdem zeigen
    if (z.springeZu) {
      var ziel = finde(z.sicht.aufgaben, z.springeZu.replace(/^a-/, ''));
      if (ziel && !aufgabeSichtbar(ziel)) z.trotzdem = ziel.id;
    }
    var liste = offeneAufgaben();
    var erledigt = erledigteAufgaben();
    var abgelaufen = z.sicht.aufgaben.filter(istAbgelaufen).filter(aufgabeSichtbar);
    if (z.springeZu && abgelaufen.some(function (g) { return 'a-' + g.id === z.springeZu; })) z.vergangene = true;
    var h = alsHtml() + '<div class="leiste"><span class="leise">Aufgaben zum Mithelfen</span>' +
      (admin() ? '<button data-aktion="aufgabe-neu">+ Neue Aufgabe</button>' : '') + '</div>';
    if (istOffen('aufgabe', '')) h += aufgabeFormular(null);
    if (!liste.length) h += '<p class="leer">Gerade keine offenen Aufgaben.</p>';
    liste.forEach(function (g) { h += aufgabeHtml(g); });
    if (z.springeZu && erledigt.some(function (g) { return 'a-' + g.id === z.springeZu; })) z.erledigteZeigen = true;
    if (erledigt.length) {
      h += '<p class="vergangen-schalter"><button class="link" data-aktion="erledigte">' +
        (z.erledigteZeigen ? 'Erledigte Aufgaben ausblenden' : 'Erledigte Aufgaben anzeigen (' + erledigt.length + ')') +
        '</button></p>';
      if (z.erledigteZeigen) erledigt.forEach(function (g) { h += aufgabeHtml(g); });
    }
    if (abgelaufen.length) {
      h += '<p class="vergangen-schalter"><button class="link" data-aktion="vergangene">' +
        (z.vergangene ? 'Abgelaufene Aufgaben ausblenden' : 'Abgelaufene Aufgaben anzeigen (' + abgelaufen.length + ')') +
        '</button></p>';
      if (z.vergangene) {
        h += '<h2 class="abschnitt">Abgelaufene Aufgaben</h2>';
        abgelaufen.slice().reverse().forEach(function (g) { h += aufgabeHtml(g); });
      }
    }
    return h;
  }

  function aufgabeHtml(g) {
    var vorbei = istAbgelaufen(g);
    var h = '<section class="aufgabe' + (vorbei ? ' vorbei' : '') + (g.fertig ? ' fertig' : '') + '" id="a-' + esc(g.id) + '">';
    if (istOffen('aufgabe', g.id)) return h + aufgabeFormular(g) + '</section>';

    h += '<h2>' + esc(g.titel) + '</h2>';
    var wann = [];
    if (g.frist) wann.push('bis ' + esc(datumLang(g.frist)));
    if (g.termin) wann.push('zu <a href="#t-' + esc(g.termin.id) + '">' + esc(g.termin.titel) + '</a> am ' + esc(datumKurz(g.termin.von)));
    var rel = vorbei || g.fertig || !g.bisWann ? '' : relativ(g.bisWann);
    if (rel) wann.push(rel);
    if (wann.length || g.zg.length) h += '<div class="t-datum">' + wann.join(' · ') + zgEtikett(g.zg) + '</div>';
    if (g.info) h += '<p class="info">' + mitLinks(g.info) + '</p>';
    if (g.unter.length) {
      h += '<div class="fortschritt">' + g.erledigtZahl + ' von ' + g.unter.length +
        (g.unter.length === 1 ? ' Unteraufgabe' : ' Unteraufgaben') + ' erledigt</div>';
    }

    h += '<div class="schichten">';
    // Eigene Zeile der Hauptaufgabe: ohne Unteraufgaben immer, mit nur, falls dort schon jemand steht
    if (!g.unter.length || g.leute.length) {
      var max = zahl(g.anzahl);
      var n = g.leute.length;
      var voll = max > 0 && n >= max;
      var zu = vorbei || !!g.erledigt;
      h += '<div class="zeile ohne-zeit' + (voll ? ' ist-voll' : '') + '">' +
        zahlHtml(n, max) +
        '<span class="z-namen">' + namenHtml(g.leute, zu) + '</span>' +
        '<span class="z-aktion">' + (g.erledigt && !vorbei ? '<span class="leise">erledigt</span>' : aktionHtml(g.id, vorbei, voll, g.leute, true)) + '</span></div>';
      if (istOffen('eintragen', g.id) && !zu && !voll) h += eintragFormular(g.id);
    }
    g.unter.forEach(function (u) { h += unterZeile(u, vorbei); });
    h += '</div>';
    if (istOffen('unter', g.id)) h += unterFormular(g);

    var links = [];
    if (!vorbei) {
      links.push('<label class="haken"><input type="checkbox" data-aktion="abhaken" data-id="' + esc(g.id) + '"' + (g.erledigt ? ' checked' : '') + '> ' +
        (g.unter.length ? 'Ganze Aufgabe erledigt' : 'erledigt') + '</label>' +
        (g.erledigt ? ' <span class="leise">' + esc(erledigtText(g)) + '</span>' : ''));
    }
    if (admin()) {
      links.push('<button class="link" data-aktion="unter-neu" data-id="' + esc(g.id) + '">+ Unteraufgaben</button>');
      links.push('<button class="link" data-aktion="aufgabe-bearbeiten" data-id="' + esc(g.id) + '">Bearbeiten</button>');
      links.push('<button class="link" data-aktion="aufgabe-loeschen" data-id="' + esc(g.id) + '">Löschen</button>');
    }
    if (links.length) h += '<div class="t-links">' + links.join('<span class="trenn"> · </span>') + '</div>';
    return h + '</section>';
  }

  function unterZeile(u, vorbei) {
    if (istOffen('aufgabe', u.id)) return aufgabeFormular(u);
    var max = zahl(u.anzahl);
    var n = u.leute.length;
    var voll = max > 0 && n >= max;
    var fertig = !!u.erledigt;
    var h = '<div class="zeile unteraufgabe' + (fertig ? ' erledigt' : '') + (voll ? ' ist-voll' : '') + '">';
    h += '<span class="z-haken"><input type="checkbox" data-aktion="abhaken" data-id="' + esc(u.id) + '"' +
      (fertig ? ' checked' : '') + (vorbei ? ' disabled' : '') + ' aria-label="' + esc(u.titel) + ' erledigt"></span>';
    h += '<span class="z-titel"><span class="u-titel">' + esc(u.titel) + '</span>' +
      (u.info ? '<span class="z-info">' + esc(u.info) + '</span>' : '') +
      (fertig ? '<span class="z-info">erledigt ' + esc(erledigtText(u)) + '</span>' : '') + '</span>';
    h += zahlHtml(n, max);
    h += '<span class="z-namen">' + namenHtml(u.leute, vorbei || fertig) + '</span>';
    h += '<span class="z-aktion">' + (fertig ? '' : aktionHtml(u.id, vorbei, voll, u.leute, false));
    if (admin()) {
      h += '<span class="verw"><button class="link" data-aktion="aufgabe-bearbeiten" data-id="' + esc(u.id) + '">ändern</button>' +
        '<button class="link" data-aktion="unter-loeschen" data-id="' + esc(u.id) + '">löschen</button></span>';
    }
    h += '</span></div>';
    if (istOffen('eintragen', u.id) && !vorbei && !voll && !fertig) h += eintragFormular(u.id);
    return h;
  }

  function unterFormular(g) {
    return '<form class="kasten" data-form="unter" data-id="' + esc(g.id) + '">' +
      '<h3>Unteraufgaben hinzufügen</h3>' +
      '<label>Unteraufgaben<textarea name="titel" rows="3" maxlength="3000" placeholder="Baum aussuchen&#10;Anhänger organisieren"></textarea>' +
      '<span class="tipp">Eine Unteraufgabe pro Zeile.</span></label>' +
      '<div class="reihe"><label>Helfer je Unteraufgabe<input type="number" name="anzahl" min="0" max="999" inputmode="numeric" value="1">' +
      '<span class="tipp">0 = beliebig viele</span></label></div>' +
      '<div class="knoepfe"><button type="submit" class="haupt">Hinzufügen</button>' +
      '<button type="button" data-aktion="schliessen">Fertig</button></div></form>';
  }

  // ---------- Meine Einträge ----------

  function meineHtml() {
    var h = '<form class="name-form" data-form="name"><label for="meinname">Dein Name</label>' +
      '<input id="meinname" name="name" value="' + esc(z.name) + '" maxlength="60" autocomplete="name" placeholder="z. B. Anna Müller">' +
      '<button type="submit">Anzeigen</button></form>';
    if (!z.name) {
      return h + '<p class="leer">Gib deinen Namen so ein, wie du dich einträgst. Dann siehst du hier alles auf einen Blick. ' +
        'Der Name wird nur in diesem Browser gespeichert.</p>';
    }
    var liste = meineEintraege();
    if (!liste.length) {
      return h + '<p class="leer">Mit dem Namen „' + esc(z.name) + '“ bist du gerade nirgends eingetragen.</p>';
    }
    h += '<ul class="meine">';
    liste.forEach(function (m) {
      var wann, was;
      if (m.schicht) {
        wann = datumKurz(m.schicht.tag) + (zeitText(m.schicht) ? ' · ' + zeitText(m.schicht) : '');
        was = '<a href="#t-' + esc(m.termin.id) + '">' + esc(m.termin.titel) + '</a>' +
          (m.schicht.station ? ' · ' + esc(m.schicht.station) : '');
      } else if (m.termin) {
        var t = m.termin;
        wann = datumKurz(t.von) + (t.bis !== t.von ? ' – ' + datumKurz(t.bis) : '') +
          (t.uhrVon ? ' · ' + t.uhrVon + (t.uhrBis ? '–' + t.uhrBis : '') : '');
        was = '<a href="#t-' + esc(t.id) + '">' + esc(t.titel) + '</a>';
      } else {
        wann = m.aufgabe.frist ? 'bis ' + datumKurz(m.aufgabe.frist) : 'Aufgabe';
        was = '<a href="#a-' + esc(m.aufgabe.id) + '">' + esc(m.aufgabe.titel) + '</a>' +
          (m.unter ? ' › ' + esc(m.unter.titel) : '');
      }
      if (m.e.notiz) was += ' <span class="notiz">(' + esc(m.e.notiz) + ')</span>';
      h += '<li><span class="m-wann">' + esc(wann) + '</span><span class="m-was">' + was + '</span>' +
        '<span><button class="link" data-aktion="austragen" data-id="' + esc(m.e.id) + '">absagen</button></span></li>';
    });
    h += '</ul>';
    if (liste.some(function (m) { return m.termin; })) {
      h += '<p class="t-links"><button class="link" data-aktion="ics-meine">Meine Termine in den Kalender übernehmen</button></p>';
    }
    return h;
  }

  // ---------- Verwaltungsformulare ----------

  function terminFormular(t) {
    t = t || {};
    var direkt = t.id ? t.plaetze !== '' : true; // neue Termine: Eintragen direkt beim Termin vorausgewählt
    var zeit = t.uhrVon ? t.uhrVon + (t.uhrBis ? '–' + t.uhrBis : '') : '';
    var fehlt = z.version < 3 ? 'Uhrzeit, Bis-Datum, Eintragen beim Termin, „' + EXTERN + '“ und „Für wen?“ werden'
      : z.version < 4 ? '„' + EXTERN + '“ und „Für wen?“ werden' : '„Für wen?“ wird';
    return '<form class="kasten" data-form="termin" data-id="' + esc(t.id || '') + '">' +
      '<h3>' + (t.id ? 'Termin bearbeiten' : 'Neuer Termin') + '</h3>' +
      veraltetHinweis(5, fehlt) +
      '<label>Titel<input name="titel" required maxlength="120" value="' + esc(t.titel || '') + '" placeholder="z. B. Adventsmarkt"></label>' +
      '<div class="reihe"><label>Datum<input type="date" name="datum" required value="' + esc(t.datum || '') + '"></label>' +
      '<label>Bis<input type="date" name="bis_datum" value="' + esc(t.bis_datum || '') + '"><span class="tipp">optional, nur bei mehreren Tagen</span></label></div>' +
      '<div class="reihe"><label>Uhrzeit<input name="zeit" maxlength="40" value="' + esc(zeit) + '" placeholder="z. B. 14:00–16:00 oder 19:00">' +
      '<span class="tipp">optional</span></label>' +
      '<label>Ort<input name="ort" maxlength="150" value="' + esc(t.ort || '') + '" placeholder="optional"></label></div>' +
      '<label>Info<textarea name="info" rows="3" maxlength="2000" placeholder="optional">' + esc(t.info || '') + '</textarea></label>' +
      fuerFeld(t.zg) +
      '<label class="haken-zeile extern-haken"><input type="checkbox" name="extern"' + (t.extern ? ' checked' : '') + '> ' + EXTERN +
      '<span class="tipp">wird eingeklappt und ohne Farbe angezeigt und lässt sich ausblenden</span></label>' +
      '<div class="reihe"><label class="haken-zeile"><input type="checkbox" name="direkt"' + (direkt ? ' checked' : '') + '> Direkt beim Termin eintragen</label>' +
      '<label>Plätze<input type="number" name="plaetze" min="0" max="999" inputmode="numeric" value="' + esc(t.plaetze ? zahl(t.plaetze) : 0) + '">' +
      '<span class="tipp">0 = beliebig viele</span></label></div>' +
      '<p class="tipp">Braucht es verschiedene Aufgaben oder Zeiten (z. B. Aufbau, Kasse)? Dann nach dem Speichern zusätzlich ' +
      '„Schichten hinzufügen“. Ohne Häkchen trägt man sich nur bei den Schichten ein.</p>' +
      '<div class="knoepfe"><button type="submit" class="haupt">Speichern</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
  }

  function schichtFormular(t, s) {
    var stationen = einzigartig(t.schichten.map(function (x) { return x.station; }).filter(Boolean));
    s = s || {};
    // Vorhandene Stationen als einfache Links (statt Browser-Vorschlagsliste, die sich je nach Gerät anders verhält)
    var vorhandene = stationen.length
      ? '<span class="tipp">Vorhandene: ' + stationen.map(function (x, i) {
        return '<span class="wahl"><button type="button" class="link" data-aktion="station-waehlen" data-wert="' + esc(x) + '">' +
          esc(x) + '</button>' + (i < stationen.length - 1 ? ',' : '') + '</span>';
      }).join(' ') + '</span>'
      : '<span class="tipp">Leer lassen, wenn es nur allgemein Helfer braucht.</span>';
    return '<form class="kasten" data-form="schicht" data-id="' + esc(s.id || '') + '" data-termin="' + esc(t.id) + '">' +
      '<h3>' + (s.id ? 'Schicht ändern' : 'Schichten hinzufügen') + '</h3>' +
      '<div class="reihe"><label>Station / Aufgabe<input name="station" maxlength="80" autocomplete="off" value="' + esc(s.station || '') + '" placeholder="z. B. Glühweinstand">' +
      vorhandene + '</label>' +
      '<label>Datum<input type="date" name="datum" value="' + esc(s.tag || t.datum || '') + '">' +
      '<span class="tipp">Für einen weiteren Tag einfach ein anderes Datum wählen.</span></label></div>' +
      '<div class="reihe"><label>' + (s.id ? 'Zeit' : 'Zeiten') + '<input name="zeiten" value="' + esc(s.id ? zeitText(s).replace(/^ab /, '') : '') + '" placeholder="' + (s.id ? '14:00–16:00' : '14:00–16:00, 16:00–18:00') + '">' +
      '<span class="tipp">' + (s.id ? 'Leer = ohne feste Zeit.' : 'Mehrere Zeiten mit Komma trennen – je Zeit entsteht eine Schicht. Leer = ohne feste Zeit.') + '</span></label>' +
      '<label>Helfer pro Schicht<input type="number" name="anzahl" min="0" max="999" inputmode="numeric" value="' + esc(s.id ? zahl(s.anzahl) : 2) + '">' +
      '<span class="tipp">0 = beliebig viele</span></label></div>' +
      '<label>Hinweis<input name="info" maxlength="300" value="' + esc(s.info || '') + '" placeholder="optional, z. B. Treffpunkt"></label>' +
      '<div class="knoepfe"><button type="submit" class="haupt">' + (s.id ? 'Speichern' : 'Hinzufügen') + '</button>' +
      '<button type="button" data-aktion="schliessen">' + (s.id ? 'Abbrechen' : 'Fertig') + '</button></div></form>';
  }

  function kopierFormular(t) {
    return '<form class="kasten zeile-form" data-form="kopieren" data-id="' + esc(t.id) + '">' +
      '<label for="kopie-' + esc(t.id) + '">Kopieren auf Datum</label>' +
      '<input type="date" id="kopie-' + esc(t.id) + '" name="datum" required value="' + esc(plusTage(t.datum, 7)) + '">' +
      '<button type="submit" class="haupt">Kopieren</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button>' +
      '<span class="tipp leise klein">Alle Schichten werden mitkopiert, die Eintragungen nicht.</span></form>';
  }

  function aufgabeFormular(g, terminVorwahl) {
    g = g || {};
    var unter = !!g.eltern_id;
    var terminId = g.id ? g.termin_id || '' : terminVorwahl || '';
    // Termine zur Auswahl: kommende, dazu der bisher zugeordnete
    var termine = z.sicht.termine.filter(function (t) { return !istVorbei(t) || t.id === terminId; });
    var terminWahl = unter ? '' : '<label>Gehört zu Termin<select name="termin_id"><option value="">– keinem –</option>' +
      termine.map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (t.id === terminId ? ' selected' : '') + '>' + esc(datumKurz(t.von) + ' · ' + t.titel) + '</option>';
      }).join('') + '</select><span class="tipp">optional – die Aufgabe steht dann auch beim Termin</span></label>';
    return '<form class="kasten" data-form="aufgabe" data-id="' + esc(g.id || '') + '"' + (terminVorwahl ? ' data-termin="' + esc(terminVorwahl) + '"' : '') + '>' +
      '<h3>' + (unter ? 'Unteraufgabe bearbeiten' : g.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe') + '</h3>' +
      (unter ? '' : veraltetHinweis(5, '„Für wen?“ und „Gehört zu Termin“ werden')) +
      '<label>Titel<input name="titel" required maxlength="120" value="' + esc(g.titel || '') + '" placeholder="z. B. Kuchen backen"></label>' +
      (unter
        ? '<label>Hinweis<input name="info" maxlength="300" value="' + esc(g.info || '') + '" placeholder="optional"></label>'
        : '<label>Info<textarea name="info" rows="2" maxlength="2000" placeholder="optional">' + esc(g.info || '') + '</textarea></label>') +
      '<div class="reihe">' +
      (unter ? '' : '<label>Erledigen bis<input type="date" name="frist" value="' + esc(g.frist || '') + '"><span class="tipp">optional</span></label>') +
      '<label>Wie viele Helfer?<input type="number" name="anzahl" min="0" max="999" inputmode="numeric" value="' + esc(g.id ? zahl(g.anzahl) : 1) + '">' +
      '<span class="tipp">0 = beliebig viele</span></label></div>' +
      terminWahl +
      (unter ? '' : fuerFeld(g.zgEigen, 'Nichts angehakt = für alle – oder für die, für die der zugeordnete Termin ist.')) +
      '<div class="knoepfe"><button type="submit" class="haupt">Speichern</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
  }

  // Eingaben in offenen Formularen über ein Neuzeichnen retten
  function formSchluessel(f) { return f.getAttribute('data-form') + ':' + (f.getAttribute('data-id') || '') + ':' + (f.getAttribute('data-termin') || ''); }
  function merkeFormulare() {
    var gemerkt = {};
    document.querySelectorAll('form[data-form]').forEach(function (f) {
      var w = {};
      Array.prototype.forEach.call(f.elements, function (el) {
        if (!el.name) return;
        if (el.type === 'checkbox') w[el.name + '=' + el.value] = el.checked;
        else w[el.name] = el.value;
      });
      gemerkt[formSchluessel(f)] = w;
    });
    return gemerkt;
  }
  // Kommt eine Antwort vom Server, während jemand tippt, bleiben Cursor und Markierung erhalten.
  function merkeFokus() {
    var el = document.activeElement;
    if (!el || !el.name || !el.form || !el.form.getAttribute('data-form')) return null;
    var f = { form: formSchluessel(el.form), name: el.name, start: null, ende: null };
    try { f.start = el.selectionStart; f.ende = el.selectionEnd; } catch (e) { /* z. B. Datumsfeld */ }
    return f;
  }
  function stelleFokusWiederHer(f) {
    if (!f) return;
    var forms = document.querySelectorAll('form[data-form]');
    for (var i = 0; i < forms.length; i++) {
      if (formSchluessel(forms[i]) !== f.form) continue;
      var el = forms[i].elements[f.name];
      if (!el || el === document.activeElement) return;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      if (f.start !== null) { try { el.setSelectionRange(f.start, f.ende); } catch (e) { /* egal */ } }
      return;
    }
  }

  function stelleFormulareWiederHer(gemerkt) {
    document.querySelectorAll('form[data-form]').forEach(function (f) {
      var w = gemerkt[formSchluessel(f)];
      if (!w) return;
      Array.prototype.forEach.call(f.elements, function (el) {
        if (!el.name) return;
        var k = el.type === 'checkbox' ? el.name + '=' + el.value : el.name;
        if (!Object.prototype.hasOwnProperty.call(w, k)) return;
        if (el.type === 'checkbox') el.checked = !!w[k];
        else el.value = w[k];
      });
    });
  }

  // =====================================================================
  // Meldungen
  // =====================================================================

  var meldungTimer = null;
  // rueckgaengig: ID einer Eintragung (wird wieder gelöscht) oder { aktion, id } für einen anderen Knopf
  function zeigeMeldung(text, istFehler, rueckgaengig) {
    var el = document.getElementById('meldung');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    if (rueckgaengig) {
      if (typeof rueckgaengig === 'string') rueckgaengig = { aktion: 'rueckgaengig', id: rueckgaengig };
      var b = document.createElement('button');
      b.className = 'link';
      b.textContent = 'Rückgängig';
      b.setAttribute('data-aktion', rueckgaengig.aktion);
      b.setAttribute('data-id', rueckgaengig.id);
      el.appendChild(b);
    }
    el.className = 'meldung' + (istFehler ? ' fehler' : '');
    el.hidden = false;
    clearTimeout(meldungTimer);
    meldungTimer = setTimeout(function () { el.hidden = true; }, istFehler ? 7000 : rueckgaengig ? 6000 : 3500);
  }

  // =====================================================================
  // Laden und Senden
  // =====================================================================

  // Google braucht pro Anfrage 1–3 Sekunden. Damit die Seite trotzdem sofort reagiert:
  // - Änderungen wie Eintragen/Absagen werden gleich angezeigt („ausstehend“) und
  //   verschwinden wieder, falls der Server sie ablehnt.
  // - Der letzte Stand wird im Browser gemerkt und beim Öffnen sofort gezeigt.
  var basis = null;
  var ausstehend = [];
  var tmpZaehler = 0;
  var STAND = 'helferliste.stand';

  function vollstaendig(d) {
    d = d || {};
    ['Termine', 'Schichten', 'Aufgaben', 'Eintragungen', 'Abstimmungen', 'Optionen', 'Stimmen'].forEach(function (t) {
      if (!Array.isArray(d[t])) d[t] = [];
    });
    return d;
  }

  function setzeDaten(daten, merken) {
    basis = vollstaendig(daten);
    if (merken && !backend.demo) merke('localStorage', STAND, JSON.stringify({ api: KONF.api, daten: basis }));
    zeigeStand();
  }

  function zeigeStand() {
    var d = basis;
    if (ausstehend.length) {
      d = JSON.parse(JSON.stringify(basis));
      ausstehend.forEach(function (a) { a.anwenden(d); });
    }
    z.daten = d;
    z.sicht = aufbereiten(d);
    document.body.setAttribute('data-ausstehend', String(ausstehend.length));
  }

  // „Rückgängig“ soll immer nur die zuletzt angeklickte Aktion betreffen, auch wenn
  // Antworten auf frühere Klicks später eintreffen.
  var letzteAktion = 0;
  function neueAktion() { return ++letzteAktion; }
  function istLetzte(nr) { return nr === letzteAktion; }

  function gemerkterStand() {
    if (backend.demo) return;
    try {
      var s = JSON.parse(lies('localStorage', STAND) || 'null');
      if (s && s.api === KONF.api && s.daten) setzeDaten(s.daten, false);
    } catch (e) { /* egal */ }
  }

  function tmpId() { return 'tmp-' + (++tmpZaehler); }
  function istTmp(id) { return /^tmp-/.test(id || ''); }

  // Änderung sofort anzeigen und im Hintergrund senden
  // a.letzte: ob diese Aktion noch die zuletzt angeklickte ist (nur dann Erfolgsmeldung)
  function sofort(anwenden, anfrage) {
    var nr = neueAktion();
    var eintrag = { anwenden: anwenden };
    ausstehend.push(eintrag);
    zeigeStand();
    render();
    return senden(anfrage, null, eintrag).then(function (a) {
      a.letzte = istLetzte(nr);
      if (a.ok && a.letzte) zeigeMeldung(a.meldung);
      return a;
    });
  }

  function eintragenSofort(bezug, name, notiz) {
    sofort(function (d) {
      d.Eintragungen.push({ id: tmpId(), bezug: bezug, name: name, notiz: notiz || '', fuer: '', zeitpunkt: new Date().toISOString() });
    }, { aktion: 'eintragen', bezug: bezug, name: name, notiz: notiz || '' }).then(function (a) {
      if (a.ok && a.letzte) {
        var neu = z.daten.Eintragungen.filter(function (x) { return x.bezug === bezug && gleicherName(x.name, name); })[0];
        if (neu) zeigeMeldung(a.meldung, false, neu.id);
      }
      render();
    });
  }

  function austragenSofort(id) {
    sofort(function (d) {
      d.Eintragungen = d.Eintragungen.filter(function (e) { return e.id !== id; });
    }, { aktion: 'austragen', id: id }).then(render);
  }

  function stimmeSofort(optionId, name) {
    sofort(function (d) {
      d.Stimmen.push({ id: tmpId(), option_id: optionId, name: name, zeitpunkt: new Date().toISOString() });
    }, { aktion: 'abstimmen', option_id: optionId, name: name }).then(render);
  }

  function laden(still) {
    return backend.lesen().then(function (a) {
      if (a.daten) { setzeDaten(a.daten, true); z.ladefehler = ''; z.version = a.version || 1; }
      else if (!a.ok) throw new Error(a.fehler || 'unbekannter Fehler');
      render();
    }).catch(function (e) {
      if (!still || !z.sicht) { z.ladefehler = e.message; render(); }
    });
  }

  function senden(anfrage, knopf, eintrag) {
    if (knopf) { knopf.disabled = true; knopf.setAttribute('data-text', knopf.textContent); knopf.textContent = '…'; }
    return backend.senden(anfrage).catch(function (e) {
      return { ok: false, fehler: e.message };
    }).then(function (a) {
      if (knopf) { knopf.disabled = false; knopf.textContent = knopf.getAttribute('data-text'); }
      if (eintrag) ausstehend.splice(ausstehend.indexOf(eintrag), 1);
      if (a.daten) { setzeDaten(a.daten, true); z.version = a.version || 1; }
      else if (eintrag) zeigeStand();
      if (!a.ok && a.fehler === 'Unbekannte Aktion.') {
        a.fehler = 'Dafür muss zuerst die neue Code.gs in Apps Script eingefügt und neu bereitgestellt werden (siehe Anleitung).';
      }
      if (!a.ok && anfrage.passwort && /Falsches Passwort|gesperrt/.test(a.fehler || '')) abmelden();
      // Fehler immer zeigen; Erfolg bei sofort angezeigten Änderungen entscheidet sofort()
      if (!a.ok) zeigeMeldung(a.fehler, true);
      else if (!eintrag) zeigeMeldung(a.meldung);
      return a;
    });
  }

  function verwalten(anfrage, knopf) {
    anfrage.passwort = z.passwort;
    return senden(anfrage, knopf);
  }

  function abmelden() {
    z.passwort = '';
    merke('sessionStorage', 'helferliste.passwort', '');
  }

  function oeffne(offen, fokusSelektor) {
    z.offen = offen;
    render();
    var el = document.querySelector(fokusSelektor || 'form[data-form] input:not([type=hidden])');
    if (el) {
      el.focus();
      var r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' });
    }
  }

  // =====================================================================
  // Teilen und Kalender
  // =====================================================================

  function seitenLink(anker) {
    return location.href.split('#')[0] + (anker ? '#' + anker : '');
  }

  // Freie Plätze beim direkten Eintragen (0 = keine, Infinity = beliebig viele)
  function direktFrei(t) {
    if (t.plaetze === '' || istVorbei(t)) return 0;
    return freiePlaetze({ anzahl: t.plaetze, leute: t.leute });
  }

  function teilenText(termine, einzeln) {
    var zeilen = [];
    termine.forEach(function (t) {
      var offen = t.schichten.filter(function (s) { return s.tag >= heute() && freiePlaetze(s) > 0; });
      var frei = direktFrei(t);
      if (!einzeln && !offen.length && !frei) return;
      var mehrtaegig = einzigartig(t.schichten.map(function (s) { return s.tag; })).length > 1;
      var uhr = uhrText(t);
      zeilen.push('*' + t.titel + '*');
      zeilen.push(zeitraum(t.von, t.bis) + (uhr ? ', ' + uhr : '') + (t.ort ? ', ' + t.ort : ''));
      if (frei) zeilen.push(frei === Infinity ? 'Jeder ist willkommen – bitte eintragen.' : 'Noch ' + frei + (frei === 1 ? ' Platz' : ' Plätze') + ' frei.');
      else if (t.plaetze !== '' && !t.schichten.length) zeilen.push('Alle Plätze sind belegt – danke!');
      if (offen.length) {
        zeilen.push('Noch gesucht:');
        // eine Zeile pro Station, in der Reihenfolge wie auf der Seite
        t.stationen.forEach(function (station) {
          var hier = offen.filter(function (s) { return s.station === station; });
          if (!hier.length) return;
          var teile = hier.map(function (s) {
            var frei = freiePlaetze(s);
            var wann = ((mehrtaegig ? WT[alsDatum(s.tag).getDay()] + ' ' : '') + zeitText(s)).trim();
            return (wann ? wann + ' ' : '') + '(' + (frei === Infinity ? 'gern noch mehr' : frei + ' frei') + ')';
          });
          zeilen.push('• ' + (station || 'Helfer') + ': ' + teile.join(', '));
        });
      } else if (t.schichten.length) {
        zeilen.push('Alle Schichten sind besetzt – danke!');
      }
      zeilen.push('');
    });
    zeilen.push((einzeln ? 'Eintragen: ' : 'Hier eintragen: ') + seitenLink(einzeln ? 't-' + termine[0].id : 'termine'));
    return zeilen.join('\n');
  }

  function teilen(text) {
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  function icsText(t) {
    return String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsFalten(zeile) {
    var teile = [];
    while (zeile.length > 72) { teile.push(zeile.slice(0, 72)); zeile = ' ' + zeile.slice(72); }
    teile.push(zeile);
    return teile.join('\r\n');
  }
  function icsZeitpunkt(tag, zeit) { return tag.replace(/-/g, '') + 'T' + zeit.replace(':', '') + '00'; }
  function plusStunde(zeit) {
    var h = parseInt(zeit, 10) + 1;
    return h >= 24 ? null : zz(h) + zeit.slice(2);
  }

  // eintraege: [{ uid, titel, ort, info, tag, bisTag, von, bis }]
  function icsHerunterladen(eintraege, dateiname) {
    var stempel = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    var z2 = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jahresplan//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsText(KONF.titel || 'Jahresplan')];
    eintraege.forEach(function (e) {
      z2.push('BEGIN:VEVENT', 'UID:' + e.uid + '@helferliste', 'DTSTAMP:' + stempel);
      if (e.von) {
        var endeTag = e.tag, endeZeit = e.bis || plusStunde(e.von);
        if (!endeZeit) { endeZeit = '23:59'; }
        if (e.bis && e.bis <= e.von) endeTag = plusTage(e.tag, 1);
        z2.push('DTSTART:' + icsZeitpunkt(e.tag, e.von), 'DTEND:' + icsZeitpunkt(endeTag, endeZeit));
      } else {
        z2.push('DTSTART;VALUE=DATE:' + e.tag.replace(/-/g, ''),
          'DTEND;VALUE=DATE:' + plusTage(e.bisTag || e.tag, 1).replace(/-/g, ''));
      }
      z2.push('SUMMARY:' + icsText(e.titel));
      if (e.ort) z2.push('LOCATION:' + icsText(e.ort));
      if (e.info) z2.push('DESCRIPTION:' + icsText(e.info));
      if (e.kategorie) z2.push('CATEGORIES:' + icsText(e.kategorie));
      z2.push('END:VEVENT');
    });
    z2.push('END:VCALENDAR');
    var blob = new Blob([z2.map(icsFalten).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = dateiname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function icsTermin(t) {
    icsHerunterladen([icsEintrag(t)], dateiname(t.titel));
  }

  // Termine ab Stichtag, wahlweise ohne „Jugend extern“
  function kalenderAuswahl(ab, ohneExtern) {
    return z.sicht.termine.filter(function (t) {
      return t.von && (t.bis || t.von) >= ab && !(ohneExtern && t.extern) && fuerMich(t);
    });
  }

  function kalenderFormular() {
    var gibtExtern = z.sicht.termine.some(function (t) { return t.extern; });
    var ab = heute();
    var ohne = z.externAus;
    var n = kalenderAuswahl(ab, ohne).length;
    return '<form class="kasten" data-form="kalender">' +
      '<h3>Termine in den Kalender übernehmen</h3>' +
      '<div class="reihe"><label>Ab<input type="date" name="ab" required value="' + esc(ab) + '"></label><span class="lueckenfueller"></span></div>' +
      (gibtExtern ? '<label class="haken-zeile extern-haken"><input type="checkbox" name="ohne_extern"' + (ohne ? ' checked' : '') + '> ohne „' + EXTERN + '“</label>' : '') +
      (profilAktiv() ? '<p class="tipp">Nur Termine für: ' + esc(z.profil.join(', ')) + ' (deine Auswahl oben).</p>' : '') +
      '<p class="tipp">Lädt eine Kalenderdatei (.ics) herunter. Am Handy einfach öffnen, bei Google Kalender am Computer unter ' +
      '„Einstellungen → Importieren“. Spätere Änderungen kommen nicht automatisch mit – dann die Datei neu herunterladen.</p>' +
      '<div class="knoepfe"><button type="submit" class="haupt">' + kalenderKnopf(n) + '</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
  }
  function kalenderKnopf(n) { return n === 1 ? '1 Termin herunterladen' : n + ' Termine herunterladen'; }

  // =====================================================================
  // Termine aus einer Vorlage übernehmen (Verwaltung)
  // =====================================================================

  function vorlagenListe() {
    return (Array.isArray(KONF.vorlagen) ? KONF.vorlagen : []).filter(function (v) { return v && v.datei; });
  }

  function ladeVorlage(datei) {
    if (z.vorlage && z.vorlage.datei === datei && !z.vorlage.fehler) return;
    z.vorlage = { datei: datei, laden: true };
    fetch(datei, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('Datei ' + datei + ' nicht gefunden.'); return r.json(); })
      .then(function (d) {
        if (!z.vorlage || z.vorlage.datei !== datei) return;
        z.vorlage = { datei: datei, daten: { titel: d.titel || '', beschreibung: d.beschreibung || '', hinweise: d.hinweise || [],
          termine: Array.isArray(d.termine) ? d.termine : [], aufgaben: Array.isArray(d.aufgaben) ? d.aufgaben : [] } };
        render();
      })
      .catch(function (e) {
        if (!z.vorlage || z.vorlage.datei !== datei) return;
        z.vorlage = { datei: datei, fehler: e.message === 'Failed to fetch' ? 'Vorlage konnte nicht geladen werden.' : e.message };
        render();
      });
  }

  // für den Vergleich: Kleinbuchstaben, nur Buchstaben und Ziffern
  function titelKern(t) {
    return String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  }
  // Gibt es den Termin schon (gleicher Tag, Titel gleich oder einer im anderen enthalten)?
  function schonDa(v) {
    var k = titelKern(v.titel);
    return z.daten.Termine.filter(function (t) {
      if (t.datum !== v.datum) return false;
      var k2 = titelKern(t.titel);
      return k2 === k || (k.length >= 4 && k2.length >= 4 && (k.indexOf(k2) >= 0 || k2.indexOf(k) >= 0));
    })[0] || null;
  }
  function aufgabeSchonDa(g) {
    var k = titelKern(g.titel);
    return z.daten.Aufgaben.some(function (a) { return !a.eltern_id && !a.erledigt && titelKern(a.titel) === k; });
  }

  // Zustand jeder Zeile der Vorlage: vorbei, schon da oder neu
  function vorlageStand(d) {
    var termine = d.termine.map(function (v) {
      var da = schonDa(v);
      var vorbei = (v.bis_datum || v.datum) < heute();
      return { v: v, da: da, vorbei: vorbei, vorwahl: !da && !vorbei };
    });
    var aufgaben = d.aufgaben.map(function (g) {
      var t = termine.filter(function (x) { return g.termin && x.v.key === g.termin; })[0] || null;
      var da = aufgabeSchonDa(g);
      return { g: g, t: t, da: da, vorwahl: !da && !(t && t.vorbei) };
    });
    return { termine: termine, aufgaben: aufgaben };
  }

  function fuerText(w) {
    var l = zgListe(w);
    return l.length ? zgKurz(l).join(', ') : 'alle';
  }

  // Erklärt, wie „ab …“ gerade aufgelöst wird, und warnt bei Namen, die in config.js fehlen
  function vorlageGruppenHtml(d) {
    var namen = [];
    d.termine.concat(d.aufgaben).forEach(function (x) {
      String(x.zielgruppen || '').split(',').forEach(function (n) {
        n = n.trim();
        if (n && !namen.some(function (y) { return istGleich(y, n); })) namen.push(n);
      });
    });
    var ab = [], fehlt = [];
    namen.forEach(function (n) {
      if (/^ab\s+/i.test(n)) {
        var i = abGruppe(n);
        if (i < 0) fehlt.push(n.replace(/^ab\s+/i, ''));
        else ab.push('<strong>' + esc(n) + '</strong> = ' + esc(ZG.gruppen.slice(i).join(', ')));
      } else if (!ZG.alle.some(function (b) { return istGleich(b, n); })) {
        fehlt.push(n);
      }
    });
    var h = '';
    if (ZG.gruppen.length) {
      h += '<p class="tipp">Reihenfolge der Gruppen in config.js (jung → alt): ' + esc(ZG.gruppen.join(' → ')) + '. ' +
        'Daraus ergibt sich: ' + (ab.length ? ab.join(' · ') : '–') +
        '. Stimmt die Reihenfolge nicht, einfach in config.js ändern – die Termine passen sich dann von selbst an.</p>';
    }
    if (fehlt.length) {
      h += '<p class="warnung">Nicht in config.js eingetragen: ' + esc(fehlt.join(', ')) +
        '. Solche Termine sieht nur, wer „Alles anzeigen“ gewählt hat. Bitte in config.js ergänzen.</p>';
    }
    return h;
  }

  function importKnopf(nT, nA) {
    if (!nT && !nA) return 'Nichts ausgewählt';
    var teile = [];
    if (nT) teile.push(nT === 1 ? '1 Termin' : nT + ' Termine');
    if (nA) teile.push(nA === 1 ? '1 Aufgabe' : nA + ' Aufgaben');
    return teile.join(' und ') + ' übernehmen';
  }

  function importHtml() {
    var liste = vorlagenListe();
    var datei = (z.vorlage && z.vorlage.datei) || (liste[0] || {}).datei || '';
    // data-id: je Vorlage eigene Häkchen beim Neuzeichnen
    var h = '<form class="kasten import" data-form="import" data-id="' + esc(datei) + '"><h3>Termine aus einer Vorlage übernehmen</h3>';
    if (!liste.length) {
      return h + '<p class="tipp">In config.js ist keine Vorlage eingetragen (vorlagen).</p>' +
        '<div class="knoepfe"><button type="button" data-aktion="schliessen">Schließen</button></div></form>';
    }
    if (liste.length > 1) {
      h += '<label>Vorlage<select name="vorlage">' + liste.map(function (v) {
        return '<option value="' + esc(v.datei) + '"' + (v.datei === datei ? ' selected' : '') + '>' + esc(v.titel || v.datei) + '</option>';
      }).join('') + '</select></label>';
    }
    var v = z.vorlage;
    if (!v || v.datei !== datei || v.laden) {
      return h + '<p class="leer">Lade Vorlage …</p><div class="knoepfe"><button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
    }
    if (v.fehler) {
      return h + '<p class="warnung">' + esc(v.fehler) + '</p><div class="knoepfe"><button type="button" data-aktion="schliessen">Schließen</button></div></form>';
    }
    var d = v.daten;
    var st = vorlageStand(d);
    h += (d.titel ? '<p><strong>' + esc(d.titel) + '</strong>' + (d.beschreibung ? '<br><span class="leise">' + esc(d.beschreibung) + '</span>' : '') + '</p>' : '');
    if (d.hinweise.length) {
      h += '<details class="vorlage-hinweise"><summary>So wurde übertragen</summary><ul>' +
        d.hinweise.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    }
    h += vorlageGruppenHtml(d);
    h += veraltetHinweis(6, 'Der Import wird');
    h += '<p class="tipp">Häkchen weg bei allem, was nicht übernommen werden soll. Was schon im Jahresplan steht, ist abgewählt. ' +
      'Alles lässt sich danach wie gewohnt bearbeiten.</p>';

    // Termine, nach Monaten
    h += '<div class="import-kopf"><h4>Termine</h4><span><button type="button" class="link" data-aktion="import-alle" data-id="t">alle</button>' +
      '<span class="trenn"> · </span><button type="button" class="link" data-aktion="import-keine" data-id="t">keine</button></span></div>';
    h += '<table class="import-liste"><tbody>';
    var monat = '';
    st.termine.forEach(function (x, i) {
      var t = x.v;
      var m = t.datum.slice(0, 7);
      if (m !== monat) {
        monat = m;
        h += '<tr class="monat"><th colspan="4">' + MONAT[+m.slice(5) - 1] + ' ' + m.slice(0, 4) + '</th></tr>';
      }
      // Wochentag und Datum bleiben zusammen, umbrochen wird nur nach dem Strich
      var nb = function (x) { return datumKurz(x).replace(/ /g, '\u00a0'); };
      var wann = nb(t.datum) + (t.bis_datum ? '–' + nb(t.bis_datum) : '');
      var zeit = String(t.zeit || '').replace(/\s*-\s*/, '–');
      var stand = x.da ? '<span class="etikett">schon im Plan' + (x.da.titel !== t.titel ? ': „' + esc(x.da.titel) + '“' : '') + '</span>'
        : x.vorbei ? '<span class="etikett">vorbei</span>' : '';
      h += '<tr' + (x.vorwahl ? '' : ' class="leise"') + '><td class="haken"><input type="checkbox" name="nimm" value="t' + i + '"' +
        (x.vorwahl ? ' checked' : '') + ' aria-label="' + esc(t.titel) + ' übernehmen"></td>' +
        '<td class="wann">' + esc(wann) + (zeit ? '<br><span class="leise">' + esc(zeit) + '</span>' : '') + '</td>' +
        '<td><strong>' + esc(t.titel) + '</strong>' + (istExtern(t) ? ' <span class="etikett">' + EXTERN + '</span>' : '') + ' ' + stand +
        (t.info ? '<div class="leise klein">' + esc(t.info) + '</div>' : '') +
        '<div class="leise klein fuer-unten">' + esc(fuerSatz(fuerText(t.zielgruppen))) + '</div></td>' +
        '<td class="fuer-spalte">' + esc(fuerText(t.zielgruppen)) + '</td></tr>';
    });
    h += '</tbody></table>';

    if (st.aufgaben.length) {
      h += '<div class="import-kopf"><h4>Aufgaben</h4><span><button type="button" class="link" data-aktion="import-alle" data-id="a">alle</button>' +
        '<span class="trenn"> · </span><button type="button" class="link" data-aktion="import-keine" data-id="a">keine</button></span></div>';
      h += '<table class="import-liste"><tbody>';
      st.aufgaben.forEach(function (x, i) {
        var g = x.g;
        var unter = Array.isArray(g.unter) ? g.unter : [];
        var zu = x.t ? 'zu „' + x.t.v.titel + '“ am ' + datumKurz(x.t.v.datum) : '';
        h += '<tr' + (x.vorwahl ? '' : ' class="leise"') + '><td class="haken"><input type="checkbox" name="nimm" value="a' + i + '"' +
          (x.vorwahl ? ' checked' : '') + ' aria-label="' + esc(g.titel) + ' übernehmen"></td>' +
          '<td><strong>' + esc(g.titel) + '</strong>' + (x.da ? ' <span class="etikett">schon vorhanden</span>' : '') +
          (zu ? '<div class="leise klein">' + esc(zu) + '</div>' : '') +
          (unter.length ? '<details class="klein"><summary>' + unter.length + (unter.length === 1 ? ' Unteraufgabe' : ' Unteraufgaben') + '</summary>' +
            '<ul>' + unter.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></details>' : '') +
          '<div class="leise klein fuer-unten">' + esc(fuerSatz(fuerText(g.zielgruppen))) + '</div></td>' +
          '<td class="fuer-spalte">' + esc(fuerText(g.zielgruppen)) + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    var nT = st.termine.filter(function (x) { return x.vorwahl; }).length;
    var nA = st.aufgaben.filter(function (x) { return x.vorwahl; }).length;
    h += '<div class="knoepfe"><button type="submit" class="haupt">' + importKnopf(nT, nA) + '</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
    return h;
  }

  // Knopftext an die Häkchen anpassen
  function importVorschau(f) {
    var nT = 0, nA = 0;
    f.querySelectorAll('input[name=nimm]').forEach(function (b) {
      if (b.checked) { if (b.value.charAt(0) === 't') nT++; else nA++; }
      var zeile = b.closest('tr');
      if (zeile) zeile.classList.toggle('leise', !b.checked);
    });
    f.querySelector('button[type=submit]').textContent = importKnopf(nT, nA);
  }

  function importAbsenden(f, knopf) {
    var d = z.vorlage && z.vorlage.daten;
    if (!d) return;
    var st = vorlageStand(d);
    var gewaehlt = {};
    f.querySelectorAll('input[name=nimm]').forEach(function (b) { if (b.checked) gewaehlt[b.value] = true; });
    var termine = [], schluessel = {};
    st.termine.forEach(function (x, i) {
      if (!gewaehlt['t' + i]) return;
      var t = x.v;
      termine.push({ key: t.key || '', titel: t.titel, datum: t.datum, bis_datum: t.bis_datum || '', zeit: t.zeit || '',
        ort: t.ort || '', info: t.info || '', plaetze: t.plaetze == null ? '' : String(t.plaetze), kategorie: t.kategorie || '',
        zielgruppen: t.zielgruppen || '' });
      if (t.key) schluessel[t.key] = true;
    });
    var aufgaben = [];
    st.aufgaben.forEach(function (x, i) {
      if (!gewaehlt['a' + i]) return;
      var g = x.g;
      var a = { titel: g.titel, info: g.info || '', frist: g.frist || '', anzahl: g.anzahl || '', zielgruppen: g.zielgruppen || '',
        unter: Array.isArray(g.unter) ? g.unter : [] };
      // zum mit übernommenen Termin – oder zu dem, der schon im Plan steht
      if (g.termin && schluessel[g.termin]) a.termin = g.termin;
      else if (x.t && x.t.da) a.termin_id = x.t.da.id;
      aufgaben.push(a);
    });
    if (!termine.length && !aufgaben.length) { zeigeMeldung('Nichts ausgewählt.', true); return; }
    verwalten({ aktion: 'importieren', termine: termine, aufgaben: aufgaben }, knopf).then(function (a) {
      if (a.ok) { z.offen = null; window.scrollTo(0, 0); }
      render();
    });
  }

  function icsEintrag(t) {
    var mitZeit = t.schichten.filter(function (s) { return s.von; });
    var eintrag = { uid: t.id, titel: t.titel, ort: t.ort, info: (t.info ? t.info + '\n\n' : '') + seitenLink('t-' + t.id), tag: t.von, bisTag: t.bis, kategorie: t.kategorie };
    if (t.von === t.bis && t.uhrVon) {
      eintrag.von = t.uhrVon;
      eintrag.bis = t.uhrBis;
    } else if (t.von === t.bis && mitZeit.length) {
      eintrag.von = mitZeit.map(function (s) { return s.von; }).sort()[0];
      var enden = mitZeit.map(function (s) { return s.bis; }).filter(Boolean).sort();
      eintrag.bis = enden[enden.length - 1] || '';
    }
    return eintrag;
  }

  function icsMeine() {
    var liste = meineEintraege().filter(function (m) { return m.termin && m.termin.von; }).map(function (m) {
      var t = m.termin;
      if (!m.schicht) {
        // direkt beim Termin: einzelner Tag mit Uhrzeit, sonst ganztägig über alle Tage
        var einTag = t.von === t.bis;
        return {
          uid: m.e.id, titel: t.titel, ort: t.ort, info: (t.info ? t.info + '\n\n' : '') + seitenLink('t-' + t.id),
          tag: t.von, bisTag: t.bis, von: einTag ? t.uhrVon : '', bis: einTag ? t.uhrBis : ''
        };
      }
      var s = m.schicht;
      return {
        uid: m.e.id, titel: t.titel + (s.station ? ': ' + s.station : ''),
        ort: t.ort, info: (s.info ? s.info + '\n\n' : '') + seitenLink('t-' + t.id),
        tag: s.tag, von: s.von, bis: s.bis
      };
    });
    icsHerunterladen(liste, 'meine-termine.ics');
  }

  function dateiname(titel) {
    return (String(titel).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'termin') + '.ics';
  }

  // =====================================================================
  // Klicks und Formulare
  // =====================================================================

  function finde(liste, id) {
    for (var i = 0; i < liste.length; i++) if (liste[i].id === id) return liste[i];
    return null;
  }

  function klick(ev) {
    var el = ev.target.closest('[data-aktion]');
    if (!el) return;
    var aktion = el.getAttribute('data-aktion');
    var id = el.getAttribute('data-id') || '';
    ev.preventDefault();

    switch (aktion) {
      case 'eintragen':
        oeffne({ art: 'eintragen', id: el.getAttribute('data-bezug') },
          z.name ? 'form[data-form=eintragen] input[name=notiz]' : 'form[data-form=eintragen] input[name=name]');
        break;

      case 'schnell-eintragen':
        eintragenSofort(el.getAttribute('data-bezug'), z.name, '');
        break;

      case 'weitere':
        oeffne({ art: 'eintragen', id: el.getAttribute('data-bezug'), weitere: true }, 'form[data-form=eintragen] input[name=name]');
        break;

      case 'rueckgaengig':
        zeigeMeldung('');
        austragenSofort(id);
        break;

      case 'stimmen':
        stimmeSofort(el.getAttribute('data-option'), z.name);
        break;

      case 'stimmen-name':
        oeffne({ art: 'stimmen', id: el.getAttribute('data-option') }, 'form[data-form=stimmen] input[name=name]');
        break;

      case 'stimme-weg':
        if (istTmp(id)) return;
        sofort(function (d) {
          d.Stimmen = d.Stimmen.filter(function (v) { return v.id !== id; });
        }, { aktion: 'stimme_entfernen', id: id }).then(render);
        break;

      case 'teilen-abstimmung': {
        var pt = finde(z.sicht.abstimmungen, id);
        if (pt) teilen(abstimmungText(pt));
        break;
      }

      case 'abstimmung-neu':
        oeffne({ art: 'abstimmung', id: '', zeilen: 3 }, 'form[data-form=abstimmung] input[name=titel]');
        break;

      case 'abstimmung-bearbeiten':
        oeffne({ art: 'abstimmung', id: id, zeilen: 1 }, 'form[data-form=abstimmung] input[name=titel]');
        break;

      case 'option-zeile': {
        var n = (z.offen && z.offen.zeilen) || 1;
        z.offen.zeilen = n + 1;
        render();
        var neuesFeld = document.querySelector('form[data-form=abstimmung] input[name=odatum_' + n + ']');
        if (neuesFeld) neuesFeld.focus();
        break;
      }

      case 'abstimmung-loeschen': {
        var pl = finde(z.sicht.abstimmungen, id);
        if (!pl || !window.confirm('Abstimmung „' + pl.titel + '“ mit allen Stimmen löschen?')) return;
        verwalten({ aktion: 'abstimmung_loeschen', id: id }, el).then(render);
        break;
      }

      case 'option-loeschen': {
        var ol = finde(z.daten.Optionen, id);
        var stimmenAnzahl = z.daten.Stimmen.filter(function (v) { return v.option_id === id; }).length;
        var ofrage = (ol ? datumLang(ol.datum) + (ol.von ? ', ' + ol.von : '') : 'Auswahl') + ' aus der Abstimmung löschen?';
        if (stimmenAnzahl) ofrage += '\n' + stimmenAnzahl + (stimmenAnzahl === 1 ? ' Stimme geht' : ' Stimmen gehen') + ' verloren.';
        if (!window.confirm(ofrage)) return;
        verwalten({ aktion: 'option_loeschen', id: id }, el).then(render);
        break;
      }

      case 'festlegen': {
        var of = finde(z.daten.Optionen, el.getAttribute('data-option'));
        if (!of || !window.confirm('Termin auf ' + datumLang(of.datum) + (of.von ? ', ' + of.von + ' Uhr' : '') +
          ' festlegen?\nDie Abstimmung ist damit beendet.')) return;
        verwalten({ aktion: 'abstimmung_festlegen', id: id, option_id: of.id }, el).then(function (a) {
          if (a.ok) z.springeZu = 't-' + a.id;
          render();
        });
        break;
      }

      case 'name-aendern':
        oeffne({ art: 'name' }, 'form[data-form=name] input');
        break;

      case 'austragen': {
        var e = finde(z.daten.Eintragungen, id);
        if (!e) return;
        var frage = ich(e.name) ? 'Wirklich absagen?' : e.name + ' austragen?';
        if (e.fuer) frage += '\n' + e.fuer;
        if (!window.confirm(frage)) return;
        austragenSofort(id);
        break;
      }

      case 'schliessen':
        z.offen = null;
        render();
        break;

      case 'vergangene':
        z.vergangene = !z.vergangene;
        render();
        break;

      case 'teilen': {
        var t = finde(z.sicht.termine, id);
        if (t) teilen(teilenText([t], true));
        break;
      }

      case 'teilen-alle':
        teilen(teilenText(sichtbareTermine(), false));
        break;

      case 'ics-termin': {
        var t2 = finde(z.sicht.termine, id);
        if (t2) icsTermin(t2);
        break;
      }

      case 'ics-meine':
        icsMeine();
        break;

      case 'neu-laden':
        z.ladefehler = '';
        render();
        laden();
        break;

      case 'login':
        oeffne({ art: 'login' }, 'form[data-form=login] input');
        break;

      case 'abmelden':
        abmelden();
        z.offen = null;
        render();
        break;

      case 'demo-reset':
        if (!window.confirm('Alle Demo-Daten in diesem Browser zurücksetzen?')) return;
        backend.zuruecksetzen();
        laden();
        break;

      case 'termin-neu':
        oeffne({ art: 'termin', id: '' });
        break;

      case 'termin-bearbeiten':
        oeffne({ art: 'termin', id: id });
        break;

      case 'termin-kopieren':
        oeffne({ art: 'kopieren', id: id }, 'form[data-form=kopieren] input');
        break;

      case 'termin-loeschen': {
        var t3 = finde(z.sicht.termine, id);
        if (!t3 || !window.confirm('„' + t3.titel + '“ mit allen Schichten und Eintragungen löschen?')) return;
        verwalten({ aktion: 'termin_loeschen', id: id }, el).then(render);
        break;
      }

      case 'schicht-neu':
        oeffne({ art: 'schicht', id: '', termin: el.getAttribute('data-termin') }, 'form[data-form=schicht] input[name=station]');
        break;

      case 'schicht-bearbeiten':
        oeffne({ art: 'schicht', id: id, termin: el.getAttribute('data-termin') }, 'form[data-form=schicht] input[name=station]');
        break;

      case 'schicht-loeschen': {
        var s = finde(z.daten.Schichten, id);
        var anzahl = z.daten.Eintragungen.filter(function (x) { return x.bezug === id; }).length;
        var text = 'Schicht ' + [s && s.station, s && zeitText(s)].filter(Boolean).join(' ') + ' löschen?';
        if (anzahl) text += '\n' + anzahl + (anzahl === 1 ? ' Eintragung wird' : ' Eintragungen werden') + ' mitgelöscht.';
        if (!window.confirm(text)) return;
        verwalten({ aktion: 'schicht_loeschen', id: id }, el).then(render);
        break;
      }

      case 'aufgabe-neu':
        oeffne({ art: 'aufgabe', id: '' });
        break;

      case 'aufgabe-bearbeiten':
        oeffne({ art: 'aufgabe', id: id });
        break;

      case 'aufgabe-loeschen': {
        var g = finde(z.sicht.aufgaben, id);
        if (!g) return;
        var gfrage = 'Aufgabe „' + g.titel + '“ löschen?';
        if (g.unter.length) gfrage += '\nAuch ' + (g.unter.length === 1 ? 'die Unteraufgabe wird' : 'die ' + g.unter.length + ' Unteraufgaben werden') + ' gelöscht.';
        if (!window.confirm(gfrage)) return;
        verwalten({ aktion: 'aufgabe_loeschen', id: id }, el).then(render);
        break;
      }

      case 'unter-neu':
        oeffne({ art: 'unter', id: id }, 'form[data-form=unter] textarea');
        break;

      case 'unter-loeschen': {
        var ul = finde(z.daten.Aufgaben, id);
        if (!ul) return;
        var uAnzahl = z.daten.Eintragungen.filter(function (x) { return x.bezug === id; }).length;
        var ufrage = 'Unteraufgabe „' + ul.titel + '“ löschen?';
        if (uAnzahl) ufrage += '\n' + uAnzahl + (uAnzahl === 1 ? ' Eintragung wird' : ' Eintragungen werden') + ' mitgelöscht.';
        if (!window.confirm(ufrage)) return;
        verwalten({ aktion: 'aufgabe_loeschen', id: id }, el).then(render);
        break;
      }

      case 'abhaken': {
        var ga = finde(z.daten.Aufgaben, id);
        if (!ga) return;
        var nunErledigt = !ga.erledigt;
        var wer = z.name;
        zeigeMeldung('');
        sofort(function (d) {
          var x = finde(d.Aufgaben, id);
          if (x) { x.erledigt = nunErledigt ? heute() : ''; x.erledigt_von = nunErledigt ? wer : ''; }
        }, { aktion: 'abhaken', id: id, erledigt: nunErledigt, name: wer }).then(function (a) {
          if (a.ok && nunErledigt && a.letzte) zeigeMeldung(a.meldung, false, { aktion: 'abhaken', id: id });
          render();
        });
        break;
      }

      case 'erledigte':
        z.erledigteZeigen = !z.erledigteZeigen;
        render();
        break;

      case 'ansicht':
        z.ansicht = id === 'tabelle' ? 'tabelle' : 'liste';
        merke('localStorage', 'helferliste.ansicht', z.ansicht === 'tabelle' ? 'tabelle' : '');
        z.offen = null;
        render();
        break;

      case 'drucken':
        window.print();
        break;

      case 'extern-auf':
        if (z.aufgeklappt[id]) delete z.aufgeklappt[id]; else z.aufgeklappt[id] = true;
        if (z.trotzdem === id && !z.aufgeklappt[id]) z.trotzdem = '';
        render();
        // Beim Aufklappen den Termin im Blick behalten
        var sek = document.getElementById('t-' + id);
        if (sek && z.aufgeklappt[id]) {
          var r = sek.getBoundingClientRect();
          if (r.top < 0 || r.top > window.innerHeight - 80) sek.scrollIntoView({ block: 'start' });
        }
        break;

      case 'kalender':
        oeffne({ art: 'kalender' }, 'form[data-form=kalender] input[name=ab]');
        break;

      case 'profil-aendern':
        oeffne({ art: 'profil' }, 'form[data-form=profil] input');
        break;

      case 'profil-alles':
        setzeProfil([]);
        z.offen = null;
        render();
        zeigeMeldung('Du siehst jetzt alle Termine und Aufgaben.');
        break;

      case 'profil-link': {
        var pf = el.closest('form');
        var auswahl = pf ? fuerAuswahl(pf) : [];
        var link = location.origin + location.pathname + '?fuer=' + encodeURIComponent(auswahl.length ? auswahl.join(',') : 'alle');
        var fertigText = 'Link kopiert – er öffnet den Jahresplan für: ' + (auswahl.length ? auswahl.join(', ') : 'alle');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(function () { zeigeMeldung(fertigText); }, function () { zeigeMeldung(link); });
        } else {
          zeigeMeldung(link);
        }
        break;
      }

      case 'fuer-jugend':
      case 'fuer-keine': {
        var ff = el.closest('form');
        if (!ff) break;
        Array.prototype.forEach.call(ff.querySelectorAll('input[name=fuer]'), function (box) {
          var istGruppe = ZG.gruppen.some(function (n) { return istGleich(n, box.value); });
          if (aktion === 'fuer-keine') box.checked = false;
          else if (istGruppe) box.checked = true;
          else if (ZG.weitere.some(function (n) { return istGleich(n, box.value); })) box.checked = false;
        });
        break;
      }

      case 'aufgabe-dazu':
        oeffne({ art: 'aufgabe', id: '', termin: el.getAttribute('data-termin') }, 'form[data-form=aufgabe] input[name=titel]');
        break;

      case 'extern-filter':
        z.externAus = !z.externAus;
        z.trotzdem = '';
        merke('localStorage', 'helferliste.externAus', z.externAus ? '1' : '');
        render();
        break;

      case 'station-waehlen': {
        var sf = el.closest('form');
        if (sf) { sf.elements.station.value = el.getAttribute('data-wert'); sf.elements.station.focus(); }
        break;
      }

      case 'import': {
        var vl = vorlagenListe();
        if (vl.length) ladeVorlage((z.vorlage && z.vorlage.datei) || vl[0].datei);
        z.reiter = 'termine';
        z.ansicht = 'liste';
        if (location.hash && location.hash !== '#termine') history.replaceState(null, '', '#termine');
        z.offen = { art: 'import' };
        render();
        var kasten = document.querySelector('form[data-form=import]');
        if (kasten) kasten.scrollIntoView({ block: 'start' });
        break;
      }

      case 'team-aufgaben':
        z.teamAufgaben[id] = !z.teamAufgaben[id];
        render();
        break;

      case 'import-alle':
      case 'import-keine': {
        var imf = el.closest('form');
        if (!imf) break;
        imf.querySelectorAll('input[name=nimm]').forEach(function (b) {
          if (b.value.charAt(0) === id) b.checked = aktion === 'import-alle';
        });
        importVorschau(imf);
        break;
      }
    }
  }

  function absenden(ev) {
    var f = ev.target;
    var art = f.getAttribute('data-form');
    if (!art) return;
    ev.preventDefault();
    var id = f.getAttribute('data-id') || '';
    var knopf = f.querySelector('button[type=submit]');
    var w = {};
    Array.prototype.forEach.call(f.elements, function (el) { if (el.name) w[el.name] = el.value.trim(); });

    if (art === 'import') {
      importAbsenden(f, knopf);
    } else if (art === 'eintragen') {
      if (!w.name) return;
      // Beim Eintragen weiterer Personen bleibt der eigene gespeicherte Name unverändert.
      if (f.getAttribute('data-weitere') !== '1') {
        z.name = w.name;
        merke('localStorage', 'helferliste.name', w.name);
      }
      z.offen = null;
      eintragenSofort(id, w.name, w.notiz);
    } else if (art === 'stimmen') {
      if (!w.name) return;
      z.name = w.name;
      merke('localStorage', 'helferliste.name', w.name);
      z.offen = null;
      stimmeSofort(id, w.name);
    } else if (art === 'abstimmung') {
      var optionen = [];
      for (var i = 0; i < 100; i++) {
        if (!(('odatum_' + i) in w)) break;
        if (w['odatum_' + i] || w['ozeit_' + i]) optionen.push({ datum: w['odatum_' + i], von: w['ozeit_' + i] });
      }
      verwalten({ aktion: 'abstimmung_speichern', abstimmung: {
        id: id, titel: w.titel, ort: w.ort, info: w.info, frist: w.frist, optionen: optionen,
        zielgruppen: zielgruppenAus(f, id ? (finde(z.daten.Abstimmungen, id) || {}).zielgruppen : '')
      } }, knopf).then(function (a) {
        if (a.ok) { z.offen = null; z.springeZu = 'p-' + (id || a.id); }
        render();
      });
    } else if (art === 'profil') {
      setzeProfil(fuerAuswahl(f));
      z.offen = null;
      render();
      zeigeMeldung(z.profil.length ? 'Jahresplan für: ' + z.profil.join(', ') : 'Du siehst jetzt alle Termine und Aufgaben.');
    } else if (art === 'name') {
      z.name = w.name;
      merke('localStorage', 'helferliste.name', w.name);
      z.offen = null;
      render();
    } else if (art === 'login') {
      senden({ aktion: 'anmelden', passwort: w.passwort }, knopf).then(function (a) {
        if (a.ok) {
          z.passwort = w.passwort;
          merke('sessionStorage', 'helferliste.passwort', w.passwort);
          z.offen = null;
        }
        render();
      });
    } else if (art === 'kalender') {
      var auswahl = kalenderAuswahl(w.ab || heute(), !!(f.elements.ohne_extern && f.elements.ohne_extern.checked));
      if (!auswahl.length) { zeigeMeldung('Ab diesem Tag gibt es keine Termine.', true); return; }
      icsHerunterladen(auswahl.map(icsEintrag), 'termine-ab-' + (w.ab || heute()) + '.ics');
      z.offen = null;
      render();
      zeigeMeldung(kalenderKnopf(auswahl.length).replace('herunterladen', 'als Kalenderdatei gespeichert.'));
    } else if (art === 'termin') {
      w.id = id;
      w.zielgruppen = zielgruppenAus(f, id ? (finde(z.daten.Termine, id) || {}).zielgruppen : '');
      delete w.fuer; delete w.fuer_ab;
      // Häkchen „Direkt beim Termin eintragen“: Plätze (0 = beliebig) – ohne Häkchen leer
      w.plaetze = f.elements.direkt && f.elements.direkt.checked ? String(zahl(w.plaetze)) : '';
      delete w.direkt;
      // Kategorie: „Jugend extern“ an/aus, eine andere (künftige) Kategorie bleibt erhalten
      var bisher = id ? (finde(z.daten.Termine, id) || {}).kategorie || '' : '';
      w.kategorie = f.elements.extern && f.elements.extern.checked ? EXTERN : (istExtern({ kategorie: bisher }) ? '' : bisher);
      delete w.extern;
      if (w.kategorie === EXTERN) z.aufgeklappt[id] = true; // nach dem Speichern offen lassen
      verwalten({ aktion: 'termin_speichern', termin: w }, knopf).then(function (a) {
        if (a.ok) {
          z.offen = null;
          z.springeZu = 't-' + (id || a.id);
          if (!id && w.kategorie === EXTERN) z.aufgeklappt[a.id] = true;
        }
        render();
      });
    } else if (art === 'schicht') {
      w.id = id;
      w.termin_id = f.getAttribute('data-termin');
      var leeren = ['station', 'zeiten', 'info'];
      if (!id) {
        // Sofort leeren und Formular offen lassen: Die nächste Station kann man schon tippen,
        // während Google noch antwortet.
        leeren.forEach(function (n) { f.elements[n].value = ''; });
        f.elements.station.focus();
      }
      verwalten({ aktion: 'schicht_speichern', schicht: w }, knopf).then(function (a) {
        if (a.ok && id) z.offen = null;
        if (!a.ok && !id) {
          // Fehler: Eingaben zurückholen, falls inzwischen nichts Neues getippt wurde
          var form = document.querySelector('form[data-form=schicht][data-termin="' + w.termin_id + '"]');
          if (form && leeren.every(function (n) { return !form.elements[n].value; })) {
            leeren.forEach(function (n) { form.elements[n].value = w[n] || ''; });
          }
        }
        render();
      });
    } else if (art === 'kopieren') {
      verwalten({ aktion: 'termin_kopieren', id: id, datum: w.datum }, knopf).then(function (a) {
        if (a.ok) { z.offen = null; z.springeZu = 't-' + a.id; }
        render();
      });
    } else if (art === 'aufgabe') {
      w.id = id;
      var bisher = id ? finde(z.daten.Aufgaben, id) : null;
      w.zielgruppen = zielgruppenAus(f, bisher ? bisher.zielgruppen : '');
      if (!f.elements.termin_id) w.termin_id = bisher ? bisher.termin_id || '' : '';
      delete w.fuer; delete w.fuer_ab;
      var vomTermin = f.getAttribute('data-termin'); // „+ Aufgabe dazu“ beim Termin
      verwalten({ aktion: 'aufgabe_speichern', aufgabe: w }, knopf).then(function (a) {
        if (a.ok) {
          z.offen = null;
          z.springeZu = vomTermin ? 't-' + vomTermin : 'a-' + (bisher && bisher.eltern_id ? bisher.eltern_id : id || a.id);
        }
        render();
      });
    } else if (art === 'unter') {
      // sofort leeren (Formular bleibt offen für weitere), bei Fehler zurückholen
      f.elements.titel.value = '';
      f.elements.titel.focus();
      verwalten({ aktion: 'unteraufgaben_hinzufuegen', eltern_id: id, titel: w.titel, anzahl: w.anzahl }, knopf).then(function (a) {
        if (!a.ok) {
          var uf = document.querySelector('form[data-form=unter][data-id="' + id + '"]');
          if (uf && !uf.elements.titel.value) uf.elements.titel.value = w.titel;
        }
        render();
      });
    }
  }

  // „Für wen?“ aus dem Formular; ohne Feld (keine Zielgruppen eingestellt) bleibt der bisherige Wert
  function zielgruppenAus(f, bisher) {
    if (!f.querySelector('input[name=fuer]')) return bisher || '';
    // die ältesten Gruppen ab einer bestimmten als „ab …“ speichern – so passt es auch nach
    // einer Änderung der Reihenfolge in config.js oder mit einer neuen Gruppe
    return zgKurz(fuerAuswahl(f), true).join(', ');
  }

  // Schnellwahl „ab Gruppe …“: diese Gruppe und alle danach (älteren) anhaken, die davor nicht
  document.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (!sel || sel.name !== 'fuer_ab' || sel.value === '') return;
    var ab = +sel.value;
    Array.prototype.forEach.call(sel.form.querySelectorAll('input[name=fuer]'), function (box) {
      var i = -1;
      ZG.gruppen.forEach(function (n, j) { if (istGleich(n, box.value)) i = j; });
      if (i >= 0) box.checked = i >= ab;
    });
    sel.value = '';
  });

  document.addEventListener('click', klick);
  document.addEventListener('submit', absenden);
  // Kalender-Formular: Anzahl auf dem Knopf beim Ändern von Datum oder Häkchen anpassen
  function kalenderVorschau(ev) {
    var f = ev.target && ev.target.form;
    if (!f || f.getAttribute('data-form') !== 'kalender' || !z.sicht) return;
    var ab = f.elements.ab.value || heute();
    var n = kalenderAuswahl(ab, !!(f.elements.ohne_extern && f.elements.ohne_extern.checked)).length;
    f.querySelector('button[type=submit]').textContent = kalenderKnopf(n);
  }
  document.addEventListener('input', kalenderVorschau);
  document.addEventListener('change', kalenderVorschau);
  // Vorlage: Häkchen zählen, andere Vorlage laden
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    var f = el && el.form;
    if (!f || f.getAttribute('data-form') !== 'import') return;
    if (el.name === 'nimm') importVorschau(f);
    if (el.name === 'vorlage') { ladeVorlage(el.value); render(); }
  });

  // =====================================================================
  // Navigation über den Anker in der Adresse (#termine, #aufgaben, #meine, #t-…, #a-…)
  // =====================================================================

  function ankerLesen() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h === 'aufgaben' || h === 'meine' || h === 'termine') z.reiter = h;
    else if (h === 'tabelle') { z.reiter = 'termine'; z.ansicht = 'tabelle'; }
    else if (/^t-/.test(h)) { z.reiter = 'termine'; z.ansicht = 'liste'; z.springeZu = h; }
    else if (/^a-/.test(h)) { z.reiter = 'aufgaben'; z.springeZu = h; }
    else if (/^p-/.test(h)) { z.reiter = 'termine'; z.ansicht = 'liste'; z.springeZu = h; }
    else if (!h) z.reiter = 'termine';
  }

  window.addEventListener('hashchange', function () {
    ankerLesen();
    var sprung = !!z.springeZu; // render() setzt springeZu zurück, daher vorher merken
    z.offen = z.offen && z.offen.art === 'login' ? z.offen : null;
    render();
    // Nur beim Wechsel des Reiters nach oben, nicht beim Sprung zu einem Termin
    if (!sprung) window.scrollTo(0, Math.min(window.scrollY, document.getElementById('reiter').offsetTop));
  });

  // Regelmäßig aktualisieren, solange niemand gerade etwas eingibt
  function stillAktualisieren() {
    if (document.hidden || z.offen) return;
    var aktiv = document.activeElement;
    if (aktiv && /INPUT|TEXTAREA/.test(aktiv.tagName)) return;
    laden(true);
  }
  if (!backend.demo) {
    setInterval(stillAktualisieren, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) stillAktualisieren(); });
  }

  // =====================================================================
  // Beispieldaten für den Demo-Modus
  // =====================================================================

  function beispieldaten() {
    var h = alsDatum(heute());
    function tag(n) { var d = new Date(h); d.setDate(d.getDate() + n); return isoVon(d); }
    function ersterAdvent(jahr) {
      var d = new Date(jahr, 10, 27);
      d.setDate(27 + (7 - d.getDay()) % 7);
      return d;
    }
    var advent = ersterAdvent(h.getFullYear());
    if (advent - h < 3 * 86400000) advent = ersterAdvent(h.getFullYear() + 1);
    var sonntag = isoVon(advent);
    var markt = plusTage(sonntag, -1);
    var naechsterSonntag = tag((7 - h.getDay()) % 7 || 7);
    var freitag = tag(30 + (5 - (h.getDay() + 30) % 7 + 7) % 7); // ein Freitag in gut vier Wochen
    var jetzt = new Date().toISOString();
    var grp = ZG.gruppen.length ? ZG.gruppen : ['Gruppe 1', 'Gruppe 2'];
    // „ab …“ wie im echten Jahresplan, wenn es die Gruppe gibt – sonst die ältesten Gruppen
    function ab(name, sonst) {
      return grp.some(function (g) { return istGleich(g, name); }) ? 'ab ' + name : grp.slice(-sonst).join(', ');
    }

    function s(id, termin, station, von, bis, anzahl, datum, info) {
      return { id: id, termin_id: termin, station: station, datum: datum || '', von: von, bis: bis, anzahl: String(anzahl), info: info || '' };
    }
    function e(id, bezug, name, notiz) {
      return { id: id, bezug: bezug, name: name, notiz: notiz || '', fuer: '', zeitpunkt: jetzt };
    }

    return {
      Termine: [
        // einfacher Termin: Uhrzeit und Eintragen direkt beim Termin
        { id: 't1', titel: 'Kirchcafé nach dem Gottesdienst', datum: naechsterSonntag, ort: 'Gemeindehaus', info: 'Kaffee kochen, Kuchen aufschneiden, danach spülen.', von: '10:30', bis: '13:30', plaetze: '4' },
        // nur mit Schichten
        { id: 't2', titel: 'Seniorennachmittag', datum: tag(10), ort: 'Gemeindehaus, großer Saal', info: 'Mit Kaffee, Kuchen und Liedern zum Herbst.', von: '14:30', bis: '17:00', plaetze: '' },
        // nur zur Info, ohne Eintragen
        { id: 't3', titel: 'Gemeindeversammlung', datum: tag(24), ort: 'Kirche', info: 'Bericht aus dem Kirchenvorstand, Haushalt, Verschiedenes.', von: '19:00', bis: '', plaetze: '' },
        // Jugend extern: eingeklappt, ohne Farbe, ausblendbar
        { id: 't6', titel: 'Dekanatsjugendgottesdienst', datum: tag(13), ort: 'St. Paul', info: 'Treffpunkt 18:15 Uhr vor dem Gemeindehaus, wir fahren gemeinsam.', von: '19:00', bis: '', plaetze: '0', kategorie: 'Jugend extern' },
        { id: 't7', titel: 'Kreisjugendring-Vollversammlung', datum: tag(19), ort: 'Jugendzentrum', info: '', von: '18:00', bis: '20:00', plaetze: '', kategorie: 'Jugend extern' },
        // mehrtägig mit Bis-Datum und Platzgrenze, nur für die älteren Gruppen
        { id: 't5', titel: 'Jugendwochenende', datum: freitag, bis_datum: plusTage(freitag, 2), ort: 'Jugendhaus am See', info: 'Anreise Freitag 17 Uhr, Rückkehr Sonntag nach dem Mittagessen.', von: '17:00', bis: '', plaetze: '12', zielgruppen: ab('Polarwölfe', 2) },
        // „Für wen?“: nur für bestimmte Gruppen, Teams oder Eltern
        { id: 't8', titel: 'MAK-Sitzung', datum: tag(8), ort: 'Jugendraum', info: 'Planung der nächsten Wochen.', von: '19:30', bis: '21:00', plaetze: '', zielgruppen: ab('Pinguine', 2) + ', MAK' },
        { id: 't9', titel: 'SoLa-Vorbereitungstreffen', datum: tag(16), ort: 'Gemeindehaus', info: 'Ort, Programm und Material fürs Sommerlager.', von: '19:00', bis: '', plaetze: '0', zielgruppen: 'Team SoLa' },
        { id: 't10', titel: 'Elternabend zum Jugendwochenende', datum: tag(21), ort: 'Gemeindehaus', info: 'Infos zu Ablauf, Packliste und Kosten.', von: '19:30', bis: '', plaetze: '', zielgruppen: 'Eltern' },
        {
          id: 't4', titel: 'Adventsmarkt', datum: markt, ort: 'Kirchplatz',
          info: 'Samstag 14–20 Uhr, Sonntag nach dem Gottesdienst bis 18 Uhr.\nBitte warm anziehen!', plaetze: ''
        }
      ],
      Schichten: [
        s('s3', 't2', 'Fahrdienst', '14:00', '', 3, '', 'Abholen und wieder nach Hause bringen'),
        s('s4', 't2', 'Bewirtung', '14:30', '17:00', 2),
        s('s5', 't4', 'Aufbau', '09:00', '13:00', 6),
        s('s6', 't4', 'Glühweinstand', '14:00', '16:00', 2),
        s('s7', 't4', 'Glühweinstand', '16:00', '18:00', 2),
        s('s8', 't4', 'Glühweinstand', '18:00', '20:00', 2),
        s('s9', 't4', 'Waffeln', '14:00', '17:00', 2),
        s('s10', 't4', 'Waffeln', '17:00', '20:00', 2),
        s('s11', 't4', 'Kasse', '14:00', '17:00', 1),
        s('s12', 't4', 'Kasse', '17:00', '20:00', 1),
        s('s13', 't4', 'Glühweinstand', '12:00', '15:00', 2, sonntag),
        s('s14', 't4', 'Glühweinstand', '15:00', '18:00', 2, sonntag),
        s('s15', 't4', 'Abbau', '18:00', '20:00', 6, sonntag)
      ],
      Aufgaben: [
        { id: 'a1', titel: 'Plakate für den Adventsmarkt aufhängen', info: 'Plakate liegen im Gemeindebüro.', frist: plusTage(markt, -14), anzahl: '3', termin_id: 't4', zielgruppen: ab('Pinguine', 2) + ', MAK' },
        { id: 'a2', titel: 'Kuchen für den Adventsmarkt backen', info: 'Bitte Freitagabend oder Samstag bis 13 Uhr im Gemeindehaus abgeben. Gern mit Zettel, was drin ist.', frist: plusTage(markt, -1), anzahl: '10', termin_id: 't4' },
        { id: 'a8', titel: 'Zeltplan fürs Sommerlager erstellen', info: 'Wer schläft wo, welche Zelte brauchen wir?', frist: '', anzahl: '2', termin_id: 't9' },
        { id: 'a9', titel: 'Snacks für die MAK-Sitzung', info: '', frist: '', anzahl: '1', termin_id: 't8' },
        { id: 'a3', titel: 'Weihnachtsbaum für die Kirche besorgen', info: '', frist: plusTage(sonntag, 14), anzahl: '0' },
        { id: 'a5', titel: 'Baum in der Gärtnerei aussuchen', info: '', frist: '', anzahl: '2', eltern_id: 'a3' },
        { id: 'a6', titel: 'Anhänger organisieren', info: '', frist: '', anzahl: '1', eltern_id: 'a3', erledigt: heute(), erledigt_von: 'Peter' },
        { id: 'a7', titel: 'Baum aufstellen und schmücken', info: 'Samstag ab 10 Uhr', frist: '', anzahl: '5', eltern_id: 'a3' },
        { id: 'a4', titel: 'Gemeindebrief verteilen', info: 'Die Bezirke werden im Gemeindebüro aufgeteilt.', frist: '', anzahl: '0' }
      ],
      Eintragungen: [
        e('e1', 't1', 'Maria'), e('e2', 't1', 'Thomas', 'bringe Kuchen mit'),
        e('e20', 't5', 'Lena'), e('e21', 't5', 'Jonas'), e('e22', 't5', 'Mia'),
        e('e23', 't6', 'Jonas'), e('e24', 't6', 'Mia'),
        e('e3', 's3', 'Klaus', 'mit Kleinbus'),
        e('e4', 's5', 'Jonas'), e('e5', 's5', 'Peter'), e('e6', 's5', 'Lena'),
        e('e7', 's6', 'Sabine'), e('e8', 's6', 'Ute'),
        e('e9', 's7', 'Thomas'),
        e('e10', 's9', 'Lena'),
        e('e11', 's11', 'Helga'),
        e('e12', 's13', 'Peter'),
        e('e13', 'a1', 'Jonas'),
        e('e14', 'a2', 'Maria', 'Apfelkuchen'), e('e15', 'a2', 'Sabine', 'Zimtschnecken'),
        e('e16', 'a4', 'Klaus'), e('e17', 'a4', 'Ute'),
        e('e18', 'a5', 'Klaus'), e('e19', 'a6', 'Peter', 'mit Papas Anhänger')
      ],
      Abstimmungen: [
        { id: 'p1', titel: 'Dankeschön-Abend für alle Helfer', ort: 'Gemeindehaus', info: 'Mit Essen und Rückblick aufs Jahr.',
          frist: tag(12), status: '', ergebnis: '', termin_id: '' }
      ],
      Optionen: [
        { id: 'o1', abstimmung_id: 'p1', datum: plusTage(sonntag, 12), von: '19:00' },
        { id: 'o2', abstimmung_id: 'p1', datum: plusTage(sonntag, 13), von: '18:00' },
        { id: 'o3', abstimmung_id: 'p1', datum: plusTage(sonntag, 40), von: '19:00' }
      ],
      Stimmen: [
        { id: 'v1', option_id: 'o1', name: 'Maria', zeitpunkt: jetzt }, { id: 'v2', option_id: 'o1', name: 'Thomas', zeitpunkt: jetzt },
        { id: 'v3', option_id: 'o2', name: 'Maria', zeitpunkt: jetzt }, { id: 'v4', option_id: 'o2', name: 'Klaus', zeitpunkt: jetzt },
        { id: 'v5', option_id: 'o2', name: 'Ute', zeitpunkt: jetzt }, { id: 'v6', option_id: 'o3', name: 'Sabine', zeitpunkt: jetzt }
      ]
    };
  }

  // =====================================================================
  // Start
  // =====================================================================

  ankerLesen();
  gemerkterStand();
  render();
  laden();
})();
