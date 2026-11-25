/* Jahresplan – Regeln für Vorlagen
 * Rechnet aus Regeln wie „2. Sonntag im Januar“, „Karsamstag“, „Samstag nach der Wiesn“
 * oder „6 Tage vor dem Sommerlager“ die Daten für ein bestimmtes Jahr aus.
 *
 * Regel („wann“) – eine Grundlage:
 *   { monat: 1, nr: 2, wt: 'So' }      2. Sonntag im Januar (nr: -1 = letzter)
 *   { datum: '12-24' }                 fester Tag
 *   { ostern: -1 }                     Tage ab Ostersonntag (-1 Karsamstag, 49 Pfingstsonntag)
 *   { advent: 2 }                      2. Adventssonntag
 *   { wiesn: 'beginn' | 'ende' }       Oktoberfest München
 *   { ferien: 'sommer', rand: 'beginn' | 'ende' }   Schulferien (sommer, herbst, ostern, pfingsten, fruehjahr)
 *   { termin: 'sola' }                 Beginn eines anderen Termins der Vorlage
 * dazu wahlweise:
 *   tage: -6                           Tage dazu oder weg
 *   wt: 'Sa', richtung: 'vor' | 'bis' | 'nach' | 'ab' | 'um'   auf diesen Wochentag schieben
 *   sonst: { … }                       Ersatzregel, falls die Grundlage fehlt (z. B. Ferien nicht geladen)
 *   text: '…'                          eigene Beschreibung
 *
 * Termin: dauer (Tage, Standard 1), ausweichen: ['ferien', 'wiesn', 'weinfest', '01-01', 'termin:sola'],
 *   schritt (Tage, Standard 7): so lange verschieben, bis nichts mehr im Weg ist.
 * Aufgabe: frist als Regel (z. B. { termin: 'sola', tage: -120 }) oder als Datum.
 */
(function (wurzel) {
  'use strict';

  var WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WT_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MONAT = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var FERIEN_NAME = { fruehjahr: 'Frühjahrsferien', ostern: 'Osterferien', pfingsten: 'Pfingstferien', sommer: 'Sommerferien', herbst: 'Herbstferien', weihnachten: 'Weihnachtsferien' };
  var OSTER_NAME = { '-2': 'Karfreitag', '-1': 'Karsamstag', '0': 'Ostersonntag', '1': 'Ostermontag', '39': 'Christi Himmelfahrt', '49': 'Pfingstsonntag', '50': 'Pfingstmontag', '60': 'Fronleichnam' };

  // ---------- Datum (immer als 'JJJJ-MM-TT', gerechnet in UTC) ----------
  function zz(n) { return (n < 10 ? '0' : '') + n; }
  function iso(j, m, t) { var d = new Date(Date.UTC(j, m - 1, t)); return d.getUTCFullYear() + '-' + zz(d.getUTCMonth() + 1) + '-' + zz(d.getUTCDate()); }
  function teile(s) { return [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)]; }
  function plus(s, n) { var p = teile(s); return iso(p[0], p[1], p[2] + n); }
  function wochentag(s) { var p = teile(s); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function wtIndex(w) {
    var k = String(w || '').slice(0, 2).toLowerCase();
    for (var i = 0; i < 7; i++) if (WT[i].toLowerCase() === k) return i;
    return -1;
  }
  function kurz(s) { var p = teile(s); return p[2] + '.' + p[1] + '.'; }

  // Ostersonntag (Gaußsche Osterformel, gregorianisch)
  function ostern(j) {
    var a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var monat = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(j, monat, tag);
  }
  // n-ter Adventssonntag: der 4. ist der Sonntag am oder vor dem 24.12.
  function advent(j, n) {
    var x = iso(j, 12, 24);
    x = plus(x, -wochentag(x));
    return plus(x, -(4 - n) * 7);
  }
  // n-ter Wochentag im Monat (nr -1 = letzter); null, wenn es ihn nicht gibt
  function nterWochentag(j, m, nr, w) {
    if (nr < 0) {
      var letzt = iso(j, m + 1, 0);
      return plus(letzt, -((wochentag(letzt) - w + 7) % 7) + (nr + 1) * 7);
    }
    var erst = iso(j, m, 1);
    var x = plus(erst, (w - wochentag(erst) + 7) % 7 + (nr - 1) * 7);
    return +x.slice(5, 7) === m ? x : null;
  }
  // Oktoberfest: endet am ersten Oktobersonntag (frühestens am 3.10.), beginnt 15 Tage vor diesem Sonntag
  function wiesn(j) {
    var so = nterWochentag(j, 10, 1, 0);
    var drei = iso(j, 10, 3);
    return { beginn: plus(so, -15), ende: so < drei ? drei : so };
  }
  // Aubinger Weinfest: Freitag und Samstag am letzten Juni-Wochenende (voraussichtlich)
  function weinfest(j) {
    var sa = nterWochentag(j, 6, -1, 6);
    return { beginn: plus(sa, -1), ende: sa };
  }

  function ferienArt(f) {
    var n = String(f.name || '').toLowerCase();
    if (/weihnacht/.test(n)) return 'weihnachten';
    if (/oster/.test(n)) return 'ostern';
    if (/pfingst/.test(n)) return 'pfingsten';
    if (/sommer/.test(n)) return 'sommer';
    if (/herbst|allerheiligen/.test(n)) return 'herbst';
    if (/fr(ü|ue)hjahr|winter|fasching/.test(n)) return 'fruehjahr';
    return '';
  }
  function ferienImJahr(liste, j, art) {
    return (liste || []).filter(function (f) { return ferienArt(f) === art && +f.von.slice(0, 4) === j; })[0] || null;
  }

  // ---------- Regel auswerten ----------
  function wtSchieben(x, w, richtung) {
    var d = (w - wochentag(x) + 7) % 7;    // Tage bis zum nächsten (oder gleichen) Wochentag
    if (richtung === 'nach') return plus(x, d || 7);
    if (richtung === 'ab') return plus(x, d);
    if (richtung === 'bis') return plus(x, -((7 - d) % 7));
    if (richtung === 'vor') return plus(x, -((7 - d) % 7 || 7));
    // 'um': nächstgelegener
    return d <= 3 ? plus(x, d) : plus(x, d - 7);
  }

  function tageText(n, wort) {
    return Math.abs(n) + (Math.abs(n) === 1 ? ' Tag ' : ' Tage ') + (n < 0 ? 'vor ' : 'nach ') + wort;
  }

  function regelTag(r, ctx) {
    if (!r) return null;
    var j = ctx.jahr, x = null, text = '', grundlage = '';
    if (r.monat) {
      var w = wtIndex(r.wt);
      x = nterWochentag(j, +r.monat, +r.nr || 1, w);
      text = (+r.nr === -1 ? 'letzter ' : (+r.nr || 1) + '. ') + WT_LANG[w] + ' im ' + MONAT[+r.monat - 1];
    } else if (r.datum) {
      x = j + '-' + r.datum;
      grundlage = 'dem ' + kurz(x);
      text = kurz(x);
    } else if (r.ostern != null) {
      x = plus(ostern(j), +r.ostern);
      grundlage = OSTER_NAME[String(+r.ostern)] || 'Ostern ' + (r.ostern < 0 ? '' : '+') + r.ostern + ' Tage';
      text = grundlage;
    } else if (r.advent) {
      x = advent(j, +r.advent);
      grundlage = 'dem ' + r.advent + '. Advent';
      text = r.advent + '. Advent';
    } else if (r.wiesn) {
      x = wiesn(j)[r.wiesn === 'beginn' ? 'beginn' : 'ende'];
      grundlage = r.wiesn === 'beginn' ? 'dem Wiesn-Beginn' : 'der Wiesn';
      text = r.wiesn === 'beginn' ? 'Wiesn-Beginn' : 'Ende der Wiesn';
    } else if (r.ferien) {
      var f = ctx.ferien ? ferienImJahr(ctx.ferien, j, r.ferien) : null;
      if (f) {
        x = r.rand === 'ende' ? f.bis : f.von;
        grundlage = (r.rand === 'ende' ? 'den ' : 'dem Beginn der ') + (FERIEN_NAME[r.ferien] || 'Ferien');
        text = (r.rand === 'ende' ? 'Ende der ' : 'Beginn der ') + (FERIEN_NAME[r.ferien] || 'Ferien');
      }
    } else if (r.termin) {
      var t = ctx.termin(r.termin);
      if (t && t.datum) {
        x = t.datum;
        grundlage = '„' + t.titel + '“';
        text = 'wie „' + t.titel + '“';
      }
    }
    if (!x) {
      if (r.sonst) {
        var ersatz = regelTag(r.sonst, ctx);
        if (ersatz) ersatz.ersatz = true;
        return ersatz;
      }
      return null;
    }
    if (r.tage) {
      x = plus(x, +r.tage);
      if (r.termin && grundlage) text = tageText(+r.tage, grundlage);
      else text += (r.tage > 0 ? ' + ' : ' − ') + Math.abs(r.tage) + (Math.abs(r.tage) === 1 ? ' Tag' : ' Tage');
    }
    if (r.wt && !r.monat) {
      var w2 = wtIndex(r.wt);
      var richtung = r.richtung || 'um';
      x = wtSchieben(x, w2, richtung);
      var praep = { vor: 'vor', bis: 'spätestens am', nach: 'nach', ab: 'ab', um: 'um' }[richtung] || '';
      text = WT_LANG[w2] + ' ' + praep + ' ' + (grundlage || text);
    }
    return { datum: x, text: r.text || text };
  }

  // ---------- Hindernisse zum Ausweichen ----------
  function zeitraum(beginn, dauer) {
    var tage = [];
    for (var i = 0; i < Math.max(1, dauer); i++) tage.push(plus(beginn, i));
    return tage;
  }
  function hindernis(tage, ausweichen, ctx, selbst) {
    for (var i = 0; i < ausweichen.length; i++) {
      var a = String(ausweichen[i]);
      var treffer = null;
      if (a === 'ferien') {
        if (!ctx.ferien) continue;
        treffer = ctx.ferien.filter(function (f) {
          return ferienArt(f) && tage.some(function (d) { return d >= f.von && d <= f.bis; });
        })[0];
        if (treffer) return FERIEN_NAME[ferienArt(treffer)] || 'Ferien';
      } else if (a === 'wiesn' || a === 'weinfest') {
        var z = a === 'wiesn' ? wiesn(ctx.jahr) : weinfest(ctx.jahr);
        if (tage.some(function (d) { return d >= z.beginn && d <= z.ende; })) return a === 'wiesn' ? 'Wiesn' : 'Aubinger Weinfest';
      } else if (/^termin:/.test(a)) {
        var k = a.slice(7);
        if (k === selbst) continue;
        var t = ctx.termin(k);
        if (t && t.datum) {
          var ihre = zeitraum(t.datum, t.dauer || 1);
          if (tage.some(function (d) { return ihre.indexOf(d) >= 0; })) return '„' + t.titel + '“';
        }
      } else if (/^\d{2}-\d{2}$/.test(a)) {
        if (tage.some(function (d) { return d.slice(5) === a; })) return kurz(ctx.jahr + '-' + a);
      }
    }
    return '';
  }

  // ---------- ganze Vorlage für ein Jahr ----------
  // ferien: [{ von, bis, name }] oder null (nicht geladen)
  function berechne(vorlage, jahr, ferien) {
    var quelle = (vorlage && vorlage.termine) || [];
    var nachKey = {};
    quelle.forEach(function (t, i) { if (t.key) nachKey[t.key] = i; });
    var fertig = {}, inArbeit = {}, fehler = [];
    var ctx = { jahr: +jahr, ferien: ferien || null, termin: termin };

    function termin(key) {
      if (fertig[key]) return fertig[key];
      if (!(key in nachKey)) { fehler.push('Unbekannter Termin „' + key + '“'); return null; }
      return rechne(quelle[nachKey[key]]);
    }

    function rechne(v) {
      var key = v.key || ('#' + quelle.indexOf(v));
      if (fertig[key]) return fertig[key];
      if (inArbeit[key]) { fehler.push('Regeln von „' + v.titel + '“ hängen im Kreis.'); return null; }
      inArbeit[key] = true;
      var aus = {};
      Object.keys(v).forEach(function (k) { if (k !== 'wann' && k !== 'ausweichen' && k !== 'schritt' && k !== 'dauer') aus[k] = v[k]; });
      var dauer = Math.max(1, +v.dauer || 1);
      aus.dauer = dauer;
      if (v.datum && !v.wann) {               // Vorlage mit festen Daten
        aus.datum = v.datum; aus.bis_datum = v.bis_datum || ''; aus.regel = '';
      } else {
        var r = regelTag(v.wann, ctx);
        if (!r) {
          aus.datum = ''; aus.bis_datum = ''; aus.regel = '';
          aus.warnung = v.wann && (v.wann.ferien || (v.wann.sonst && v.wann.sonst.ferien)) ? 'Ohne Schulferien nicht berechenbar.' : 'Datum nicht berechenbar.';
        } else {
          var beginn = r.datum, grund = '', warnung = '';
          var ausweichen = Array.isArray(v.ausweichen) ? v.ausweichen : [];
          var schritt = +v.schritt || 7;
          for (var n = 0; n < 6; n++) {
            var h = hindernis(zeitraum(beginn, dauer), ausweichen, ctx, v.key);
            if (!h) break;
            if (!grund) grund = h;
            if (n === 5) warnung = 'Liegt trotz Verschieben auf: ' + h;
            else beginn = plus(beginn, schritt);
          }
          aus.datum = beginn;
          aus.bis_datum = dauer > 1 ? plus(beginn, dauer - 1) : '';
          aus.regel = r.text;
          aus.verschoben = grund && beginn !== r.datum ? grund : '';
          if (r.ersatz) aus.ersatz = true;
          if (warnung) aus.warnung = warnung;
        }
      }
      inArbeit[key] = false;
      fertig[key] = aus;
      return aus;
    }

    var termine = quelle.map(rechne);
    var aufgaben = ((vorlage && vorlage.aufgaben) || []).map(function (g) {
      var a = {};
      Object.keys(g).forEach(function (k) { a[k] = g[k]; });
      if (g.frist && typeof g.frist === 'object') {
        var r = regelTag(g.frist, ctx);
        a.frist = r ? r.datum : '';
        a.fristRegel = r ? r.text : '';
      }
      return a;
    });
    return { jahr: +jahr, termine: termine, aufgaben: aufgaben, fehler: fehler, ohneFerien: !ferien };
  }

  // Braucht die Vorlage ein Jahr (also Regeln statt fester Daten)?
  function mitRegeln(vorlage) {
    return ((vorlage && vorlage.termine) || []).some(function (t) { return t.wann; });
  }

  var api = {
    berechne: berechne, mitRegeln: mitRegeln, ostern: ostern, advent: advent, wiesn: wiesn,
    weinfest: weinfest, nterWochentag: nterWochentag, ferienArt: ferienArt
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else wurzel.Jahresregeln = api;
})(typeof window !== 'undefined' ? window : this);
