/**
 * Helferliste – Backend für Google Apps Script
 * --------------------------------------------
 * Speichert Termine, Schichten, Aufgaben und Eintragungen in diesem Google Sheet.
 * Einrichtung: siehe README.md im GitHub-Repo (Abschnitt „Einrichten“).
 *
 * Kurzfassung:
 *   1. Neues Google Sheet anlegen → Erweiterungen → Apps Script
 *   2. Diesen Code komplett einfügen, unten PASSWORT ändern, speichern
 *   3. Funktion „einrichten“ einmal ausführen (legt die Tabellenblätter an)
 *   4. Bereitstellen → Neue Bereitstellung → Web-App
 *      Ausführen als: Ich · Zugriff: Jeder
 *   5. Die Web-App-URL in config.js auf GitHub eintragen
 */

// ===================== EINSTELLUNG =====================

// Passwort für „Verwalten“ (Termine/Aufgaben anlegen, ändern, löschen).
// Unbedingt ändern! Nur hier im Apps Script eintragen, nicht auf GitHub.
const PASSWORT = 'bitte-aendern';

// ============ AB HIER NICHTS ÄNDERN NÖTIG ==============

const STANDARD_PASSWORT = 'bitte-aendern';

const TABELLEN = {
  Termine: ['id', 'titel', 'datum', 'ort', 'info'],
  Schichten: ['id', 'termin_id', 'station', 'datum', 'von', 'bis', 'anzahl', 'info'],
  Aufgaben: ['id', 'titel', 'info', 'frist', 'anzahl'],
  Eintragungen: ['id', 'bezug', 'name', 'notiz', 'fuer', 'zeitpunkt']
};

const ID_PRAEFIX = { Termine: 't', Schichten: 's', Aufgaben: 'a', Eintragungen: 'e' };

const SPALTENTYP = {
  datum: 'datum', frist: 'datum', von: 'zeit', bis: 'zeit',
  anzahl: 'zahl', zeitpunkt: 'zeitpunkt'
};

const VERWALTUNG = {
  anmelden: true,
  termin_speichern: true, termin_loeschen: true, termin_kopieren: true,
  schicht_speichern: true, schicht_loeschen: true,
  aufgabe_speichern: true, aufgabe_loeschen: true
};

// =======================================================
// Logik (reines JavaScript, läuft auch im Demo-Modus der Website)
// =======================================================

/**
 * Führt eine Anfrage auf den Daten aus.
 * db:      { Termine: [...], Schichten: [...], Aufgaben: [...], Eintragungen: [...] }
 * anfrage: { aktion: 'eintragen', ... }
 * opt:     { passwort: '...' }
 * Rückgabe: { aenderungen: [...], meldung: '...', id: '...' }
 */
function verarbeite(db, anfrage, opt) {
  const ctx = { db: db, opt: opt || {}, aenderungen: [] };
  Object.keys(TABELLEN).forEach(function (t) { if (!db[t]) db[t] = []; });
  normalisiere_(ctx);

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
  }
};

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

/** Einmal im Editor ausführen: legt die Tabellenblätter an und fragt die Berechtigung ab. */
function einrichten() {
  ladeTabellen_();
  Logger.log('Fertig. Jetzt „Bereitstellen → Neue Bereitstellung → Web-App“ wählen.');
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
    try { ergebnis.daten = oeffentlich(ladeTabellen_().db); } catch (x) { /* egal */ }
  }
  return ContentService.createTextOutput(JSON.stringify(ergebnis))
    .setMimeType(ContentService.MimeType.JSON);
}

function ausfuehren_(anfrage) {
  const opt = { passwort: PASSWORT };
  const nurLesen = anfrage.aktion === 'daten' || anfrage.aktion === 'anmelden';

  if (nurLesen) {
    const ctx = ladeTabellen_();
    const erg = verarbeite(ctx.db, anfrage, opt);
    // Nur wenn im Sheet IDs fehlten, muss doch geschrieben werden.
    if (!erg.aenderungen.length) return { ok: true, meldung: erg.meldung, daten: oeffentlich(ctx.db) };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ctx = ladeTabellen_();
    const erg = verarbeite(ctx.db, anfrage, opt);
    schreibe_(ctx, erg.aenderungen);
    SpreadsheetApp.flush();
    return { ok: true, meldung: erg.meldung, id: erg.id, daten: oeffentlich(ctx.db) };
  } finally {
    lock.releaseLock();
  }
}

function ladeTabellen_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
