/* Moagem — Registos: interface. Sem frameworks, para manter simples de manter. */
(function () {
  'use strict';
  const t = function (k) { return I18n.t(k); };
  const L = window.Logic;
  const $ = function (sel, el) { return (el || document).querySelector(sel); };
  const esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const fmtKg = function (n) { return (Math.round(n) || 0).toLocaleString(I18n.lang === 'pt' ? 'pt-PT' : 'en-GB') + ' kg'; };

  const DEFAULT_SETTINGS = {
    lang: 'pt', millName: '', site: '', operator: '',
    silos: [{ id: 'S1', cap: '' }, { id: 'S2', cap: '' }, { id: 'S3', cap: '' }, { id: 'S4', cap: '' }],
    suppliers: [],
    limits: {
      Trigo: { hum: '', imp: '', afla: '', don: '', fum: '', aflaRequired: false, donRequired: false, fumRequired: false },
      Milho: { hum: '', imp: '', afla: '', don: '', fum: '', aflaRequired: false, donRequired: false, fumRequired: false }
    },
    lastBackup: null
  };

  const S = { tab: 'intake', settings: null, lots: [], events: [], form: null, sheet: null };

  // ---------------- carregar / load ----------------
  function load() {
    return Promise.all([DB.all('lots'), DB.all('events'), DB.getSetting('main', null)]).then(function (r) {
      S.lots = r[0].sort(function (a, b) { return (b.date + b.time + b.id) < (a.date + a.time + a.id) ? -1 : 1; });
      S.events = r[1];
      S.settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), r[2] || {});
      I18n.set(S.settings.lang);
    });
  }
  function saveSettings() { return DB.setSetting('main', S.settings); }

  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // ---------------- casca / shell ----------------
  function renderShell() {
    document.title = t('app_name');
    $('#title').textContent = ({ intake: t('intake_title'), silos: t('silos_title'), export: t('export_title'), settings: t('settings_title') })[S.tab];
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
    if (S.tab === 'export') main.innerHTML = exportView();
    if (S.tab === 'settings') main.innerHTML = settingsView();
    if (S.tab === 'intake' && S.form) updateDecision();
    renderSheet();
    main.scrollTop = 0;
  }

  // ---------------- recepção: lista / intake list ----------------
  function statusBadge(st) { return '<span class="badge b-' + st + '">' + esc(t('st_' + st)) + '</span>'; }
  function lotRow(l) {
    const silo = l.silo ? ' · ' + esc(t('silo')) + ' ' + esc(l.silo) : '';
    const act = l.status === 'HELD' ? '<button class="btn small" data-action="decide-held" data-id="' + esc(l.id) + '">' + esc(t('decide_held')) + '</button>' : '';
    return '<div class="card row"><div class="grow"><div class="mono">' + esc(l.id) + '</div><div class="muted">' +
      esc(l.cereal === 'Trigo' ? t('wheat') : t('maize')) + ' · ' + esc(l.supplier) + ' · ' + fmtKg(L.num(l.kg)) + silo + '</div>' + act + '</div>' + statusBadge(l.status) + '</div>';
  }
  function intakeList() {
    const d = L.today();
    const todays = S.lots.filter(function (l) { return l.date === d; });
    const older = S.lots.filter(function (l) { return l.date !== d; }).slice(0, 30);
    let h = '<button class="btn primary block" data-action="new-lot">+ ' + esc(t('new_lot')) + '</button>';
    h += '<h2>' + esc(t('lots_today')) + '</h2>';
    h += todays.length ? todays.map(lotRow).join('') : '<p class="muted">' + esc(t('no_lots')) + '</p>';
    if (older.length) h += '<h2>' + esc(t('lots_older')) + '</h2>' + older.map(lotRow).join('');
    return h;
  }

  // ---------------- recepção: formulário / intake form ----------------
  function newForm() {
    return { date: L.today(), time: L.nowTime(), guia: '', supplier: '', origin: '', cereal: 'Milho', plate: '', kg: '', hum: '', imp: '',
      ins: 'N', odor: 'Normal', afla: '', don: '', fum: '', silo: '', responsible: S.settings.operator || '', notes: '', final: '', overrideReason: '' };
  }
  function field(name, label, type, extra) {
    const f = S.form;
    return '<label>' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(f[name]) + '"' + (extra || '') + '></label>';
  }
  function seg(name, opts) {
    const f = S.form;
    return '<div class="seg" role="group">' + opts.map(function (o) {
      return '<button type="button" class="' + (f[name] === o[0] ? 'on' : '') + '" data-action="seg" data-name="' + name + '" data-value="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function intakeForm() {
    const f = S.form;
    const sup = '<datalist id="suppliers">' + S.settings.suppliers.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>';
    const silos = '<option value="">—</option>' + S.settings.silos.map(function (s) { return '<option ' + (f.silo === s.id ? 'selected' : '') + '>' + esc(s.id) + '</option>'; }).join('');
    let h = '<form id="lotform" class="card stack" autocomplete="off" novalidate>';
    h += '<h2>' + esc(t('new_lot')) + ' · <span class="mono">' + esc(L.lotCode(f.date || L.today(), S.lots)) + '</span></h2>';
    h += seg('cereal', [['Trigo', t('wheat')], ['Milho', t('maize')]]);
    h += '<div class="grid2">' + field('date', t('date'), 'date') + field('time', t('time'), 'time') + '</div>';
    h += '<label>' + esc(t('supplier')) + '<input name="supplier" list="suppliers" value="' + esc(f.supplier) + '"></label>' + sup;
    h += '<div class="grid2">' + field('guia', t('guia')) + field('plate', t('plate')) + '</div>';
    h += '<div class="grid2">' + field('origin', t('origin')) + field('kg', t('net_kg'), 'text', ' inputmode="decimal"') + '</div>';
    h += '<div class="grid2">' + field('hum', t('moisture'), 'text', ' inputmode=\"decimal\"') + field('imp', t('impurities'), 'text', ' inputmode=\"decimal\"') + '</div>';
    h += '<div class="lbl">' + esc(t('live_insects')) + '</div>' + seg('ins', [['N', t('no')], ['S', t('yes')]]);
    h += '<div class="lbl">' + esc(t('odour')) + '</div>' + seg('odor', [['Normal', t('normal')], ['Anormal', t('abnormal')]]);
    h += '<div class="grid2">' + field('afla', t('afla'), 'text', ' inputmode=\"decimal\"') + field('don', t('don'), 'text', ' inputmode=\"decimal\"') + '</div>';
    h += field('fum', t('fum'), 'text', ' inputmode=\"decimal\"');
    h += '<div id="decision"></div>';
    h += '<label>' + esc(t('final_decision')) + '<select name="final"><option value="">—</option>' +
      ['ACCEPTED', 'HELD', 'REJECTED'].map(function (s) { return '<option value="' + s + '" ' + (f.final === s ? 'selected' : '') + '>' + esc(t('st_' + s)) + '</option>'; }).join('') + '</select></label>';
    h += '<p class="muted small">' + esc(t('override_note')) + '</p>';
    h += field('overrideReason', t('override_reason'));
    h += '<label>' + esc(t('silo_dest')) + '<select name="silo">' + silos + '</select></label>';
    h += '<div class="grid2">' + field('responsible', t('responsible')) + field('notes', t('notes')) + '</div>';
    h += '<div class="grid2"><button type="button" class="btn" data-action="cancel-lot">' + esc(t('cancel')) + '</button><button type="submit" class="btn primary">' + esc(t('save_lot')) + '</button></div>';
    h += '</form>';
    return h;
  }
  const AUTO_TO_STATUS = { ACCEPT: 'ACCEPTED', HOLD: 'HELD', REJECT: 'REJECTED' };
  function limitsFor(c) { return S.settings.limits[c] || {}; }
  function updateDecision() {
    const box = $('#decision'); if (!box || !S.form) return;
    const lim = limitsFor(S.form.cereal);
    const d = L.decide(S.form, lim);
    const anyLimit = ['hum', 'imp', 'afla', 'don', 'fum'].some(function (k) { return L.num(lim[k]) !== null; });
    let h = '<div class="decision d' + d.level + '"><div class="small caps">' + esc(t('auto_decision')) + '</div><div class="big">' + esc(t(d.code)) + '</div>';
    h += '<div>' + (d.reasons.length ? d.reasons.map(function (r) { return esc(t(r)); }).join(' · ') : esc(t('all_ok'))) + '</div>';
    if (d.notAssessed.length) h += '<div class="small">' + esc(t('not_assessed')) + d.notAssessed.map(function (k) { return esc(t(k === 'hum' ? 'moisture' : k === 'imp' ? 'impurities' : k)); }).join(', ') + '</div>';
    h += '</div>';
    if (!anyLimit) h += '<p class="warn">' + esc(t('no_limits_warning')) + '</p>';
    box.innerHTML = h;
    const sel = $('select[name=final]');
    if (sel && !S.form._finalTouched) { sel.value = AUTO_TO_STATUS[d.code]; S.form.final = sel.value; }
  }
  function saveLot() {
    const f = S.form;
    if (!f.date || !f.supplier || !f.cereal || L.num(f.kg) === null) { toast(t('need_fields')); return; }
    const d = L.decide(f, limitsFor(f.cereal));
    const final = f.final || AUTO_TO_STATUS[d.code];
    if (final !== AUTO_TO_STATUS[d.code] && !f.overrideReason.trim()) { toast(t('need_override_reason')); return; }
    if (final === 'ACCEPTED' && !f.silo) { toast(t('need_silo')); return; }
    const lot = {
      id: L.lotCode(f.date, S.lots), date: f.date, time: f.time, guia: f.guia, supplier: f.supplier.trim(), origin: f.origin, cereal: f.cereal,
      plate: f.plate, kg: L.num(f.kg), hum: L.num(f.hum), imp: L.num(f.imp), ins: f.ins, odor: f.odor,
      afla: L.num(f.afla), don: L.num(f.don), fum: L.num(f.fum),
      auto: d.code, reasons: d.reasons, status: final, overrideReason: f.overrideReason.trim(),
      silo: final === 'ACCEPTED' ? f.silo : '', responsible: f.responsible, notes: f.notes,
      history: [{ at: new Date().toISOString(), status: final, by: f.responsible }], createdAt: new Date().toISOString()
    };
    const ops = [DB.put('lots', lot)];
    if (final === 'ACCEPTED') ops.push(DB.add('events', { date: f.date, time: f.time, silo: f.silo, type: 'IN', lot: lot.id, lots: [lot.id], kg: lot.kg, place: t('tab_intake'), prodLot: '', operator: f.responsible, notes: '' }));
    if (f.responsible) S.settings.operator = f.responsible;
    if (lot.supplier && S.settings.suppliers.indexOf(lot.supplier) < 0) S.settings.suppliers.push(lot.supplier);
    ops.push(saveSettings());
    Promise.all(ops).then(load).then(function () { S.form = null; render(); toast(t('saved') + ': ' + lot.id); });
  }

  // ---------------- silos ----------------
  function silosView() {
    if (!S.settings.silos.length) return '<p class="warn">' + esc(t('no_silos')) + '</p>';
    const lotsById = {}; S.lots.forEach(function (l) { lotsById[l.id] = l; });
    let h = '';
    S.settings.silos.forEach(function (s) {
      const c = L.siloContents(s.id, S.events);
      const cap = L.num(s.cap);
      const pct = cap ? Math.min(100, Math.round(c.kg / cap * 100)) : null;
      h += '<div class="card stack"><div class="row"><div class="grow big2">' + esc(s.id) + '</div><div class="strong">' + fmtKg(c.kg) + (pct !== null ? ' · ' + pct + '%' : '') + '</div></div>';
      if (pct !== null) h += '<div class="bar"><div style="width:' + pct + '%"></div></div>';
      h += '<div class="small muted">' + esc(t('lots_in_silo')) + '</div>';
      h += c.lots.length ? c.lots.map(function (id) { const l = lotsById[id]; return '<div class="row small"><span class="mono grow">' + esc(id) + '</span><span class="muted">' + (l ? esc(l.supplier) + ' · ' + fmtKg(l.kg) : '') + '</span></div>'; }).join('') : '<div class="muted">' + esc(t('empty_silo')) + '</div>';
      const dis = c.lots.length ? '' : ' disabled';
      h += '<div class="grid3"><button class="btn small" data-action="silo-out" data-silo="' + esc(s.id) + '"' + dis + '>' + esc(t('act_out')) + '</button>' +
        '<button class="btn small" data-action="silo-transfer" data-silo="' + esc(s.id) + '"' + dis + '>' + esc(t('act_transfer')) + '</button>' +
        '<button class="btn small" data-action="silo-empty" data-silo="' + esc(s.id) + '">' + esc(t('act_empty')) + '</button></div></div>';
    });
    const evs = S.events.slice().sort(function (a, b) { return (b.date + b.time + String(b.seq).padStart(8, '0')) < (a.date + a.time + String(a.seq).padStart(8, '0')) ? -1 : 1; }).slice(0, 25);
    h += '<h2>' + esc(t('events')) + '</h2>';
    h += evs.map(function (e) {
      const what = e.type === 'TRANSFER' ? esc(e.silo) + ' → ' + esc(e.toSilo) : esc(e.silo);
      return '<div class="card row small"><div class="grow"><strong>' + esc(t('ev_' + e.type)) + '</strong> · ' + what + (e.place && e.type === 'OUT' ? ' → ' + esc(e.place) : '') +
        '<div class="muted">' + esc(e.date) + ' ' + esc(e.time) + (e.lots && e.lots.length ? ' · ' + e.lots.map(esc).join(', ') : '') + (e.prodLot ? ' · ' + esc(e.prodLot) : '') + '</div></div><div>' + (e.kg ? fmtKg(e.kg) : '') + '</div></div>';
    }).join('');
    return h;
  }

  // ---------------- folhas (modais) / sheets ----------------
  function renderSheet() {
    const el = $('#sheet');
    if (!S.sheet) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const sh = S.sheet;
    let h = '<form class="sheet-card stack" id="sheetform" novalidate><h2>';
    if (sh.kind === 'out') h += esc(t('act_out')) + ' · ' + esc(sh.silo);
    if (sh.kind === 'transfer') h += esc(t('act_transfer')) + ' · ' + esc(sh.silo);
    if (sh.kind === 'empty') h += esc(t('act_empty')) + ' · ' + esc(sh.silo);
    if (sh.kind === 'held') h += esc(t('decide_held')) + ' · <span class="mono">' + esc(sh.id) + '</span>';
    h += '</h2>';
    const now = '<div class="grid2"><label>' + esc(t('date')) + '<input name="date" type="date" value="' + L.today() + '"></label><label>' + esc(t('time')) + '<input name="time" type="time" value="' + L.nowTime() + '"></label></div>';
    if (sh.kind === 'out') {
      h += now + '<label>' + esc(t('to_line')) + '<input name="place" required></label><label>' + esc(t('kg')) + '<input name="kg" type="text" inputmode="decimal"></label>' +
        '<label>' + esc(t('prod_lot')) + '<input name="prodLot"></label>';
    }
    if (sh.kind === 'transfer') {
      const opts = S.settings.silos.filter(function (s) { return s.id !== sh.silo; }).map(function (s) { return '<option>' + esc(s.id) + '</option>'; }).join('');
      h += now + '<label>' + esc(t('to_silo')) + '<select name="toSilo" required>' + opts + '</select></label><label>' + esc(t('kg')) + '<input name="kg" type="text" inputmode="decimal"></label>';
    }
    if (sh.kind === 'empty') h += now + '<p class="warn">' + esc(t('confirm_empty')) + '</p>';
    if (sh.kind === 'held') {
      const silos = S.settings.silos.map(function (s) { return '<option>' + esc(s.id) + '</option>'; }).join('');
      h += '<label>' + esc(t('final_decision')) + '<select name="decision"><option value="ACCEPTED">' + esc(t('accept')) + '</option><option value="REJECTED">' + esc(t('reject')) + '</option><option value="HELD">' + esc(t('keep_held')) + '</option></select></label>' +
        '<label>' + esc(t('silo_dest')) + '<select name="silo">' + silos + '</select></label><label>' + esc(t('override_reason')) + '<input name="reason" required></label>';
    }
    if (sh.kind !== 'held') h += '<label>' + esc(t('operator')) + '<input name="operator" value="' + esc(S.settings.operator || '') + '"></label>';
    h += '<div class="grid2"><button type="button" class="btn" data-action="close-sheet">' + esc(t('cancel')) + '</button><button type="submit" class="btn primary">' + esc(t('confirm')) + '</button></div></form>';
    el.innerHTML = h;
  }
  function submitSheet(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    const sh = S.sheet;
    let p;
    if (sh.kind === 'held') {
      const lot = S.lots.find(function (l) { return l.id === sh.id; });
      if (!v.reason || !v.reason.trim()) { toast(t('need_override_reason')); return; }
      lot.status = v.decision; lot.silo = v.decision === 'ACCEPTED' ? v.silo : '';
      lot.history = (lot.history || []).concat([{ at: new Date().toISOString(), status: v.decision, by: S.settings.operator || '', reason: v.reason }]);
      lot.overrideReason = v.reason;
      const ops = [DB.put('lots', lot)];
      if (v.decision === 'ACCEPTED') ops.push(DB.add('events', { date: L.today(), time: L.nowTime(), silo: v.silo, type: 'IN', lot: lot.id, lots: [lot.id], kg: lot.kg, place: t('tab_intake'), prodLot: '', operator: S.settings.operator || '', notes: v.reason }));
      p = Promise.all(ops);
    } else {
      const ev = { date: v.date, time: v.time, silo: sh.silo, operator: v.operator || '', notes: '' };
      if (sh.kind === 'out' && !(v.place || '').trim()) { toast(t('to_line')); return; }
      if (sh.kind === 'out') Object.assign(ev, { type: 'OUT', kg: L.num(v.kg), place: v.place, prodLot: v.prodLot, lots: L.siloContents(sh.silo, S.events).lots });
      if (sh.kind === 'transfer') Object.assign(ev, { type: 'TRANSFER', toSilo: v.toSilo, kg: L.num(v.kg), lots: L.lotsCarried(sh.silo, S.events) });
      if (sh.kind === 'empty') Object.assign(ev, { type: 'EMPTY', kg: null, lots: [] });
      if (v.operator) S.settings.operator = v.operator;
      p = Promise.all([DB.add('events', ev), saveSettings()]);
    }
    p.then(load).then(function () { S.sheet = null; render(); toast(t('saved')); });
  }

  // ---------------- exportar / export ----------------
  function exportView() {
    const d = L.today();
    const first = d.slice(0, 8) + '01';
    return '<div class="card stack"><div class="grid2"><label>' + esc(t('export_from')) + '<input id="exfrom" type="date" value="' + first + '"></label><label>' + esc(t('export_to')) + '<input id="exto" type="date" value="' + d + '"></label></div>' +
      '<button class="btn primary block" data-action="export-xlsx">' + esc(t('export_xlsx')) + '</button><p class="muted small">' + esc(t('export_note')) + '</p></div>' +
      '<div class="card stack"><h2>' + esc(t('backup')) + '</h2><p>' + esc(t('backup_note')) + '</p><p class="small muted">' + esc(t('last_backup')) + ': ' + esc(S.settings.lastBackup ? S.settings.lastBackup.replace('T', ' ').slice(0, 16) : t('never')) + '</p>' +
      '<button class="btn block" data-action="backup">' + esc(t('backup_save')) + '</button>' +
      '<label class="btn block filebtn">' + esc(t('backup_restore')) + '<input type="file" id="restore" accept="application/json,.json" hidden></label></div>';
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportXlsx() {
    const from = $('#exfrom').value, to = $('#exto').value;
    const inRange = function (d) { return (!from || d >= from) && (!to || d <= to); };
    const pt = I18n.lang === 'pt';
    const H21 = pt ? ['Data', 'Nº do dia', 'Código do lote', 'Guia / documento', 'Fornecedor', 'Origem', 'Cereal', 'Matrícula', 'Peso líquido (kg)', 'Humidade (%)', 'Impurezas (%)', 'Insectos vivos (S/N)', 'Odor (Normal/Anormal)', 'Aflatoxinas totais (µg/kg)', 'DON (µg/kg)', 'Fumonisinas (µg/kg)', 'Silo de destino', 'DECISÃO (auto)', 'Motivo (auto)', 'Decisão final / assinatura', 'Observações']
      : ['Date', 'No. of day', 'Lot code', 'Delivery note', 'Supplier', 'Origin', 'Grain', 'Truck plate', 'Net weight (kg)', 'Moisture (%)', 'Impurities (%)', 'Live insects (Y/N)', 'Odour', 'Total aflatoxins (µg/kg)', 'DON (µg/kg)', 'Fumonisins (µg/kg)', 'Destination silo', 'DECISION (auto)', 'Reason (auto)', 'Final decision / signature', 'Notes'];
    const rows21 = S.lots.filter(function (l) { return inRange(l.date); }).sort(function (a, b) { return a.id < b.id ? -1 : 1; }).map(function (l) {
      return [l.date, parseInt(l.id.slice(-2), 10), l.id, l.guia, l.supplier, l.origin, l.cereal === 'Trigo' ? t('wheat') : t('maize'), l.plate, l.kg, l.hum, l.imp, pt ? l.ins : (l.ins === 'S' ? 'Y' : 'N'), l.odor === 'Anormal' ? t('abnormal') : t('normal'),
        l.afla, l.don, l.fum, l.silo, t(l.auto), (l.reasons || []).map(t).join('; '), t('st_' + l.status) + (l.responsible ? ' — ' + l.responsible : '') + (l.overrideReason ? ' (' + l.overrideReason + ')' : ''), l.notes];
    });
    const H13 = pt ? ['Data', 'Hora', 'Silo / célula', 'Movimento', 'Lote de recepção (REC)', 'Quantidade (kg)', 'Origem / destino (silo, célula, linha)', 'Lote de produção afectado', 'Operador', 'Observações']
      : ['Date', 'Time', 'Silo / bin', 'Movement', 'Intake lot (REC)', 'Quantity (kg)', 'From / to (silo, bin, line)', 'Production lot affected', 'Operator', 'Notes'];
    const rows13 = S.events.filter(function (e) { return inRange(e.date); }).sort(function (a, b) { return (a.date + a.time + String(a.seq).padStart(8, '0')) < (b.date + b.time + String(b.seq).padStart(8, '0')) ? -1 : 1; }).map(function (e) {
      const where = e.type === 'TRANSFER' ? e.silo + ' → ' + e.toSilo : e.type === 'OUT' ? e.place : e.type === 'IN' ? t('tab_intake') : '';
      return [e.date, e.time, e.silo, t('ev_' + e.type), (e.lots || []).join(', '), e.kg, where, e.prodLot || '', e.operator, e.notes];
    });
    const wb = XLSX.utils.book_new();
    const title = (S.settings.millName || '[NOME DA EMPRESA]') + ' — ';
    const ws21 = XLSX.utils.aoa_to_sheet([[title + (pt ? 'RG-21 · Boletim de Recepção de Cereal' : 'RG-21 · Grain Intake Record')], [(pt ? 'Exportado de Moagem — Registos em ' : 'Exported from Mill — Records on ') + L.today() + ' ' + L.nowTime() + ' · ' + from + ' → ' + to], [], H21].concat(rows21));
    const ws13 = XLSX.utils.aoa_to_sheet([[title + (pt ? 'RG-13 · Registo de Lotes: Silos e Células' : 'RG-13 · Lot Log: Silos and Bins')], [], [], H13].concat(rows13));
    ws21['!cols'] = H21.map(function (h) { return { wch: Math.max(10, Math.min(28, h.length + 2)) }; });
    ws13['!cols'] = H13.map(function (h) { return { wch: Math.max(10, Math.min(30, h.length + 2)) }; });
    XLSX.utils.book_append_sheet(wb, ws21, 'RG-21');
    XLSX.utils.book_append_sheet(wb, ws13, 'RG-13');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), L.today() + '_Moagem_RG-21_RG-13_' + from + '_' + to + '.xlsx');
  }
  function backup() {
    DB.exportAll().then(function (data) {
      download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), L.today() + '_Moagem_copia-seguranca.json');
      S.settings.lastBackup = new Date().toISOString();
      return saveSettings();
    }).then(function () { render(); });
  }
  function restore(file) {
    if (!file || !confirm(t('restore_confirm'))) return;
    file.text().then(function (txt) { return DB.importAll(JSON.parse(txt)); })
      .then(load).then(function () { render(); toast(t('restored')); })
      .catch(function () { toast(t('bad_backup')); });
  }

  // ---------------- definições / settings ----------------
  function settingsView() {
    const s = S.settings;
    let h = '<form id="settingsform" class="stack" novalidate>';
    h += '<div class="card stack"><label>' + esc(t('mill_name')) + '<input name="millName" value="' + esc(s.millName) + '"></label><label>' + esc(t('site')) + '<input name="site" value="' + esc(s.site) + '"></label>' +
      '<label>' + esc(t('language')) + '<select name="lang"><option value="pt" ' + (s.lang === 'pt' ? 'selected' : '') + '>Português</option><option value="en" ' + (s.lang === 'en' ? 'selected' : '') + '>English</option></select></label></div>';
    h += '<div class="card stack"><h2>' + esc(t('silos_cfg')) + '</h2>' + s.silos.map(function (x, i) {
      return '<div class="grid3b"><input aria-label="' + esc(t('silo_id')) + '" name="silo_id_' + i + '" value="' + esc(x.id) + '"><input aria-label="' + esc(t('silo_cap')) + '" placeholder="' + esc(t('silo_cap')) + '" name="silo_cap_' + i + '" type="text" inputmode="decimal" value="' + esc(x.cap) + '"><button type="button" class="btn small" data-action="rm-silo" data-i="' + i + '">' + esc(t('remove')) + '</button></div>';
    }).join('') + '<button type="button" class="btn small" data-action="add-silo">+ ' + esc(t('add_silo')) + '</button></div>';
    h += '<div class="card stack"><h2>' + esc(t('suppliers_cfg')) + '</h2>' + s.suppliers.map(function (x, i) {
      return '<div class="grid2b"><input name="sup_' + i + '" value="' + esc(x) + '"><button type="button" class="btn small" data-action="rm-sup" data-i="' + i + '">' + esc(t('remove')) + '</button></div>';
    }).join('') + '<button type="button" class="btn small" data-action="add-sup">+ ' + esc(t('add_supplier')) + '</button></div>';
    h += '<div class="card stack"><h2>' + esc(t('limits_cfg')) + '</h2><p class="small muted">' + esc(t('limits_note')) + '</p>';
    ['Trigo', 'Milho'].forEach(function (c) {
      const lim = s.limits[c];
      h += '<h3>' + esc(c === 'Trigo' ? t('wheat') : t('maize')) + '</h3><div class="grid2">';
      [['hum', 'moisture'], ['imp', 'impurities'], ['afla', 'afla'], ['don', 'don'], ['fum', 'fum']].forEach(function (k) {
        h += '<label>' + esc(t(k[1])) + '<input name="lim_' + c + '_' + k[0] + '" type="text" inputmode="decimal" value="' + esc(lim[k[0]]) + '">' +
          (['afla', 'don', 'fum'].indexOf(k[0]) >= 0 ? '<span class="check"><input type="checkbox" name="req_' + c + '_' + k[0] + '" ' + (lim[k[0] + 'Required'] ? 'checked' : '') + '> ' + esc(t('required_test')) + '</span>' : '') + '</label>';
      });
      h += '</div>';
    });
    h += '</div><button class="btn primary block" type="submit">' + esc(t('save')) + '</button>';
    h += '<p class="small muted" id="storage"></p><p class="small muted">' + esc(t('install_hint')) + '</p></form>';
    setTimeout(function () {
      const el = $('#storage');
      if (el && navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(function (p) { el.textContent = p ? t('storage_ok') : t('storage_maybe'); });
    }, 0);
    return h;
  }
  function readSettingsForm(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    const s = S.settings;
    s.millName = v.millName || ''; s.site = v.site || ''; s.lang = v.lang || 'pt';
    s.silos = s.silos.map(function (x, i) { return { id: (v['silo_id_' + i] || '').trim(), cap: v['silo_cap_' + i] || '' }; }).filter(function (x) { return x.id; });
    s.suppliers = s.suppliers.map(function (x, i) { return (v['sup_' + i] || '').trim(); }).filter(Boolean);
    ['Trigo', 'Milho'].forEach(function (c) {
      ['hum', 'imp', 'afla', 'don', 'fum'].forEach(function (k) { s.limits[c][k] = v['lim_' + c + '_' + k] || ''; });
      ['afla', 'don', 'fum'].forEach(function (k) { s.limits[c][k + 'Required'] = !!v['req_' + c + '_' + k]; });
    });
  }

  // ---------------- eventos / events ----------------
  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const a = b.dataset.action;
    if (a === 'tab') { S.tab = b.dataset.tab; S.sheet = null; render(); }
    if (a === 'new-lot') { S.form = newForm(); render(); }
    if (a === 'cancel-lot') { S.form = null; render(); }
    if (a === 'seg') { S.form[b.dataset.name] = b.dataset.value; b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); updateDecision(); }
    if (a === 'decide-held') { S.sheet = { kind: 'held', id: b.dataset.id }; renderSheet(); }
    if (a === 'silo-out') { S.sheet = { kind: 'out', silo: b.dataset.silo }; renderSheet(); }
    if (a === 'silo-transfer') { S.sheet = { kind: 'transfer', silo: b.dataset.silo }; renderSheet(); }
    if (a === 'silo-empty') { S.sheet = { kind: 'empty', silo: b.dataset.silo }; renderSheet(); }
    if (a === 'close-sheet') { S.sheet = null; renderSheet(); }
    if (a === 'export-xlsx') exportXlsx();
    if (a === 'backup') backup();
    if (a === 'add-silo') { readSettingsForm($('#settingsform')); S.settings.silos.push({ id: 'S' + (S.settings.silos.length + 1), cap: '' }); render(); }
    if (a === 'rm-silo') { readSettingsForm($('#settingsform')); S.settings.silos.splice(+b.dataset.i, 1); render(); }
    if (a === 'add-sup') { readSettingsForm($('#settingsform')); S.settings.suppliers.push(' '); render(); }
    if (a === 'rm-sup') { readSettingsForm($('#settingsform')); S.settings.suppliers.splice(+b.dataset.i, 1); render(); }
  });
  document.addEventListener('input', function (e) {
    if (S.form && e.target.form && e.target.form.id === 'lotform') {
      S.form[e.target.name] = e.target.value;
      if (e.target.name === 'final') S.form._finalTouched = true;
      if (e.target.name !== 'final') updateDecision();
    }
  });
  document.addEventListener('change', function (e) {
    if (S.form && e.target.form && e.target.form.id === 'lotform') {
      S.form[e.target.name] = e.target.value;
      if (e.target.name === 'final') S.form._finalTouched = true;
    }
    if (e.target.id === 'restore') restore(e.target.files[0]);
    if (e.target.name === 'lang' && e.target.form && e.target.form.id === 'settingsform') {
      readSettingsForm(e.target.form); I18n.set(S.settings.lang);
      saveSettings().then(function () { render(); toast(t('settings_saved')); });
    }
  });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'lotform') saveLot();
    if (e.target.id === 'sheetform') submitSheet(e.target);
    if (e.target.id === 'settingsform') {
      readSettingsForm(e.target); I18n.set(S.settings.lang);
      saveSettings().then(function () { render(); toast(t('settings_saved')); });
    }
  });

  // ---------------- arranque / start ----------------
  load().then(function () { render(); DB.persist(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
})();
