/* Regras de negócio puras (sem interface) — testáveis em Node.
   Business rules with no UI — testable in Node.
   v0.2.0: classificação por graus (SOP-OPS-001 §7), capacidade dos silos, descarga em sequência, inspecções. */
(function (root) {
  'use strict';

  // ---------- datas / dates ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function today(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowTime(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function r3(n) { return Math.round(n * 1000) / 1000; }

  // ---------- números / numbers ----------
  // Devolve null (vazio), NaN (inválido) ou o número.
  // Aceita vírgula ou ponto decimal e separadores de milhares (espaço, ponto, vírgula).
  // mode 'kg': "30.000" = 30 000 (uso angolano: ponto = milhares). Nos restantes campos "13.000" = 13.
  function num(v, mode) {
    if (v === '' || v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    let s = String(v).trim().replace(/[\s  ']/g, '');
    if (s === '') return null;
    if (!/^-?[0-9.,]+$/.test(s)) return NaN;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    function groups(parts) { return parts.slice(1).every(function (p) { return p.length === 3; }) && parts[0].replace('-', '').length >= 1 && parts[0].replace('-', '').length <= 3; }
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',', th = dec === '.' ? ',' : '.';
      const ip = s.slice(0, s.lastIndexOf(dec)), fp = s.slice(s.lastIndexOf(dec) + 1);
      if (fp.indexOf(th) >= 0 || !groups(ip.split(th))) return NaN;
      s = ip.split(th).join('') + '.' + fp;
    } else if (lastComma >= 0) {
      const parts = s.split(',');
      if (parts.length > 2) { if (!groups(parts)) return NaN; s = parts.join(''); } else s = s.replace(',', '.');
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2) { if (!groups(parts)) return NaN; s = parts.join(''); }
      else if (mode === 'kg' && parts[1].length === 3 && groups(parts)) s = parts.join('');
    }
    if (s === '' || s === '-' || s === '.') return NaN;
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function bad(v, mode) { const n = num(v, mode); return n !== null && isNaN(n); }

  // ---------- código do lote / lot code: REC-AAMMDD-NN ----------
  function lotCode(dateStr, existingLots) {
    const prefix = 'REC-' + dateStr.replace(/-/g, '').slice(2) + '-';
    let max = 0;
    (existingLots || []).forEach(function (l) {
      const id = typeof l === 'string' ? l : l && l.id;
      if (id && id.indexOf(prefix) === 0) { const n = parseInt(id.slice(prefix.length), 10); if (n > max) max = n; }
    });
    return prefix + pad(max + 1);
  }

  // ---------- classificação / grading (SOP-OPS-001 §7) ----------
  // grading: { hum:[g1,g2,off], brk:[...], fm:[...], dis:[...], sw:[g1,g2,off], humLow }
  //   hum/brk/fm/dis: máximos (≤). sw (peso específico): mínimos (≥).
  //   Valor acima do limite de "Fora de grau" = Rejeitar. Valor entre graus = grau inferior (upper bounds only).
  // myco: { afla, don, fum, aflaRequired, ... } — acima do limite = Rejeitar.
  const GRADES = ['G1', 'G2', 'OFF', 'REJ'];
  const PARAMS = [['hum', 'max'], ['brk', 'max'], ['fm', 'max'], ['dis', 'max'], ['sw', 'min']];
  const MYCO = ['afla', 'don', 'fum'];
  function thresholds(arr) {
    if (!arr || arr.length !== 3) return null;
    const n = arr.map(function (x) { return num(x); });
    return n.every(function (x) { return x !== null && !isNaN(x); }) ? n : null;
  }
  function paramLevel(v, th, dir) {
    if (dir === 'max') return v <= th[0] ? 0 : v <= th[1] ? 1 : v <= th[2] ? 2 : 3;
    return v >= th[0] ? 0 : v >= th[1] ? 1 : v >= th[2] ? 2 : 3;
  }
  function gradeLot(lot, grading, myco) {
    grading = grading || {}; myco = myco || {};
    const res = { code: null, matrix: null, level: 0, reasons: [], missing: [], invalid: [], hold: [], notes: [], notAssessed: [] };
    let configured = 0, level = 0;
    PARAMS.forEach(function (p) {
      const k = p[0], th = thresholds(grading[k]), v = num(lot[k]);
      if (v !== null && isNaN(v)) { res.invalid.push(k); return; }
      if (!th) { if (v !== null) res.notAssessed.push(k); return; }
      configured++;
      if (v === null) { res.missing.push(k); return; }
      const lv = paramLevel(v, th, p[1]);
      if (lv > 0) res.reasons.push({ k: k, level: lv, v: v });
      if (lv > level) level = lv;
    });
    if (bad(lot.fat)) res.invalid.push('fat');
    MYCO.forEach(function (k) {
      const v = num(lot[k]), lim = num(myco[k]);
      if (v !== null && isNaN(v)) { res.invalid.push(k); return; }
      if (v !== null && (lim === null || isNaN(lim))) { res.notAssessed.push(k); return; }
      if (v !== null && v > lim) { res.reasons.push({ k: k, level: 3, v: v }); level = 3; }
      if (v === null && lim !== null && !isNaN(lim) && myco[k + 'Required']) res.hold.push('missing_' + k);
    });
    const hl = num(grading.humLow), hv = num(lot.hum);
    if (hl !== null && !isNaN(hl) && hv !== null && !isNaN(hv) && hv < hl) res.notes.push('low_moisture');
    if (lot.ins === 'S') res.hold.push('insects');
    if (lot.odor === 'Anormal') res.hold.push('odour');
    res.level = level;
    if (res.invalid.length) res.code = 'INVALID';
    else if (res.missing.length) res.code = 'INCOMPLETE';
    else {
      res.matrix = configured ? GRADES[level] : (level === 3 ? 'REJ' : null);
      if (res.matrix === 'REJ') res.code = 'REJ';
      else if (res.hold.length) res.code = 'HOLD';
      else if (!res.matrix) res.code = 'NONE';
      else res.code = res.matrix;
    }
    return res;
  }
  // Graus que o CQ pode atribuir ao libertar um lote retido: o grau da matriz ou inferior (nunca superior).
  function releaseOptions(matrix) {
    if (!matrix) return GRADES.slice();
    return GRADES.slice(GRADES.indexOf(matrix));
  }

  // ---------- silos ----------
  // events: [{silo, type:'IN'|'OUT'|'TRANSFER'|'EMPTY', lots, kg, toSilo, date, time, seq}]
  // Lotes presentes = todas as entradas desde o último "vazio" (regra conservadora PR-12).
  // Quantidade = entradas − saídas (registos). EMPTY põe a zero (diferença fica registada no evento).
  function stamp(e) { return (e.date || '') + 'T' + (e.time || '00:00') + '#' + String(e.seq || 0).padStart(8, '0'); }
  function sortEvents(evs) { return evs.slice().sort(function (a, b) { return stamp(a) < stamp(b) ? -1 : stamp(a) > stamp(b) ? 1 : 0; }); }
  function siloContents(siloId, events) {
    const evs = sortEvents((events || []).filter(function (e) { return e.silo === siloId || (e.type === 'TRANSFER' && e.toSilo === siloId); }));
    let lots = {}, kg = 0, lastEmpty = null;
    evs.forEach(function (e) {
      if (e.type === 'EMPTY' && e.silo === siloId) { lots = {}; kg = 0; lastEmpty = e; return; }
      const inbound = e.type === 'IN' || (e.type === 'TRANSFER' && e.toSilo === siloId && e.silo !== siloId);
      const outbound = e.type === 'OUT' || (e.type === 'TRANSFER' && e.silo === siloId && e.toSilo !== siloId);
      if (inbound) { (e.lots || (e.lot ? [e.lot] : [])).forEach(function (l) { lots[l] = true; }); kg += num(e.kg) || 0; }
      else if (outbound) kg -= num(e.kg) || 0;
    });
    return { lots: Object.keys(lots), kg: r3(kg), lastEmpty: lastEmpty };
  }
  function lotsCarried(fromSilo, events) { return siloContents(fromSilo, events).lots; }
  // Espaço livre; null se a capacidade não estiver definida.
  function freeSpace(silo, events) {
    const cap = num(silo.cap, 'kg');
    if (cap === null || isNaN(cap) || cap <= 0) return null;
    return r3(Math.max(0, cap - siloContents(silo.id, events).kg));
  }
  // Repartir kg pelos silos, pela ordem dada: enche/esvazia o primeiro, depois o seguinte.
  // slots: [{id, avail}] → { parts:[{silo, kg}], short }
  function allocate(kg, slots) {
    let rest = kg; const parts = [];
    (slots || []).forEach(function (s) {
      if (rest <= 0) return;
      const take = r3(Math.min(rest, Math.max(0, s.avail || 0)));
      if (take > 0) { parts.push({ silo: s.id, kg: take }); rest = r3(rest - take); }
    });
    return { parts: parts, short: r3(Math.max(0, rest)) };
  }
  // Compatibilidade de um lote (cereal, cor, grau) com a designação de um silo.
  // ok=false: proibido (outro cereal, Amarelo/Branco, silo não designado). mismatch=true: grau diferente → autorização.
  function siloFit(item, silo) {
    if (!silo || !silo.cereal || !silo.grade) return { ok: false, why: 'not_designated' };
    if (silo.cereal !== item.cereal) return { ok: false, why: 'other_cereal' };
    if (silo.cereal === 'Milho') {
      if (!silo.colour) return { ok: false, why: 'not_designated' };
      if (silo.colour !== item.colour) return { ok: false, why: 'other_colour' };
    }
    return { ok: true, mismatch: silo.grade !== item.grade };
  }

  // ---------- inspecções / inspections ----------
  // lim: { tempMax, humMax, days }
  function inspectionFlags(ins, lim) {
    lim = lim || {};
    const f = [];
    const tv = num(ins.temp), tm = num(lim.tempMax), hv = num(ins.hum), hm = num(lim.humMax);
    if (tv !== null && tm !== null && !isNaN(tv) && !isNaN(tm) && tv > tm) f.push('temp_high');
    if (hv !== null && hm !== null && !isNaN(hv) && !isNaN(hm) && hv > hm) f.push('hum_high');
    if (ins.odor === 'Anormal') f.push('odour');
    if (ins.ins === 'S') f.push('insects');
    return f;
  }
  function inspectionOverdue(lastDate, todayStr, days) {
    const d = num(days);
    if (d === null || isNaN(d) || d <= 0) return false;
    if (!lastDate) return true;
    return daysBetween(lastDate, todayStr) > d;
  }

  // ---------- cópia de segurança / backup validation ----------
  const STATUS = ['ACCEPTED', 'HELD', 'REJECTED'];
  const EVT = ['IN', 'OUT', 'TRANSFER', 'EMPTY'];
  function validBackup(d) {
    if (!d || d.app !== 'moagem-app' || (d.format !== 1 && d.format !== 2)) return false;
    if (!Array.isArray(d.lots) || !Array.isArray(d.events) || !Array.isArray(d.settings)) return false;
    if (d.inspections !== undefined && !Array.isArray(d.inspections)) return false;
    const okLots = d.lots.every(function (l) { return l && typeof l.id === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(l.id) && STATUS.indexOf(l.status) >= 0 && (l.grade == null || GRADES.indexOf(l.grade) >= 0); });
    const okEv = d.events.every(function (e) { return e && EVT.indexOf(e.type) >= 0 && typeof e.silo === 'string'; });
    const okSet = d.settings.every(function (s) { return s && typeof s.key === 'string'; });
    return okLots && okEv && okSet;
  }

  const api = { today: today, nowTime: nowTime, daysBetween: daysBetween, num: num, bad: bad, lotCode: lotCode,
    GRADES: GRADES, PARAMS: PARAMS, MYCO: MYCO, thresholds: thresholds, gradeLot: gradeLot, releaseOptions: releaseOptions,
    siloContents: siloContents, lotsCarried: lotsCarried, freeSpace: freeSpace, allocate: allocate, siloFit: siloFit, sortEvents: sortEvents,
    inspectionFlags: inspectionFlags, inspectionOverdue: inspectionOverdue, validBackup: validBackup, STATUS: STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Logic = api;
})(this);
