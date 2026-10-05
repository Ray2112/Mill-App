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
  const fmtKg = function (n) { return fmtNum(n, 0) + ' kg'; };
  const clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  const CEREALS = ['Milho', 'Trigo', 'Arroz'];
  const CER_KEY = { Milho: 'maize', Trigo: 'wheat', Arroz: 'rice' };
  const COLOURS = ['Amarelo', 'Branco'];
  const SILO_GRADES = ['G1', 'G2', 'OFF'];
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
      insp: { tempMax: '', humMax: '', days: '' },
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
    s.silos = (s.silos || []).map(function (x) { return { id: x.id, cap: x.cap || '', cereal: x.cereal || '', colour: x.colour || '', grade: x.grade || '' }; });
    s.insp = Object.assign(d.insp, s.insp || {});
    s.schema = 2;
    return s;
  }

  const S = { tab: 'intake', settings: null, lots: [], events: [], insp: [], form: null, sheet: null, unlocked: false, q: '' };

  // ---------------- carregar / load ----------------
  function load() {
    return Promise.all([DB.all('lots'), DB.all('events'), DB.all('inspections'), DB.getSetting('main', null)]).then(function (r) {
      S.lots = r[0].sort(function (a, b) { return (b.date + b.time + b.id) < (a.date + a.time + a.id) ? -1 : 1; });
      S.events = r[1];
      S.insp = r[2];
      S.settings = migrate(r[3]);
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
  function gradeName(g) { return L.GRADES.indexOf(g) >= 0 ? t('g_' + g) : '—'; }
  function siloDesig(s) {
    if (!s.cereal || !s.grade) return t('not_designated');
    return cerName(s.cereal) + (s.colour ? ' ' + s.colour : '') + ' · ' + gradeName(s.grade);
  }
  function gradeBadge(g) { return L.GRADES.indexOf(g) >= 0 ? '<span class="badge g-' + g + '">' + esc(gradeName(g)) + '</span>' : ''; }
  function statusBadge(st) { return L.STATUS.indexOf(st) >= 0 ? '<span class="badge b-' + st + '">' + esc(t('st_' + st)) + '</span>' : ''; }
  function placeName(p) { return p === 'INTAKE' ? t('tab_intake') : p; }
  function siloById(id) { return S.settings.silos.find(function (s) { return s.id === id; }); }
  function siloHasHistory(id) { return S.events.some(function (e) { return e.silo === id || e.toSilo === id; }) || S.insp.some(function (i) { return i.silo === id; }); }
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
      const r = L.gradeLot(f, gcfg(f.cereal), mcfg(f.cereal));
      const opts = L.releaseOptions(r.matrix);
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
    const r = L.gradeLot(f, gcfg(f.cereal), mcfg(f.cereal));
    if (f.mode === 'release') {
      const g = f.qcGrade;
      return { r: r, grade: SILO_GRADES.indexOf(g) >= 0 ? g : null, status: g === 'REJ' ? 'REJECTED' : g === 'HELD' || !g ? 'HELD' : 'ACCEPTED', kg: L.num(f.kg, 'kg') };
    }
    const status = r.code === 'REJ' ? 'REJECTED' : (r.code === 'HOLD' || r.code === 'NONE') ? 'HELD' : SILO_GRADES.indexOf(r.code) >= 0 ? 'ACCEPTED' : null;
    return { r: r, grade: status === 'ACCEPTED' ? r.code : null, status: status, kg: L.num(f.kg, 'kg') };
  }
  // Silos possíveis para um item (cereal/cor/grau) / candidate silos
  function candidates(item, excludeId) {
    return S.settings.silos.filter(function (s) { return s.id !== excludeId; }).map(function (s) {
      const fit = L.siloFit(item, s);
      const free = L.freeSpace(s, S.events);
      return { s: s, fit: fit, free: free };
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
    else { cls = r.code === 'OFF' ? 'd1' : 'd0'; title = gradeName(r.code); body = r.reasons.map(why); if (!body.length) body = [esc(t('all_ok'))]; if (r.code === 'OFF') body.push(esc(t('off_note'))); }
    let h = '<div class="decision ' + cls + '"><div class="small caps">' + esc(f.mode === 'release' ? t('qc_info') : t('auto_grade')) + '</div><div class="big">' + esc(title) + '</div>' +
      body.map(function (b) { return '<div>' + b + '</div>'; }).join('');
    if (r.notes.indexOf('low_moisture') >= 0) h += '<div class="small">' + esc(t('low_moisture')) + '</div>';
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
    if (blocked.length) h += '<div class="small muted">' + blocked.map(function (c) { return esc(c.s.id) + ': ' + esc(c.free === null ? t('cap_not_set') : t('silo_full')); }).join(' · ') + '</div>';
    if (order.length) {
      h += '<div class="lbl">' + esc(t('dest_order')) + '</div>';
      h += order.map(function (id, i) {
        const p = plan.parts.find(function (x) { return x.silo === id; });
        const s = siloById(id);
        const mism = plan.mismatch.indexOf(id) >= 0;
        return '<div class="row destrow' + (mism ? ' mism' : '') + '"><span class="mono">' + (i + 1) + '. ' + esc(id) + '</span><span class="grow small muted">' + esc(s ? siloDesig(s) : '') + '</span><span class="strong">' + (p ? fmtKg(p.kg) : '0 kg') + '</span>' +
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
    plan.mismatch.forEach(function (id) { n.push(t('auth_mismatch') + ' ' + id + ' (' + gradeName(siloById(id).grade) + ' ≠ ' + gradeName(grade) + ')'); });
    return n;
  }
  function updateDyn() {
    const box = $('#dyn'); if (!box || !S.form) return;
    const f = S.form, d = formDecision();
    let h = resultBox(d);
    if (d.status === 'ACCEPTED' && d.grade) {
      const item = { cereal: f.cereal, colour: f.colour, grade: d.grade };
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
    const bad = f.dest.filter(function (id) { const s = siloById(id); return !s || !L.siloFit(item, s).ok; });
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
  function lastInspection(id) {
    let last = null;
    S.insp.forEach(function (i) { if (i.silo === id && (!last || (i.date + i.time + String(i.seq).padStart(8, '0')) > (last.date + last.time + String(last.seq).padStart(8, '0')))) last = i; });
    return last;
  }
  function inspStatus(id) {
    const last = lastInspection(id);
    const flags = last ? L.inspectionFlags(last, S.settings.insp) : [];
    const overdue = L.inspectionOverdue(last && last.date, L.today(), S.settings.insp.days);
    return { last: last, flags: flags, overdue: overdue };
  }
  function silosView() {
    if (!S.settings.silos.length) return '<p class="warn">' + esc(t('no_silos')) + '</p>';
    const lotsById = {}; S.lots.forEach(function (l) { lotsById[l.id] = l; });
    let h = '<button class="btn primary block" data-action="discharge">' + esc(t('act_out')) + '</button>';
    S.settings.silos.forEach(function (s) {
      const c = L.siloContents(s.id, S.events);
      const cap = L.num(s.cap, 'kg');
      const hasCap = cap !== null && !isNaN(cap) && cap > 0;
      const pct = hasCap ? Math.min(100, Math.round(c.kg / cap * 100)) : null;
      const full = hasCap && c.kg >= cap;
      const is = inspStatus(s.id);
      h += '<div class="card stack"><div class="row"><div class="grow"><div class="big2">' + esc(s.id) + '</div><div class="small muted">' + esc(siloDesig(s)) + '</div></div>' +
        '<div class="right"><div class="strong">' + fmtKg(c.kg) + '</div><div class="small muted">' + (hasCap ? esc(t('of')) + ' ' + fmtKg(cap) + ' · ' + pct + '%' : esc(t('cap_not_set'))) + '</div></div></div>';
      if (hasCap) h += '<div class="bar' + (full ? ' full' : '') + '"><div style="width:' + pct + '%"></div></div>';
      if (full) h += '<div class="badge b-REJECTED fit">' + esc(t('silo_full')) + '</div>';
      if (c.kg < 0) h += '<p class="warn small">' + esc(t('negative_stock')) + '</p>';
      h += '<div class="small">' + inspLine(is) + '</div>';
      h += '<details><summary class="small muted">' + esc(t('lots_in_silo')) + ' (' + c.lots.length + ')</summary>' +
        (c.lots.length ? c.lots.map(function (id) { const l = lotsById[id]; return '<div class="row small"><span class="mono grow">' + esc(id) + '</span><span class="muted">' + (l ? esc(l.supplier) + ' · ' + esc(gradeName(l.grade)) : '') + '</span></div>'; }).join('') : '<div class="muted small">' + esc(t('empty_silo')) + '</div>') + '</details>';
      const dis = c.kg > 0 ? '' : ' disabled';
      h += '<div class="grid2"><button class="btn small" data-action="discharge" data-silo="' + esc(s.id) + '"' + dis + '>' + esc(t('act_out_short')) + '</button>' +
        '<button class="btn small" data-action="silo-transfer" data-silo="' + esc(s.id) + '"' + dis + '>' + esc(t('act_transfer')) + '</button>' +
        '<button class="btn small" data-action="silo-inspect" data-silo="' + esc(s.id) + '">' + esc(t('act_inspect')) + '</button>' +
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
  function inspLine(is) {
    if (!is.last) return '<span class="' + (is.overdue ? 'flag' : 'muted') + '">' + esc(t('insp_never')) + '</span>';
    const l = is.last;
    let s = esc(t('last_insp')) + ': ' + esc(l.date) + ' · ' + (l.temp !== null && l.temp !== undefined ? esc(fmtNum(l.temp, 1)) + ' °C · ' : '') + (l.hum !== null && l.hum !== undefined ? esc(fmtNum(l.hum)) + '% · ' : '') + esc(l.inspector);
    if (is.flags.length) s += ' <span class="flag">⚠ ' + is.flags.map(function (f) { return esc(t('flag_' + f)); }).join(', ') + '</span>';
    if (is.overdue) s += ' <span class="flag">⏰ ' + esc(t('insp_overdue')) + '</span>';
    return s;
  }

  // ---------------- inspecções / inspections tab ----------------
  function inspView() {
    const lim = S.settings.insp;
    let h = '';
    if (L.num(lim.tempMax) === null && L.num(lim.humMax) === null) h += '<p class="warn small">' + esc(t('insp_no_limits')) + '</p>';
    if (!S.settings.silos.length) return h + '<p class="warn">' + esc(t('no_silos')) + '</p>';
    h += S.settings.silos.map(function (s) {
      const is = inspStatus(s.id);
      const cls = is.flags.length ? 'b-REJECTED' : is.overdue ? 'b-HELD' : is.last ? 'b-ACCEPTED' : '';
      const lbl = is.flags.length ? t('st_alert') : is.overdue ? t('insp_overdue') : is.last ? 'OK' : t('insp_never_short');
      return '<div class="card row"><div class="grow"><div class="big2">' + esc(s.id) + '</div><div class="small muted">' + esc(siloDesig(s)) + ' · ' + fmtKg(L.siloContents(s.id, S.events).kg) + '</div><div class="small">' + inspLine(is) + '</div></div>' +
        '<div class="stack right"><span class="badge ' + cls + (cls ? '' : ' b-none') + '">' + esc(lbl) + '</span><button class="btn small" data-action="silo-inspect" data-silo="' + esc(s.id) + '">' + esc(t('act_inspect')) + '</button></div></div>';
    }).join('');
    const list = S.insp.slice().sort(function (a, b) { return (b.date + b.time + String(b.seq).padStart(8, '0')) < (a.date + a.time + String(a.seq).padStart(8, '0')) ? -1 : 1; }).slice(0, 50);
    h += '<h2>' + esc(t('insp_history')) + '</h2>';
    h += list.length ? list.map(function (i) {
      const fl = L.inspectionFlags(i, lim);
      return '<div class="card small"><div class="row"><strong class="grow">' + esc(i.silo) + ' · ' + esc(i.date) + ' ' + esc(i.time) + '</strong>' + (fl.length ? '<span class="flag">⚠ ' + fl.map(function (f) { return esc(t('flag_' + f)); }).join(', ') + '</span>' : '') + '</div>' +
        '<div class="muted">' + esc(t('temp')) + ': ' + esc(fmtNum(i.temp, 1)) + ' · ' + esc(t('moisture')) + ': ' + esc(fmtNum(i.hum)) + ' · ' + esc(t('odour')) + ': ' + esc(i.odor === 'Anormal' ? t('abnormal') : t('normal')) + ' · ' + esc(t('infestation')) + ': ' + esc(i.ins === 'S' ? t('yes') : t('no')) + ' · ' + esc(i.inspector) + '</div>' +
        (i.notes ? '<div>' + esc(i.notes) + '</div>' : '') + (i.action ? '<div><b>' + esc(t('action_taken')) + ':</b> ' + esc(i.action) + '</div>' : '') + '</div>';
    }).join('') : '<p class="muted">' + esc(t('no_insp')) + '</p>';
    return h;
  }

  // ---------------- folhas (modais) / sheets ----------------
  function sv(name, dflt) { const v = S.sheet.v[name]; return v === undefined ? (dflt === undefined ? '' : dflt) : v; }
  function sInput(name, label, extra, dflt) { return '<label>' + esc(label) + '<input name="' + name + '" value="' + esc(sv(name, dflt)) + '"' + (extra || '') + '></label>'; }
  function openSheet(kind, data) { S.sheet = Object.assign({ kind: kind, v: { date: L.today(), time: L.nowTime(), operator: S.settings.operator || '' } }, data || {}); renderSheet(); }
  function renderSheet() {
    const el = $('#sheet');
    if (!S.sheet) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const sh = S.sheet;
    let h = '<form class="sheet-card stack" id="sheetform" novalidate><h2>';
    h += esc({ out: t('act_out'), transfer: t('act_transfer') + ' · ' + sh.silo, empty: t('act_empty') + ' · ' + sh.silo, inspect: t('act_inspect') + ' · ' + sh.silo }[sh.kind]);
    h += '</h2><div class="grid2">' + sInput('date', t('date'), ' type="date"') + sInput('time', t('time'), ' type="time"') + '</div>';
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
    if (sh.kind === 'inspect') {
      h += '<div class="grid2">' + sInput('temp', t('temp'), DEC) + sInput('hum', t('moisture'), DEC) + '</div>';
      h += '<div class="lbl">' + esc(t('odour')) + '</div>' + seg('odor', [['Normal', t('normal')], ['Anormal', t('abnormal')]], sv('odor', 'Normal'));
      h += '<div class="lbl">' + esc(t('infestation')) + '</div>' + seg('ins', [['N', t('no')], ['S', t('yes')]], sv('ins', 'N'));
      h += sInput('notes', t('notes')) + sInput('action', t('action_taken'));
    }
    h += sInput(sh.kind === 'inspect' ? 'inspector' : 'operator', (sh.kind === 'inspect' ? t('inspector') : t('operator')) + ' *', '', S.settings.operator || '');
    h += '<div id="sheetdyn"></div>';
    h += '<div class="grid2"><button type="button" class="btn" data-action="close-sheet">' + esc(t('cancel')) + '</button><button type="submit" class="btn primary">' + esc(t('confirm')) + '</button></div></form>';
    el.innerHTML = h;
    updateSheetDyn();
  }
  // Silos com grão (para descarga) / silos with stock
  function stocked() { return S.settings.silos.map(function (s) { return { s: s, kg: L.siloContents(s.id, S.events).kg }; }).filter(function (x) { return x.kg > 0; }); }
  function outPlan() {
    const kg = L.num(sv('kg'), 'kg');
    const slots = S.sheet.order.map(function (id) { return { id: id, avail: Math.max(0, L.siloContents(id, S.events).kg) }; });
    return { kg: kg, a: L.allocate(kg > 0 ? kg : 0, slots) };
  }
  function transferCheck() {
    const sh = S.sheet, kg = L.num(sv('kg'), 'kg'), to = siloById(sv('toSilo')), src = siloById(sh.silo);
    const bal = L.siloContents(sh.silo, S.events).kg;
    const res = { kg: kg, errors: [], needs: [] };
    if (kg === null) res.errors.push(t('need_kg'));
    else if (isNaN(kg) || kg <= 0) res.errors.push(t('check_values') + ': ' + t('kg'));
    else if (kg > bal) res.errors.push(t('more_than_stock') + ' ' + fmtKg(bal));
    if (!to) res.errors.push(t('need_to_silo'));
    else {
      const free = L.freeSpace(to, S.events);
      if (free === null) res.errors.push(to.id + ': ' + t('cap_not_set'));
      else if (kg > free) res.errors.push(t('more_than_space') + ' ' + fmtKg(free));
      const fit = L.siloFit({ cereal: src.cereal, colour: src.colour, grade: src.grade }, to);
      if (!fit.ok) res.errors.push(t('silo_not_allowed') + ' ' + to.id);
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
      if (more.length) h += '<div class="chips">' + more.map(function (x) { return '<button type="button" class="chip" data-action="out-add" data-silo="' + esc(x.s.id) + '">+ ' + esc(x.s.id) + ' <span class="muted">' + esc(gradeName(x.s.grade)) + ' · ' + fmtKg(x.kg) + '</span></button>'; }).join('') + '</div>';
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
    if (sh.kind === 'inspect') {
      const fl = L.inspectionFlags({ temp: sv('temp'), hum: sv('hum'), odor: sv('odor', 'Normal'), ins: sv('ins', 'N') }, S.settings.insp);
      if (fl.length) h += '<p class="warn"><b>⚠ ' + fl.map(function (f) { return esc(t('flag_' + f)); }).join(', ') + '</b> — ' + esc(t('insp_alert_note')) + '</p>';
    }
    box.innerHTML = h;
  }
  function submitSheet() {
    const sh = S.sheet, v = sh.v;
    const who = (sh.kind === 'inspect' ? sv('inspector', S.settings.operator) : sv('operator', S.settings.operator)).trim();
    if (!who) { toast(t('need_person')); return; }
    if (!v.date && !sv('date')) { toast(t('need_fields')); return; }
    const base = { date: sv('date'), time: sv('time'), silo: sh.silo, operator: who, notes: '' };
    let p;
    if (sh.kind === 'out') {
      if (!sv('place').trim()) { toast(t('need_line')); return; }
      const pl = outPlan();
      if (pl.kg === null || isNaN(pl.kg) || pl.kg <= 0) { toast(t('need_kg')); return; }
      if (!sh.order.length) { toast(t('need_silo')); return; }
      if (pl.a.short > 0) { toast(t('short_stock') + ' ' + fmtKg(pl.a.short)); return; }
      p = DB.addMany(pl.a.parts.map(function (part) {
        return { store: 'events', obj: Object.assign({}, base, { silo: part.silo, type: 'OUT', kg: part.kg, place: sv('place').trim(), prodLot: sv('prodLot'), lots: L.siloContents(part.silo, S.events).lots, seqGroup: Date.now() }) };
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
    if (sh.kind === 'inspect') {
      const temp = L.num(sv('temp')), hum = L.num(sv('hum'));
      if ((temp !== null && isNaN(temp)) || (hum !== null && isNaN(hum))) { toast(t('check_values')); return; }
      if (temp === null && hum === null) { toast(t('need_insp_values')); return; }
      p = DB.add('inspections', { date: sv('date'), time: sv('time'), silo: sh.silo, temp: temp, hum: hum, odor: sv('odor', 'Normal'), ins: sv('ins', 'N'), inspector: who, notes: sv('notes'), action: sv('action'), createdAt: new Date().toISOString() });
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
      '<div class="card stack"><h2>' + esc(t('backup')) + '</h2>' + (backupDue() ? '<p class="warn">' + esc(t('backup_due')) + '</p>' : '') + '<p>' + esc(t('backup_note')) + '</p><p class="small muted">' + esc(t('last_backup')) + ': ' + esc(S.settings.lastBackup ? S.settings.lastBackup.replace('T', ' ').slice(0, 16) : t('never')) + '</p>' +
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
        (l.auth || []).map(function (a) { return a.by + ' — ' + a.reason + ' [' + a.items.join('; ') + '] ' + a.at.slice(0, 16).replace('T', ' '); }).join(' | '),
        (l.qc || []).map(function (q) { return q.by + ': ' + (q.decision === 'HELD' ? t('keep_held') : q.decision === 'REJ' ? t('st_REJECTED') : gradeName(q.decision)) + ' — ' + q.reason; }).join(' | '),
        l.responsible, l.notes];
    });
    const H13 = [t('date'), t('time'), t('silo'), t('x_move'), t('x_lots'), t('kg'), t('x_fromto'), t('prod_lot'), t('operator'), t('x_auth'), t('notes')];
    const rows13 = L.sortEvents(S.events.filter(function (e) { return inRange(e.date); })).map(function (e) {
      const where = e.type === 'TRANSFER' ? e.silo + ' → ' + e.toSilo : e.type === 'OUT' ? placeName(e.place) : e.type === 'IN' ? t('tab_intake') : '';
      const kg = e.type === 'EMPTY' ? (e.writeOff ? -e.writeOff : null) : e.kg;
      return [e.date, e.time, e.silo, t('ev_' + e.type), (e.lots || []).join(', '), kg, where, e.prodLot || '', e.operator, e.auth ? e.auth.by + ' — ' + e.auth.reason : '', e.notes];
    });
    const HI = [t('date'), t('time'), t('silo'), t('temp'), t('moisture'), t('odour'), t('infestation'), t('x_flags'), t('inspector'), t('notes'), t('action_taken')];
    const rowsI = S.insp.filter(function (i) { return inRange(i.date); }).sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; }).map(function (i) {
      return [i.date, i.time, i.silo, i.temp, i.hum, i.odor === 'Anormal' ? t('abnormal') : t('normal'), yn(i.ins), L.inspectionFlags(i, S.settings.insp).map(function (f) { return t('flag_' + f); }).join('; '), i.inspector, i.notes, i.action];
    });
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
    sheet(pt ? 'Inspeccoes' : 'Inspections', HI, rowsI, t('x_insp'));
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), L.today() + '_Moagem_RG-21_RG-13_Inspeccoes_' + from + '_' + to + '.xlsx');
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
    h += '<div class="card stack"><h2>' + esc(t('insp_cfg')) + '</h2><p class="small muted">' + esc(t('insp_cfg_note')) + '</p><div class="grid3">' +
      '<label>' + esc(t('temp_max')) + '<input name="i_tempMax" type="text" inputmode="decimal" value="' + esc(s.insp.tempMax) + '"></label>' +
      '<label>' + esc(t('hum_max')) + '<input name="i_humMax" type="text" inputmode="decimal" value="' + esc(s.insp.humMax) + '"></label>' +
      '<label>' + esc(t('insp_days')) + '<input name="i_days" type="text" inputmode="numeric" value="' + esc(s.insp.days) + '"></label></div></div>';
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
        cereal: locked ? x.cereal : (v['silo_cer_' + i] || ''), colour: locked ? x.colour : (v['silo_col_' + i] || ''), grade: v['silo_grade_' + i] || '', _new: x._new };
    });
    const ids = {};
    s.silos.forEach(function (x) {
      if (!x.id) errors.push(t('err_silo_id'));
      else if (ids[x.id]) errors.push(t('err_silo_dup') + ' ' + x.id); ids[x.id] = true;
      const cap = L.num(x.cap, 'kg');
      if (cap !== null && (isNaN(cap) || cap <= 0)) errors.push(x.id + ': ' + t('silo_cap'));
      if (x.cereal === 'Milho' && x.grade && !x.colour) errors.push(x.id + ': ' + t('err_colour'));
      if (x.cereal !== 'Milho') x.colour = '';
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
    ['tempMax', 'humMax', 'days'].forEach(function (k) { s.insp[k] = (v['i_' + k] || '').trim(); if (L.bad(s.insp[k])) errors.push(t('insp_cfg') + ': ' + t('err_number')); });
    return { s: s, errors: errors };
  }
  function keepProtDraft() { const f = $('#protform'); if (f && S.unlocked) { const r = readProt(f); S.settings.silos = r.s.silos; S.settings.grading = r.s.grading; S.settings.myco = r.s.myco; S.settings.insp = r.s.insp; } }
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
    if (a === 'silo-inspect') { openSheet('inspect', { silo: b.dataset.silo }); S.sheet.v.inspector = S.settings.operator || ''; }
    if (a === 'close-sheet') { S.sheet = null; renderSheet(); }
    if (a === 'export-xlsx') exportXlsx();
    if (a === 'backup') backup(false).then(render);
    if (a === 'lock') { S.unlocked = false; load().then(render); }
    if (a === 'add-silo') { keepProtDraft(); S.settings.silos.push({ id: 'S' + String(S.settings.silos.length + 1).padStart(2, '0'), cap: '', cereal: '', colour: '', grade: '', _new: true }); render(); }
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
      S.sheet.v[el.name] = el.value;
      if (['kg', 'toSilo', 'temp', 'hum'].indexOf(el.name) >= 0) updateSheetDyn();
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
    if (S.sheet && el.form && el.form.id === 'sheetform' && el.name) S.sheet.v[el.name] = el.value; // sem redesenhar: o 'input' já tratou (evita perder o foco)
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
