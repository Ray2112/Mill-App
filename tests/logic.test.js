/* Testes das regras: node tests/logic.test.js */
const L = require('../js/logic.js');
const assert = require('assert');
let n = 0; function ok(name, fn) { fn(); n++; }
const SOP = { hum: ['13.0', '14.0', '15.0'], brk: ['3.0', '6.0', '10.0'], fm: ['1.0', '2.0', '3.0'], dis: ['0.5', '1.0', '2.0'], sw: ['72', '68', '64'], humLow: '12.5' };
const base = { hum: '12.8', brk: '2', fm: '0,5', dis: '0.3', sw: '74', odor: 'Normal', ins: 'N' };
const g = (o, m) => L.gradeLot(Object.assign({}, base, o), SOP, m || {});

ok('num kg thousands', () => {
  assert.strictEqual(L.num('30.000', 'kg'), 30000);
  assert.strictEqual(L.num('30 000', 'kg'), 30000);
  assert.strictEqual(L.num('1.250,5', 'kg'), 1250.5);
  assert.strictEqual(L.num('1,250.5', 'kg'), 1250.5);
  assert.strictEqual(L.num('30.5', 'kg'), 30.5);
  assert.strictEqual(L.num('13,5'), 13.5);
  assert.strictEqual(L.num('13.000'), 13);
  assert.strictEqual(L.num(''), null);
  assert.ok(isNaN(L.num('1O')));
  assert.ok(isNaN(L.num('1.2.3', 'kg')));
});
ok('grade 1', () => assert.strictEqual(g({}).code, 'G1'));
ok('boundary 13.0 is G1, 13.05 is G2', () => { assert.strictEqual(g({ hum: '13,0' }).code, 'G1'); assert.strictEqual(g({ hum: '13.05' }).code, 'G2'); });
ok('worst parameter wins', () => assert.strictEqual(g({ brk: '7' }).code, 'OFF'));
ok('reject above off-grade', () => { assert.strictEqual(g({ fm: '3.1' }).code, 'REJ'); assert.strictEqual(g({ hum: '15.01' }).code, 'REJ'); });
ok('SW between grades -> lower', () => { assert.strictEqual(g({ sw: '71.5' }).code, 'G2'); assert.strictEqual(g({ sw: '63.9' }).code, 'REJ'); });
ok('odour -> HOLD with matrix kept', () => { const r = g({ odor: 'Anormal', brk: '4' }); assert.strictEqual(r.code, 'HOLD'); assert.strictEqual(r.matrix, 'G2'); });
ok('reject beats hold', () => assert.strictEqual(g({ ins: 'S', dis: '5' }).code, 'REJ'));
ok('missing -> INCOMPLETE', () => assert.strictEqual(g({ sw: '' }).code, 'INCOMPLETE'));
ok('typo -> INVALID', () => assert.strictEqual(g({ dis: '0.O' }).code, 'INVALID'));
ok('low moisture note', () => assert.deepStrictEqual(g({ hum: '12' }).notes, ['low_moisture']));
ok('myco above limit -> REJ', () => assert.strictEqual(g({ afla: '12' }, { afla: '10' }).code, 'REJ'));
ok('myco required missing -> HOLD', () => assert.strictEqual(g({}, { afla: '10', aflaRequired: true }).code, 'HOLD'));
ok('no limits -> NONE', () => assert.strictEqual(L.gradeLot(base, {}, {}).code, 'NONE'));
ok('release options never upgrade', () => assert.deepStrictEqual(L.releaseOptions('G2'), ['G2', 'OFF', 'REJ']));
ok('allocate in order', () => {
  const a = L.allocate(30000, [{ id: 'S1', avail: 12000 }, { id: 'S2', avail: 50000 }]);
  assert.deepStrictEqual(a, { parts: [{ silo: 'S1', kg: 12000 }, { silo: 'S2', kg: 18000 }], short: 0 });
  assert.strictEqual(L.allocate(30000, [{ id: 'S1', avail: 10000 }]).short, 20000);
});
ok('silo contents and free space', () => {
  const ev = [{ seq: 1, date: '2026-10-05', time: '08:00', silo: 'S1', type: 'IN', lots: ['A'], kg: 20000 },
    { seq: 2, date: '2026-10-05', time: '09:00', silo: 'S1', type: 'OUT', lots: ['A'], kg: 5000 },
    { seq: 3, date: '2026-10-05', time: '10:00', silo: 'S1', type: 'TRANSFER', toSilo: 'S2', lots: ['A'], kg: 1000 }];
  assert.strictEqual(L.siloContents('S1', ev).kg, 14000);
  assert.strictEqual(L.siloContents('S2', ev).kg, 1000);
  assert.strictEqual(L.freeSpace({ id: 'S1', cap: '50.000' }, ev), 36000);
  assert.strictEqual(L.freeSpace({ id: 'S1', cap: '' }, ev), null);
});
ok('silo fit', () => {
  const lot = { cereal: 'Milho', colour: 'Amarelo', grade: 'G1' };
  assert.deepStrictEqual(L.siloFit(lot, { cereal: 'Milho', colour: 'Amarelo', grade: 'G1' }), { ok: true, mismatch: false });
  assert.deepStrictEqual(L.siloFit(lot, { cereal: 'Milho', colour: 'Amarelo', grade: 'G2' }), { ok: true, mismatch: true });
  assert.strictEqual(L.siloFit(lot, { cereal: 'Milho', colour: 'Branco', grade: 'G1' }).why, 'other_colour');
  assert.strictEqual(L.siloFit(lot, { cereal: 'Trigo', grade: 'G1' }).why, 'other_cereal');
  assert.strictEqual(L.siloFit(lot, { cereal: '', grade: '' }).why, 'not_designated');
});
ok('inspection flags and overdue', () => {
  assert.deepStrictEqual(L.inspectionFlags({ temp: '31', hum: '13', odor: 'Normal', ins: 'S' }, { tempMax: '30', humMax: '' }), ['temp_high', 'insects']);
  assert.strictEqual(L.inspectionOverdue('2026-10-01', '2026-10-05', '3'), true);
  assert.strictEqual(L.inspectionOverdue('2026-10-03', '2026-10-05', '3'), false);
  assert.strictEqual(L.inspectionOverdue(null, '2026-10-05', ''), false);
});
ok('backup validation', () => {
  const good = { app: 'moagem-app', format: 2, lots: [{ id: 'REC-261005-01', status: 'ACCEPTED', grade: 'G1' }], events: [{ type: 'IN', silo: 'S1' }], settings: [{ key: 'main' }], inspections: [] };
  assert.ok(L.validBackup(good));
  assert.ok(!L.validBackup(Object.assign({}, good, { lots: [{ id: 'X', status: 'x"><img src=x onerror=alert(1)>' }] })));
  assert.ok(!L.validBackup(Object.assign({}, good, { lots: [{ id: '<b>', status: 'HELD' }] })));
});
console.log('OK — ' + n + ' tests');
