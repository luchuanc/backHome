const assert = require('node:assert/strict');
const test = require('node:test');

global.window = global;
require('../src/data.js');
const Game = require('../src/game.js');

function fresh(seed = 91, facilities = {}) {
  return new Game({ seed, facilities });
}

function tick(game, seconds, input = {}) {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.update(0.05, { autoFire: false, ...input });
}

function atRelay(game) {
  const relay = game.relays[0];
  Object.assign(game.player, { x: relay.x, y: relay.y });
  return relay;
}

function chooseAll(game) {
  while (game.state === 'upgrade') game.chooseUpgrade(game.upgradeChoices[0]);
}

test('开局成群抵达，前十五秒至少十四个目标，常规敌人总量有上限且不在墙内', () => {
  for (const seed of [3, 17, 91, 1234]) {
    const game = fresh(seed);
    // 隔离生成节奏，不用击杀速度掩盖敌人总量与生成位置。
    for (let i = 0; i < 300; i++) {
      game.elapsed += 0.05;
      game._updateSpawns(0.05);
    }
    assert.ok(game.enemies.length >= 14);
    for (let i = 0; i < 1000; i++) game._updateSpawns(0.05);
    assert.ok(game.enemies.length <= 24);
    for (const enemy of game.enemies) for (const wall of game.obstacles) {
      const x = Math.max(wall.x, Math.min(enemy.x, wall.x + wall.w));
      const y = Math.max(wall.y, Math.min(enemy.y, wall.y + wall.h));
      assert.ok(Math.hypot(enemy.x - x, enemy.y - y) >= enemy.r);
    }
  }
});

test('长按启动守点，离圈保留进度且不补刷，升级期间冻结，恢复不会重开第一波', () => {
  const game = fresh();
  const relay = atRelay(game);
  tick(game, 1.4, { interact: true });
  assert.equal(game.relaysActivated, 0);
  assert.equal(game.defense.relayId, relay.id);
  assert.equal(game.defense.wave, 1);
  const progress = game.defense.elapsed;
  const enemies = game.enemies.length;
  game.player.x += 250;
  game._updateDefense(6);
  assert.equal(game.defense.elapsed, progress);
  assert.equal(game.enemies.length, enemies);
  const restored = Game.fromSnapshot(game.serialize());
  assert.deepEqual(restored.serialize(), game.serialize());
  atRelay(restored);
  restored._gainXp(restored.player.xpNext);
  tick(restored, 3, { interact: true });
  assert.equal(restored.defense.elapsed, progress);
  chooseAll(restored);
  restored._updateDefense(0.05);
  assert.equal(restored.defense.wave, 1);
  assert.equal(restored.enemies.length, enemies);
  restored._startDefense(restored.relays[1]);
  assert.equal(restored.defense.relayId, relay.id, '已有挑战不能被另一个站覆盖');
});

test('三波守点必须击破精英并回到圈内，核心与强化只兑现一次', () => {
  const game = fresh();
  const relay = atRelay(game);
  game._startDefense(relay);
  for (let i = 0; i < 361; i++) game._updateDefense(0.05);
  assert.equal(game.defense.wave, 3);
  assert.equal(game.defense.elapsed, 18);
  assert.equal(game.enemies.length, 13);
  assert.equal(relay.active, false, '站够时间也必须击破精英');
  const leader = game.enemies.find(e => e.id === game.defense.leaderId);
  assert.ok(leader.elite);
  game._damageEnemy(leader, leader.hp, 'test');
  assert.equal(game.drops.filter(d => d.type === 'core').length, 1);
  game.player.x += 250;
  game._updateDefense(0.05);
  assert.equal(relay.active, false);
  const restored = Game.fromSnapshot(game.serialize());
  atRelay(restored);
  const level = restored.player.level;
  restored._updateDefense(0.05);
  assert.equal(restored.relaysActivated, 1);
  assert.equal(restored.defense, null);
  assert.equal(restored.state, 'upgrade');
  assert.equal(restored.player.level, level + 1);
  chooseAll(restored);
  restored._startDefense(restored.relays[0]);
  restored._updateDefense(1);
  assert.equal(restored.defense, null);
  assert.equal(restored.relaysActivated, 1);
  assert.equal(restored.drops.filter(d => d.type === 'core').length, 1);
  assert.equal(restored.drainEvents().filter(e => e.type === 'relay').length, 1);
});

test('三座站点配置不同，种子改变首站敌群并且能精确恢复', () => {
  const configurations = new Set();
  for (const seed of [30, 31, 32]) {
    const game = fresh(seed);
    const patterns = game.relays.map(relay => {
      game.defense = null;
      game._startDefense(relay);
      return game.defense.pattern;
    });
    assert.equal(new Set(patterns).size, 3);
    configurations.add(patterns[0]);
    assert.deepEqual(Game.fromSnapshot(game.serialize()).defense, game.defense);
  }
  assert.equal(configurations.size, 3);
});

test('撤离先呼叫再迎击，离开绿圈倒计时继续，恢复与反复长按不重复生成追兵', () => {
  const game = fresh();
  game.elapsed = 45;
  game.exit.available = true;
  game._spawnedOpeningGroup = true;
  game._spawnTimer = 1000;
  Object.assign(game.player, { x: game.exit.x, y: game.exit.y });
  tick(game, 0.5, { interact: true });
  tick(game, 0.05);
  assert.equal(game.exit.called, false, '松手取消尚未完成的呼叫');
  tick(game, 1.05, { interact: true });
  assert.equal(game.exit.called, true);
  assert.equal(game.enemies.length, 8);
  assert.equal(game.state, 'running');
  assert.equal(game._findInteraction(), null, '接应途中不能提前登车');
  game.player.x += 220;
  game._updateExtraction(2);
  assert.ok(game.exit.arrival < 6);
  const restored = Game.fromSnapshot(game.serialize());
  restored._callExtraction();
  assert.equal(restored.enemies.length, 8);
  const remaining = restored.exit.arrival;
  restored._gainXp(restored.player.xpNext);
  tick(restored, 3);
  assert.equal(restored.exit.arrival, remaining, '升级选择不消耗等待时间');
  chooseAll(restored);
  restored._updateExtraction(8);
  assert.equal(restored.state, 'running', '接应到达不会自动结束远征');
  restored.enemies = [];
  Object.assign(restored.player, { x: restored.exit.x, y: restored.exit.y });
  tick(restored, 2.05, { interact: true });
  assert.equal(restored.result.success, true);
  assert.equal(restored.result.reason, 'extracted');
});

test('信标缩短接应等待，v3 旧档保留已接通站点和正在进行的撤离', () => {
  const normal = fresh(), beacon = fresh(91, { beacon: 3 });
  normal._callExtraction();
  beacon._callExtraction();
  assert.equal(normal.exit.arrival, 8);
  assert.equal(beacon.exit.arrival, 3.5);
  const legacy = fresh().serialize();
  legacy.version = 3;
  delete legacy.defense;
  delete legacy.exit.called;
  delete legacy.exit.arrival;
  legacy.relays[0].active = true;
  legacy.relaysActivated = 1;
  legacy.exit.progress = 0.4;
  const original = JSON.stringify(legacy);
  const restored = Game.fromSnapshot(legacy);
  assert.equal(restored.defense, null);
  assert.equal(restored.relays[0].active, true);
  assert.equal(restored.exit.called, true);
  assert.equal(restored.exit.arrival, 0);
  assert.equal(JSON.stringify(legacy), original);
  assert.equal(restored.serialize().version, 4);
});

test('守点与接应的非法快照被拒绝', () => {
  const game = fresh();
  game._startDefense(atRelay(game));
  for (const mutate of [
    s => { s.defense.relayId = 'missing'; },
    s => { s.defense.elapsed = -1; },
    s => { s.defense.wave = 4; },
    s => { s.defense.pattern = 3; },
    s => { s.defense.wave = 3; },
    s => { s.exit.arrival = 9; },
    s => { s.exit.called = false; s.exit.arrival = 4; }
  ]) {
    const snapshot = game.serialize();
    mutate(snapshot);
    assert.throws(() => Game.fromSnapshot(snapshot), /无效/);
  }
});
