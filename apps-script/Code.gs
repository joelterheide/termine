/**
 * Helferliste – Backend für Google Apps Script
 * --------------------------------------------
 * Speichert Termine, Schichten, Aufgaben und Eintragungen in diesem Google Sheet.
 * Einrichtung: siehe README.md im GitHub-Repo (Abschnitt „Einrichten“).
 *
 * Kurzfassung (am Computer, nicht am Handy):
 *   1. https://script.new öffnen (neues Apps-Script-Projekt)
 *   2. Diesen Code komplett einfügen, unten PASSWORT ändern, speichern
 *   3. Funktion „einrichten“ einmal ausführen – legt die Google-Tabelle
 *      „Helferliste – Daten“ in deinem Drive an (Link steht im Protokoll)
 *   4. Bereitstellen → Neue Bereitstellung → Web-App
 *      Ausführen als: Ich · Zugriff: Jeder
 *   5. Die Web-App-URL in config.js auf GitHub eintragen
 *
 * Alternativ geht auch: Google Sheet öffnen → Erweiterungen → Apps Script.
 * Dann werden die Daten direkt in diesem Sheet gespeichert.
 */

// ===================== EINSTELLUNG =====================

// Passwort für „Verwalten“ (Termine/Aufgaben anlegen, ändern, löschen).
// Nur hier im Apps Script eintragen, nicht auf GitHub.
// Das Passwort wird gespeichert: Wenn du später eine neue Version dieser Datei
// einfügst, kannst du 'bitte-aendern' stehen lassen – das alte Passwort gilt weiter.
const PASSWORT = 'bitte-aendern';

// ============ AB HIER NICHTS ÄNDERN NÖTIG ==============

const STANDARD_PASSWORT = 'bitte-aendern';
const ZEITZONE = 'Europe/Berlin';

const TABELLEN = {
  Termine: ['id', 'titel', 'datum', 'ort', 'info'],
  Schichten: ['id', 'termin_id', 'station', 'datum', 'von', 'bis', 'anzahl', 'info'],
  Aufgaben: ['id', 'titel', 'info', 'frist', 'anzahl'],
  Eintragungen: ['id', 'bezug', 'name', 'notiz', 'fuer', 'zeitpunkt'],
  Abstimmungen: ['id', 'titel', 'ort', 'info', 'frist', 'status', 'ergebnis', 'termin_id'],
  Optionen: ['id', 'abstimmung_id', 'datum', 'von'],
  Stimmen: ['id', 'option_id', 'name', 'zeitpunkt']
};

const ID_PRAEFIX = {
  Termine: 't', Schichten: 's', Aufgaben: 'a', Eintragungen: 'e',
  Abstimmungen: 'p', Optionen: 'o', Stimmen: 'v'
};

const SPALTENTYP = {
  datum: 'datum', frist: 'datum', von: 'zeit', bis: 'zeit',
  anzahl: 'zahl', zeitpunkt: 'zeitpunkt'
};

const VERWALTUNG = {
  anmelden: true,
  termin_speichern: true, termin_loeschen: true, termin_kopieren: true,
  schicht_speichern: true, schicht_loeschen: true,
  aufgabe_speichern: true, aufgabe_loeschen: true,
  abstimmung_speichern: true, abstimmung_loeschen: true,
  abstimmung_festlegen: true, option_loeschen: true
};

// =======================================================
// Logik (reines JavaScript, läuft auch im Demo-Modus der Website)
// =======================================================

/**
 * Führt eine Anfrage auf den Daten aus.
 * db:      { Termine: [...], Schichten: [...], Aufgaben: [...], Eintragungen: [...] }
 * anfrage: { aktion: 'eintragen', ... }
 * opt:     { passwort: '...', heute: 'JJJJ-MM-TT' }
 * Rückgabe: { aenderungen: [...], meldung: '...', id: '...' }
 */
function verarbeite(db, anfrage, opt) {
  const ctx = { db: db, opt: opt || {}, aenderungen: [] };
  if (!ctx.opt.heute) ctx.opt.heute = heuteLokal_();
  Object.keys(TABELLEN).forEach(function (t) { if (!db[t]) db[t] = []; });
  normalisiere_(ctx);
  schliesseAbgelaufene_(ctx);

  anfrage = anfrage || {};
  const aktion = String(anfrage.aktion || 'daten');
  const fn = AKTIONEN[aktion];
  if (!fn) throw fehler_('Unbekannte Aktion.');
  if (VERWALTUNG[aktion]) pruefePasswort_(ctx, anfrage.passwort);

  let ergebnis = fn(ctx, anfrage) || {};
  if (typeof ergebnis === 'string') ergebnis = { meldung: ergebnis };
  return { aenderungen: ctx.aenderungen, meldung: ergebnis.meldung || '', id: ergebnis.id || '' };
}

/** Daten so, wie die Website sie bekommt. */
function oeffentlich(db) {
  const aus = {};
  Object.keys(TABELLEN).forEach(function (t) {
    aus[t] = (db[t] || []).map(function (z) {
      const o = {};
      TABELLEN[t].forEach(function (sp) { o[sp] = z[sp] == null ? '' : String(z[sp]); });
      return o;
    });
  });
  return aus;
}

const AKTIONEN = {
  daten: function () { return ''; },

  anmelden: function () { return 'Angemeldet.'; },

  eintragen: function (ctx, a) {
    const name = einzeilig_(a.name, 60).replace(/^[=+\-@]+/, '').trim();
    if (!name) throw fehler_('Bitte deinen Namen eingeben.');
    const notiz = einzeilig_(a.notiz, 200);
    const bezug = String(a.bezug || '');
    const ziel = finde_(ctx.db.Schichten, bezug) || finde_(ctx.db.Aufgaben, bezug);
    if (!ziel) throw fehler_('Diesen Eintrag gibt es nicht mehr. Bitte Seite neu laden.');

    const liste = ctx.db.Eintragungen.filter(function (e) { return e.bezug === bezug; });
    if (liste.some(function (e) { return gleicherName_(e.name, name); })) {
      throw fehler_(name + ' ist hier schon eingetragen.');
    }
    const max = zahl_(ziel.anzahl);
    if (max > 0 && liste.length >= max) throw fehler_('Leider schon voll – jemand war schneller.');

    neu_(ctx, 'Eintragungen', {
      bezug: bezug, name: name, notiz: notiz,
      fuer: beschreibung_(ctx.db, bezug), zeitpunkt: new Date().toISOString()
    });
    return name + ' ist eingetragen.';
  },

  austragen: function (ctx, a) {
    const e = finde_(ctx.db.Eintragungen, a.id);
    if (!e) throw fehler_('Diese Eintragung gibt es nicht mehr.');
    loesche_(ctx, 'Eintragungen', e);
    return e.name + ' ist ausgetragen.';
  },

  termin_speichern: function (ctx, a) {
    const t = a.termin || {};
    const titel = einzeilig_(t.titel, 120);
    if (!titel) throw fehler_('Bitte einen Titel angeben.');
    const datum = datum_(t.datum);
    if (!datum) throw fehler_('Bitte ein gültiges Datum angeben.');
    const daten = { titel: titel, datum: datum, ort: einzeilig_(t.ort, 150), info: mehrzeilig_(t.info, 2000) };

    if (t.id) {
      const alt = finde_(ctx.db.Termine, t.id);
      if (!alt) throw fehler_('Termin nicht gefunden.');
      const versatz = tageZwischen_(datum_(alt.datum), datum);
      aendere_(ctx, 'Termine', alt, daten);
      // Schichten mit eigenem Datum (z. B. zweiter Markttag) wandern mit.
      if (versatz) {
        schichtenVon_(ctx.db, alt.id).forEach(function (s) {
          if (!s.datum) return;
          const d = plusTage_(s.datum, versatz);
          aendere_(ctx, 'Schichten', s, { datum: d === datum ? '' : d });
        });
      }
      aktualisiereFuer_(ctx, alt.id);
      return 'Termin gespeichert.';
    }
    const neu = neu_(ctx, 'Termine', daten);
    return { meldung: 'Termin angelegt.', id: neu.id };
  },

  termin_loeschen: function (ctx, a) {
    const t = finde_(ctx.db.Termine, a.id);
    if (!t) throw fehler_('Termin nicht gefunden.');
    schichtenVon_(ctx.db, t.id).forEach(function (s) { loescheSchicht_(ctx, s); });
    loesche_(ctx, 'Termine', t);
    return 'Termin gelöscht.';
  },

  termin_kopieren: function (ctx, a) {
    const t = finde_(ctx.db.Termine, a.id);
    if (!t) throw fehler_('Termin nicht gefunden.');
    const datum = datum_(a.datum);
    if (!datum) throw fehler_('Bitte ein gültiges Datum für die Kopie angeben.');
    const versatz = tageZwischen_(datum_(t.datum), datum);
    const kopie = neu_(ctx, 'Termine', { titel: t.titel, datum: datum, ort: t.ort, info: t.info });
    schichtenVon_(ctx.db, t.id).forEach(function (s) {
      let d = s.datum ? plusTage_(s.datum, versatz) : '';
      if (d === datum) d = '';
      neu_(ctx, 'Schichten', {
        termin_id: kopie.id, station: s.station, datum: d,
        von: s.von, bis: s.bis, anzahl: s.anzahl, info: s.info
      });
    });
    return { meldung: 'Termin kopiert.', id: kopie.id };
  },

  schicht_speichern: function (ctx, a) {
    const s = a.schicht || {};
    const alt = s.id ? finde_(ctx.db.Schichten, s.id) : null;
    if (s.id && !alt) throw fehler_('Schicht nicht gefunden.');
    const termin = finde_(ctx.db.Termine, alt ? alt.termin_id : s.termin_id);
    if (!termin) throw fehler_('Termin nicht gefunden.');

    const zeiten = zeiten_(s.zeiten);
    let datum = '';
    if (s.datum) {
      datum = datum_(s.datum);
      if (!datum) throw fehler_('Bitte ein gültiges Datum angeben.');
      if (datum === datum_(termin.datum)) datum = '';
    }
    const basis = {
      termin_id: termin.id,
      station: einzeilig_(s.station, 80),
      datum: datum,
      anzahl: String(zahl_(s.anzahl)),
      info: einzeilig_(s.info, 300)
    };

    if (alt) {
      if (zeiten.length > 1) throw fehler_('Beim Bearbeiten bitte nur eine Zeit angeben.');
      const z = zeiten[0] || { von: '', bis: '' };
      basis.von = z.von; basis.bis = z.bis;
      aendere_(ctx, 'Schichten', alt, basis);
      aktualisiereFuer_(ctx, termin.id);
      return 'Gespeichert.';
    }
    if (!zeiten.length) zeiten.push({ von: '', bis: '' });
    zeiten.forEach(function (z) {
      const zeile = Object.assign({}, basis, { von: z.von, bis: z.bis });
      neu_(ctx, 'Schichten', zeile);
    });
    return zeiten.length === 1 ? 'Schicht angelegt.' : zeiten.length + ' Schichten angelegt.';
  },

  schicht_loeschen: function (ctx, a) {
    const s = finde_(ctx.db.Schichten, a.id);
    if (!s) throw fehler_('Schicht nicht gefunden.');
    loescheSchicht_(ctx, s);
    return 'Schicht gelöscht.';
  },

  aufgabe_speichern: function (ctx, a) {
    const g = a.aufgabe || {};
    const titel = einzeilig_(g.titel, 120);
    if (!titel) throw fehler_('Bitte einen Titel angeben.');
    let frist = '';
    if (g.frist) {
      frist = datum_(g.frist);
      if (!frist) throw fehler_('Bitte ein gültiges Datum für „bis“ angeben.');
    }
    const daten = { titel: titel, info: mehrzeilig_(g.info, 2000), frist: frist, anzahl: String(zahl_(g.anzahl)) };
    if (g.id) {
      const alt = finde_(ctx.db.Aufgaben, g.id);
      if (!alt) throw fehler_('Aufgabe nicht gefunden.');
      aendere_(ctx, 'Aufgaben', alt, daten);
      ctx.db.Eintragungen.forEach(function (e) {
        if (e.bezug === alt.id) aendere_(ctx, 'Eintragungen', e, { fuer: beschreibung_(ctx.db, alt.id) });
      });
      return 'Aufgabe gespeichert.';
    }
    const neu = neu_(ctx, 'Aufgaben', daten);
    return { meldung: 'Aufgabe angelegt.', id: neu.id };
  },

  aufgabe_loeschen: function (ctx, a) {
    const g = finde_(ctx.db.Aufgaben, a.id);
    if (!g) throw fehler_('Aufgabe nicht gefunden.');
    eintragungenVon_(ctx.db, g.id).forEach(function (e) { loesche_(ctx, 'Eintragungen', e); });
    loesche_(ctx, 'Aufgaben', g);
    return 'Aufgabe gelöscht.';
  },

  // ---------- Abstimmungen ----------

  abstimmen: function (ctx, a) {
    const name = einzeilig_(a.name, 60).replace(/^[=+\-@]+/, '').trim();
    if (!name) throw fehler_('Bitte deinen Namen eingeben.');
    const o = finde_(ctx.db.Optionen, a.option_id);
    if (!o) throw fehler_('Diese Auswahl gibt es nicht mehr. Bitte Seite neu laden.');
    offeneAbstimmung_(ctx, o.abstimmung_id);
    if (stimmenVon_(ctx.db, o.id).some(function (v) { return gleicherName_(v.name, name); })) {
      throw fehler_(name + ' hat hier schon abgestimmt.');
    }
    neu_(ctx, 'Stimmen', { option_id: o.id, name: name, zeitpunkt: new Date().toISOString() });
    return 'Stimme gespeichert.';
  },

  stimme_entfernen: function (ctx, a) {
    const v = finde_(ctx.db.Stimmen, a.id);
    if (!v) throw fehler_('Diese Stimme gibt es nicht mehr.');
    const o = finde_(ctx.db.Optionen, v.option_id);
    if (o) offeneAbstimmung_(ctx, o.abstimmung_id);
    loesche_(ctx, 'Stimmen', v);
    return 'Stimme entfernt.';
  },

  abstimmung_speichern: function (ctx, a) {
    const g = a.abstimmung || {};
    const titel = einzeilig_(g.titel, 120);
    if (!titel) throw fehler_('Bitte einen Titel angeben.');
    const frist = datum_(g.frist);
    if (!frist) throw fehler_('Bitte angeben, bis wann abgestimmt werden kann.');
    if (frist < ctx.opt.heute) throw fehler_('„Abstimmen bis“ liegt in der Vergangenheit.');
    const daten = { titel: titel, ort: einzeilig_(g.ort, 150), info: mehrzeilig_(g.info, 2000), frist: frist };

    const neueOptionen = [];
    (g.optionen || []).forEach(function (x) {
      if (!x || (!x.datum && !x.von)) return;
      const d = datum_(x.datum);
      if (!d) throw fehler_('Bitte für jede Auswahl ein gültiges Datum angeben.');
      const z = x.von ? zeit_(x.von) : '';
      if (x.von && !z) throw fehler_('Uhrzeit „' + x.von + '“ nicht verstanden.');
      neueOptionen.push({ datum: d, von: z });
    });

    let p;
    if (g.id) {
      p = offeneAbstimmung_(ctx, g.id);
      aendere_(ctx, 'Abstimmungen', p, daten);
    } else {
      if (neueOptionen.length < 2) throw fehler_('Bitte mindestens zwei mögliche Termine angeben.');
      p = neu_(ctx, 'Abstimmungen', Object.assign({ status: '', ergebnis: '', termin_id: '' }, daten));
    }
    const vorhanden = optionenVon_(ctx.db, p.id).map(function (o) { return o.datum + ' ' + o.von; });
    neueOptionen.forEach(function (o) {
      if (vorhanden.indexOf(o.datum + ' ' + o.von) >= 0) return; // doppelt
      vorhanden.push(o.datum + ' ' + o.von);
      neu_(ctx, 'Optionen', { abstimmung_id: p.id, datum: o.datum, von: o.von });
    });
    return g.id ? 'Abstimmung gespeichert.' : { meldung: 'Abstimmung angelegt.', id: p.id };
  },

  abstimmung_loeschen: function (ctx, a) {
    const p = finde_(ctx.db.Abstimmungen, a.id);
    if (!p) throw fehler_('Abstimmung nicht gefunden.');
    optionenVon_(ctx.db, p.id).forEach(function (o) { loescheOption_(ctx, o); });
    loesche_(ctx, 'Abstimmungen', p);
    return 'Abstimmung gelöscht.';
  },

  option_loeschen: function (ctx, a) {
    const o = finde_(ctx.db.Optionen, a.id);
    if (!o) throw fehler_('Auswahl nicht gefunden.');
    offeneAbstimmung_(ctx, o.abstimmung_id);
    loescheOption_(ctx, o);
    return 'Auswahl gelöscht.';
  },

  abstimmung_festlegen: function (ctx, a) {
    const p = offeneAbstimmung_(ctx, a.id);
    const t = festlegen_(ctx, p, a.option_id);
    return { meldung: 'Termin festgelegt.', id: t.id };
  }
};

// ---------- Abstimmungen: Hilfsfunktionen ----------

function optionenVon_(db, abstimmungId) {
  return db.Optionen.filter(function (o) { return o.abstimmung_id === abstimmungId; });
}

function stimmenVon_(db, optionId) {
  return db.Stimmen.filter(function (v) { return v.option_id === optionId; });
}

function loescheOption_(ctx, o) {
  stimmenVon_(ctx.db, o.id).forEach(function (v) { loesche_(ctx, 'Stimmen', v); });
  loesche_(ctx, 'Optionen', o);
}

function offeneAbstimmung_(ctx, id) {
  const p = finde_(ctx.db.Abstimmungen, id);
  if (!p) throw fehler_('Abstimmung nicht gefunden.');
  if (p.status) throw fehler_('Die Abstimmung ist schon beendet.');
  return p;
}

/** Nach Ablauf der Frist automatisch den Termin mit den meisten Stimmen festlegen. */
function schliesseAbgelaufene_(ctx) {
  ctx.db.Abstimmungen.forEach(function (p) {
    if (!p.status && p.frist && p.frist < ctx.opt.heute) festlegen_(ctx, p, '');
  });
}

/**
 * Legt den Termin fest: die gewählte Option oder – ohne Angabe – die mit den
 * meisten Stimmen (bei Gleichstand die frühere). Ohne Stimmen: „beendet“, kein Termin.
 */
function festlegen_(ctx, p, optionId) {
  const optionen = optionenVon_(ctx.db, p.id).slice().sort(function (x, y) {
    return (x.datum + ' ' + x.von) < (y.datum + ' ' + y.von) ? -1 : 1;
  });
  let gewinner = null;
  if (optionId) {
    gewinner = finde_(optionen, optionId);
    if (!gewinner) throw fehler_('Diese Auswahl gehört nicht zur Abstimmung.');
  } else {
    let meiste = 0;
    optionen.forEach(function (o) {
      const n = stimmenVon_(ctx.db, o.id).length;
      if (n > meiste) { meiste = n; gewinner = o; }
    });
    if (!gewinner) {
      aendere_(ctx, 'Abstimmungen', p, { status: 'beendet' });
      return null;
    }
  }
  let info = gewinner.von ? 'Beginn: ' + gewinner.von + ' Uhr' : '';
  if (p.info) info += (info ? '\n' : '') + p.info;
  const t = neu_(ctx, 'Termine', { titel: p.titel, datum: gewinner.datum, ort: p.ort, info: info });
  aendere_(ctx, 'Abstimmungen', p, { status: 'festgelegt', ergebnis: gewinner.id, termin_id: t.id });
  return t;
}

function heuteLokal_() {
  const d = new Date();
  return d.getFullYear() + '-' + zweistellig_(d.getMonth() + 1) + '-' + zweistellig_(d.getDate());
}

// ---------- Hilfsfunktionen der Logik ----------

function fehler_(text) {
  const e = new Error(text);
  e.nutzerfehler = true;
  return e;
}

function pruefePasswort_(ctx, pw) {
  const soll = ctx.opt.passwort;
  if (!soll || soll === STANDARD_PASSWORT) {
    throw fehler_('Verwalten ist noch gesperrt: Bitte in Code.gs ein eigenes PASSWORT eintragen und neu bereitstellen.');
  }
  if (String(pw || '') !== String(soll)) throw fehler_('Falsches Passwort.');
}

/** Werte vereinheitlichen, fehlende oder doppelte IDs reparieren. */
function normalisiere_(ctx) {
  Object.keys(TABELLEN).forEach(function (t) {
    const gesehen = {};
    ctx.db[t].forEach(function (z) {
      TABELLEN[t].forEach(function (sp) {
        let w = z[sp] == null ? '' : String(z[sp]).trim();
        if (SPALTENTYP[sp] === 'datum') w = datum_(w) || w;
        if (SPALTENTYP[sp] === 'zeit') w = zeit_(w) || w;
        z[sp] = w;
      });
      if (!z.id || gesehen[z.id]) {
        z.id = neueId_(ctx.db, t);
        ctx.aenderungen.push({ tabelle: t, art: 'aendern', zeile: z });
      }
      gesehen[z.id] = true;
    });
  });
}

function neueId_(db, t) {
  let id;
  do {
    id = ID_PRAEFIX[t] + Math.random().toString(36).slice(2, 9);
  } while (finde_(db[t], id));
  return id;
}

function neu_(ctx, t, daten) {
  const z = { id: neueId_(ctx.db, t) };
  TABELLEN[t].forEach(function (sp) {
    if (sp !== 'id') z[sp] = daten[sp] == null ? '' : String(daten[sp]);
  });
  ctx.db[t].push(z);
  ctx.aenderungen.push({ tabelle: t, art: 'neu', zeile: z });
  return z;
}

function aendere_(ctx, t, zeile, daten) {
  Object.keys(daten).forEach(function (k) { zeile[k] = daten[k] == null ? '' : String(daten[k]); });
  ctx.aenderungen.push({ tabelle: t, art: 'aendern', zeile: zeile });
}

function loesche_(ctx, t, zeile) {
  const i = ctx.db[t].indexOf(zeile);
  if (i >= 0) ctx.db[t].splice(i, 1);
  ctx.aenderungen.push({ tabelle: t, art: 'loeschen', zeile: zeile });
}

function loescheSchicht_(ctx, s) {
  eintragungenVon_(ctx.db, s.id).forEach(function (e) { loesche_(ctx, 'Eintragungen', e); });
  loesche_(ctx, 'Schichten', s);
}

function finde_(liste, id) {
  if (!id) return null;
  for (let i = 0; i < liste.length; i++) if (liste[i].id === id) return liste[i];
  return null;
}

function schichtenVon_(db, terminId) {
  return db.Schichten.filter(function (s) { return s.termin_id === terminId; });
}

function eintragungenVon_(db, bezug) {
  return db.Eintragungen.filter(function (e) { return e.bezug === bezug; });
}

function aktualisiereFuer_(ctx, terminId) {
  schichtenVon_(ctx.db, terminId).forEach(function (s) {
    const fuer = beschreibung_(ctx.db, s.id);
    eintragungenVon_(ctx.db, s.id).forEach(function (e) {
      if (e.fuer !== fuer) aendere_(ctx, 'Eintragungen', e, { fuer: fuer });
    });
  });
}

/** Lesbarer Text für die Spalte „fuer“ im Sheet, z. B. „Adventsmarkt · Glühwein · 28.11.2026 16:00–18:00“ */
function beschreibung_(db, bezug) {
  const s = finde_(db.Schichten, bezug);
  if (s) {
    const t = finde_(db.Termine, s.termin_id) || {};
    const d = datum_(s.datum || t.datum);
    const teile = [t.titel || 'Termin'];
    if (s.station) teile.push(s.station);
    let wann = d ? d.split('-').reverse().join('.') : '';
    if (s.von) wann += (wann ? ' ' : '') + s.von + (s.bis ? '–' + s.bis : '');
    if (wann) teile.push(wann);
    return teile.join(' · ');
  }
  const g = finde_(db.Aufgaben, bezug);
  return g ? 'Aufgabe: ' + g.titel : '';
}

function einzeilig_(w, max) {
  return String(w == null ? '' : w).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function mehrzeilig_(w, max) {
  return String(w == null ? '' : w).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function gleicherName_(a, b) {
  return einzeilig_(a, 100).toLowerCase() === einzeilig_(b, 100).toLowerCase();
}

function zahl_(w) {
  const n = parseInt(String(w == null ? '' : w).trim(), 10);
  return isNaN(n) || n < 0 ? 0 : Math.min(n, 999);
}

function zweistellig_(n) { return (n < 10 ? '0' : '') + n; }

/** '2026-11-28', '28.11.2026', '28.11.26' → '2026-11-28'; ungültig → '' */
function datum_(w) {
  w = String(w == null ? '' : w).trim();
  let j, m, t, r;
  if ((r = w.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { j = +r[1]; m = +r[2]; t = +r[3]; }
  else if ((r = w.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}|\d{2})$/))) {
    t = +r[1]; m = +r[2]; j = +r[3]; if (j < 100) j += 2000;
  } else return '';
  const d = new Date(Date.UTC(j, m - 1, t));
  if (d.getUTCFullYear() !== j || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== t) return '';
  return j + '-' + zweistellig_(m) + '-' + zweistellig_(t);
}

/** '14', '14 Uhr', '14.30', '9:05' → '14:00', '14:30', '09:05'; ungültig → '' */
function zeit_(w) {
  const r = String(w == null ? '' : w).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?$/i);
  if (!r) return '';
  const h = +r[1], min = r[2] ? +r[2] : 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return '';
  return zweistellig_(h) + ':' + zweistellig_(min);
}

/** '14–16, 16:30-18 Uhr; ab 19' → [{von:'14:00',bis:'16:00'}, …] */
function zeiten_(text) {
  const teile = String(text == null ? '' : text).split(/[,;\n]+/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
  return teile.map(function (teil) {
    let r = teil.match(/^(?:von\s+)?(.+?)\s*(?:-|–|—|bis)\s*(.+)$/i);
    let von, bis;
    if (r) { von = zeit_(r[1]); bis = zeit_(r[2]); }
    else { von = zeit_(teil.replace(/^ab\s*/i, '')); bis = ''; }
    if (!von || (r && !bis)) throw fehler_('Zeit „' + teil + '“ nicht verstanden. Beispiel: 14:00–16:00, 16:00–18:00');
    return { von: von, bis: bis };
  });
}

function tageZwischen_(a, b) {
  if (!a || !b) return 0;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function plusTage_(d, n) {
  const iso = datum_(d);
  if (!iso) return d;
  const x = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
  return x.getUTCFullYear() + '-' + zweistellig_(x.getUTCMonth() + 1) + '-' + zweistellig_(x.getUTCDate());
}

// =======================================================
// Google-Sheets-Anbindung (läuft nur im Apps Script)
// =======================================================

/** Einmal im Editor ausführen: legt die Tabelle an und fragt die Berechtigung ab. */
function einrichten() {
  passwort_();
  ladeTabellen_();
  Logger.log('Fertig. Deine Daten-Tabelle: ' + tabellenDatei_().getUrl());
  Logger.log('Jetzt oben rechts „Bereitstellen → Neue Bereitstellung → Web-App“ wählen.');
}

/**
 * Die Google-Tabelle mit den Daten:
 * - Skript aus einem Sheet heraus geöffnet (Erweiterungen → Apps Script): dieses Sheet
 * - eigenständiges Skript (script.new): eine eigene Tabelle, die beim ersten Mal angelegt wird
 */
let tabellenDateiCache_ = null;
function tabellenDatei_() {
  if (tabellenDateiCache_) return tabellenDateiCache_;
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('TABELLE_ID');
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      ss = SpreadsheetApp.create('Helferliste – Daten');
      props.setProperty('TABELLE_ID', ss.getId());
    }
  }
  tabellenDateiCache_ = ss;
  return ss;
}

function doGet(e) {
  // Über GET wird nur gelesen.
  return antwort_({ aktion: 'daten' });
}

function doPost(e) {
  let anfrage = null;
  try { anfrage = JSON.parse(e.postData.contents); } catch (x) { /* ungültig */ }
  return antwort_(anfrage || { aktion: '?' });
}

function antwort_(anfrage) {
  let ergebnis;
  try {
    ergebnis = ausfuehren_(anfrage);
  } catch (err) {
    ergebnis = {
      ok: false,
      fehler: err && err.nutzerfehler ? err.message : 'Fehler auf dem Server: ' + (err && err.message ? err.message : err)
    };
    try { ergebnis.daten = ausCache_() || oeffentlich(ladeTabellen_().db); } catch (x) { /* egal */ }
  }
  return ContentService.createTextOutput(JSON.stringify(ergebnis))
    .setMimeType(ContentService.MimeType.JSON);
}

function ausfuehren_(anfrage) {
  const opt = { passwort: passwort_(), heute: Utilities.formatDate(new Date(), ZEITZONE, 'yyyy-MM-dd') };

  // Lesen geht meist aus dem Zwischenspeicher – das spart das Laden der Tabelle.
  if (anfrage.aktion === 'daten') {
    const gemerkt = ausCache_();
    if (gemerkt) return { ok: true, meldung: '', daten: gemerkt };
  }
  // Anmelden prüft nur das Passwort.
  if (anfrage.aktion === 'anmelden') {
    const erg = verarbeite({}, anfrage, opt);
    return { ok: true, meldung: erg.meldung };
  }

  // Alles andere unter Sperre: So überschreiben sich gleichzeitige Eintragungen nicht,
  // und der Zwischenspeicher enthält immer den neuesten Stand.
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ctx = ladeTabellen_();
    const erg = verarbeite(ctx.db, anfrage, opt);
    if (erg.aenderungen.length) {
      schreibe_(ctx, erg.aenderungen);
      SpreadsheetApp.flush();
    }
    const daten = oeffentlich(ctx.db);
    inCache_(daten);
    return { ok: true, meldung: erg.meldung, id: erg.id, daten: daten };
  } finally {
    lock.releaseLock();
  }
}

/** Passwort aus Code.gs – oder, falls dort noch 'bitte-aendern' steht, das zuletzt gespeicherte. */
function passwort_() {
  const props = PropertiesService.getScriptProperties();
  if (PASSWORT && PASSWORT !== STANDARD_PASSWORT) {
    if (props.getProperty('PASSWORT') !== PASSWORT) props.setProperty('PASSWORT', PASSWORT);
    return PASSWORT;
  }
  return props.getProperty('PASSWORT') || STANDARD_PASSWORT;
}

// ---------- Zwischenspeicher (CacheService, max. 100 KB je Eintrag → in Stücken) ----------

const CACHE_SCHLUESSEL = 'helferliste-daten';
const CACHE_SEKUNDEN = 120; // direkte Änderungen im Sheet erscheinen spätestens nach 2 Minuten

function inCache_(daten) {
  try {
    const text = JSON.stringify(daten);
    const marke = Math.random().toString(36).slice(2, 8);
    const teile = {};
    let n = 0;
    for (let i = 0; i < text.length; i += 30000) teile[CACHE_SCHLUESSEL + '-' + marke + '-' + (n++)] = text.slice(i, i + 30000);
    const cache = CacheService.getScriptCache();
    if (n > 25) { cache.remove(CACHE_SCHLUESSEL); return; }
    cache.putAll(teile, CACHE_SEKUNDEN + 60);
    cache.put(CACHE_SCHLUESSEL, marke + ':' + n, CACHE_SEKUNDEN);
  } catch (e) { /* ohne Zwischenspeicher geht es auch */ }
}

function ausCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const kopf = cache.get(CACHE_SCHLUESSEL);
    if (!kopf) return null;
    const marke = kopf.split(':')[0];
    const n = parseInt(kopf.split(':')[1], 10);
    const schluessel = [];
    for (let i = 0; i < n; i++) schluessel.push(CACHE_SCHLUESSEL + '-' + marke + '-' + i);
    const werte = cache.getAll(schluessel);
    let text = '';
    for (let i = 0; i < n; i++) {
      if (werte[schluessel[i]] == null) return null;
      text += werte[schluessel[i]];
    }
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function ladeTabellen_() {
  const ss = tabellenDatei_();
  const tz = ss.getSpreadsheetTimeZone();
  const db = {};
  const blaetter = {};
  let neuAngelegt = false;

  Object.keys(TABELLEN).forEach(function (name) {
    const spalten = TABELLEN[name];
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = legeBlattAn_(ss, name, spalten); neuAngelegt = true; }

    const werte = sh.getDataRange().getValues();
    const kopf = (werte[0] || []).map(function (k) { return String(k).trim().toLowerCase(); });
    while (kopf.length && kopf[kopf.length - 1] === '') kopf.pop();
    spalten.forEach(function (sp) {
      if (kopf.indexOf(sp) < 0) {
        kopf.push(sp);
        sh.getRange(1, kopf.length).setValue(sp).setFontWeight('bold');
      }
    });
    const index = {};
    spalten.forEach(function (sp) { index[sp] = kopf.indexOf(sp); });

    const zeilen = [];
    for (let r = 1; r < werte.length; r++) {
      const roh = werte[r];
      if (roh.every(function (v) { return v === '' || v === null; })) continue;
      const z = {};
      Object.defineProperty(z, '_zeile', { value: r + 1, writable: true, enumerable: false });
      spalten.forEach(function (sp) { z[sp] = zelle_(roh[index[sp]], sp, tz); });
      zeilen.push(z);
    }
    db[name] = zeilen;
    blaetter[name] = { sh: sh, index: index, breite: kopf.length };
  });

  if (neuAngelegt) entferneLeeresStandardblatt_(ss);
  return { db: db, blaetter: blaetter };
}

function legeBlattAn_(ss, name, spalten) {
  let sh;
  try {
    sh = ss.insertSheet(name);
  } catch (e) {
    sh = ss.getSheetByName(name); // gleichzeitig angelegt
    if (sh) return sh;
    throw e;
  }
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  sh.getRange(1, 1, 1, spalten.length).setValues([spalten]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function entferneLeeresStandardblatt_(ss) {
  ss.getSheets().forEach(function (sh) {
    if (!TABELLEN[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(sh); } catch (e) { /* egal */ }
    }
  });
}

function zelle_(v, spalte, tz) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const typ = SPALTENTYP[spalte];
    if (typ === 'zeit') return Utilities.formatDate(v, tz, 'HH:mm');
    if (typ === 'zeitpunkt') return v.toISOString();
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return String(v);
}

function zellwert_(w) {
  w = w == null ? '' : String(w);
  return w.charAt(0) === '=' ? "'" + w : w; // nie als Formel speichern
}

function schreibe_(ctx, aenderungen) {
  const proBlatt = {};
  aenderungen.forEach(function (a) { (proBlatt[a.tabelle] = proBlatt[a.tabelle] || []).push(a); });

  Object.keys(proBlatt).forEach(function (name) {
    const b = ctx.blaetter[name];
    const liste = proBlatt[name];
    const geloescht = liste.filter(function (a) { return a.art === 'loeschen'; }).map(function (a) { return a.zeile; });
    const istGeloescht = function (z) { return geloescht.indexOf(z) >= 0; };

    // 1. Bestehende Zeilen ändern (nur unsere Spalten, andere bleiben unberührt)
    const erledigt = [];
    liste.forEach(function (a) {
      const z = a.zeile;
      if (a.art !== 'aendern' || !z._zeile || istGeloescht(z) || erledigt.indexOf(z) >= 0) return;
      erledigt.push(z);
      const rng = b.sh.getRange(z._zeile, 1, 1, b.breite);
      const werte = rng.getValues()[0];
      TABELLEN[name].forEach(function (sp) { werte[b.index[sp]] = zellwert_(z[sp]); });
      rng.setNumberFormat('@');
      rng.setValues([werte]);
    });

    // 2. Zeilen löschen, von unten nach oben
    const zuLoeschen = geloescht.filter(function (z) { return z._zeile; })
      .map(function (z) { return z._zeile; })
      .sort(function (x, y) { return y - x; });
    if (zuLoeschen.length && b.sh.getMaxRows() - zuLoeschen.length <= b.sh.getFrozenRows()) {
      b.sh.insertRowsAfter(b.sh.getMaxRows(), 20);
    }
    zuLoeschen.forEach(function (r) { b.sh.deleteRow(r); });

    // 3. Neue Zeilen anhängen
    const neue = liste.filter(function (a) { return a.art === 'neu' && !istGeloescht(a.zeile); })
      .map(function (a) { return a.zeile; });
    if (neue.length) {
      const werte = neue.map(function (z) {
        const zeile = [];
        for (let i = 0; i < b.breite; i++) zeile.push('');
        TABELLEN[name].forEach(function (sp) { zeile[b.index[sp]] = zellwert_(z[sp]); });
        return zeile;
      });
      const start = b.sh.getLastRow() + 1;
      const rng = b.sh.getRange(start, 1, werte.length, b.breite);
      rng.setNumberFormat('@');
      rng.setValues(werte);
    }
  });
}
