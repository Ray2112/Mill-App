/* Moagem — Registos v0.2.0: interface. Sem frameworks, para manter simples de manter.
   Recepção com classificação por graus (SOP-OPS-001), silos com capacidade, descarga em sequência,
   inspecções periódicas e autorização por PIN do supervisor. */
(function () {
  'use strict';
  const t = function (k) { return I18n.t(k); };
  const L = window.Logic;
  const $ = function (sel, el) { return (el || document).querySelector(sel); };
  const esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const loc = function () { return I18n.lang === 'pt' ? 'pt-PT' : 'en-GB'; };
  const fmtNum = function (n, d) { return (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString(loc(), { maximumFractionDigits: d === undefined ? 2 : d }); };
  const fmt1 = function (n) { return (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
  const fmtKg = function (n) { return fmtNum(n, 0) + ' kg'; };
  const lt = function (iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : L.today(d) + ' ' + L.nowTime(d); }; // hora local / local time
  const clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  const CEREALS = ['Milho', 'Trigo', 'Arroz'];
  const CER_KEY = { Milho: 'maize', Trigo: 'wheat', Arroz: 'rice' };
  const COLOURS = ['Amarelo', 'Branco'];
  const SILO_GRADES = ['G1', 'G2', 'OFF', 'PRI'];
  const ACCEPT_GRADES = ['G1', 'G2', 'OFF', 'PRI'];
  const ODOURS = ['N', 'MUSTY', 'SOUR', 'VISIBLE', 'BRIDGE'];
  const DISPS = ['RELEASE_NORMAL', 'RELEASE_PRIORITY', 'SEGREGATE', 'REJECT'];
  // SOP-OPS-002 Rev 0.1, Tabelas 5.1–5.3 e §5.5
  const SOP_STORE = { moist: ['13.00', '13.50', '14.00', '15.00'], temp: ['25.0', '30.0', '35.0', '40.0'], dt: ['2.0', '3.0'], shifts: ['07:00', '19:00'], weeklyDays: '7', amberRounds: '2', clearShifts: '3' };
  const PLABEL = { hum: 'moisture', brk: 'broken', fm: 'foreign', dis: 'diseased', sw: 'sw', fat: 'fat', afla: 'afla', don: 'don', fum: 'fum' };
  // Limites do SOP-OPS-001 Rev 1.0, §7 (matriz de classificação do milho)
  const SOP_MAIZE = { hum: ['13.0', '14.0', '15.0'], brk: ['3.0', '6.0', '10.0'], fm: ['1.0', '2.0', '3.0'], dis: ['0.5', '1.0', '2.0'], sw: ['72', '68', '64'], humLow: '12.5' };
  const blankG = function () { return { hum: ['', '', ''], brk: ['', '', ''], fm: ['', '', ''], dis: ['', '', ''], sw: ['', '', ''], humLow: '' }; };
  const blankM = function () { return { afla: '', don: '', fum: '', aflaRequired: false, donRequired: false, fumRequired: false }; };

  function defaults() {
    return {
      lang: 'pt', millName: '', site: '', operator: '', silos: [], suppliers: [],
      grading: { Milho: clone(SOP_MAIZE), Trigo: blankG(), Arroz: blankG() },
      myco: { Milho: blankM(), Trigo: blankM(), Arroz: blankM() },
      st: clone(SOP_STORE),
      pin: null, lastBackup: null, schema: 2
    };
  }
  // Migração das definições v0.1 / migrate v0.1 settings
  function migrate(saved) {
    const s = Object.assign(defaults(), saved || {});
    const d = defaults();
    CEREALS.forEach(function (c) {
      s.grading[c] = Object.assign(d.grading[c], (saved && saved.grading && saved.grading[c]) || {});
      s.myco[c] = Object.assign(d.myco[c], (saved && saved.myco && saved.myco[c]) || {});
    });
    if (saved && saved.limits && !saved.myco) {
      const old = { Milho: saved.limits.Milho, Trigo: saved.limits.Trigo };
      Object.keys(old).forEach(function (c) { if (old[c]) L.MYCO.forEach(function (k) { s.myco[c][k] = old[c][k] || ''; s.myco[c][k + 'Required'] = !!old[c][k + 'Required']; }); });
      delete s.limits;
    }
    s.silos = (s.silos || []).map(function (x) { return { id: x.id, cap: x.cap || '', cereal: x.cereal || '', colour: x.colour || '', grade: x.grade || '', points: x.points || '1' }; });
    s.st = Object.assign(d.st, s.st || {});
    delete s.insp;
    s.schema = 2;
    return s;
  }

  const S = { tab: 'intake', settings: null, lots: [], events: [], mon: [], sev: [], form: null, sheet: null, unlocked: false, q: '' };

  // ---------------- carregar / load ----------------
  function load() {
    return Promise.all([DB.all('lots'), DB.all('events'), DB.all('monitor'), DB.all('sevents'), DB.getSetting('main', null)]).then(function (r) {
      S.lots = r[0].sort(function (a, b) { return (b.date + b.time + b.id) < (a.date + a.time + a.id) ? -1 : 1; });
      S.events = r[1];
      S.mon = r[2];
      S.sev = r[3];
      S.settings = migrate(r[4]);
      I18n.set(S.settings.lang);
    });
  }
  function saveSettings() { return DB.setSetting('main', S.settings); }
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  // ---------------- PIN do supervisor / supervisor PIN ----------------
  // Nota: o PIN fica (em resumo SHA-256) neste telemóvel. Impede alterações casuais; não é segurança forte.
  let pinFails = 0, pinLockUntil = 0;
  function hashPin(pin, salt) {
    if (!(window.crypto && crypto.subtle)) return Promise.reject(new Error('nocrypto'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)).then(function (b) {
      return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function checkPin(pin) {
    if (!S.settings.pin) return Promise.resolve('nopin');
    if (Date.now() < pinLockUntil) return Promise.resolve('locked');
    return hashPin(String(pin || ''), S.settings.pin.salt).then(function (h) {
      if (h === S.settings.pin.hash) { pinFails = 0; return 'ok'; }
      pinFails++; if (pinFails >= 5) { pinFails = 0; pinLockUntil = Date.now() + 60000; }
      return 'bad';
    }, function () { return 'nocrypto'; });
  }
  function pinMsg(r) { return { nopin: t('pin_not_set'), locked: t('pin_locked'), bad: t('pin_wrong'), nocrypto: t('pin_nocrypto') }[r]; }
  function setPin(pin) {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return hashPin(pin, salt).then(function (h) { S.settings.pin = { salt: salt, hash: h, setAt: new Date().toISOString() }; return saveSettings(); });
  }
  // Bloco de autorização (PIN + nome + motivo) / authorization block
  function authBlock(needs, v) {
    v = v || {};
    return '<div class="authbox stack"><div class="strong">⚠ ' + esc(t('auth_needed')) + '</div><ul class="small">' + needs.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' +
      (S.settings.pin ? '' : '<p class="warn">' + esc(t('pin_not_set')) + '</p>') +
      '<div class="grid2"><label>' + esc(t('auth_by')) + '<input name="auth_by" value="' + esc(v.auth_by) + '" autocomplete="off"></label>' +
      '<label>' + esc(t('pin')) + '<input name="auth_pin" type="password" inputmode="numeric" autocomplete="off" value="' + esc(v.auth_pin) + '"></label></div>' +
      '<label>' + esc(t('auth_reason')) + '<input name="auth_reason" value="' + esc(v.auth_reason) + '" autocomplete="off"></label></div>';
  }
  function verifyAuth(v) {
    if (!(v.auth_by || '').trim() || !(v.auth_reason || '').trim()) return Promise.resolve(t('auth_fill'));
    return checkPin(v.auth_pin).then(function (r) { return r === 'ok' ? null : pinMsg(r); });
  }

  // ---------------- casca / shell ----------------
  const TITLES = { intake: 'intake_title', silos: 'silos_title', insp: 'insp_title', export: 'export_title', settings: 'settings_title' };
  function renderShell() {
    document.title = t('app_name');
    $('#title').textContent = t(TITLES[S.tab]);
    $('#mill').textContent = S.settings.millName || t('app_name');
    $('#badge').textContent = t('offline_badge');
    $('#footer').textContent = t('footer');
    document.querySelectorAll('nav button').forEach(function (b) {
      b.querySelector('span').textContent = t('tab_' + b.dataset.tab);
      b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false');
    });
  }
  function render() {
    renderShell();
    const main = $('#main');
    if (S.tab === 'intake') main.innerHTML = S.form ? intakeForm() : intakeList();
    if (S.tab === 'silos') main.innerHTML = silosView();
    if (S.tab === 'insp') main.innerHTML = inspView();
    if (S.tab === 'export') main.innerHTML = exportView();
    if (S.tab === 'settings') main.innerHTML = settingsView();
    if (S.tab === 'intake' && S.form) updateDyn();
    renderSheet();
  }

  // ---------------- etiquetas / labels ----------------
  function cerName(c) { return CER_KEY[c] ? t(CER_KEY[c]) : (c || '—'); }
  function gradeName(g) { return L.LOT_GRADES.indexOf(g) >= 0 ? t('g_' + g) : '—'; }
  function siloDesig(s) {
    if (!s.cereal || !s.grade) return t('not_designated');
    return cerName(s.cereal) + (s.colour ? ' ' + s.colour : '') + ' · ' + gradeName(s.grade);
  }
  function gradeBadge(g) { return L.LOT_GRADES.indexOf(g) >= 0 ? '<span class="badge g-' + g + '">' + esc(gradeName(g)) + '</span>' : ''; }
  function statusBadge(st) { return L.STATUS.indexOf(st) >= 0 ? '<span class="badge b-' + st + '">' + esc(t('st_' + st)) + '</span>' : ''; }
  function placeName(p) { return p === 'INTAKE' ? t('tab_intake') : p; }
  function siloById(id) { return S.settings.silos.find(function (s) { return s.id === id; }); }
  function siloHasHistory(id) { return S.events.some(function (e) { return e.silo === id || e.toSilo === id; }) || S.mon.some(function (i) { return i.silo === id; }); }
  function backupDue() {
    if (!S.lots.length && !S.events.length) return false;
    const lb = S.settings.lastBackup;
    return !lb || L.daysBetween(lb.slice(0, 10), L.today()) > 7;
  }

  // ---------------- recepção: lista / intake list ----------------
  function lotRow(l) {
    const dest = (l.dest && l.dest.length) ? ' · ' + l.dest.map(function (d) { return esc(d.silo); }).join('+') : (l.silo ? ' · ' + esc(l.silo) : '');
    const act = l.status === 'HELD' ? '<button class="btn small" data-action="release" data-id="' + esc(l.id) + '">' + esc(t('decide_held')) + '</button>' : '';
    return '<div class="card row"><div class="grow"><div class="mono">' + esc(l.id) + '</div><div class="muted small">' +
      esc(cerName(l.cereal)) + (l.colour ? ' ' + esc(l.colour) : '') + ' · ' + esc(l.supplier) + ' · ' + fmtKg(L.num(l.kg, 'kg')) + dest + '</div>' + act + '</div>' +
      '<div class="stack right">' + statusBadge(l.status) + gradeBadge(l.grade) + '</div></div>';
  }
  function intakeList() {
    const d = L.today();
    let h = '';
    if (backupDue()) h += '<p class="warn">' + esc(t('backup_due')) + '</p>';
    h += '<button class="btn primary block" data-action="new-lot">+ ' + esc(t('new_lot')) + '</button>';
    const held = S.lots.filter(function (l) { return l.status === 'HELD'; });
    if (held.length) h += '<h2>' + esc(t('lots_held')) + ' (' + held.length + ')</h2>' + held.map(lotRow).join('');
    h += '<label class="search">' + esc(t('search')) + '<input id="q" type="search" value="' + esc(S.q) + '" placeholder="' + esc(t('search_ph')) + '"></label>';
    h += '<div id="lotlist">' + lotListHtml(d) + '</div>';
    return h;
  }
  function lotListHtml(d) {
    const q = S.q.trim().toLowerCase();
    if (q) {
      const m = S.lots.filter(function (l) { return (l.id + ' ' + l.supplier + ' ' + (l.plate || '') + ' ' + (l.guia || '')).toLowerCase().indexOf(q) >= 0; });
      return m.length ? m.slice(0, 100).map(lotRow).join('') + (m.length > 100 ? '<p class="muted small">' + esc(t('more_results')) + '</p>' : '') : '<p class="muted">' + esc(t('no_results')) + '</p>';
    }
    const todays = S.lots.filter(function (l) { return l.date === d; });
    const older = S.lots.filter(function (l) { return l.date !== d; }).slice(0, 30);
    let h = '<h2>' + esc(t('lots_today')) + '</h2>' + (todays.length ? todays.map(lotRow).join('') : '<p class="muted">' + esc(t('no_lots')) + '</p>');
    if (older.length) h += '<h2>' + esc(t('lots_older')) + '</h2>' + older.map(lotRow).join('') + '<p class="muted small">' + esc(t('use_search')) + '</p>';
    return h;
  }

  // ---------------- recepção: formulário / intake form ----------------
  function newForm() {
    return { mode: 'new', date: L.today(), time: L.nowTime(), guia: '', supplier: '', origin: '', cereal: 'Milho', colour: '', plate: '', kg: '',
      hum: '', fat: '', fm: '', brk: '', dis: '', sw: '', ins: 'N', odor: 'Normal', afla: '', don: '', fum: '',
      dest: [], responsible: S.settings.operator || '', notes: '', auth_by: '', auth_pin: '', auth_reason: '' };
  }
  function releaseForm(lot) {
    return Object.assign(clone(lot), { mode: 'release', qcGrade: '', qcName: S.settings.operator || '', qcReason: '', dest: [], auth_by: '', auth_pin: '', auth_reason: '' });
  }
  function field(name, label, extra, mode) {
    const f = S.form, v = f[name];
    const invalid = (extra || '').indexOf('decimal') >= 0 && L.bad(v, mode);
    return '<label>' + esc(label) + '<input name="' + name + '" value="' + esc(v) + '"' + (extra || '') + (invalid ? ' aria-invalid="true"' : '') + '></label>';
  }
  const DEC = ' type="text" inputmode="decimal"';
  function seg(name, opts, value) {
    return '<div class="seg" role="group"><input type="hidden" name="' + name + '" value="' + esc(value) + '">' + opts.map(function (o) {
      const on = value === o[0];
      return '<button type="button" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '" data-action="seg" data-name="' + name + '" data-value="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function intakeForm() {
    const f = S.form;
    let h = '<form id="lotform" class="card stack" autocomplete="off" novalidate>';
    if (f.mode === 'release') {
      h += '<h2>' + esc(t('decide_held')) + ' · <span class="mono">' + esc(f.id) + '</span></h2>' + lotSummary(f);
      const r = L.intakeClass(f, gcfg(f.cereal), mcfg(f.cereal), f.cereal === 'Milho' ? S.settings.st : null);
      const opts = L.releaseOptions(r.matrix, r.priority);
      h += '<label>' + esc(t('qc_decision')) + '<select name="qcGrade"><option value="">—</option>' + opts.map(function (g) {
        return '<option value="' + g + '"' + (f.qcGrade === g ? ' selected' : '') + '>' + esc(g === 'REJ' ? t('st_REJECTED') : t('release_as') + ' ' + gradeName(g)) + '</option>';
      }).join('') + '<option value="HELD"' + (f.qcGrade === 'HELD' ? ' selected' : '') + '>' + esc(t('keep_held')) + '</option></select></label>';
      h += '<p class="small muted">' + esc(r.matrix ? t('release_note') : t('release_note_none')) + '</p>';
      h += '<div class="grid2">' + field('qcName', t('qc_name')) + field('qcReason', t('qc_reason')) + '</div>';
      h += '<div id="dyn"></div>';
    } else {
      h += '<h2>' + esc(t('new_lot')) + ' · <span class="mono">' + esc(L.lotCode(f.date || L.today(), S.lots)) + '</span></h2>';
      h += '<label>' + esc(t('cereal')) + '<select name="cereal">' + CEREALS.map(function (c) { return '<option value="' + c + '"' + (f.cereal === c ? ' selected' : '') + '>' + esc(cerName(c)) + '</option>'; }).join('') + '</select></label>';
      if (f.cereal === 'Milho') h += '<div class="lbl">' + esc(t('colour')) + '</div>' + seg('colour', COLOURS.map(function (c) { return [c, c]; }), f.colour);
      h += '<div class="grid2">' + field('date', t('date'), ' type="date"') + field('time', t('time'), ' type="time"') + '</div>';
      h += '<label>' + esc(t('supplier')) + '<input name="supplier" list="suppliers" value="' + esc(f.supplier) + '"></label>';
      h += '<datalist id="suppliers">' + S.settings.suppliers.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>';
      h += '<div class="grid2">' + field('guia', t('guia')) + field('plate', t('plate')) + '</div>';
      h += '<div class="grid2">' + field('origin', t('origin')) + field('kg', t('net_kg'), DEC, 'kg') + '</div>';
      h += '<h3>' + esc(t('quality')) + '</h3>';
      h += '<div class="grid2">' + field('hum', t('moisture'), DEC) + field('fat', t('fat'), DEC) + '</div>';
      h += '<div class="grid2">' + field('fm', t('foreign'), DEC) + field('brk', t('broken'), DEC) + '</div>';
      h += '<div class="grid2">' + field('dis', t('diseased'), DEC) + field('sw', t('sw'), DEC) + '</div>';
      h += '<div class="lbl">' + esc(t('odour')) + '</div>' + seg('odor', [['Normal', t('normal')], ['Anormal', t('abnormal')]], f.odor);
      h += '<div class="lbl">' + esc(t('infestation')) + '</div>' + seg('ins', [['N', t('no')], ['S', t('yes')]], f.ins);
      h += '<details' + (f.afla || f.don || f.fum ? ' open' : '') + '><summary class="lbl">' + esc(t('myco_optional')) + '</summary><div class="grid3">' +
        field('afla', t('afla'), DEC) + field('don', t('don'), DEC) + field('fum', t('fum'), DEC) + '</div></details>';
      h += '<div id="dyn"></div>';
      h += '<div class="grid2">' + field('responsible', t('responsible') + ' *') + field('notes', t('notes')) + '</div>';
    }
    h += '<div class="grid2"><button type="button" class="btn" data-action="cancel-lot">' + esc(t('cancel')) + '</button><button type="submit" class="btn primary">' + esc(f.mode === 'release' ? t('confirm') : t('save_lot')) + '</button></div>';
    return h + '</form>';
  }
  function lotSummary(l) {
    const rows = [['net_kg', fmtKg(L.num(l.kg, 'kg'))], ['moisture', l.hum], ['fat', l.fat], ['foreign', l.fm], ['broken', l.brk], ['diseased', l.dis], ['sw', l.sw],
      ['odour', l.odor === 'Anormal' ? t('abnormal') : t('normal')], ['infestation', l.ins === 'S' ? t('yes') : t('no')], ['afla', l.afla], ['don', l.don], ['fum', l.fum]];
    return '<div class="small muted">' + esc(cerName(l.cereal)) + (l.colour ? ' ' + esc(l.colour) : '') + ' · ' + esc(l.supplier) + ' · ' + esc(l.date) + ' ' + esc(l.time) + '</div>' +
      '<div class="kv small">' + rows.filter(function (r) { return r[1] !== null && r[1] !== undefined && r[1] !== ''; }).map(function (r) { return '<span>' + esc(t(r[0])) + '</span><b>' + esc(r[1]) + '</b>'; }).join('') + '</div>' +
      ((l.holdReasons || []).length ? '<p class="warn small">' + esc(t('held_because')) + ' ' + l.holdReasons.map(function (x) { return esc(t('hold_' + x)); }).join(' · ') + '</p>' : '');
  }
  function gcfg(c) { return S.settings.grading[c] || {}; }
  function mcfg(c) { return S.settings.myco[c] || {}; }

  // Grau efectivo e decisão / effective grade and decision
  function formDecision() {
    const f = S.form;
    const r = L.intakeClass(f, gcfg(f.cereal), mcfg(f.cereal), f.cereal === 'Milho' ? S.settings.st : null);
    if (f.mode === 'release') {
      const g = f.qcGrade;
      return { r: r, grade: ACCEPT_GRADES.indexOf(g) >= 0 ? g : null, status: g === 'REJ' ? 'REJECTED' : g === 'HELD' || !g ? 'HELD' : 'ACCEPTED', kg: L.num(f.kg, 'kg') };
    }
    const status = r.code === 'REJ' ? 'REJECTED' : (r.code === 'HOLD' || r.code === 'NONE') ? 'HELD' : ACCEPT_GRADES.indexOf(r.code) >= 0 ? 'ACCEPTED' : null;
    return { r: r, grade: status === 'ACCEPTED' ? r.code : null, status: status, kg: L.num(f.kg, 'kg') };
  }
  // Silos possíveis para um item (cereal/cor/grau) / candidate silos
  function candidates(item, excludeId) {
    return S.settings.silos.filter(function (s) { return s.id !== excludeId; }).map(function (s) {
      let fit = L.siloFit(item, s);
      const ss = siloSt(s);
      if (fit.ok && (ss.held || ss.rejected || ss.level >= 4)) fit = { ok: false, why: 'held' };
      const free = L.freeSpace(s, S.events);
      return { s: s, fit: fit, free: free, ss: ss };
    });
  }
  function destPlan(item, kg, order) {
    const slots = order.map(function (id) { const s = siloById(id); return { id: id, avail: s ? (L.freeSpace(s, S.events) || 0) : 0 }; });
    const a = L.allocate(kg || 0, slots);
    const mism = a.parts.filter(function (p) { const s = siloById(p.silo); return s && L.siloFit(item, s).mismatch; }).map(function (p) { return p.silo; });
    return { parts: a.parts, short: a.short, mismatch: mism };
  }
  function resultBox(d) {
    const f = S.form, r = d.r;
    let cls = 'd3', title = '', body = [];
    const why = function (x) { return esc(t(PLABEL[x.k])) + ' ' + esc(fmtNum(x.v)) + ' → ' + esc(gradeName(L.GRADES[x.level])); };
    if (f.mode === 'release') {
      cls = 'd3'; title = t('matrix_grade') + ': ' + (r.matrix ? gradeName(r.matrix) : t('not_graded'));
      body = r.reasons.map(why);
    } else if (r.code === 'INVALID') { cls = 'd2'; title = t('check_values'); body = [r.invalid.map(function (k) { return esc(t(PLABEL[k])); }).join(', ')]; }
    else if (r.code === 'INCOMPLETE') { title = t('enter_values'); body = [r.missing.map(function (k) { return esc(t(PLABEL[k])); }).join(', ')]; }
    else if (r.code === 'NONE') { cls = 'd1'; title = t('not_graded'); body = [esc(t('no_grading_limits'))]; }
    else if (r.code === 'HOLD') { cls = 'd1'; title = t('HOLD'); body = r.hold.map(function (x) { return esc(t('hold_' + x)); }).concat([esc(t('matrix_grade')) + ': ' + esc(r.matrix ? gradeName(r.matrix) : t('not_graded')), esc(t('hold_note'))]); }
    else if (r.code === 'REJ') { cls = 'd2'; title = t('g_REJ'); body = r.reasons.filter(function (x) { return x.level === 3; }).map(why).concat([esc(t('reject_note'))]); }
    else if (r.code === 'PRI') { cls = 'd1'; title = gradeName('PRI'); body = r.reasons.map(why).concat([esc(t('pri_note')) + ' ' + esc(gradeName(r.baseGrade)) + '.']); }
    else { cls = r.code === 'OFF' ? 'd1' : 'd0'; title = gradeName(r.code); body = r.reasons.map(why); if (!body.length) body = [esc(t('all_ok'))]; if (r.code === 'OFF') body.push(esc(t('off_note'))); }
    let h = '<div class="decision ' + cls + '"><div class="small caps">' + esc(f.mode === 'release' ? t('qc_info') : t('auto_grade')) + '</div><div class="big">' + esc(title) + '</div>' +
      body.map(function (b) { return '<div>' + b + '</div>'; }).join('');
    if (r.notes.indexOf('low_moisture') >= 0) h += '<div class="small">' + esc(t('low_moisture')) + '</div>';
    if (r.moistBand !== null && r.moistBand !== undefined) h += '<div class="small"><span class="dot lv' + r.moistBand + '"></span>' + esc(t('storage_band')) + ': <b>' + esc(t('lv_' + r.moistBand)) + '</b> — ' + esc(t('mb_' + r.moistBand)) + '</div>';
    if (r.notAssessed.length) h += '<div class="small">' + esc(t('not_assessed')) + r.notAssessed.map(function (k) { return esc(t(PLABEL[k])); }).join(', ') + '</div>';
    if (f.mode !== 'release' && d.kg !== null && !isNaN(d.kg)) h += '<div class="small">' + esc(t('kg_read_as')) + ' ' + fmtKg(d.kg) + '</div>';
    return h + '</div>';
  }
  function pickerHtml(item, kg, order, plan, opts) {
    opts = opts || {};
    const cands = candidates(item, opts.exclude);
    const avail = cands.filter(function (c) { return c.fit.ok && !c.fit.mismatch && c.free !== null && c.free > 0 && order.indexOf(c.s.id) < 0; });
    const other = cands.filter(function (c) { return c.fit.ok && c.fit.mismatch && order.indexOf(c.s.id) < 0; });
    const blocked = cands.filter(function (c) { return c.fit.ok && !c.fit.mismatch && (c.free === null || c.free <= 0) && order.indexOf(c.s.id) < 0; });
    let h = '<div class="stack"><div class="lbl strong">' + esc(t('silos_for')) + ' ' + esc(cerName(item.cereal)) + (item.colour ? ' ' + esc(item.colour) : '') + ' · ' + esc(gradeName(item.grade)) + '</div>';
    h += avail.length ? '<div class="chips">' + avail.map(function (c) { return '<button type="button" class="chip" data-action="dest-add" data-silo="' + esc(c.s.id) + '">+ ' + esc(c.s.id) + ' <span class="muted">' + esc(t('free')) + ' ' + fmtKg(c.free) + '</span></button>'; }).join('') + '</div>'
      : '<p class="warn small">' + esc(t('no_silo_available')) + '</p>';
    const heldC = cands.filter(function (c) { return c.fit.why === 'held' && order.indexOf(c.s.id) < 0 && L.siloFit(item, c.s).ok; });
    if (heldC.length) h += '<div class="small flag">' + heldC.map(function (c) { return esc(c.s.id) + ': ' + esc(t('silo_held_short')); }).join(' · ') + '</div>';
    if (blocked.length) h += '<div class="small muted">' + blocked.map(function (c) { return esc(c.s.id) + ': ' + esc(c.free === null ? t('cap_not_set') : t('silo_full')); }).join(' · ') + '</div>';
    if (order.length) {
      h += '<div class="lbl">' + esc(t('dest_order')) + '</div>';
      h += order.map(function (id, i) {
        const p = plan.parts.find(function (x) { return x.silo === id; });
        const s = siloById(id);
        const mism = plan.mismatch.indexOf(id) >= 0;
        const blend = blendWarn(item, s);
        return (blend ? '<p class="warn small">' + esc(blend) + '</p>' : '') + '<div class="row destrow' + (mism ? ' mism' : '') + '"><span class="mono">' + (i + 1) + '. ' + esc(id) + '</span><span class="grow small muted">' + esc(s ? siloDesig(s) : '') + '</span><span class="strong">' + (p ? fmtKg(p.kg) : '0 kg') + '</span>' +
          '<button type="button" class="btn small" data-action="dest-rm" data-silo="' + esc(id) + '" aria-label="' + esc(t('remove')) + '">✕</button></div>';
      }).join('');
      if (plan.short > 0) h += '<p class="warn small">' + esc(t('short_space')) + ' ' + fmtKg(plan.short) + '</p>';
    }
    if (other.length) {
      h += '<details><summary class="small">' + esc(t('other_grade_silos')) + '</summary><div class="chips">' + other.map(function (c) {
        const full = c.free === null || c.free <= 0;
        return '<button type="button" class="chip warnchip" data-action="dest-add" data-silo="' + esc(c.s.id) + '"' + (full ? ' disabled' : '') + '>⚠ ' + esc(c.s.id) + ' · ' + esc(gradeName(c.s.grade)) + ' <span class="muted">' + esc(full ? (c.free === null ? t('cap_not_set') : t('silo_full')) : t('free') + ' ' + fmtKg(c.free)) + '</span></button>';
      }).join('') + '</div></details>';
    }
    return h + '</div>';
  }
  function authNeeds(grade, plan) {
    const n = [];
    if (grade === 'OFF') n.push(t('auth_offgrade'));
    if (grade === 'PRI') n.push(t('auth_pri'));
    plan.mismatch.forEach(function (id) { n.push(t('auth_mismatch') + ' ' + id + ' (' + gradeName(siloById(id).grade) + ' ≠ ' + gradeName(grade) + ')'); });
    return n;
  }
  function updateDyn() {
    const box = $('#dyn'); if (!box || !S.form) return;
    const f = S.form, d = formDecision();
    let h = resultBox(d);
    if (d.status === 'ACCEPTED' && d.grade) {
      const item = { cereal: f.cereal, colour: f.colour, grade: d.grade, hum: f.hum };
      if (f.cereal === 'Milho' && !f.colour) h += '<p class="warn">' + esc(t('need_colour')) + '</p>';
      else {
        const plan = destPlan(item, d.kg, f.dest);
        h += pickerHtml(item, d.kg, f.dest, plan);
        const needs = authNeeds(d.grade, plan);
        if (needs.length) h += authBlock(needs, f);
      }
    } else if (f.mode === 'release' && d.status === 'REJECTED') h += '<p class="warn small">' + esc(t('reject_note')) + '</p>';
    box.innerHTML = h;
  }
  // Grava novo lote com código único (nunca sobrescreve) / save with unique code
  function addLotUnique(lot, events, tries) {
    tries = tries || 0;
    return DB.all('lots').then(function (all) {
      lot.id = L.lotCode(lot.date, all);
      return DB.addMany([{ store: 'lots', obj: lot }].concat(events.map(function (e) { e.lot = lot.id; e.lots = [lot.id]; return { store: 'events', obj: e }; })));
    }).catch(function (err) {
      if (tries < 3 && err && err.name === 'ConstraintError') return addLotUnique(lot, events, tries + 1);
      throw err;
    });
  }
  function saveLot() {
    const f = S.form;
    if (f.mode === 'release') return saveRelease();
    const kg = L.num(f.kg, 'kg');
    if (!f.date || !f.supplier.trim() || !f.cereal || kg === null || isNaN(kg) || kg <= 0 || !f.responsible.trim()) { toast(t('need_fields')); return; }
    if (f.cereal === 'Milho' && !f.colour) { toast(t('need_colour')); return; }
    const d = formDecision(), r = d.r;
    if (r.code === 'INVALID') { toast(t('check_values')); return; }
    if (r.code === 'INCOMPLETE') { toast(t('enter_values') + ': ' + r.missing.map(function (k) { return t(PLABEL[k]); }).join(', ')); return; }
    const now = new Date().toISOString();
    const lot = {
      id: '', date: f.date, time: f.time, guia: f.guia, supplier: f.supplier.trim(), origin: f.origin, cereal: f.cereal, colour: f.cereal === 'Milho' ? f.colour : '',
      plate: f.plate, kg: kg, hum: L.num(f.hum), fat: L.num(f.fat), fm: L.num(f.fm), brk: L.num(f.brk), dis: L.num(f.dis), sw: L.num(f.sw),
      ins: f.ins, odor: f.odor, afla: L.num(f.afla), don: L.num(f.don), fum: L.num(f.fum),
      matrix: r.matrix, auto: r.code, reasons: r.reasons, holdReasons: r.hold, gradeNotes: r.notes, grade: d.grade, status: d.status,
      dest: [], auth: [], responsible: f.responsible.trim(), notes: f.notes, createdAt: now,
      history: [{ at: now, status: d.status, grade: d.grade, by: f.responsible.trim() }]
    };
    finishAccept(lot, d, f, function (lot2, evs) {
      addLotUnique(lot2, evs).then(function () { return after(f.responsible, lot2.supplier); }).then(function () {
        S.form = null; render(); toast(t('saved') + ': ' + lot2.id + ' · ' + t('st_' + lot2.status) + (lot2.grade ? ' · ' + gradeName(lot2.grade) : ''));
      }).catch(function () { toast(t('save_failed')); });
    });
  }
  // Para lotes aceites: valida silos, capacidade e autorizações; depois chama done(lot, events)
  function finishAccept(lot, d, f, done) {
    if (d.status !== 'ACCEPTED') { done(lot, []); return; }
    const item = { cereal: lot.cereal, colour: lot.colour, grade: d.grade };
    if (!f.dest.length) { toast(t('need_silo')); return; }
    const plan = destPlan(item, lot.kg, f.dest);
    if (plan.short > 0) { toast(t('short_space') + ' ' + fmtKg(plan.short)); return; }
    const bad = f.dest.filter(function (id) { const s = siloById(id); if (!s || !L.siloFit(item, s).ok) return true; const ss = siloSt(s); return ss.held || ss.rejected || ss.level >= 4; });
    if (bad.length) { toast(t('silo_not_allowed') + ' ' + bad.join(', ')); return; }
    const needs = authNeeds(d.grade, plan);
    const go = function () {
      const by = (f.mode === 'release' ? f.qcName : f.responsible) || '';
      const auth = needs.length ? { at: new Date().toISOString(), by: f.auth_by.trim(), reason: f.auth_reason.trim(), items: needs } : null;
      if (auth) lot.auth = (lot.auth || []).concat([auth]);
      lot.dest = plan.parts;
      const evs = plan.parts.map(function (p) {
        return { date: L.today(), time: L.nowTime(), silo: p.silo, type: 'IN', lot: lot.id, lots: [lot.id], kg: p.kg, place: 'INTAKE', prodLot: '', operator: by.trim(),
          notes: plan.mismatch.indexOf(p.silo) >= 0 ? t('auth_mismatch') + ' — ' + (auth ? auth.by + ': ' + auth.reason : '') : '', auth: plan.mismatch.indexOf(p.silo) >= 0 ? auth : null };
      });
      if (f.mode === 'new') evs.forEach(function (e) { e.date = f.date; e.time = f.time; });
      done(lot, evs);
    };
    if (!needs.length) { go(); return; }
    verifyAuth(f).then(function (err) { if (err) { toast(err); return; } f.auth_pin = ''; go(); });
  }
  function saveRelease() {
    const f = S.form;
    if (!f.qcGrade) { toast(t('need_qc_decision')); return; }
    if (!(f.qcName || '').trim() || !(f.qcReason || '').trim()) { toast(t('need_qc_fields')); return; }
    const d = formDecision();
    const lot = S.lots.find(function (l) { return l.id === f.id; });
    if (!lot || lot.status !== 'HELD') { toast(t('save_failed')); return; }
    const now = new Date().toISOString();
    const upd = clone(lot);
    upd.status = d.status; upd.grade = d.grade;
    upd.qc = (upd.qc || []).concat([{ at: now, decision: f.qcGrade, by: f.qcName.trim(), reason: f.qcReason.trim() }]);
    upd.history = (upd.history || []).concat([{ at: now, status: d.status, grade: d.grade, by: f.qcName.trim(), reason: f.qcReason.trim() }]);
    finishAccept(upd, d, f, function (lot2, evs) {
      DB.addMany([{ store: 'lots', obj: lot2, put: true }].concat(evs.map(function (e) { return { store: 'events', obj: e }; })))
        .then(function () { return after(f.qcName, null); })
        .then(function () { S.form = null; render(); toast(t('saved') + ': ' + lot2.id + ' · ' + t('st_' + lot2.status)); })
        .catch(function () { toast(t('save_failed')); });
    });
  }
  function after(person, supplier) {
    if (person && person.trim()) S.settings.operator = person.trim();
    if (supplier && S.settings.suppliers.indexOf(supplier) < 0) S.settings.suppliers.push(supplier);
    return saveSettings().then(load);
  }

  // ---------------- silos ----------------
  // Estado de armazenagem de um silo (SOP-OPS-002) / storage status of a silo
  function siloSt(s) {
    const c = L.siloContents(s.id, S.events);
    const byId = {}; S.lots.forEach(function (l) { byId[l.id] = l; });
    return Object.assign(L.siloStatus({ siloId: s.id, recs: S.mon, sevents: S.sev.filter(function (e) { return e.silo === s.id; }),
      lots: c.lots.map(function (id) { return byId[id]; }).filter(Boolean), emptyStamp: c.lastEmpty ? L.recStamp(c.lastEmpty) : null,
      st: S.settings.st, now: { date: L.today(), time: L.nowTime() }, kg: c.kg }), { kg: c.kg, lots: c.lots });
  }
  function lvChip(ss) {
    if (ss.noData) return '<span class="badge b-none">' + esc(t('lv_nodata')) + '</span>';
    return '<span class="badge lv' + ss.level + '">' + esc(t('lv_' + ss.level)) + '</span>';
  }
  function drvText(d, ss) {
    const ev = ss.lastEval || {};
    if (d.p === 'temp') return t('drv_temp') + ' ' + fmt1(d.v) + ' °C' + (ev.maxPoint ? ' (P' + ev.maxPoint + ')' : '');
    if (d.p === 'dt') return 'ΔT ' + (d.v > 0 ? '+' : '') + fmt1(d.v) + ' °C' + (ev.dtPoint ? ' (P' + ev.dtPoint + ')' : '');
    if (d.p === 'odour') return t('od_' + d.v);
    if (d.p === 'fault') return t('drv_fault');
    if (d.p === 'moist') return t('drv_moist') + ' ' + fmtNum(d.v) + ' %';
    if (d.p === 'moist_entry') return t('drv_moist_entry') + ' ' + fmtNum(d.v) + ' %';
    if (d.p === 'moist_rise') return t('drv_moist_rise') + ' +' + fmtNum(d.v) + ' %';
    if (d.p === 'insects') return t('drv_insects') + ': ' + fmtNum(d.v, 0);
    if (d.p === 'treat_pending') return t('drv_treat') + ' ' + d.v;
    return d.p;
  }
  function drvList(ss, minLevel) {
    const ds = ss.drivers.filter(function (d) { return d.level >= (minLevel || 0); });
    return ds.length ? '<div class="drivers">' + ds.map(function (d) { return '<span class="drv"><span class="dot lv' + d.level + '"></span>' + esc(drvText(d, ss)) + '</span>'; }).join('') + '</div>' : '';
  }
  function ageText(ss) {
    if (ss.ageDays !== null) return t('age') + ': ' + ss.ageDays + ' ' + t('days');
    if (ss.unknownAge) return t('age_unknown');
    return '';
  }
  // Aviso "não misturar húmido em seco" (SOP-OPS-002 passo 3, erro 5)
  function blendWarn(item, s) {
    if (!s || item.hum === undefined) return '';
    const lb = L.moistBand(item.hum, S.settings.st);
    if (lb === null) return '';
    const ss = siloSt(s);
    if (!ss.lots.length || ss.kg <= 0) return '';
    const m = ss.drivers.find(function (d) { return d.p === 'moist' || d.p === 'moist_entry'; });
    if (!m || lb <= m.level) return '';
    return s.id + ': ' + t('blend_warn') + ' (' + t('lv_' + lb) + ' → ' + t('lv_' + m.level) + ')';
  }
  function silosView() {
    if (!S.settings.silos.length) return '<p class="warn">' + esc(t('no_silos')) + '</p>';
    const lotsById = {}; S.lots.forEach(function (l) { lotsById[l.id] = l; });
    let h = '<button class="btn primary block" data-action="discharge">' + esc(t('act_out')) + '</button>';
    S.settings.silos.forEach(function (s) {
      const ss = siloSt(s), c = { kg: ss.kg, lots: ss.lots };
      const cap = L.num(s.cap, 'kg');
      const hasCap = cap !== null && !isNaN(cap) && cap > 0;
      const pct = hasCap ? Math.min(100, Math.round(c.kg / cap * 100)) : null;
      const full = hasCap && c.kg >= cap;
      const blockOut = ss.held || ss.rejected;
      h += '<div class="card stack"><div class="row"><div class="grow"><div class="big2">' + esc(s.id) + ' ' + lvChip(ss) + '</div><div class="small muted">' + esc(siloDesig(s)) + (ageText(ss) ? ' · ' + esc(ageText(ss)) : '') + '</div></div>' +
        '<div class="right"><div class="strong">' + fmtKg(c.kg) + '</div><div class="small muted">' + (hasCap ? esc(t('of')) + ' ' + fmtKg(cap) + ' · ' + pct + '%' : esc(t('cap_not_set'))) + '</div></div></div>';
      if (hasCap) h += '<div class="bar' + (full ? ' full' : '') + '"><div style="width:' + pct + '%"></div></div>';
      if (full) h += '<div class="badge b-REJECTED fit">' + esc(t('silo_full')) + '</div>';
      if (c.kg < 0) h += '<p class="warn small">' + esc(t('negative_stock')) + '</p>';
      if (ss.held) h += '<p class="holdbar">⛔ ' + esc(t('held_banner')) + '</p>';
      if (ss.rejected) h += '<p class="holdbar">⛔ ' + esc(t('rejected_banner')) + '</p>';
      h += drvList(ss, 1);
      h += '<details><summary class="small muted">' + esc(t('lots_in_silo')) + ' (' + c.lots.length + ')</summary>' +
        (c.lots.length ? c.lots.map(function (id) { const l = lotsById[id]; return '<div class="row small"><span class="mono grow">' + esc(id) + '</span><span class="muted">' + (l ? esc(l.date) + ' · ' + esc(l.supplier) + ' · ' + esc(gradeName(l.grade)) : '') + '</span></div>'; }).join('') : '<div class="muted small">' + esc(t('empty_silo')) + '</div>') + '</details>';
      const dis = c.kg > 0 && !blockOut ? '' : ' disabled';
      h += '<div class="grid2"><button class="btn small" data-action="discharge" data-silo="' + esc(s.id) + '"' + dis + '>' + esc(t('act_out_short')) + '</button>' +
        '<button class="btn small" data-action="silo-transfer" data-silo="' + esc(s.id) + '"' + dis + '>' + esc(t('act_transfer')) + '</button>' +
        '<button class="btn small" data-action="mon-round" data-silo="' + esc(s.id) + '">' + esc(t('act_round')) + '</button>' +
        '<button class="btn small" data-action="silo-empty" data-silo="' + esc(s.id) + '">' + esc(t('act_empty')) + '</button></div></div>';
    });
    const evs = L.sortEvents(S.events).reverse().slice(0, 50);
    h += '<h2>' + esc(t('events')) + '</h2>';
    h += evs.length ? evs.map(function (e) {
      const what = e.type === 'TRANSFER' ? esc(e.silo) + ' → ' + esc(e.toSilo) : esc(e.silo);
      return '<div class="card row small"><div class="grow"><strong>' + esc(t('ev_' + e.type)) + '</strong> · ' + what + (e.place && e.type === 'OUT' ? ' → ' + esc(placeName(e.place)) : '') + (e.auth ? ' · <span class="flag">⚠ ' + esc(t('authorized')) + '</span>' : '') +
        '<div class="muted">' + esc(e.date) + ' ' + esc(e.time) + (e.lots && e.lots.length ? ' · ' + e.lots.map(esc).join(', ') : '') + (e.prodLot ? ' · ' + esc(e.prodLot) : '') + (e.operator ? ' · ' + esc(e.operator) : '') + '</div></div><div>' + (e.kg ? fmtKg(e.kg) : (e.type === 'EMPTY' && e.writeOff ? '−' + fmtKg(e.writeOff) : '')) + '</div></div>';
    }).join('') : '<p class="muted">' + esc(t('no_events')) + '</p>';
    return h;
  }

  // ---------------- monitorização / storage monitoring (SOP-OPS-002) ----------------
  function shiftLabel(sh) { return sh.date + ' · ' + t('shift') + ' ' + sh.start + '–' + sh.end; }
  function inspView() {
    if (!S.settings.silos.length) return '<p class="warn">' + esc(t('no_silos')) + '</p>';
    const all = S.settings.silos.map(function (s) { return { s: s, ss: siloSt(s) }; });
    const cur = L.shiftOf(L.today(), L.nowTime(), S.settings.st.shifts);
    const needed = all.filter(function (x) { return x.ss.roundsNeed > 0; });
    const done = needed.filter(function (x) { return x.ss.roundsDone >= x.ss.roundsNeed; }).length;
    let h = '<div class="card stack"><div class="row"><div class="grow"><div class="small muted caps">' + esc(t('current_shift')) + '</div><div class="strong">' + esc(shiftLabel(cur)) + '</div></div>' +
      '<div class="right"><div class="big2">' + done + '/' + needed.length + '</div><div class="small muted">' + esc(t('rounds_done')) + '</div></div></div>' +
      '<p class="small muted">' + esc(t('mon_source')) + '</p></div>';
    all.forEach(function (x) {
      const s = x.s, ss = x.ss;
      const openEv = S.sev.find(function (e) { return e.silo === s.id && e.status === 'OPEN'; });
      h += '<div class="card stack"><div class="row"><div class="grow"><div class="big2">' + esc(s.id) + ' ' + lvChip(ss) + '</div><div class="small muted">' + esc(siloDesig(s)) + ' · ' + fmtKg(ss.kg) + (ageText(ss) ? ' · ' + esc(ageText(ss)) : '') + '</div></div></div>';
      if (ss.level === 5) h += '<p class="holdbar">🚨 ' + esc(t('emerg_banner')) + '</p>';
      if (ss.held) h += '<p class="holdbar">⛔ ' + esc(t('held_banner')) + '</p>';
      if (ss.rejected) h += '<p class="holdbar">⛔ ' + esc(t('rejected_banner')) + '</p>';
      if (ss.level === 3) h += '<p class="warn small">' + esc(t('orange_banner')) + '</p>';
      if (ss.lastDisp && !ss.held) h += '<p class="small">' + esc(t('disp_last')) + ': <b>' + esc(t('disp_' + ss.lastDisp.decision)) + '</b> — ' + esc(ss.lastDisp.by) + ', ' + esc(ss.lastDisp.date) + '</p>';
      h += drvList(ss, 0);
      if (ss.roundsNeed > 0) {
        const late = ss.roundsDone < ss.roundsNeed;
        h += '<div class="small' + (late ? ' flag' : '') + '">' + (late ? '⏰ ' : '✓ ') + esc(t('round_shift')) + ': ' + ss.roundsDone + '/' + ss.roundsNeed + (ss.roundsNeed > 1 ? ' (' + esc(t('round_twice')) + ')' : '') + '</div>';
      }
      if (ss.weeklyDue) h += '<div class="small flag">⏰ ' + esc(t('weekly_due')) + (ss.lastWeekly ? ' (' + esc(t('last')) + ': ' + esc(ss.lastWeekly.date) + ')' : '') + '</div>';
      else if (ss.lastWeekly) h += '<div class="small muted">' + esc(t('weekly_last')) + ': ' + esc(ss.lastWeekly.date) + '</div>';
      if (openEv) h += '<div class="row small"><span class="grow flag">⚠ ' + esc(t('event_open')) + ' ' + esc(openEv.date) + '</span><button class="btn small" data-action="mon-event" data-id="' + esc(openEv.id) + '">' + esc(t('event_btn')) + '</button></div>';
      h += '<div class="grid3"><button class="btn small" data-action="mon-round" data-silo="' + esc(s.id) + '">' + esc(t('act_round')) + '</button>' +
        '<button class="btn small" data-action="mon-weekly" data-silo="' + esc(s.id) + '">' + esc(t('act_weekly')) + '</button>' +
        '<button class="btn small" data-action="mon-treat" data-silo="' + esc(s.id) + '">' + esc(t('act_treat')) + '</button></div>';
      if (ss.held) h += '<button class="btn small primary" data-action="mon-disp" data-silo="' + esc(s.id) + '">' + esc(t('act_disp')) + '</button>';
      h += '</div>';
    });
    // Revisão semanal de idade (passo 8)
    const rev = all.filter(function (x) { return x.ss.kg > 0; }).sort(function (a, b) {
      if (b.ss.level !== a.ss.level) return b.ss.level - a.ss.level;
      const aa = a.ss.ageDays === null ? 99999 : a.ss.ageDays, bb = b.ss.ageDays === null ? 99999 : b.ss.ageDays;
      return bb - aa;
    });
    h += '<h2>' + esc(t('age_review')) + '</h2><p class="small muted">' + esc(t('age_review_note')) + '</p>';
    h += rev.length ? '<div class="card"><table class="lim"><thead><tr><th>' + esc(t('silo')) + '</th><th>' + esc(t('status')) + '</th><th>' + esc(t('age')) + '</th><th>kg</th></tr></thead><tbody>' +
      rev.map(function (x) { return '<tr><td><b>' + esc(x.s.id) + '</b><div class="small muted">' + esc(siloDesig(x.s)) + '</div></td><td>' + lvChip(x.ss) + '</td><td>' + (x.ss.ageDays !== null ? x.ss.ageDays + ' ' + esc(t('days')) : '<span class="flag">' + esc(t('unknown')) + '</span>') + '</td><td>' + fmtKg(x.ss.kg) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">' + esc(t('no_stock')) + '</p>';
    // Eventos fechados recentes e histórico
    const hist = S.mon.slice().sort(function (a, b) { return L.recStamp(b) < L.recStamp(a) ? -1 : 1; }).slice(0, 40);
    h += '<h2>' + esc(t('mon_history')) + '</h2>';
    h += hist.length ? hist.map(monRow).join('') : '<p class="muted">' + esc(t('no_insp')) + '</p>';
    const closed = S.sev.filter(function (e) { return e.status === 'CLOSED'; }).slice(-10).reverse();
    if (closed.length) h += '<h2>' + esc(t('events_closed')) + '</h2>' + closed.map(function (e) { return '<div class="card small"><b>' + esc(e.silo) + '</b> · ' + esc(e.date) + ' → ' + esc(lt(e.closedAt).slice(0, 10)) + ' · ' + esc(t('lv_' + e.level)) + '<div>' + esc(t('cause')) + ': ' + esc(e.cause) + ' — ' + esc(e.closedBy) + '</div></div>'; }).join('');
    return h;
  }
  function prevRoundOf(r) {
    let prev = null;
    S.mon.forEach(function (x) { if (x.kind === 'ROUND' && x.silo === r.silo && L.recStamp(x) < L.recStamp(r) && (!prev || L.recStamp(x) > L.recStamp(prev))) prev = x; });
    return prev;
  }
  function prevWeeklyOf(r) {
    let prev = null;
    S.mon.forEach(function (x) { if (x.kind === 'WEEKLY' && x.silo === r.silo && L.recStamp(x) < L.recStamp(r) && (!prev || L.recStamp(x) > L.recStamp(prev))) prev = x; });
    return prev;
  }
  function monRow(r) {
    let body = '', lv = null;
    if (r.kind === 'ROUND') {
      const e = L.roundEval(r, prevRoundOf(r), S.settings.st); lv = e.level;
      body = r.points.map(function (p, i) { return 'P' + (i + 1) + ' ' + (p.fault ? t('fault_short') : fmt1(L.num(p.t))); }).join(' · ') + ' °C · ' + (e.maxDT !== null ? 'ΔT ' + fmt1(e.maxDT) + ' · ' : '') + t('od_' + r.odour);
    } else if (r.kind === 'WEEKLY') {
      lv = L.moistBand(r.moist, S.settings.st);
      if (L.num(r.insects) > 0) lv = Math.max(lv || 0, 2);
      body = t('moisture') + ' ' + fmtNum(L.num(r.moist)) + ' · ' + t('insects_live') + ' ' + fmtNum(L.num(r.insects), 0) + (r.insectType ? ' (' + r.insectType + ')' : '') + ' · ' + t('damaged') + ' ' + (r.damaged === 'S' ? t('yes') : t('no'));
    } else if (r.kind === 'TREAT') body = r.provider + ' · ' + t('cert') + ' ' + r.cert + (r.method ? ' · ' + r.method : '');
    else if (r.kind === 'DISP') body = t('disp_' + r.decision) + ' — ' + r.basis;
    return '<div class="card small"><div class="row"><b class="grow">' + esc(t('k_' + r.kind)) + ' · ' + esc(r.silo) + ' · ' + esc(r.date) + ' ' + esc(r.time) + '</b>' + (lv !== null ? '<span class="badge lv' + lv + '">' + esc(t('lv_' + lv)) + '</span>' : '') + '</div><div class="muted">' + esc(body) + ' · ' + esc(r.by) + '</div>' + (r.notes ? '<div>' + esc(r.notes) + '</div>' : '') + '</div>';
  }
  // Abre ou actualiza o evento Âmbar/Vermelho do silo (passo 10) / open or update the silo event
  function syncEvent(siloId) {
    const s = siloById(siloId); if (!s) return Promise.resolve();
    const ss = siloSt(s);
    const trig = ss.drivers.filter(function (d) { return d.level >= 2; }).map(function (d) { return d.p === 'moist_rise' ? 'moist_rise@' + ss.lastWeekly.seq : d.p; });
    if (!trig.length) return Promise.resolve();
    const open = S.sev.find(function (e) { return e.silo === siloId && e.status === 'OPEN'; });
    if (open) {
      const nt = trig.filter(function (x) { return open.triggers.indexOf(x) < 0; });
      if (!nt.length && ss.level <= open.level) return Promise.resolve();
      open.triggers = open.triggers.concat(nt); open.level = Math.max(open.level, ss.level);
      return DB.put('sevents', open);
    }
    const id = ('EV-' + L.today().replace(/-/g, '').slice(2) + '-' + siloId.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '-' + Date.now().toString(36)).slice(0, 40);
    return DB.add('sevents', { id: id, silo: siloId, date: L.today(), time: L.nowTime(), openedAt: new Date().toISOString(), level: ss.level, triggers: trig, status: 'OPEN', actions: [] });
  }

  // ---------------- folhas (modais) / sheets ----------------
  function sv(name, dflt) { const v = S.sheet.v[name]; return v === undefined ? (dflt === undefined ? '' : dflt) : v; }
  function sInput(name, label, extra, dflt) { return '<label>' + esc(label) + '<input name="' + name + '" value="' + esc(sv(name, dflt)) + '"' + (extra || '') + '></label>'; }
  function openSheet(kind, data) { S.sheet = Object.assign({ kind: kind, v: { date: L.today(), time: L.nowTime(), operator: S.settings.operator || '' } }, data || {}); renderSheet(); }
  const PERSON = { round: ['operator', 'operator'], weekly: ['operator', 'qc_name'], treat: ['operator', 'recorded_by'], disp: ['operator', 'qc_name'], event: ['operator', 'decided_by'] };
  function renderSheet() {
    const el = $('#sheet');
    if (!S.sheet) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const sh = S.sheet;
    const titles = { out: t('act_out'), transfer: t('act_transfer'), empty: t('act_empty'), round: t('act_round'), weekly: t('act_weekly'), treat: t('act_treat'), disp: t('act_disp'), event: t('event_btn') };
    let h = '<form class="sheet-card stack" id="sheetform" novalidate><h2>' + esc(titles[sh.kind]) + (sh.silo ? ' · ' + esc(sh.silo) : '') + '</h2>';
    if (sh.kind !== 'event') h += '<div class="grid2">' + sInput('date', t('date'), ' type="date"') + sInput('time', t('time'), ' type="time"') + '</div>';
    if (sh.kind === 'out') {
      h += sInput('place', t('to_line') + ' *') + '<div class="grid2">' + sInput('kg', t('kg') + ' *', DEC) + sInput('prodLot', t('prod_lot')) + '</div>';
    }
    if (sh.kind === 'transfer') {
      const src = siloById(sh.silo);
      const item = { cereal: src.cereal, colour: src.colour, grade: src.grade };
      const opts = candidates(item, sh.silo).filter(function (c) { return c.fit.ok; });
      h += '<p class="small muted">' + esc(t('from')) + ' ' + esc(sh.silo) + ': ' + esc(siloDesig(src)) + ' · ' + fmtKg(L.siloContents(sh.silo, S.events).kg) + '</p>';
      h += '<label>' + esc(t('to_silo')) + ' *<select name="toSilo"><option value="">—</option>' + opts.map(function (c) {
        return '<option value="' + esc(c.s.id) + '"' + (sv('toSilo') === c.s.id ? ' selected' : '') + '>' + esc(c.s.id + ' · ' + gradeName(c.s.grade) + ' · ' + (c.free === null ? t('cap_not_set') : t('free') + ' ' + fmtKg(c.free)) + (c.fit.mismatch ? ' ⚠' : '')) + '</option>';
      }).join('') + '</select></label>' + sInput('kg', t('kg') + ' *', DEC);
      if (!src.cereal || !src.grade) h += '<p class="warn small">' + esc(t('src_not_designated')) + '</p>';
    }
    if (sh.kind === 'empty') {
      const bal = L.siloContents(sh.silo, S.events).kg;
      h += '<p class="warn">' + esc(t('confirm_empty')) + '</p>';
      if (bal > 0) h += '<p class="warn"><b>' + esc(t('writeoff_warn')) + ' ' + fmtKg(bal) + '.</b> ' + esc(t('writeoff_reason_needed')) + '</p>' + sInput('reason', t('writeoff_reason') + ' *');
    }
    if (sh.kind === 'round') {
      const s = siloById(sh.silo), n = Math.max(1, Math.min(50, parseInt(s.points, 10) || 1));
      const prev = lastRoundOf(sh.silo);
      h += '<p class="small muted">' + esc(t('round_note')) + '</p><div class="points">';
      for (let i = 0; i < n; i++) {
        const pp = prev && prev.points[i];
        h += '<div class="pt"><label>P' + (i + 1) + ' (°C)' + '<input name="p_' + i + '" type="text" inputmode="decimal" value="' + esc(sv('p_' + i)) + '"></label>' +
          '<span class="small muted">' + esc(t('prev')) + ': ' + (pp ? (pp.fault ? t('fault_short') : esc(fmt1(L.num(pp.t)))) : '—') + '</span>' +
          '<span class="check"><input type="checkbox" name="f_' + i + '"' + (sv('f_' + i) ? ' checked' : '') + '> ' + esc(t('fault')) + '</span></div>';
      }
      h += '</div><label>' + esc(t('odour_visual')) + '<select name="odour">' + ODOURS.map(function (o) { return '<option value="' + o + '"' + (sv('odour', 'N') === o ? ' selected' : '') + '>' + esc(t('od_' + o)) + '</option>'; }).join('') + '</select></label>' + sInput('notes', t('notes'));
    }
    if (sh.kind === 'weekly') {
      const pw = lastWeeklyOf(sh.silo);
      h += '<div class="grid2">' + sInput('moist', t('moisture') + ' *', DEC) + '<div class="lbl">' + esc(t('prev_week')) + '<div class="strong">' + (pw ? esc(fmtNum(L.num(pw.moist))) + ' % (' + esc(pw.date) + ')' : '—') + '</div></div></div>';
      h += '<div class="grid2">' + sInput('insects', t('insects_live') + ' *', ' type="text" inputmode="numeric"') + sInput('insectType', t('insect_type')) + '</div>';
      h += '<div class="lbl">' + esc(t('damaged')) + '</div>' + seg('damaged', [['N', t('no')], ['S', t('yes')]], sv('damaged', 'N'));
      h += sInput('notes', t('notes'));
    }
    if (sh.kind === 'treat') {
      h += '<p class="warn small">' + esc(t('treat_warn')) + '</p>' + '<div class="grid2">' + sInput('provider', t('provider') + ' *') + sInput('cert', t('cert') + ' *') + '</div>' + sInput('method', t('method')) +
        '<div class="lbl">' + esc(t('safe_declared')) + '</div>' + seg('safe', [['N', t('no')], ['S', t('yes')]], sv('safe', 'N')) + sInput('notes', t('notes'));
    }
    if (sh.kind === 'disp') {
      h += '<p class="small muted">' + esc(t('disp_note')) + '</p><label>' + esc(t('disp_decision')) + ' *<select name="decision"><option value="">—</option>' + DISPS.map(function (d) { return '<option value="' + d + '"' + (sv('decision') === d ? ' selected' : '') + '>' + esc(t('disp_' + d)) + '</option>'; }).join('') + '</select></label>' +
        sInput('basis', t('disp_basis') + ' *') + '<label>' + esc(t('pin')) + ' *<input name="auth_pin" type="password" inputmode="numeric" autocomplete="off"></label>';
    }
    if (sh.kind === 'event') {
      const ev = S.sev.find(function (e) { return e.id === sh.id; });
      h += '<p class="small"><b>' + esc(ev.silo) + '</b> · ' + esc(t('opened')) + ' ' + esc(ev.date) + ' ' + esc(ev.time) + ' · <span class="badge lv' + ev.level + '">' + esc(t('lv_' + ev.level)) + '</span></p>' +
        '<p class="small">' + esc(t('triggers')) + ': ' + ev.triggers.map(function (x) { return esc(t('tr_' + x.split('@')[0])); }).join(', ') + '</p>' +
        (ev.actions.length ? '<div class="small stack">' + ev.actions.map(function (a) { return '<div>• ' + esc(lt(a.at)) + ' — ' + esc(a.text) + ' (' + esc(a.by) + ')</div>'; }).join('') + '</div>' : '') +
        '<p class="small muted">' + esc(t('event_note')) + '</p>' + sInput('action', t('event_action')) +
        '<div class="authbox stack"><span class="check"><input type="checkbox" name="closeIt"' + (sv('closeIt') ? ' checked' : '') + '> ' + esc(t('event_close')) + '</span>' + sInput('cause', t('cause')) +
        '<span class="check"><input type="checkbox" name="unknown"' + (sv('unknown') ? ' checked' : '') + '> ' + esc(t('cause_unknown')) + '</span></div>';
    }
    const pn = PERSON[sh.kind] || ['operator', 'operator'];
    h += sInput(pn[0], t(pn[1]) + ' *', '', S.settings.operator || '');
    h += '<div id="sheetdyn"></div>';
    h += '<div class="grid2"><button type="button" class="btn" data-action="close-sheet">' + esc(t('cancel')) + '</button><button type="submit" class="btn primary">' + esc(t('confirm')) + '</button></div></form>';
    el.innerHTML = h;
    updateSheetDyn();
  }
  function lastRoundOf(id) { let p = null; S.mon.forEach(function (x) { if (x.kind === 'ROUND' && x.silo === id && (!p || L.recStamp(x) > L.recStamp(p))) p = x; }); return p; }
  function lastWeeklyOf(id) { let p = null; S.mon.forEach(function (x) { if (x.kind === 'WEEKLY' && x.silo === id && (!p || L.recStamp(x) > L.recStamp(p))) p = x; }); return p; }
  function sheetRound() {
    const s = siloById(S.sheet.silo), n = Math.max(1, Math.min(50, parseInt(s.points, 10) || 1));
    const pts = []; for (let i = 0; i < n; i++) pts.push({ t: sv('p_' + i), fault: !!sv('f_' + i) });
    return { points: pts, odour: sv('odour', 'N') };
  }
  // Silos com grão e não retidos (para descarga) / stocked and not held
  function stocked() {
    return S.settings.silos.map(function (s) { const ss = siloSt(s); return { s: s, kg: ss.kg, ss: ss }; }).filter(function (x) { return x.kg > 0; });
  }
  function outPlan() {
    const kg = L.num(sv('kg'), 'kg');
    const slots = S.sheet.order.map(function (id) { return { id: id, avail: Math.max(0, L.siloContents(id, S.events).kg) }; });
    return { kg: kg, a: L.allocate(kg > 0 ? kg : 0, slots) };
  }
  function transferCheck() {
    const sh = S.sheet, kg = L.num(sv('kg'), 'kg'), to = siloById(sv('toSilo')), src = siloById(sh.silo);
    const bal = L.siloContents(sh.silo, S.events).kg;
    const res = { kg: kg, errors: [], needs: [] };
    const sss = siloSt(src);
    if (sss.held || sss.rejected) res.errors.push(sh.silo + ': ' + t('silo_held_short'));
    if (kg === null) res.errors.push(t('need_kg'));
    else if (isNaN(kg) || kg <= 0) res.errors.push(t('check_values') + ': ' + t('kg'));
    else if (kg > bal) res.errors.push(t('more_than_stock') + ' ' + fmtKg(bal));
    if (!to) res.errors.push(t('need_to_silo'));
    else {
      const free = L.freeSpace(to, S.events);
      if (free === null) res.errors.push(to.id + ': ' + t('cap_not_set'));
      else if (kg > free) res.errors.push(t('more_than_space') + ' ' + fmtKg(free));
      const fit = L.siloFit({ cereal: src.cereal, colour: src.colour, grade: src.grade }, to);
      const tss = siloSt(to);
      if (!fit.ok) res.errors.push(t('silo_not_allowed') + ' ' + to.id);
      else if (tss.held || tss.rejected || tss.level >= 4) res.errors.push(to.id + ': ' + t('silo_held_short'));
      else if (fit.mismatch) res.needs.push(t('auth_mismatch') + ' ' + to.id + ' (' + gradeName(to.grade) + ' ≠ ' + gradeName(src.grade) + ')');
    }
    return res;
  }
  function updateSheetDyn() {
    const box = $('#sheetdyn'); if (!box || !S.sheet) return;
    const sh = S.sheet;
    let h = '';
    if (sh.kind === 'out') {
      const p = outPlan(), st = stocked();
      h += '<div class="lbl strong">' + esc(t('discharge_order')) + '</div><p class="small muted">' + esc(t('discharge_note')) + '</p>';
      h += sh.order.map(function (id, i) {
        const part = p.a.parts.find(function (x) { return x.silo === id; });
        const s = siloById(id);
        return '<div class="row destrow"><span class="mono">' + (i + 1) + '. ' + esc(id) + '</span><span class="grow small muted">' + esc(s ? siloDesig(s) : '') + ' · ' + fmtKg(L.siloContents(id, S.events).kg) + '</span><span class="strong">' + (part ? '−' + fmtKg(part.kg) : '0 kg') + '</span>' +
          '<button type="button" class="btn small" data-action="out-rm" data-silo="' + esc(id) + '" aria-label="' + esc(t('remove')) + '">✕</button></div>';
      }).join('');
      const more = st.filter(function (x) { return sh.order.indexOf(x.s.id) < 0; });
      if (more.length) h += '<div class="chips">' + more.map(function (x) {
        const blocked = x.ss.held || x.ss.rejected;
        return '<button type="button" class="chip' + (blocked ? ' warnchip' : '') + '" data-action="out-add" data-silo="' + esc(x.s.id) + '"' + (blocked ? ' disabled' : '') + '>' + (blocked ? '⛔ ' : '+ ') + esc(x.s.id) + ' <span class="muted">' + esc(blocked ? t('silo_held_short') : gradeName(x.s.grade) + ' · ' + fmtKg(x.kg)) + '</span></button>';
      }).join('') + '</div>';
      if (p.kg !== null && !isNaN(p.kg) && p.kg > 0) {
        h += '<p class="small">' + esc(t('kg_read_as')) + ' ' + fmtKg(p.kg) + '</p>';
        if (p.a.short > 0) h += '<p class="warn small">' + esc(t('short_stock')) + ' ' + fmtKg(p.a.short) + '</p>';
      }
      const grades = Array.from(new Set(sh.order.map(function (id) { const s = siloById(id); return s ? s.cereal + s.colour + s.grade : ''; })));
      if (grades.length > 1) h += '<p class="warn small">' + esc(t('mixed_discharge')) + '</p>';
    }
    if (sh.kind === 'transfer') {
      const c = transferCheck();
      if (c.kg !== null && !isNaN(c.kg) && c.kg > 0) h += '<p class="small">' + esc(t('kg_read_as')) + ' ' + fmtKg(c.kg) + '</p>';
      if (sv('kg') !== '' || sv('toSilo') !== '') h += c.errors.map(function (e) { return '<p class="warn small">' + esc(e) + '</p>'; }).join('');
      if (c.needs.length) h += authBlock(c.needs, sh.v);
    }
    if (sh.kind === 'round') {
      const r = sheetRound();
      if (r.points.some(function (p) { return !p.fault && L.bad(p.t); })) h += '<p class="warn small">' + esc(t('check_values')) + '</p>';
      else {
        const e = L.roundEval(r, lastRoundOf(sh.silo), S.settings.st);
        const parts = [];
        if (e.maxT !== null) parts.push('<span class="drv"><span class="dot lv' + (e.lv.temp || 0) + '"></span>' + esc(t('drv_temp')) + ' ' + esc(fmt1(e.maxT)) + ' °C (P' + e.maxPoint + ')</span>');
        if (e.maxDT !== null) parts.push('<span class="drv"><span class="dot lv' + (e.lv.dt || 0) + '"></span>ΔT ' + (e.maxDT > 0 ? '+' : '') + esc(fmt1(e.maxDT)) + ' °C (P' + e.dtPoint + ')</span>');
        if (e.fault) parts.push('<span class="drv"><span class="dot lv2"></span>' + esc(t('drv_fault')) + '</span>');
        h += '<div class="decision d3"><div class="small caps">' + esc(t('round_result')) + '</div><div class="big2"><span class="badge lv' + e.level + '">' + esc(t('lv_' + e.level)) + '</span></div><div class="drivers">' + parts.join('') + '</div>' + (e.level >= 2 ? '<div class="small">' + esc(t('lvact_' + Math.min(e.level, 5))) + '</div>' : '') + '</div>';
      }
    }
    if (sh.kind === 'weekly') {
      const lv = L.moistBand(sv('moist'), S.settings.st), ins = L.num(sv('insects'));
      const pw = lastWeeklyOf(sh.silo);
      const notes = [];
      if (lv !== null) notes.push('<span class="drv"><span class="dot lv' + lv + '"></span>' + esc(t('moisture')) + ': ' + esc(t('lv_' + lv)) + '</span>');
      if (pw && L.num(sv('moist')) !== null && L.num(sv('moist')) > L.num(pw.moist)) notes.push('<span class="drv"><span class="dot lv2"></span>' + esc(t('drv_moist_rise')) + '</span>');
      if (ins > 0) notes.push('<span class="drv"><span class="dot lv2"></span>' + esc(t('drv_insects')) + '</span>');
      if (notes.length) h += '<div class="drivers">' + notes.join('') + '</div>';
    }
    box.innerHTML = h;
  }
  function submitSheet() {
    const sh = S.sheet, v = sh.v;
    const pn = (PERSON[sh.kind] || ['operator'])[0];
    const who = sv(pn, S.settings.operator).trim();
    if (!who) { toast(t('need_person')); return; }
    if (sh.kind !== 'event' && !sv('date')) { toast(t('need_fields')); return; }
    const base = { date: sv('date'), time: sv('time'), silo: sh.silo, operator: who, notes: '' };
    const monBase = { date: sv('date'), time: sv('time'), silo: sh.silo, by: who, notes: sv('notes').trim(), createdAt: new Date().toISOString() };
    let p;
    if (sh.kind === 'out') {
      if (!sv('place').trim()) { toast(t('need_line')); return; }
      const pl = outPlan();
      if (pl.kg === null || isNaN(pl.kg) || pl.kg <= 0) { toast(t('need_kg')); return; }
      if (!sh.order.length) { toast(t('need_silo')); return; }
      const heldIn = sh.order.filter(function (id) { const ss = siloSt(siloById(id)); return ss.held || ss.rejected; });
      if (heldIn.length) { toast(heldIn.join(', ') + ': ' + t('silo_held_short')); return; }
      if (pl.a.short > 0) { toast(t('short_stock') + ' ' + fmtKg(pl.a.short)); return; }
      p = DB.addMany(pl.a.parts.map(function (part) {
        return { store: 'events', obj: Object.assign({}, base, { silo: part.silo, type: 'OUT', kg: part.kg, place: sv('place').trim(), prodLot: sv('prodLot'), lots: L.siloContents(part.silo, S.events).lots }) };
      }));
    }
    if (sh.kind === 'transfer') {
      const c = transferCheck();
      if (c.errors.length) { toast(c.errors[0]); return; }
      const ev = Object.assign({}, base, { type: 'TRANSFER', toSilo: sv('toSilo'), kg: c.kg, lots: L.lotsCarried(sh.silo, S.events) });
      const go = function (auth) { if (auth) { ev.auth = auth; ev.notes = t('auth_mismatch') + ' — ' + auth.by + ': ' + auth.reason; } return DB.add('events', ev); };
      if (c.needs.length) {
        verifyAuth(v).then(function (err) {
          if (err) { toast(err); return; }
          finishSheet(go({ at: new Date().toISOString(), by: v.auth_by.trim(), reason: v.auth_reason.trim(), items: c.needs }), who);
        });
        return;
      }
      p = go(null);
    }
    if (sh.kind === 'empty') {
      const bal = L.siloContents(sh.silo, S.events).kg;
      if (bal > 0 && !sv('reason').trim()) { toast(t('writeoff_reason_needed')); return; }
      p = DB.add('events', Object.assign({}, base, { type: 'EMPTY', kg: null, writeOff: bal > 0 ? bal : 0, notes: sv('reason').trim(), lots: [] }));
    }
    if (sh.kind === 'round') {
      const r = sheetRound();
      if (r.points.some(function (x) { return !x.fault && (L.num(x.t) === null || isNaN(L.num(x.t))); })) { toast(t('need_all_points')); return; }
      const rec = Object.assign({}, monBase, { kind: 'ROUND', shift: L.shiftOf(sv('date'), sv('time'), S.settings.st.shifts).id, odour: r.odour,
        points: r.points.map(function (x) { return { t: x.fault ? null : L.num(x.t), fault: x.fault }; }) });
      p = DB.add('monitor', rec).then(load).then(function () { return syncEvent(sh.silo); });
    }
    if (sh.kind === 'weekly') {
      const m = L.num(sv('moist')), ins = L.num(sv('insects'));
      if (m === null || isNaN(m) || ins === null || isNaN(ins) || ins < 0 || Math.round(ins) !== ins) { toast(t('need_weekly')); return; }
      p = DB.add('monitor', Object.assign({}, monBase, { kind: 'WEEKLY', moist: m, insects: ins, insectType: sv('insectType').trim(), damaged: sv('damaged', 'N') }))
        .then(load).then(function () { return syncEvent(sh.silo); });
    }
    if (sh.kind === 'treat') {
      if (!sv('provider').trim() || !sv('cert').trim()) { toast(t('need_treat')); return; }
      p = DB.add('monitor', Object.assign({}, monBase, { kind: 'TREAT', provider: sv('provider').trim(), cert: sv('cert').trim(), method: sv('method').trim(), safe: sv('safe', 'N') }))
        .then(load).then(function () { return syncEvent(sh.silo); });
    }
    if (sh.kind === 'disp') {
      if (!sv('decision') || !sv('basis').trim()) { toast(t('need_disp')); return; }
      checkPin(sv('auth_pin')).then(function (r) {
        if (r !== 'ok') { toast(pinMsg(r)); return; }
        finishSheet(DB.add('monitor', Object.assign({}, monBase, { kind: 'DISP', decision: sv('decision'), basis: sv('basis').trim() })), who);
      });
      return;
    }
    if (sh.kind === 'event') {
      const ev = clone(S.sev.find(function (e) { return e.id === sh.id; }));
      const act = sv('action').trim(), closeIt = !!sv('closeIt');
      const cause = sv('unknown') ? t('cause_unknown_txt') : sv('cause').trim();
      if (!act && !closeIt) { toast(t('need_event_input')); return; }
      if (closeIt && !cause) { toast(t('need_cause')); return; }
      if (act) ev.actions.push({ at: new Date().toISOString(), by: who, text: act });
      if (closeIt) { ev.status = 'CLOSED'; ev.cause = cause; ev.closedBy = who; ev.closedAt = new Date().toISOString(); }
      p = DB.put('sevents', ev);
    }
    finishSheet(p, who);
  }
  function finishSheet(p, who) {
    p.then(function () { S.settings.operator = who; return saveSettings(); }).then(load).then(function () { S.sheet = null; render(); toast(t('saved')); })
      .catch(function () { toast(t('save_failed')); });
  }

  // ---------------- exportar / export ----------------
  function exportView() {
    const d = L.today();
    return '<div class="card stack"><div class="grid2"><label>' + esc(t('export_from')) + '<input id="exfrom" type="date" value="' + d.slice(0, 8) + '01"></label><label>' + esc(t('export_to')) + '<input id="exto" type="date" value="' + d + '"></label></div>' +
      '<button class="btn primary block" data-action="export-xlsx">' + esc(t('export_xlsx')) + '</button><p class="muted small">' + esc(t('export_note')) + '</p></div>' +
      '<div class="card stack"><h2>' + esc(t('backup')) + '</h2>' + (backupDue() ? '<p class="warn">' + esc(t('backup_due')) + '</p>' : '') + '<p>' + esc(t('backup_note')) + '</p><p class="small muted">' + esc(t('last_backup')) + ': ' + esc(S.settings.lastBackup ? lt(S.settings.lastBackup) : t('never')) + '</p>' +
      '<button class="btn block" data-action="backup">' + esc(t('backup_save')) + '</button>' +
      '<div class="stack restorebox"><div class="lbl strong">' + esc(t('backup_restore')) + '</div><p class="small muted">' + esc(t('restore_note')) + '</p>' +
      (S.settings.pin ? '<label>' + esc(t('pin')) + '<input id="restorepin" type="password" inputmode="numeric" autocomplete="off"></label>' : '') +
      '<label class="btn block filebtn">' + esc(t('choose_file')) + '<input type="file" id="restore" accept="application/json,.json" hidden></label></div></div>';
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function exportXlsx() {
    const from = $('#exfrom').value, to = $('#exto').value;
    const inRange = function (d) { return (!from || d >= from) && (!to || d <= to); };
    const pt = I18n.lang === 'pt';
    const yn = function (v) { return v === 'S' ? t('yes') : v === 'N' ? t('no') : ''; };
    const H21 = [t('date'), t('time'), t('lot_code'), t('guia'), t('supplier'), t('origin'), t('cereal'), t('colour'), t('plate'), t('net_kg'),
      t('moisture'), t('fat'), t('foreign'), t('broken'), t('diseased'), t('sw'), t('odour'), t('infestation'), t('afla'), t('don'), t('fum'),
      t('x_matrix'), t('x_reasons'), t('x_status'), t('x_grade'), t('x_dest'), t('x_auth'), t('x_qc'), t('responsible'), t('notes')];
    const rows21 = S.lots.filter(function (l) { return inRange(l.date); }).sort(function (a, b) { return a.id < b.id ? -1 : 1; }).map(function (l) {
      return [l.date, l.time, l.id, l.guia, l.supplier, l.origin, cerName(l.cereal), l.colour || '', l.plate, l.kg, l.hum, l.fat, l.fm, l.brk, l.dis, l.sw,
        l.odor === 'Anormal' ? t('abnormal') : t('normal'), yn(l.ins), l.afla, l.don, l.fum,
        l.matrix ? gradeName(l.matrix) : '', (l.reasons || []).map(function (x) { return x.k ? t(PLABEL[x.k]) + ' ' + x.v + ' → ' + gradeName(L.GRADES[x.level]) : t(x); }).concat((l.holdReasons || []).map(function (x) { return t('hold_' + x); })).join('; '),
        t('st_' + l.status), l.grade ? gradeName(l.grade) : '', (l.dest || []).map(function (d) { return d.silo + ': ' + d.kg; }).join('; ') || l.silo || '',
        (l.auth || []).map(function (a) { return a.by + ' — ' + a.reason + ' [' + a.items.join('; ') + '] ' + lt(a.at); }).join(' | '),
        (l.qc || []).map(function (q) { return q.by + ': ' + (q.decision === 'HELD' ? t('keep_held') : q.decision === 'REJ' ? t('st_REJECTED') : gradeName(q.decision)) + ' — ' + q.reason; }).join(' | '),
        l.responsible, l.notes];
    });
    const H13 = [t('date'), t('time'), t('silo'), t('x_move'), t('x_lots'), t('kg'), t('x_fromto'), t('prod_lot'), t('operator'), t('x_auth'), t('notes')];
    const rows13 = L.sortEvents(S.events.filter(function (e) { return inRange(e.date); })).map(function (e) {
      const where = e.type === 'TRANSFER' ? e.silo + ' → ' + e.toSilo : e.type === 'OUT' ? placeName(e.place) : e.type === 'IN' ? t('tab_intake') : '';
      const kg = e.type === 'EMPTY' ? (e.writeOff ? -e.writeOff : null) : e.kg;
      return [e.date, e.time, e.silo, t('ev_' + e.type), (e.lots || []).join(', '), kg, where, e.prodLot || '', e.operator, e.auth ? e.auth.by + ' — ' + e.auth.reason : '', e.notes];
    });
    const desig = function (id) { const x = siloById(id); return x ? siloDesig(x) : ''; };
    const HA = [t('date'), t('shift'), t('time'), t('silo'), t('x_product'), t('x_maxtemp'), t('x_point'), t('x_maxdt'), t('odour_visual'), t('status'), t('operator'), t('x_points'), t('notes')];
    const rowsA = S.mon.filter(function (r) { return r.kind === 'ROUND' && inRange(r.date); }).sort(function (a, b) { return L.recStamp(a) < L.recStamp(b) ? -1 : 1; }).map(function (r) {
      const e = L.roundEval(r, prevRoundOf(r), S.settings.st), sh = L.shiftOf(r.date, r.time, S.settings.st.shifts);
      return [r.date, sh.start + '–' + sh.end, r.time, r.silo, desig(r.silo), e.maxT, e.maxPoint ? 'P' + e.maxPoint : '', e.maxDT, t('od_' + r.odour), t('lv_' + e.level), r.by,
        r.points.map(function (p, i) { return 'P' + (i + 1) + '=' + (p.fault ? t('fault_short') : p.t); }).join('; '), r.notes];
    });
    const HB = [t('date'), t('silo'), t('x_product'), t('moisture'), t('prev_week'), t('insects_live'), t('insect_type'), t('damaged'), t('status'), t('notes'), t('qc_name')];
    const rowsB = S.mon.filter(function (r) { return r.kind === 'WEEKLY' && inRange(r.date); }).sort(function (a, b) { return L.recStamp(a) < L.recStamp(b) ? -1 : 1; }).map(function (r) {
      const pw = prevWeeklyOf(r); let lv = L.moistBand(r.moist, S.settings.st);
      if (r.insects > 0 || (pw && r.moist > pw.moist)) lv = Math.max(lv || 0, 2);
      return [r.date, r.silo, desig(r.silo), r.moist, pw ? pw.moist : '', r.insects, r.insectType, yn(r.damaged), lv !== null ? t('lv_' + lv) : '', r.notes, r.by];
    });
    const HT = [t('date'), t('time'), t('silo'), t('x_type'), t('x_details'), t('x_by')];
    const rowsT = S.mon.filter(function (r) { return (r.kind === 'TREAT' || r.kind === 'DISP') && inRange(r.date); }).sort(function (a, b) { return L.recStamp(a) < L.recStamp(b) ? -1 : 1; }).map(function (r) {
      return [r.date, r.time, r.silo, t('k_' + r.kind), r.kind === 'TREAT' ? r.provider + ' · ' + t('cert') + ' ' + r.cert + (r.method ? ' · ' + r.method : '') + ' · ' + t('safe_declared') + ': ' + yn(r.safe) : t('disp_' + r.decision) + ' — ' + r.basis, r.by];
    });
    const HE = ['ID', t('silo'), t('opened'), t('status'), t('triggers'), t('x_actions'), t('x_evstate'), t('cause'), t('x_closed')];
    const rowsE = S.sev.filter(function (e) { return inRange(e.date); }).map(function (e) {
      return [e.id, e.silo, e.date + ' ' + e.time, t('lv_' + e.level), e.triggers.map(function (x) { return t('tr_' + x.split('@')[0]); }).join('; '), e.actions.map(function (a) { return lt(a.at) + ' ' + a.by + ': ' + a.text; }).join(' | '), e.status === 'OPEN' ? t('x_open') : t('x_closed_st'), e.cause || '', e.closedBy ? e.closedBy + ' ' + lt(e.closedAt) : ''];
    });
    const HR = [t('silo'), t('x_product'), t('kg'), t('status'), t('age'), t('x_oldest'), t('x_held'), t('x_drivers')];
    const rowsR = S.settings.silos.map(function (x) { const ss = siloSt(x); const ls = S.lots.filter(function (l) { return ss.lots.indexOf(l.id) >= 0; }).map(function (l) { return l.date; }).sort();
      return [x.id, siloDesig(x), ss.kg, ss.noData ? t('lv_nodata') : t('lv_' + ss.level), ss.ageDays, ls[0] || '', ss.held ? t('yes') : t('no'), ss.drivers.map(function (d) { return drvText(d, ss) + ' (' + t('lv_' + d.level) + ')'; }).join('; ')]; });
    const wb = XLSX.utils.book_new();
    const title = (S.settings.millName || (pt ? '[NOME DA EMPRESA]' : '[COMPANY NAME]')) + ' — ';
    const sub = t('x_exported') + ' ' + L.today() + ' ' + L.nowTime() + ' · ' + from + ' → ' + to;
    function sheet(name, head, rows, ttl) {
      const ws = XLSX.utils.aoa_to_sheet([[title + ttl], [sub], [], head].concat(rows));
      ws['!cols'] = head.map(function (h) { return { wch: Math.max(10, Math.min(30, String(h).length + 2)) }; });
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    sheet('RG-21', H21, rows21, t('x_rg21'));
    sheet('RG-13', H13, rows13, t('x_rg13'));
    sheet(pt ? 'Anexo A' : 'Annex A', HA, rowsA, t('x_annexA'));
    sheet(pt ? 'Anexo B' : 'Annex B', HB, rowsB, t('x_annexB'));
    sheet(pt ? 'Tratamentos-Disposicoes' : 'Treatments-Dispositions', HT, rowsT, t('x_treat'));
    sheet(pt ? 'Eventos' : 'Events', HE, rowsE, t('x_events'));
    sheet(pt ? 'Revisao-idade' : 'Age-review', HR, rowsR, t('x_review') + ' ' + L.today());
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), L.today() + '_Moagem_Recepcao-Silos-Armazenagem_' + from + '_' + to + '.xlsx');
  }
  function backup(silent) {
    return DB.exportAll().then(function (data) {
      download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), L.today() + '_' + L.nowTime().replace(':', '') + '_Moagem_copia-seguranca' + (silent ? '_antes-de-restaurar' : '') + '.json');
      S.settings.lastBackup = new Date().toISOString();
      return saveSettings();
    });
  }
  function restore(file, input) {
    if (!file) return;
    const pinEl = $('#restorepin');
    const reset = function () { if (input) input.value = ''; };
    checkPin(pinEl ? pinEl.value : '').then(function (r) {
      if (r !== 'ok' && r !== 'nopin') { toast(pinMsg(r)); reset(); return; }
      return file.text().then(function (txt) {
        let data; try { data = JSON.parse(txt); } catch (e) { throw new Error('bad'); }
        if (!L.validBackup(data)) throw new Error('bad');
        if (!confirm(t('restore_confirm'))) { reset(); return; }
        // Cópia automática dos dados actuais antes de restaurar / automatic safety copy first
        return backup(true).then(function () { return DB.importAll(data); }).then(load).then(function () { S.unlocked = false; render(); toast(t('restored')); });
      });
    }).catch(function () { reset(); toast(t('bad_backup')); });
  }

  // ---------------- definições / settings ----------------
  function settingsView() {
    const s = S.settings;
    let h = '<form id="generalform" class="stack" novalidate><div class="card stack"><h2>' + esc(t('general')) + '</h2><label>' + esc(t('mill_name')) + '<input name="millName" value="' + esc(s.millName) + '"></label><label>' + esc(t('site')) + '<input name="site" value="' + esc(s.site) + '"></label>' +
      '<label>' + esc(t('language')) + '<select name="lang"><option value="pt" ' + (s.lang === 'pt' ? 'selected' : '') + '>Português</option><option value="en" ' + (s.lang === 'en' ? 'selected' : '') + '>English</option></select></label></div>';
    h += '<div class="card stack"><h2>' + esc(t('suppliers_cfg')) + '</h2>' + s.suppliers.map(function (x, i) {
      return '<div class="grid2b"><input name="sup_' + i + '" value="' + esc(x) + '" aria-label="' + esc(t('supplier')) + '"><button type="button" class="btn small" data-action="rm-sup" data-i="' + i + '">' + esc(t('remove')) + '</button></div>';
    }).join('') + '<button type="button" class="btn small" data-action="add-sup">+ ' + esc(t('add_supplier')) + '</button><button class="btn primary" type="submit">' + esc(t('save')) + '</button></div></form>';
    // PIN
    h += '<form id="pinform" class="card stack" novalidate><h2>' + esc(t('pin_title')) + '</h2>';
    if (!s.pin) h += '<p class="warn small">' + esc(t('pin_create_note')) + '</p><div class="grid2"><label>' + esc(t('pin_new')) + '<input name="p1" type="password" inputmode="numeric" autocomplete="new-password"></label><label>' + esc(t('pin_repeat')) + '<input name="p2" type="password" inputmode="numeric" autocomplete="new-password"></label></div><button class="btn primary" type="submit">' + esc(t('pin_create')) + '</button>';
    else h += '<p class="small muted">' + esc(t('pin_is_set')) + ' ' + esc(s.pin.setAt ? s.pin.setAt.slice(0, 10) : '') + '. ' + esc(t('pin_limits')) + '</p><details><summary class="small">' + esc(t('pin_change')) + '</summary><div class="stack"><label>' + esc(t('pin_current')) + '<input name="p0" type="password" inputmode="numeric" autocomplete="off"></label><div class="grid2"><label>' + esc(t('pin_new')) + '<input name="p1" type="password" inputmode="numeric" autocomplete="new-password"></label><label>' + esc(t('pin_repeat')) + '<input name="p2" type="password" inputmode="numeric" autocomplete="new-password"></label></div><button class="btn" type="submit">' + esc(t('pin_change')) + '</button></div></details>';
    h += '</form>';
    // Protegido / protected
    h += '<form id="protform" class="stack" novalidate>';
    if (!S.unlocked) {
      h += '<div class="card stack"><h2>🔒 ' + esc(t('protected')) + '</h2><p class="small muted">' + esc(t('protected_note')) + '</p>' + protSummary();
      if (s.pin) h += '<div class="grid2b"><input name="unlockpin" type="password" inputmode="numeric" autocomplete="off" aria-label="' + esc(t('pin')) + '" placeholder="' + esc(t('pin')) + '"><button class="btn primary" type="submit">' + esc(t('unlock')) + '</button></div>';
      else h += '<p class="warn small">' + esc(t('pin_first')) + '</p>';
      h += '</div>';
    } else h += protEditor();
    h += '</form><p class="small muted" id="storage"></p><p class="small muted">' + esc(t('install_hint')) + '</p>';
    setTimeout(function () {
      const el = $('#storage');
      if (el && navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(function (p) { el.textContent = p ? t('storage_ok') : t('storage_maybe'); });
    }, 0);
    return h;
  }
  function protSummary() {
    const s = S.settings;
    const g = s.grading.Milho;
    let h = '<div class="small"><b>' + esc(t('silos_cfg')) + ':</b> ' + (s.silos.length ? s.silos.map(function (x) { return esc(x.id) + ' (' + esc(siloDesig(x)) + (L.num(x.cap, 'kg') ? ', ' + fmtKg(L.num(x.cap, 'kg')) : '') + ')'; }).join(' · ') : esc(t('none'))) + '</div>';
    h += '<div class="small"><b>' + esc(t('maize')) + ':</b> ' + L.PARAMS.map(function (p) { return esc(t(PLABEL[p[0]])) + ' ' + (p[1] === 'max' ? '≤' : '≥') + ' ' + g[p[0]].map(function (x) { return esc(x || '—'); }).join(' / '); }).join(' · ') + '</div>';
    return h;
  }
  function protEditor() {
    const s = S.settings;
    let h = '<div class="card stack"><div class="row"><h2 class="grow">🔓 ' + esc(t('silos_cfg')) + '</h2></div><p class="small muted">' + esc(t('silos_note')) + '</p>';
    h += s.silos.map(function (x, i) {
      const hist = siloHasHistory(x.id) && !x._new;
      const stock = L.siloContents(x.id, S.events);
      const locked = stock.kg > 0 || stock.lots.length > 0;
      const sel = function (name, opts, val, dis) { return '<select name="' + name + '_' + i + '"' + (dis ? ' disabled' : '') + '><option value="">—</option>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (val === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
      return '<div class="silocfg stack"><div class="grid2"><label>' + esc(t('silo_id')) + '<input name="silo_id_' + i + '" value="' + esc(x.id) + '"' + (hist ? ' readonly' : '') + '></label><label>' + esc(t('silo_cap')) + '<input name="silo_cap_' + i + '" type="text" inputmode="decimal" value="' + esc(x.cap) + '"></label></div>' +
        '<label>' + esc(t('silo_points')) + '<input name="silo_pts_' + i + '" type="text" inputmode="numeric" value="' + esc(x.points || '1') + '"></label>' +
        '<div class="grid3"><label>' + esc(t('cereal')) + sel('silo_cer', CEREALS.map(function (c) { return [c, cerName(c)]; }), x.cereal, locked) + '</label><label>' + esc(t('colour')) + sel('silo_col', COLOURS.map(function (c) { return [c, c]; }), x.colour, locked) + '</label><label>' + esc(t('grade')) + sel('silo_grade', SILO_GRADES.map(function (g) { return [g, gradeName(g)]; }), x.grade) + '</label></div>' +
        (locked ? '<p class="small muted">' + esc(t('silo_locked_note')) + '</p>' : '') +
        (hist ? '<p class="small muted">' + esc(t('silo_hist_note')) + '</p>' : '<button type="button" class="btn small" data-action="rm-silo" data-i="' + i + '">' + esc(t('remove')) + '</button>') + '</div>';
    }).join('') + '<button type="button" class="btn small" data-action="add-silo">+ ' + esc(t('add_silo')) + '</button></div>';
    CEREALS.forEach(function (c) {
      const g = s.grading[c], m = s.myco[c];
      h += '<div class="card stack"><h2>' + esc(t('grading_cfg')) + ' · ' + esc(cerName(c)) + '</h2>' + (c === 'Milho' ? '<p class="small muted">' + esc(t('sop_source')) + '</p>' : '<p class="small muted">' + esc(t('no_preset')) + '</p>');
      h += '<table class="lim"><thead><tr><th></th><th>' + esc(t('g_G1')) + '</th><th>' + esc(t('g_G2')) + '</th><th>' + esc(t('g_OFF')) + '</th></tr></thead><tbody>';
      L.PARAMS.forEach(function (p) {
        h += '<tr><th>' + esc(t(PLABEL[p[0]])) + ' <span class="muted">' + (p[1] === 'max' ? '≤' : '≥') + '</span></th>' + [0, 1, 2].map(function (j) { return '<td><input name="g_' + c + '_' + p[0] + '_' + j + '" type="text" inputmode="decimal" value="' + esc(g[p[0]][j]) + '" aria-label="' + esc(t(PLABEL[p[0]]) + ' ' + t('g_' + SILO_GRADES[j])) + '"></td>'; }).join('') + '</tr>';
      });
      h += '</tbody></table><p class="small muted">' + esc(t('reject_rule')) + '</p>';
      h += '<label>' + esc(t('hum_low')) + '<input name="g_' + c + '_humLow" type="text" inputmode="decimal" value="' + esc(g.humLow) + '"></label>';
      h += '<div class="lbl strong">' + esc(t('myco_limits')) + '</div><div class="grid3">' + L.MYCO.map(function (k) {
        return '<label>' + esc(t(k)) + '<input name="m_' + c + '_' + k + '" type="text" inputmode="decimal" value="' + esc(m[k]) + '"><span class="check"><input type="checkbox" name="mr_' + c + '_' + k + '"' + (m[k + 'Required'] ? ' checked' : '') + '> ' + esc(t('required_test')) + '</span></label>';
      }).join('') + '</div><p class="small muted">' + esc(t('myco_note')) + '</p></div>';
    });
    const st = s.st;
    const row = function (key, labels, unit) { return '<div class="lbl strong">' + esc(t('stc_' + key)) + '</div><div class="grid' + (labels.length === 2 ? '2' : '4') + '">' + labels.map(function (l, j) { return '<label>' + esc(l) + '<input name="st_' + key + '_' + j + '" type="text" inputmode="decimal" value="' + esc(st[key][j]) + '"></label>'; }).join('') + '</div>'; };
    h += '<div class="card stack"><h2>' + esc(t('storage_cfg')) + '</h2><p class="small muted">' + esc(t('storage_src')) + '</p>' +
      row('moist', [t('lv_0') + ' ≤', t('lv_1') + ' ≤', t('lv_2') + ' ≤', t('lv_3') + ' ≤']) + '<p class="small muted">' + esc(t('stc_moist_note')) + '</p>' +
      row('temp', [t('lv_0') + ' ≤', t('lv_1') + ' ≤', t('lv_2') + ' ≤', t('lv_4') + ' ≤']) + '<p class="small muted">' + esc(t('stc_temp_note')) + '</p>' +
      row('dt', [t('lv_2') + ' ≥', t('lv_4') + ' ≥']) +
      '<div class="grid2"><label>' + esc(t('stc_shifts')) + '<input name="st_shifts" value="' + esc(st.shifts.join(', ')) + '"></label><label>' + esc(t('stc_weekly')) + '<input name="st_weeklyDays" inputmode="numeric" value="' + esc(st.weeklyDays) + '"></label></div>' +
      '<div class="grid2"><label>' + esc(t('stc_amber')) + '<input name="st_amberRounds" inputmode="numeric" value="' + esc(st.amberRounds) + '"></label><label>' + esc(t('stc_clear')) + '<input name="st_clearShifts" inputmode="numeric" value="' + esc(st.clearShifts) + '"></label></div></div>';
    h += '<div class="grid2"><button type="button" class="btn" data-action="lock">' + esc(t('lock')) + '</button><button class="btn primary" type="submit">' + esc(t('save_protected')) + '</button></div>';
    return h;
  }
  // Lê o editor protegido para uma cópia; devolve {s, errors} / read protected editor
  function readProt(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    const s = clone(S.settings), errors = [];
    const oldSilos = S.settings.silos;
    s.silos = oldSilos.map(function (x, i) {
      const hist = siloHasHistory(x.id) && !x._new;
      const st = L.siloContents(x.id, S.events);
      const locked = st.kg > 0 || st.lots.length > 0;
      return { id: hist ? x.id : (v['silo_id_' + i] || '').trim(), cap: (v['silo_cap_' + i] || '').trim(),
        cereal: locked ? x.cereal : (v['silo_cer_' + i] || ''), colour: locked ? x.colour : (v['silo_col_' + i] || ''), grade: v['silo_grade_' + i] || '', points: (v['silo_pts_' + i] || '1').trim(), _new: x._new };
    });
    const ids = {};
    s.silos.forEach(function (x) {
      if (!x.id) errors.push(t('err_silo_id'));
      else if (ids[x.id]) errors.push(t('err_silo_dup') + ' ' + x.id); ids[x.id] = true;
      const cap = L.num(x.cap, 'kg');
      if (cap !== null && (isNaN(cap) || cap <= 0)) errors.push(x.id + ': ' + t('silo_cap'));
      if (x.cereal === 'Milho' && x.grade && !x.colour) errors.push(x.id + ': ' + t('err_colour'));
      if (x.cereal !== 'Milho') x.colour = '';
      if (!/^\d{1,2}$/.test(x.points) || +x.points < 1 || +x.points > 50) errors.push(x.id + ': ' + t('err_points'));
      const kg = L.siloContents(x.id, S.events).kg;
      if (cap !== null && !isNaN(cap) && kg > cap) errors.push(x.id + ': ' + t('err_cap_below_stock') + ' ' + fmtKg(kg));
    });
    CEREALS.forEach(function (c) {
      L.PARAMS.forEach(function (p) {
        const arr = [0, 1, 2].map(function (j) { return (v['g_' + c + '_' + p[0] + '_' + j] || '').trim(); });
        const filled = arr.filter(Boolean).length;
        const n = arr.map(function (x) { return L.num(x); });
        if (n.some(function (x) { return x !== null && isNaN(x); })) errors.push(cerName(c) + ' · ' + t(PLABEL[p[0]]) + ': ' + t('err_number'));
        else if (filled && filled < 3) errors.push(cerName(c) + ' · ' + t(PLABEL[p[0]]) + ': ' + t('err_three'));
        else if (filled === 3 && (p[1] === 'max' ? !(n[0] <= n[1] && n[1] <= n[2]) : !(n[0] >= n[1] && n[1] >= n[2]))) errors.push(cerName(c) + ' · ' + t(PLABEL[p[0]]) + ': ' + t(p[1] === 'max' ? 'err_order_up' : 'err_order_down'));
        s.grading[c][p[0]] = arr;
      });
      s.grading[c].humLow = (v['g_' + c + '_humLow'] || '').trim();
      if (L.bad(s.grading[c].humLow)) errors.push(cerName(c) + ' · ' + t('hum_low') + ': ' + t('err_number'));
      L.MYCO.forEach(function (k) {
        s.myco[c][k] = (v['m_' + c + '_' + k] || '').trim();
        s.myco[c][k + 'Required'] = !!v['mr_' + c + '_' + k];
        if (L.bad(s.myco[c][k])) errors.push(cerName(c) + ' · ' + t(k) + ': ' + t('err_number'));
        if (s.myco[c][k + 'Required'] && !s.myco[c][k]) errors.push(cerName(c) + ' · ' + t(k) + ': ' + t('err_required_no_limit'));
      });
    });
    [['moist', 4, 'up'], ['temp', 4, 'up'], ['dt', 2, 'up']].forEach(function (q) {
      const arr = []; for (let j = 0; j < q[1]; j++) arr.push((v['st_' + q[0] + '_' + j] || '').trim());
      const n = arr.map(function (x) { return L.num(x); });
      if (n.some(function (x) { return x === null || isNaN(x); })) errors.push(t('stc_' + q[0]) + ': ' + t('err_number'));
      else if (n.some(function (x, j) { return j > 0 && x <= n[j - 1]; })) errors.push(t('stc_' + q[0]) + ': ' + t('err_ascending'));
      s.st[q[0]] = arr;
    });
    const sh = (v.st_shifts || '').split(/[,;\s]+/).filter(Boolean);
    if (!sh.length || sh.some(function (x) { return !/^([01]?\d|2[0-3]):[0-5]\d$/.test(x); })) errors.push(t('stc_shifts') + ': ' + t('err_shifts'));
    s.st.shifts = sh.map(function (x) { return x.length === 4 ? '0' + x : x; });
    ['weeklyDays', 'amberRounds', 'clearShifts'].forEach(function (k) { s.st[k] = (v['st_' + k] || '').trim(); if (!/^\d{1,3}$/.test(s.st[k]) || +s.st[k] < 1) errors.push(t('stc_' + ({ weeklyDays: 'weekly', amberRounds: 'amber', clearShifts: 'clear' })[k]) + ': ' + t('err_number')); });
    return { s: s, errors: errors };
  }
  function keepProtDraft() { const f = $('#protform'); if (f && S.unlocked) { const r = readProt(f); S.settings.silos = r.s.silos; S.settings.grading = r.s.grading; S.settings.myco = r.s.myco; S.settings.st = r.s.st; } }
  function readGeneral(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    const s = S.settings;
    s.millName = v.millName || ''; s.site = v.site || ''; s.lang = v.lang || 'pt';
    s.suppliers = s.suppliers.map(function (x, i) { return (v['sup_' + i] || '').trim(); }).filter(Boolean);
  }
  function pinSubmit(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    if (!/^\d{4,8}$/.test(v.p1 || '')) { toast(t('pin_format')); return; }
    if (v.p1 !== v.p2) { toast(t('pin_mismatch')); return; }
    const go = function () { setPin(v.p1).then(function () { S.unlocked = !S.settings.pin || S.unlocked; render(); toast(t('pin_saved')); }, function () { toast(t('pin_nocrypto')); }); };
    if (!S.settings.pin) { go(); return; }
    checkPin(v.p0).then(function (r) { if (r !== 'ok') { toast(pinMsg(r)); return; } go(); });
  }
  function protSubmit(form) {
    if (!S.unlocked) {
      const pin = form.querySelector('[name=unlockpin]');
      checkPin(pin ? pin.value : '').then(function (r) { if (r !== 'ok') { toast(pinMsg(r)); return; } S.unlocked = true; render(); });
      return;
    }
    const r = readProt(form);
    if (r.errors.length) { toast(r.errors[0]); return; }
    r.s.silos.forEach(function (x) { delete x._new; });
    S.settings = r.s;
    saveSettings().then(function () { S.unlocked = false; render(); toast(t('settings_saved')); });
  }

  // ---------------- eventos / events ----------------
  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
    const a = b.dataset.action;
    if (a === 'tab') { if (S.tab === 'settings' && b.dataset.tab !== 'settings') { S.unlocked = false; } S.tab = b.dataset.tab; S.sheet = null; render(); window.scrollTo(0, 0); }
    if (a === 'new-lot') { S.form = newForm(); render(); window.scrollTo(0, 0); }
    if (a === 'release') { const l = S.lots.find(function (x) { return x.id === b.dataset.id; }); if (l) { S.form = releaseForm(l); render(); window.scrollTo(0, 0); } }
    if (a === 'cancel-lot') { S.form = null; render(); }
    if (a === 'seg') {
      const form = b.closest('form'), name = b.dataset.name, val = b.dataset.value;
      const hid = form.querySelector('input[type=hidden][name="' + name + '"]'); if (hid) hid.value = val;
      b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      if (form.id === 'lotform') { S.form[name] = val; if (name === 'colour') S.form.dest = []; updateDyn(); }
      if (form.id === 'sheetform') { S.sheet.v[name] = val; updateSheetDyn(); }
    }
    if (a === 'dest-add') { if (S.form.dest.indexOf(b.dataset.silo) < 0) S.form.dest.push(b.dataset.silo); updateDyn(); }
    if (a === 'dest-rm') { S.form.dest = S.form.dest.filter(function (x) { return x !== b.dataset.silo; }); updateDyn(); }
    if (a === 'discharge') { openSheet('out', { order: b.dataset.silo ? [b.dataset.silo] : [] }); }
    if (a === 'out-add') { S.sheet.order.push(b.dataset.silo); updateSheetDyn(); }
    if (a === 'out-rm') { S.sheet.order = S.sheet.order.filter(function (x) { return x !== b.dataset.silo; }); updateSheetDyn(); }
    if (a === 'silo-transfer') openSheet('transfer', { silo: b.dataset.silo });
    if (a === 'silo-empty') openSheet('empty', { silo: b.dataset.silo });
    if (a === 'mon-round') openSheet('round', { silo: b.dataset.silo });
    if (a === 'mon-weekly') openSheet('weekly', { silo: b.dataset.silo });
    if (a === 'mon-treat') openSheet('treat', { silo: b.dataset.silo });
    if (a === 'mon-disp') openSheet('disp', { silo: b.dataset.silo });
    if (a === 'mon-event') openSheet('event', { id: b.dataset.id });
    if (a === 'close-sheet') { S.sheet = null; renderSheet(); }
    if (a === 'export-xlsx') exportXlsx();
    if (a === 'backup') backup(false).then(render);
    if (a === 'lock') { S.unlocked = false; load().then(render); }
    if (a === 'add-silo') { keepProtDraft(); S.settings.silos.push({ id: 'S' + String(S.settings.silos.length + 1).padStart(2, '0'), cap: '', cereal: '', colour: '', grade: '', points: '1', _new: true }); render(); }
    if (a === 'rm-silo') { keepProtDraft(); const x = S.settings.silos[+b.dataset.i]; if (x && !(siloHasHistory(x.id) && !x._new)) S.settings.silos.splice(+b.dataset.i, 1); render(); }
    if (a === 'add-sup') { readGeneral($('#generalform')); S.settings.suppliers.push(' '); render(); }
    if (a === 'rm-sup') { readGeneral($('#generalform')); S.settings.suppliers.splice(+b.dataset.i, 1); render(); }
  });
  const DYN_FIELDS = ['kg', 'hum', 'fat', 'fm', 'brk', 'dis', 'sw', 'afla', 'don', 'fum', 'qcGrade'];
  document.addEventListener('input', function (e) {
    const el = e.target;
    if (el.id === 'q') { S.q = el.value; $('#lotlist').innerHTML = lotListHtml(L.today()); return; }
    if (S.form && el.form && el.form.id === 'lotform' && el.name) {
      S.form[el.name] = el.value;
      if (DYN_FIELDS.indexOf(el.name) >= 0) { updateDyn(); el.toggleAttribute('aria-invalid', L.bad(el.value, el.name === 'kg' ? 'kg' : undefined)); }
    }
    if (S.sheet && el.form && el.form.id === 'sheetform' && el.name) {
      S.sheet.v[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      if (/^(kg|toSilo|moist|insects|odour|p_\d+|f_\d+)$/.test(el.name)) updateSheetDyn();
    }
  });
  document.addEventListener('change', function (e) {
    const el = e.target;
    if (S.form && el.form && el.form.id === 'lotform' && el.name) {
      S.form[el.name] = el.value;
      if (el.name === 'cereal') { S.form.dest = []; S.form.colour = ''; render(); }
      else if (el.name === 'date') render();
      else if (el.name === 'qcGrade') { S.form.dest = []; updateDyn(); }
    }
    if (S.sheet && el.form && el.form.id === 'sheetform' && el.name) S.sheet.v[el.name] = el.type === 'checkbox' ? el.checked : el.value; // sem redesenhar: o 'input' já tratou (evita perder o foco)
    if (el.id === 'restore') restore(el.files[0], el);
    if (el.name === 'lang' && el.form && el.form.id === 'generalform') {
      readGeneral(el.form); I18n.set(S.settings.lang);
      saveSettings().then(function () { render(); toast(t('settings_saved')); });
    }
  });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    const id = e.target.id;
    if (id === 'lotform') saveLot();
    if (id === 'sheetform') submitSheet();
    if (id === 'generalform') { readGeneral(e.target); I18n.set(S.settings.lang); saveSettings().then(function () { render(); toast(t('settings_saved')); }); }
    if (id === 'pinform') pinSubmit(e.target);
    if (id === 'protform') protSubmit(e.target);
  });

  // ---------------- arranque / start ----------------
  load().then(function () { render(); DB.persist(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
  window.__app = { S: S }; // apenas para testes / for tests only
})();
