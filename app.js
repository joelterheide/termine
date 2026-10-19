/* Helferliste – Oberfläche
 * Lädt die Daten vom Google-Apps-Script (oder im Demo-Modus aus dem Browser)
 * und zeigt Termine, Aufgaben und die eigenen Einträge an. */
(function () {
  'use strict';

  var KONF = Object.assign(
    { api: '', titel: 'Helferliste', untertitel: '', anleitung: '' },
    window.HELFERLISTE || {}
  );

  // ---------- Browser-Speicher (kann in privaten Fenstern fehlen) ----------

  function lies(art, k) {
    try { return window[art].getItem(k) || ''; } catch (e) { return ''; }
  }
  function merke(art, k, v) {
    try { if (v) window[art].setItem(k, v); else window[art].removeItem(k); } catch (e) { /* egal */ }
  }

  // ---------- Zustand ----------

  var z = {
    daten: null,          // Rohdaten vom Server
    sicht: null,          // aufbereitete Daten
    reiter: 'termine',
    offen: null,          // gerade geöffnetes Formular
    vergangene: false,
    passwort: lies('sessionStorage', 'helferliste.passwort'),
    name: lies('localStorage', 'helferliste.name'),
    ladefehler: '',
    springeZu: ''
  };

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
      var tage = [t.datum].concat(schichten.map(function (s) { return s.tag; }))
        .filter(function (x) { return alsDatum(x); }).sort();
      return Object.assign({}, t, {
        schichten: schichten,
        stationen: einzigartig(eigene.map(function (s) { return s.station; })), // Reihenfolge wie angelegt
        von: tage[0] || '',
        bis: tage[tage.length - 1] || ''
      });
    });
    termine.sort(function (a, b) {
      return (a.von || '9999').localeCompare(b.von || '9999') || String(a.titel).localeCompare(String(b.titel));
    });

    var aufgaben = d.Aufgaben.map(function (g) { return Object.assign({}, g, { leute: leute[g.id] || [] }); });
    aufgaben.sort(function (a, b) {
      if (a.frist && b.frist) return a.frist.localeCompare(b.frist);
      return a.frist ? -1 : b.frist ? 1 : 0;
    });

    return { termine: termine, aufgaben: aufgaben };
  }

  function istVorbei(termin) { return termin.bis && termin.bis < heute(); }
  function istAbgelaufen(aufgabe) { return aufgabe.frist && aufgabe.frist < heute(); }

  function kommendeTermine() { return z.sicht.termine.filter(function (t) { return !istVorbei(t); }); }
  function offeneAufgaben() { return z.sicht.aufgaben.filter(function (g) { return !istAbgelaufen(g); }); }

  function meineEintraege() {
    var h = heute();
    var liste = [];
    z.sicht.termine.forEach(function (t) {
      t.schichten.forEach(function (s) {
        if (s.tag && s.tag < h) return;
        s.leute.forEach(function (e) {
          if (ich(e.name)) liste.push({ e: e, termin: t, schicht: s, sortierung: (s.tag || '9999') + ' ' + (s.von || '') });
        });
      });
    });
    z.sicht.aufgaben.forEach(function (g) {
      if (istAbgelaufen(g)) return;
      g.leute.forEach(function (e) {
        if (ich(e.name)) liste.push({ e: e, aufgabe: g, sortierung: '~' + (g.frist || '9999') });
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

  function render() {
    var gemerkt = merkeFormulare();

    document.title = KONF.titel;
    document.getElementById('titel').textContent = KONF.titel;
    var unter = document.getElementById('untertitel');
    unter.textContent = KONF.untertitel;
    unter.hidden = !KONF.untertitel;

    document.getElementById('hinweis').innerHTML = hinweisHtml();
    document.getElementById('reiter').innerHTML = reiterHtml();
    document.getElementById('fuss').innerHTML = fussHtml();

    var inhalt = document.getElementById('inhalt');
    if (!z.sicht) {
      inhalt.innerHTML = z.ladefehler ? '' : '<p class="leer">Lade …</p>';
    } else if (z.reiter === 'aufgaben') {
      inhalt.innerHTML = aufgabenHtml();
    } else if (z.reiter === 'meine') {
      inhalt.innerHTML = meineHtml();
    } else {
      inhalt.innerHTML = termineHtml();
    }

    stelleFormulareWiederHer(gemerkt);

    if (z.springeZu && z.sicht) {
      var ziel = document.getElementById(z.springeZu);
      z.springeZu = '';
      if (ziel) {
        ziel.scrollIntoView();
        ziel.classList.add('markiert');
        setTimeout(function () { ziel.classList.remove('markiert'); }, 1800);
      }
    }
  }

  function hinweisHtml() {
    if (z.ladefehler) {
      return '<div class="hinweis fehler">Die Daten konnten nicht geladen werden: ' + esc(z.ladefehler) +
        ' <button class="link" data-aktion="neu-laden">Erneut versuchen</button></div>';
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
      anzahl.termine = kommendeTermine().length;
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
      teile.push('Verwaltung aktiv · <button class="link" data-aktion="abmelden">Abmelden</button>');
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
    var kommend = kommendeTermine();
    var vergangen = z.sicht.termine.filter(istVorbei);
    if (z.springeZu && vergangen.some(function (t) { return 't-' + t.id === z.springeZu; })) z.vergangene = true;

    var offen = kommend.some(function (t) {
      return t.schichten.some(function (s) { return s.tag >= heute() && freiePlaetze(s) > 0; });
    });
    var h = alsHtml() + '<div class="leiste">' +
      (offen ? '<button class="link" data-aktion="teilen-alle">Offene Plätze per WhatsApp teilen</button>' : '<span></span>') +
      (admin() ? '<button data-aktion="termin-neu">+ Neuer Termin</button>' : '') +
      '</div>';

    if (istOffen('termin', '')) h += terminFormular(null);
    if (!kommend.length) h += '<p class="leer">Keine kommenden Termine.</p>';
    kommend.forEach(function (t) { h += terminHtml(t); });

    if (vergangen.length) {
      h += '<p class="vergangen-schalter"><button class="link" data-aktion="vergangene">' +
        (z.vergangene ? 'Vergangene Termine ausblenden' : 'Vergangene Termine anzeigen (' + vergangen.length + ')') +
        '</button></p>';
      if (z.vergangene) vergangen.slice().reverse().forEach(function (t) { h += terminHtml(t); });
    }
    return h;
  }

  function terminHtml(t) {
    var vorbei = istVorbei(t);
    var h = '<section class="termin' + (vorbei ? ' vorbei' : '') + '" id="t-' + esc(t.id) + '">';

    if (istOffen('termin', t.id)) {
      h += terminFormular(t);
    } else {
      var rel = vorbei ? '' : relativ(t.von);
      h += '<div class="t-datum">' + esc(zeitraum(t.von, t.bis)) + (rel ? ' · ' + rel : '') + '</div>';
      h += '<h2>' + esc(t.titel) + '</h2>';
      if (t.ort) h += '<div class="t-ort">' + esc(t.ort) + '</div>';
      if (t.info) h += '<p class="info">' + mitLinks(t.info) + '</p>';
    }

    h += schichtenHtml(t);
    if (istOffen('schicht', '', t.id)) h += schichtFormular(t, null);
    if (istOffen('kopieren', t.id)) h += kopierFormular(t);

    var links = [];
    if (!vorbei) links.push('<button class="link" data-aktion="teilen" data-id="' + esc(t.id) + '">Per WhatsApp teilen</button>');
    if (t.von) links.push('<button class="link" data-aktion="ics-termin" data-id="' + esc(t.id) + '">In den Kalender</button>');
    if (admin()) {
      links.push('<button class="link" data-aktion="termin-bearbeiten" data-id="' + esc(t.id) + '">Bearbeiten</button>');
      links.push('<button class="link" data-aktion="schicht-neu" data-termin="' + esc(t.id) + '">Schichten hinzufügen</button>');
      links.push('<button class="link" data-aktion="termin-kopieren" data-id="' + esc(t.id) + '">Kopieren</button>');
      links.push('<button class="link" data-aktion="termin-loeschen" data-id="' + esc(t.id) + '">Löschen</button>');
    }
    if (links.length) h += '<div class="t-links">' + links.join('<span class="trenn"> · </span>') + '</div>';
    return h + '</section>';
  }

  function schichtenHtml(t) {
    if (!t.schichten.length) {
      return admin() ? '<p class="leise klein">Noch keine Schichten – über „Schichten hinzufügen“ anlegen.</p>' : '';
    }
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
    h += '<span class="z-aktion">' + aktionHtml(s.id, vorbei, voll, s.leute, false);
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
  function aktionHtml(bezug, vorbei, voll, leute, mitNotiz) {
    if (vorbei) return '<span class="leise">vorbei</span>';
    if (leute.some(function (e) { return ich(e.name); })) return '<span class="leise">eingetragen</span>';
    if (voll) return '<span class="leise">voll</span>';
    if (istOffen('eintragen', bezug)) return '';
    if (z.name) {
      return '<button data-aktion="schnell-eintragen" data-bezug="' + esc(bezug) + '" title="Als ' + esc(z.name) + ' eintragen">Eintragen</button>' +
        (mitNotiz ? '<span class="verw"><button class="link" data-aktion="eintragen" data-bezug="' + esc(bezug) + '">mit Notiz</button></span>' : '');
    }
    return '<button data-aktion="eintragen" data-bezug="' + esc(bezug) + '">Eintragen</button>';
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
      return '<span class="person' + (ich(e.name) ? ' ich' : '') + '">' + esc(e.name) +
        (e.notiz ? ' <span class="notiz">(' + esc(e.notiz) + ')</span>' : '') +
        (vorbei ? '' : '<button class="weg" data-aktion="austragen" data-id="' + esc(e.id) + '" title="absagen" aria-label="' + esc(e.name) + ' absagen">×</button>') +
        '</span>';
    }).join(', ');
  }

  function eintragFormular(bezug) {
    return '<form class="eintragen" data-form="eintragen" data-id="' + esc(bezug) + '">' +
      '<input name="name" placeholder="Dein Name" aria-label="Dein Name" maxlength="60" required autocomplete="name" value="' + esc(z.name) + '">' +
      '<input name="notiz" placeholder="Notiz (optional)" aria-label="Notiz" maxlength="200">' +
      '<span class="knoepfe"><button type="submit" class="haupt">Eintragen</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></span></form>';
  }

  // ---------- Aufgaben ----------

  function aufgabenHtml() {
    var liste = offeneAufgaben();
    var abgelaufen = z.sicht.aufgaben.filter(istAbgelaufen);
    var h = alsHtml() + '<div class="leiste"><span class="leise">Aufgaben ohne festen Termin</span>' +
      (admin() ? '<button data-aktion="aufgabe-neu">+ Neue Aufgabe</button>' : '') + '</div>';
    if (istOffen('aufgabe', '')) h += aufgabeFormular(null);
    if (!liste.length) h += '<p class="leer">Gerade keine offenen Aufgaben.</p>';
    liste.forEach(function (g) { h += aufgabeHtml(g); });
    if (abgelaufen.length && admin()) {
      h += '<p class="vergangen-schalter"><button class="link" data-aktion="vergangene">' +
        (z.vergangene ? 'Abgelaufene Aufgaben ausblenden' : 'Abgelaufene Aufgaben anzeigen (' + abgelaufen.length + ')') +
        '</button></p>';
      if (z.vergangene) abgelaufen.forEach(function (g) { h += aufgabeHtml(g); });
    }
    return h;
  }

  function aufgabeHtml(g) {
    var vorbei = istAbgelaufen(g);
    var h = '<section class="aufgabe' + (vorbei ? ' vorbei' : '') + '" id="a-' + esc(g.id) + '">';
    if (istOffen('aufgabe', g.id)) return h + aufgabeFormular(g) + '</section>';

    h += '<h2>' + esc(g.titel) + '</h2>';
    if (g.frist) {
      var rel = vorbei ? '' : relativ(g.frist);
      h += '<div class="t-datum">bis ' + esc(datumLang(g.frist)) + (rel ? ' · ' + rel : '') + '</div>';
    }
    if (g.info) h += '<p class="info">' + mitLinks(g.info) + '</p>';

    var max = zahl(g.anzahl);
    var n = g.leute.length;
    var voll = max > 0 && n >= max;
    h += '<div class="schichten"><div class="zeile ohne-zeit' + (voll ? ' ist-voll' : '') + '">' +
      zahlHtml(n, max) +
      '<span class="z-namen">' + namenHtml(g.leute, vorbei) + '</span>' +
      '<span class="z-aktion">' + aktionHtml(g.id, vorbei, voll, g.leute, true) + '</span></div>';
    if (istOffen('eintragen', g.id) && !vorbei && !voll) h += eintragFormular(g.id);
    h += '</div>';

    if (admin()) {
      h += '<div class="t-links"><button class="link" data-aktion="aufgabe-bearbeiten" data-id="' + esc(g.id) + '">Bearbeiten</button>' +
        '<span class="trenn"> · </span><button class="link" data-aktion="aufgabe-loeschen" data-id="' + esc(g.id) + '">Löschen</button></div>';
    }
    return h + '</section>';
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
      } else {
        wann = m.aufgabe.frist ? 'bis ' + datumKurz(m.aufgabe.frist) : 'Aufgabe';
        was = '<a href="#a-' + esc(m.aufgabe.id) + '">' + esc(m.aufgabe.titel) + '</a>';
      }
      if (m.e.notiz) was += ' <span class="notiz">(' + esc(m.e.notiz) + ')</span>';
      h += '<li><span class="m-wann">' + esc(wann) + '</span><span class="m-was">' + was + '</span>' +
        '<span><button class="link" data-aktion="austragen" data-id="' + esc(m.e.id) + '">absagen</button></span></li>';
    });
    h += '</ul>';
    if (liste.some(function (m) { return m.schicht; })) {
      h += '<p class="t-links"><button class="link" data-aktion="ics-meine">Meine Termine in den Kalender übernehmen</button></p>';
    }
    return h;
  }

  // ---------- Verwaltungsformulare ----------

  function terminFormular(t) {
    t = t || {};
    return '<form class="kasten" data-form="termin" data-id="' + esc(t.id || '') + '">' +
      '<h3>' + (t.id ? 'Termin bearbeiten' : 'Neuer Termin') + '</h3>' +
      '<label>Titel<input name="titel" required maxlength="120" value="' + esc(t.titel || '') + '" placeholder="z. B. Adventsmarkt"></label>' +
      '<div class="reihe"><label>Datum<input type="date" name="datum" required value="' + esc(t.datum || '') + '"></label>' +
      '<label>Ort<input name="ort" maxlength="150" value="' + esc(t.ort || '') + '" placeholder="optional"></label></div>' +
      '<label>Info<textarea name="info" rows="3" maxlength="2000" placeholder="optional">' + esc(t.info || '') + '</textarea></label>' +
      '<div class="knoepfe"><button type="submit" class="haupt">Speichern</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
  }

  function schichtFormular(t, s) {
    var stationen = einzigartig(t.schichten.map(function (x) { return x.station; }).filter(Boolean));
    var listId = 'stationen-' + t.id;
    s = s || {};
    return '<form class="kasten" data-form="schicht" data-id="' + esc(s.id || '') + '" data-termin="' + esc(t.id) + '">' +
      '<h3>' + (s.id ? 'Schicht ändern' : 'Schichten hinzufügen') + '</h3>' +
      '<div class="reihe"><label>Station / Aufgabe<input name="station" maxlength="80" list="' + esc(listId) + '" value="' + esc(s.station || '') + '" placeholder="z. B. Glühweinstand">' +
      '<span class="tipp">Leer lassen, wenn es nur allgemein Helfer braucht.</span></label>' +
      '<label>Datum<input type="date" name="datum" value="' + esc(s.tag || t.datum || '') + '"></label></div>' +
      '<datalist id="' + esc(listId) + '">' + stationen.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
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

  function aufgabeFormular(g) {
    g = g || {};
    return '<form class="kasten" data-form="aufgabe" data-id="' + esc(g.id || '') + '">' +
      '<h3>' + (g.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe') + '</h3>' +
      '<label>Titel<input name="titel" required maxlength="120" value="' + esc(g.titel || '') + '" placeholder="z. B. Kuchen backen"></label>' +
      '<label>Info<textarea name="info" rows="2" maxlength="2000" placeholder="optional">' + esc(g.info || '') + '</textarea></label>' +
      '<div class="reihe"><label>Erledigen bis<input type="date" name="frist" value="' + esc(g.frist || '') + '"><span class="tipp">optional</span></label>' +
      '<label>Wie viele Helfer?<input type="number" name="anzahl" min="0" max="999" inputmode="numeric" value="' + esc(g.id ? zahl(g.anzahl) : 1) + '">' +
      '<span class="tipp">0 = beliebig viele</span></label></div>' +
      '<div class="knoepfe"><button type="submit" class="haupt">Speichern</button>' +
      '<button type="button" data-aktion="schliessen">Abbrechen</button></div></form>';
  }

  // Eingaben in offenen Formularen über ein Neuzeichnen retten
  function formSchluessel(f) { return f.getAttribute('data-form') + ':' + (f.getAttribute('data-id') || '') + ':' + (f.getAttribute('data-termin') || ''); }
  function merkeFormulare() {
    var gemerkt = {};
    document.querySelectorAll('form[data-form]').forEach(function (f) {
      var w = {};
      Array.prototype.forEach.call(f.elements, function (el) { if (el.name) w[el.name] = el.value; });
      gemerkt[formSchluessel(f)] = w;
    });
    return gemerkt;
  }
  function stelleFormulareWiederHer(gemerkt) {
    document.querySelectorAll('form[data-form]').forEach(function (f) {
      var w = gemerkt[formSchluessel(f)];
      if (!w) return;
      Array.prototype.forEach.call(f.elements, function (el) {
        if (el.name && Object.prototype.hasOwnProperty.call(w, el.name)) el.value = w[el.name];
      });
    });
  }

  // =====================================================================
  // Meldungen
  // =====================================================================

  var meldungTimer = null;
  // rueckgaengig: ID einer Eintragung, die man direkt wieder löschen kann
  function zeigeMeldung(text, istFehler, rueckgaengig) {
    var el = document.getElementById('meldung');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    if (rueckgaengig) {
      var b = document.createElement('button');
      b.className = 'link';
      b.textContent = 'Rückgängig';
      b.setAttribute('data-aktion', 'rueckgaengig');
      b.setAttribute('data-id', rueckgaengig);
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

  function setzeDaten(daten) {
    z.daten = daten;
    z.sicht = aufbereiten(daten);
  }

  function laden(still) {
    return backend.lesen().then(function (a) {
      if (a.daten) { setzeDaten(a.daten); z.ladefehler = ''; }
      else if (!a.ok) throw new Error(a.fehler || 'unbekannter Fehler');
      render();
    }).catch(function (e) {
      if (!still || !z.sicht) { z.ladefehler = e.message; render(); }
    });
  }

  function senden(anfrage, knopf) {
    if (knopf) { knopf.disabled = true; knopf.setAttribute('data-text', knopf.textContent); knopf.textContent = '…'; }
    return backend.senden(anfrage).catch(function (e) {
      return { ok: false, fehler: e.message };
    }).then(function (a) {
      if (knopf) { knopf.disabled = false; knopf.textContent = knopf.getAttribute('data-text'); }
      if (a.daten) setzeDaten(a.daten);
      if (!a.ok && anfrage.passwort && /Falsches Passwort|gesperrt/.test(a.fehler || '')) abmelden();
      zeigeMeldung(a.ok ? a.meldung : a.fehler, !a.ok);
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

  function teilenText(termine, einzeln) {
    var zeilen = [];
    termine.forEach(function (t) {
      var offen = t.schichten.filter(function (s) { return s.tag >= heute() && freiePlaetze(s) > 0; });
      if (!einzeln && !offen.length) return;
      var mehrtaegig = einzigartig(t.schichten.map(function (s) { return s.tag; })).length > 1;
      zeilen.push('*' + t.titel + '*');
      zeilen.push(zeitraum(t.von, t.bis) + (t.ort ? ', ' + t.ort : ''));
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
    var z2 = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Helferliste//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
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
    var mitZeit = t.schichten.filter(function (s) { return s.von; });
    var eintrag = { uid: t.id, titel: t.titel, ort: t.ort, info: (t.info ? t.info + '\n\n' : '') + seitenLink('t-' + t.id), tag: t.von, bisTag: t.bis };
    if (t.von === t.bis && mitZeit.length) {
      eintrag.von = mitZeit.map(function (s) { return s.von; }).sort()[0];
      var enden = mitZeit.map(function (s) { return s.bis; }).filter(Boolean).sort();
      eintrag.bis = enden[enden.length - 1] || '';
    }
    icsHerunterladen([eintrag], dateiname(t.titel));
  }

  function icsMeine() {
    var liste = meineEintraege().filter(function (m) { return m.schicht && m.schicht.tag; }).map(function (m) {
      var s = m.schicht;
      return {
        uid: m.e.id, titel: m.termin.titel + (s.station ? ': ' + s.station : ''),
        ort: m.termin.ort, info: (s.info ? s.info + '\n\n' : '') + seitenLink('t-' + m.termin.id),
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

  document.addEventListener('click', function (ev) {
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

      case 'schnell-eintragen': {
        var bezug = el.getAttribute('data-bezug');
        senden({ aktion: 'eintragen', bezug: bezug, name: z.name, notiz: '' }, el).then(function (a) {
          if (a.ok) {
            var neu = z.daten.Eintragungen.filter(function (x) { return x.bezug === bezug && ich(x.name); })[0];
            if (neu) zeigeMeldung(a.meldung, false, neu.id);
          }
          render();
        });
        break;
      }

      case 'rueckgaengig':
        senden({ aktion: 'austragen', id: id }, el).then(render);
        break;

      case 'name-aendern':
        oeffne({ art: 'name' }, 'form[data-form=name] input');
        break;

      case 'austragen': {
        var e = finde(z.daten.Eintragungen, id);
        if (!e) return;
        var frage = ich(e.name) ? 'Wirklich absagen?' : e.name + ' austragen?';
        if (e.fuer) frage += '\n' + e.fuer;
        if (!window.confirm(frage)) return;
        senden({ aktion: 'austragen', id: id }, el).then(render);
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
        teilen(teilenText(kommendeTermine(), false));
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
        if (!g || !window.confirm('Aufgabe „' + g.titel + '“ löschen?')) return;
        verwalten({ aktion: 'aufgabe_loeschen', id: id }, el).then(render);
        break;
      }
    }
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    var art = f.getAttribute('data-form');
    if (!art) return;
    ev.preventDefault();
    var id = f.getAttribute('data-id') || '';
    var knopf = f.querySelector('button[type=submit]');
    var w = {};
    Array.prototype.forEach.call(f.elements, function (el) { if (el.name) w[el.name] = el.value.trim(); });

    if (art === 'eintragen') {
      if (!w.name) return;
      z.name = w.name;
      merke('localStorage', 'helferliste.name', w.name);
      senden({ aktion: 'eintragen', bezug: id, name: w.name, notiz: w.notiz }, knopf).then(function (a) {
        if (a.ok) z.offen = null;
        render();
      });
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
    } else if (art === 'termin') {
      w.id = id;
      verwalten({ aktion: 'termin_speichern', termin: w }, knopf).then(function (a) {
        if (a.ok) {
          // Nach dem Anlegen gleich Schichten hinzufügen
          z.offen = id ? null : { art: 'schicht', id: '', termin: a.id };
          if (!id) z.springeZu = 't-' + a.id;
        }
        render();
        if (a.ok && !id) {
          var feld = document.querySelector('form[data-form=schicht] input[name=station]');
          if (feld) feld.focus();
        }
      });
    } else if (art === 'schicht') {
      w.id = id;
      w.termin_id = f.getAttribute('data-termin');
      verwalten({ aktion: 'schicht_speichern', schicht: w }, knopf).then(function (a) {
        if (a.ok) {
          if (id) {
            z.offen = null;
          } else {
            // Formular offen lassen für die nächste Station, Felder leeren
            f.querySelector('input[name=station]').value = '';
            f.querySelector('input[name=zeiten]').value = '';
            f.querySelector('input[name=info]').value = '';
          }
        }
        render();
        if (a.ok && !id) {
          var feld = document.querySelector('form[data-form=schicht] input[name=station]');
          if (feld) feld.focus();
        }
      });
    } else if (art === 'kopieren') {
      verwalten({ aktion: 'termin_kopieren', id: id, datum: w.datum }, knopf).then(function (a) {
        if (a.ok) { z.offen = null; z.springeZu = 't-' + a.id; }
        render();
      });
    } else if (art === 'aufgabe') {
      w.id = id;
      verwalten({ aktion: 'aufgabe_speichern', aufgabe: w }, knopf).then(function (a) {
        if (a.ok) {
          z.offen = null;
          z.springeZu = 'a-' + (id || a.id);
        }
        render();
      });
    }
  });

  // =====================================================================
  // Navigation über den Anker in der Adresse (#termine, #aufgaben, #meine, #t-…, #a-…)
  // =====================================================================

  function ankerLesen() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h === 'aufgaben' || h === 'meine' || h === 'termine') z.reiter = h;
    else if (/^t-/.test(h)) { z.reiter = 'termine'; z.springeZu = h; }
    else if (/^a-/.test(h)) { z.reiter = 'aufgaben'; z.springeZu = h; }
    else if (!h) z.reiter = 'termine';
  }

  window.addEventListener('hashchange', function () {
    ankerLesen();
    z.offen = z.offen && z.offen.art === 'login' ? z.offen : null;
    render();
    if (!z.springeZu) window.scrollTo(0, Math.min(window.scrollY, document.getElementById('reiter').offsetTop));
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
    var jetzt = new Date().toISOString();

    function s(id, termin, station, von, bis, anzahl, datum, info) {
      return { id: id, termin_id: termin, station: station, datum: datum || '', von: von, bis: bis, anzahl: String(anzahl), info: info || '' };
    }
    function e(id, bezug, name, notiz) {
      return { id: id, bezug: bezug, name: name, notiz: notiz || '', fuer: '', zeitpunkt: jetzt };
    }

    return {
      Termine: [
        { id: 't1', titel: 'Kirchcafé nach dem Gottesdienst', datum: naechsterSonntag, ort: 'Gemeindehaus', info: '' },
        { id: 't2', titel: 'Seniorennachmittag', datum: tag(10), ort: 'Gemeindehaus, großer Saal', info: 'Mit Kaffee, Kuchen und Liedern zum Herbst.' },
        { id: 't3', titel: 'Gemeindeversammlung', datum: tag(24), ort: 'Kirche', info: 'Bericht aus dem Kirchenvorstand, Haushalt, Verschiedenes.' },
        {
          id: 't4', titel: 'Adventsmarkt', datum: markt, ort: 'Kirchplatz',
          info: 'Samstag 14–20 Uhr, Sonntag nach dem Gottesdienst bis 18 Uhr.\nBitte warm anziehen!'
        }
      ],
      Schichten: [
        s('s1', 't1', 'Kaffee und Kuchen', '10:30', '12:30', 3),
        s('s2', 't1', 'Spülen', '12:30', '13:30', 2),
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
        { id: 'a1', titel: 'Plakate für den Adventsmarkt aufhängen', info: 'Plakate liegen im Gemeindebüro.', frist: plusTage(markt, -14), anzahl: '3' },
        { id: 'a2', titel: 'Kuchen für den Adventsmarkt backen', info: 'Bitte Freitagabend oder Samstag bis 13 Uhr im Gemeindehaus abgeben. Gern mit Zettel, was drin ist.', frist: plusTage(markt, -1), anzahl: '10' },
        { id: 'a3', titel: 'Weihnachtsbaum für die Kirche besorgen', info: 'Wer hat einen Anhänger?', frist: plusTage(sonntag, 14), anzahl: '2' },
        { id: 'a4', titel: 'Gemeindebrief verteilen', info: 'Die Bezirke werden im Gemeindebüro aufgeteilt.', frist: '', anzahl: '0' }
      ],
      Eintragungen: [
        e('e1', 's1', 'Maria'), e('e2', 's1', 'Thomas'),
        e('e3', 's3', 'Klaus', 'mit Kleinbus'),
        e('e4', 's5', 'Jonas'), e('e5', 's5', 'Peter'), e('e6', 's5', 'Lena'),
        e('e7', 's6', 'Sabine'), e('e8', 's6', 'Ute'),
        e('e9', 's7', 'Thomas'),
        e('e10', 's9', 'Lena'),
        e('e11', 's11', 'Helga'),
        e('e12', 's13', 'Peter'),
        e('e13', 'a1', 'Jonas'),
        e('e14', 'a2', 'Maria', 'Apfelkuchen'), e('e15', 'a2', 'Sabine', 'Zimtschnecken'),
        e('e16', 'a4', 'Klaus'), e('e17', 'a4', 'Ute')
      ]
    };
  }

  // =====================================================================
  // Start
  // =====================================================================

  ankerLesen();
  render();
  laden();
})();
