/* Regras de negócio puras (sem interface) — testáveis em Node.
   Business rules with no UI — testable in Node. */
(function (root) {
  'use strict';

  // ---------- datas / dates ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function today(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowTime(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // ---------- código do lote / lot code: REC-AAMMDD-NN (PR-12 §6.1) ----------
  function lotCode(dateStr, existingLots) {
    const ymd = dateStr.replace(/-/g, '').slice(2); // AAMMDD
    const prefix = 'REC-' + ymd + '-';
    let max = 0;
    (existingLots || []).forEach(function (l) {
      if (l.id && l.id.indexOf(prefix) === 0) {
        const n = parseInt(l.id.slice(prefix.length), 10);
        if (n > max) max = n;
      }
    });
    return prefix + pad(max + 1);
  }

  // ---------- decisão de aceitação / acceptance decision (RG-21) ----------
  // limits: { hum, imp, afla, don, fum } — número máximo ou null (não avaliado)
  // Devolve { level: 0|1|2, code: 'ACCEPT'|'HOLD'|'REJECT', reasons: [keys], notAssessed: [keys] }
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  function decide(lot, limits) {
    limits = limits || {};
    const reasons = [], notAssessed = [];
    let level = 0;
    const tox = [['afla', 'reason_afla'], ['don', 'reason_don'], ['fum', 'reason_fum']];
    tox.forEach(function (t) {
      const v = num(lot[t[0]]), lim = num(limits[t[0]]);
      if (v !== null && lim === null) notAssessed.push(t[0]);
      if (v !== null && lim !== null && v > lim) { reasons.push(t[1]); level = 2; }
    });
    if (lot.ins === 'S') { reasons.push('reason_insects'); level = Math.max(level, 1); }
    if (lot.odor === 'Anormal') { reasons.push('reason_odour'); level = Math.max(level, 1); }
    [['hum', 'reason_moisture'], ['imp', 'reason_impurities']].forEach(function (t) {
      const v = num(lot[t[0]]), lim = num(limits[t[0]]);
      if (v !== null && lim === null) notAssessed.push(t[0]);
      if (v !== null && lim !== null && v > lim) { reasons.push(t[1]); level = Math.max(level, 1); }
    });
    // Um limite de micotoxina definido mas sem resultado → reter (falta análise)
    tox.forEach(function (t) {
      if (num(limits[t[0]]) !== null && num(lot[t[0]]) === null && limits[t[0] + 'Required']) {
        reasons.push('reason_missing_' + t[0]); level = Math.max(level, 1);
      }
    });
    return { level: level, code: ['ACCEPT', 'HOLD', 'REJECT'][level], reasons: reasons, notAssessed: notAssessed };
  }

  // ---------- conteúdo dos silos / silo contents (RG-13, regra conservadora PR-12 §6.2) ----------
  // events: [{silo, type:'IN'|'OUT'|'TRANSFER'|'EMPTY', lot, kg, toSilo, date, time}]
  // Lotes presentes = todas as entradas desde o último "vazio". Quantidade estimada = entradas − saídas.
  function stamp(e) { return (e.date || '') + 'T' + (e.time || '00:00') + '#' + String(e.seq || 0).padStart(8, '0'); }
  function siloContents(siloId, events) {
    const evs = (events || []).filter(function (e) { return e.silo === siloId || (e.type === 'TRANSFER' && e.toSilo === siloId); })
      .slice().sort(function (a, b) { return stamp(a) < stamp(b) ? -1 : stamp(a) > stamp(b) ? 1 : 0; });
    let lots = {}, kg = 0, lastEmpty = null;
    evs.forEach(function (e) {
      const inbound = e.type === 'IN' || (e.type === 'TRANSFER' && e.toSilo === siloId && e.silo !== siloId);
      const outbound = e.type === 'OUT' || (e.type === 'TRANSFER' && e.silo === siloId && e.toSilo !== siloId);
      if (e.type === 'EMPTY' && e.silo === siloId) { lots = {}; kg = 0; lastEmpty = e; return; }
      if (inbound) {
        (e.lots || (e.lot ? [e.lot] : [])).forEach(function (l) { lots[l] = true; });
        kg += num(e.kg) || 0;
      } else if (outbound) {
        kg -= num(e.kg) || 0;
      }
    });
    return { lots: Object.keys(lots), kg: Math.max(0, kg), lastEmpty: lastEmpty };
  }

  // Lotes que uma transferência leva consigo: todos os presentes no silo de origem (regra conservadora)
  function lotsCarried(fromSilo, events) { return siloContents(fromSilo, events).lots; }

  const api = { today: today, nowTime: nowTime, lotCode: lotCode, decide: decide, siloContents: siloContents, lotsCarried: lotsCarried, num: num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Logic = api;
})(this);
