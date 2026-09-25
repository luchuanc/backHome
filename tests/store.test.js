const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const cache = new Map();
  const storage = { getItem: k => cache.get(k) || null, setItem: (k, v) => cache.set(k, v) };
  const ctx = { window: {}, localStorage: storage, console }; vm.createContext(ctx);
  for (const f of ['data.js', 'store.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), ctx);
  return { ...ctx.window.Scrap, cache, storage };
}

test('营地购买扣除准确资源，不能透支或超过等级上限', () => {
  const { Store } = fixture(), p = Store.fresh();
  assert.equal(Store.buy(p, 'workshop'), true); assert.equal(p.resources.scrap, 6); assert.equal(p.resources.circuit, 1); assert.equal(p.facilities.workshop, 1);
  assert.equal(Store.buy(p, 'workshop'), false); assert.equal(p.resources.scrap, 6);
  p.resources = { scrap: 1000, circuit: 1000, core: 1000 };
  Store.buy(p, 'workshop'); Store.buy(p, 'workshop'); const before = JSON.stringify(p.resources);
  assert.equal(Store.buy(p, 'workshop'), false); assert.equal(JSON.stringify(p.resources), before);
  assert.equal(Store.buy(p, 'unknown'), false);
});

test('结算一次入库，移除中断战局，日志与统计持久化', () => {
  const { Store } = fixture(), p = Store.fresh();
  p.suspendedRun = { player: {} };
  Store.settle(p, { success: true, elapsed: 170, kills: 23, kept: { scrap: 18, circuit: 3, core: 1 }, bossDefeated: false });
  assert.equal(p.suspendedRun, null); assert.equal(p.resources.scrap, 48); assert.equal(p.resources.core, 1);
  assert.equal(p.stats.runs, 1); assert.equal(p.stats.escapes, 1); assert.equal(p.history.length, 1);
  const loaded = Store.load(); assert.equal(loaded.stats.kills, 23); assert.equal(loaded.resources.core, 1);
});

test('损坏存档与未知版本被拒绝，并保留原始数据供备份排查', () => {
  const { Store, cache } = fixture();
  const invalid = Store.fresh(); invalid.resources.scrap = -1;
  assert.throws(() => Store.parse(JSON.stringify(invalid)));
  invalid.resources.scrap = 10; invalid.version = 2;
  assert.throws(() => Store.parse(JSON.stringify(invalid)));
  const raw = '{bad'; cache.set('last-reclamation-station-v1', raw);
  assert.equal(Store.load().version, 1); assert.match(Store.error, /无法读取/);
  assert.equal(cache.get('last-reclamation-station-v1'), raw);
});

test('存储不可用时返回失败，游戏仍然可以使用内存进度', () => {
  const { Store, storage } = fixture(), p = Store.fresh();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(Store.save(p), false); assert.match(Store.error, /导出存档/); assert.equal(p.resources.scrap, 30);
});

test('导入拒绝锁定武器、非法音量和不可信的远征日志', () => {
  const { Store } = fixture(), p = Store.fresh();
  p.selectedWeapon = 'saw'; assert.throws(() => Store.validate(p));
  p.selectedWeapon = 'rivet'; p.settings.music = 2; assert.throws(() => Store.validate(p));
  p.settings.music = 0.3; p.history = [{ success: true, date: '2026-09-22', elapsed: 4, kills: 2, kept: { scrap: '<script>', circuit: 0, core: 0 } }];
  assert.throws(() => Store.validate(p));
});

test('建设目标使用真实成本与带回预测，不扣资源或改变设施', () => {
  const { Store } = fixture(), p = Store.fresh();
  let goal = Store.nextGoal(p);
  assert.equal(goal.id, 'workshop');
  assert.equal(goal.affordable, true);
  assert.equal(goal.unlockWeapon.id, 'scatter');
  assert.equal(goal.targetLevel, 1);
  Store.buy(p, 'workshop');
  const before = JSON.stringify(p);
  goal = Store.nextGoal(p);
  assert.equal(goal.id, 'storage');
  assert.deepEqual({ ...goal.missing }, { scrap: 12, circuit: 1, core: 0 });
  assert.equal(goal.affordable, false);
  goal = Store.nextGoal(p, { scrap: 12, circuit: 1, core: 0 });
  assert.equal(goal.id, 'storage');
  assert.equal(goal.affordable, true);
  assert.equal(goal.unlockWeapon, null);
  assert.equal(JSON.stringify(p), before, '预测不能提前结算远征物资');
  goal.cost.scrap = 0;
  assert.equal(Store.nextGoal(p).cost.scrap, 18, '返回目标不能修改设施定价');
});

test('满级设施不会再被推荐，全部完成后没有虚构目标', () => {
  const { Store } = fixture(), p = Store.fresh();
  p.facilities = { workshop: 3, storage: 3, infirmary: 3, beacon: 2 };
  p.resources = { scrap: 65, circuit: 9, core: 0 };
  const goal = Store.nextGoal(p);
  assert.equal(goal.id, 'beacon');
  assert.equal(goal.targetLevel, 3);
  assert.deepEqual({ ...goal.missing }, { scrap: 0, circuit: 0, core: 1 });
  assert.equal(Store.nextGoal(p, { scrap: 0, circuit: 0, core: 1 }).affordable, true);
  p.facilities.beacon = 3;
  assert.equal(Store.nextGoal(p), null);
});

test('新日志保留独立构筑摘要，旧日志继续兼容', () => {
  const { Store } = fixture(), p = Store.fresh();
  const result = { success: true, elapsed: 170, kills: 23, kept: { scrap: 18, circuit: 3, core: 1 }, bossDefeated: false, weapon: 'rivet', build: [{ id: 'damage', level: 2 }, { id: 'metalstorm', level: 1 }], medkitsLeft: 1 };
  Store.settle(p, result);
  result.build[0].level = 5;
  result.kept.scrap = 99;
  const loaded = Store.load();
  assert.equal(loaded.history[0].weapon, 'rivet');
  assert.equal(loaded.history[0].build[0].level, 2);
  assert.equal(loaded.history[0].kept.scrap, 18);
  assert.equal(loaded.history[0].medkitsLeft, 1);
  delete loaded.history[0].weapon;
  delete loaded.history[0].build;
  delete loaded.history[0].medkitsLeft;
  assert.equal(Store.parse(JSON.stringify(loaded)).history.length, 1);
});

test('构筑日志拒绝部分摘要、未知科技、重复科技和非法等级', () => {
  const { Store } = fixture(), p = Store.fresh();
  const record = { success: true, elapsed: 170, kills: 23, date: '2026-09-23', kept: { scrap: 18, circuit: 3, core: 1 }, weapon: 'rivet', build: [{ id: 'damage', level: 2 }], medkitsLeft: 1 };
  for (const mutate of [
    h => { delete h.build; },
    h => { h.weapon = 'unknown'; },
    h => { h.build[0].id = 'unknown'; },
    h => { h.build.push({ ...h.build[0] }); },
    h => { h.build[0].level = 0; },
    h => { h.build[0].level = 6; },
    h => { h.medkitsLeft = -1; }
  ]) {
    const h = JSON.parse(JSON.stringify(record)); mutate(h); p.history = [h];
    assert.throws(() => Store.validate(p));
  }
});
