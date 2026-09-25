const assert = require('node:assert/strict');
const test = require('node:test');

global.window = global;
require('../src/data.js');
const Game = require('../src/game.js');

function fresh(options) {
  return new Game(Object.assign({ seed: 230923 }, options));
}

function quiet(options) {
  const game = fresh(options);
  game.obstacles = [];
  game._spawnedOpeningGroup = true;
  game._spawnTimer = 1000;
  return game;
}

function tick(game, seconds, input, choose) {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i += 1) {
    if (choose) while (game.state === 'upgrade') game.chooseUpgrade(game.upgradeChoices[0]);
    game.update(0.05, Object.assign({ autoFire: false }, input));
  }
}

function drop(game, type, amount, offset) {
  game._addDrop(game.player.x + (offset || 0), game.player.y, type, amount, 10);
  return game.drops[game.drops.length - 1];
}

function upgrade(game) {
  assert.equal(game.state, 'running');
  game._gainXp(game.player.xpNext - game.player.xp);
  assert.equal(game.state, 'upgrade');
  return game.upgradeChoices;
}

function connectRelays(game) {
  game.relays.forEach((relay) => {
    game._activateRelay(relay);
    while (game.state === 'upgrade') game.chooseUpgrade(game.upgradeChoices[0]);
  });
  const relay = game.relays[2];
  game.player.x = relay.x;
  game.player.y = relay.y;
  return relay;
}

function aliveTarget(game, offset) {
  const enemy = game._spawnEnemy('crawler', game.player.x + (offset || 120), game.player.y, false);
  enemy.speed = 0;
  enemy.hp = enemy.maxHp = 10000;
  return enemy;
}

test('拾取顺序优先核心，重叠普通掉落不能抢占刚腾出的容量', () => {
  const game = quiet();
  game.player.bag.scrap = 27;
  const scrap = drop(game, 'scrap', 28);
  drop(game, 'core', 1);
  game._collectDrops();
  assert.deepEqual(game.player.bag, { scrap: 27, circuit: 0, core: 1 });
  assert.equal(game._bagWeight(), 30);
  assert.equal(game.drops.length, 1);
  assert.equal(game.drops[0].id, scrap.id);
  assert.equal(game.drops[0].amount, 28);
});

test('满包可原子交换三枚守卫核心，确认前不舍弃废铁，之后普通掉落不回填', () => {
  const game = quiet();
  game.player.bag.scrap = 30;
  drop(game, 'scrap', 28);
  const core = drop(game, 'core', 3);
  game._collectDrops();
  assert.deepEqual(game.getCoreExchange(), { dropId: core.id, coreAmount: 3, scrapCost: 9 });
  assert.deepEqual(game.player.bag, { scrap: 30, circuit: 0, core: 0 });
  assert.equal(game.exchangeCore(core.id), true);
  game._collectDrops();
  assert.deepEqual(game.player.bag, { scrap: 21, circuit: 0, core: 3 });
  assert.equal(game._bagWeight(), game.player.capacity);
  assert.equal(game.exchangeCore(core.id), false);
  assert.equal(game.exchangeCore('old-drop'), false);
});

test('核心交换使用现有空位，只扣最少废铁，保留全部电路', () => {
  const game = quiet();
  game.player.bag = { scrap: 24, circuit: 4, core: 0 };
  const core = drop(game, 'core', 3);
  assert.deepEqual(game.getCoreExchange(), { dropId: core.id, coreAmount: 3, scrapCost: 7 });
  assert.equal(game.exchangeCore(core.id), true);
  assert.deepEqual(game.player.bag, { scrap: 17, circuit: 4, core: 3 });
  assert.equal(game._bagWeight(), 30);

  const partial = quiet();
  partial.player.bag = { scrap: 4, circuit: 26, core: 0 };
  const stack = drop(partial, 'core', 3);
  assert.deepEqual(partial.getCoreExchange(), { dropId: stack.id, coreAmount: 1, scrapCost: 3 });
  assert.equal(partial.exchangeCore(stack.id), true);
  assert.deepEqual(partial.player.bag, { scrap: 1, circuit: 26, core: 1 });
  assert.equal(partial.drops.find((item) => item.id === stack.id).amount, 2);
  assert.equal(partial.getCoreExchange(), null);
});

test('只有电路或废铁不足时不交换，有足够空位时直接拾取', () => {
  for (const scrap of [0, 1, 2]) {
    const game = quiet();
    game.player.bag = { scrap, circuit: 30 - scrap, core: 0 };
    const core = drop(game, 'core', 3);
    assert.equal(game.getCoreExchange(), null);
    assert.equal(game.exchangeCore(core.id), false);
    assert.equal(game.player.bag.circuit, 30 - scrap);
  }
  const room = quiet();
  room.player.bag.scrap = 21;
  const core = drop(room, 'core', 3);
  assert.equal(room.getCoreExchange(), null);
  assert.equal(room.exchangeCore(core.id), false);
  room._collectDrops();
  assert.deepEqual(room.player.bag, { scrap: 21, circuit: 0, core: 3 });
});

test('交换重新核对距离、背包、运行态和快照恢复，不使用失效确认数据', () => {
  const original = quiet();
  original.player.bag.scrap = 30;
  const core = drop(original, 'core', 3);
  const restored = Game.fromSnapshot(original.serialize());
  assert.deepEqual(restored.getCoreExchange(), original.getCoreExchange());
  restored.player.x -= restored._pickupRadius() + 20;
  assert.equal(restored.getCoreExchange(), null);
  assert.equal(restored.exchangeCore(core.id), false);
  restored.player.x = original.player.x;
  restored.player.bag = { scrap: 2, circuit: 28, core: 0 };
  assert.equal(restored.exchangeCore(core.id), false);
  restored.player.bag = { scrap: 30, circuit: 0, core: 0 };
  restored.state = 'upgrade';
  assert.equal(restored.getCoreExchange(), null);
  assert.equal(restored.exchangeCore(core.id), false);
  restored.state = 'running';
  assert.equal(restored.exchangeCore(core.id), true);
  assert.equal(original.player.bag.core, 0, '恢复对象与原战局不共享可变背包');
});

test('普通刷怪在所有威胁级别使用明确概率区间和边界', () => {
  function typeAt(elapsed, threat, roll) {
    const game = quiet();
    game.elapsed = elapsed;
    game.threat = threat;
    game._rng.next = () => roll;
    game._safeSpawnPoint = () => ({ x: 90, y: 90 });
    let selected;
    game._spawnEnemy = (type) => { selected = type; };
    game._spawnWave();
    return selected;
  }
  for (let threat = 1; threat <= 5; threat += 1) {
    assert.equal(typeAt(29.99, threat, 0.719999), 'crawler');
    assert.equal(typeAt(29.99, threat, 0.72), 'runner');
    assert.equal(typeAt(29.99, threat, 0.99999), 'runner');
  }
  assert.equal(typeAt(30, 1, 0.779999), 'crawler');
  assert.equal(typeAt(30, 1, 0.78), 'runner');
  for (let threat = 2; threat <= 5; threat += 1) {
    assert.equal(typeAt(30, threat, 0.579999), 'crawler');
    assert.equal(typeAt(30, threat, 0.58), 'spitter');
    assert.equal(typeAt(30, threat, 0.779999), 'spitter');
    assert.equal(typeAt(30, threat, 0.78), 'runner');
    assert.equal(typeAt(30, threat, 0.829999), 'runner');
    assert.equal(typeAt(30, threat, 0.83), threat < 4 ? 'runner' : 'brute');
  }
  const cases = [
    [0, 1, { crawler: 72, runner: 28 }],
    [30, 1, { crawler: 78, runner: 22 }],
    [120, 2, { crawler: 58, spitter: 20, runner: 22 }],
    [240, 3, { crawler: 58, spitter: 20, runner: 22 }],
    [360, 4, { crawler: 58, spitter: 20, runner: 5, brute: 17 }],
    [480, 5, { crawler: 58, spitter: 20, runner: 5, brute: 17 }]
  ];
  for (const [elapsed, threat, expected] of cases) {
    const counts = {};
    for (let i = 0; i < 100; i += 1) {
      const type = typeAt(elapsed, threat, (i + 0.5) / 100);
      counts[type] = (counts[type] || 0) + 1;
    }
    assert.deepEqual(counts, expected);
  }
});

test('修正刷怪类型后保留原精英概率与非爬行者限制', () => {
  for (const [roll, eliteRoll, expected] of [[0.2, 0, false], [0.8, 0.1, true], [0.8, 0.2, false]]) {
    const game = quiet();
    game.elapsed = 160;
    game.threat = 2;
    let first = true;
    game._rng.next = () => { if (first) { first = false; return roll; } return eliteRoll; };
    game._safeSpawnPoint = () => ({ x: 90, y: 90 });
    let elite;
    game._spawnEnemy = (type, x, y, isElite) => { elite = isElite; };
    game._spawnWave();
    assert.equal(elite, expected);
  }
});

test('最后一站持续按住不能顺带召唤，释放后长按两秒只唤醒一次', () => {
  const game = quiet();
  for (const relay of game.relays.slice(0, 2)) {
    game._activateRelay(relay);
    while (game.state === 'upgrade') game.chooseUpgrade(game.upgradeChoices[0]);
  }
  const relay = game.relays[2];
  game.player.x = relay.x;
  game.player.y = relay.y;
  tick(game, 1.4, { interact: true }, true);
  assert.equal(game.relaysActivated, 3);
  tick(game, 3, { interact: true }, true);
  assert.equal(game.bossSpawned, false);
  assert.equal(game.interaction.kind, 'summon');
  assert.equal(game.interaction.name, '唤醒守卫');
  assert.equal(game.interaction.progress, 0);
  const restored = Game.fromSnapshot(game.serialize());
  tick(restored, 2.1, { interact: true }, true);
  assert.equal(restored.bossSpawned, false, '存档恢复不能绕过松手保护');
  tick(restored, 0.05, { interact: false });
  tick(restored, 1.9, { interact: true });
  assert.equal(restored.bossSpawned, false);
  tick(restored, 0.15, { interact: true });
  assert.equal(restored.bossSpawned, true);
  assert.ok(restored.elapsed < restored.bossUnlockTime);
  tick(restored, 3, { interact: true });
  assert.equal(restored.enemies.filter((enemy) => enemy.type === 'boss').length, 1);
  assert.equal(restored.drainEvents().filter((event) => event.type === 'boss').length, 1);
});

test('主动召唤松手、离开范围或切换中继站都重置进度', () => {
  const game = quiet();
  connectRelays(game);
  tick(game, 0.05, { interact: false });
  tick(game, 0.75, { interact: true });
  assert.ok(game.interaction.progress > 0.3);
  const restored = Game.fromSnapshot(game.serialize());
  assert.deepEqual(restored.interaction, game.interaction);
  tick(game, 0.05, { interact: false });
  assert.equal(game.interaction.progress, 0);
  tick(game, 0.75, { interact: true });
  game.player.x += 150;
  tick(game, 0.05, { interact: true });
  assert.equal(game.interaction, null);
  game.player.x = game.relays[0].x;
  game.player.y = game.relays[0].y;
  tick(game, 0.75, { interact: true });
  game.player.x = game.relays[1].x;
  game.player.y = game.relays[1].y;
  tick(game, 0.05, { interact: true });
  assert.ok(game.interaction.progress < 0.03);
  assert.equal(game.bossSpawned, false);
  tick(restored, 1.35, { interact: true });
  assert.equal(restored.bossSpawned, true, '明确召唤中的合法进度可随快照恢复');
});

test('不足三站不能主动唤醒，既有撤离与容器交互继续优先', () => {
  const game = quiet();
  const relay = game.relays[0];
  game._activateRelay(relay);
  while (game.state === 'upgrade') game.chooseUpgrade(game.upgradeChoices[0]);
  game.player.x = relay.x;
  game.player.y = relay.y;
  assert.equal(game._findInteraction(), null);
  game.relays.slice(1).forEach((item) => {
    game._activateRelay(item);
    while (game.state === 'upgrade') game.chooseUpgrade(game.upgradeChoices[0]);
  });
  game.containers.push({ id: 'near-supply', x: relay.x, y: relay.y, r: 30, kind: 'crate', opened: false, progress: 0 });
  assert.equal(game._findInteraction().kind, 'container');
  game.exit.x = relay.x;
  game.exit.y = relay.y;
  game.exit.available = true;
  assert.equal(game._findInteraction().kind, 'exit');
});

test('未主动召唤仍在第六分钟自动唤醒，恢复后不会生成第二只守卫', () => {
  const game = quiet();
  connectRelays(game);
  game.elapsed = 359.96;
  tick(game, 0.05, { interact: false });
  assert.equal(game.bossSpawned, true);
  const restored = Game.fromSnapshot(game.serialize());
  restored.drainEvents();
  tick(restored, 0.2, { interact: true });
  assert.equal(restored.enemies.filter((enemy) => enemy.type === 'boss').length, 1);
  assert.equal(restored.drainEvents().some((event) => event.type === 'boss'), false);
});

test('清场充满超载只发一次就绪，空场自动射击和暂停不消费', () => {
  const game = quiet();
  for (let i = 0; i < 20; i += 1) {
    const enemy = aliveTarget(game);
    game._damageEnemy(enemy, enemy.hp + 1, 'test');
  }
  game._cleanupDeadEnemies();
  game.drops = [];
  assert.equal(game.overdriveCharge, 100);
  assert.equal(game.overdriveTime, 0);
  const events = game.drainEvents();
  assert.equal(events.filter((event) => event.type === 'overdrive-ready').length, 1);
  assert.equal(events.some((event) => event.type === 'overdrive'), false);
  tick(game, 9, { autoFire: true });
  assert.equal(game.overdriveCharge, 100);
  assert.equal(game.overdriveTime, 0);
  upgrade(game);
  tick(game, 3, { autoFire: true });
  assert.equal(game.overdriveCharge, 100);
  const restored = Game.fromSnapshot(game.serialize());
  assert.equal(restored.overdriveCharge, 100);
  assert.equal(restored.overdriveTime, 0);
  assert.equal(restored.chooseUpgrade(restored.upgradeChoices[0]), true);
  restored._fireTimer = 0;
  aliveTarget(restored);
  tick(restored, 0.05, { autoFire: true });
  assert.equal(restored.overdriveTime, 8);
  assert.equal(restored.overdriveCharge, 0);
});

test('超载等待射程、无遮挡活目标、发射冷却和实际射击输入', () => {
  for (const weapon of ['rivet', 'scatter', 'arc', 'saw']) {
    const game = quiet({ weapon });
    game.overdriveCharge = 100;
    const enemy = aliveTarget(game, game._weapon().range + 100);
    game._updateWeapon(0.05, { autoFire: true });
    assert.equal(game.overdriveCharge, 100);
    enemy.x = game.player.x + 150;
    enemy.hp = 0;
    game._fireTimer = 0;
    game._updateWeapon(0.05, { autoFire: true });
    assert.equal(game.overdriveCharge, 100);
    enemy.hp = 1000;
    game.obstacles = [{ id: 'blocking-wall', x: game.player.x + 50, y: game.player.y - 30, w: 30, h: 60, kind: 'building' }];
    game._fireTimer = 0;
    game._updateWeapon(0.05, { autoFire: true });
    assert.equal(game.overdriveCharge, 100);
    game.obstacles = [];
    game._fireTimer = 0;
    game._updateWeapon(0.05, { autoFire: false, fire: false });
    assert.equal(game.overdriveCharge, 100);
    game._fireTimer = 0.1;
    game._updateWeapon(0.05, { autoFire: false, fire: true });
    assert.equal(game.overdriveCharge, 100);
    game._updateWeapon(0.05, { autoFire: false, fire: true });
    assert.equal(game.overdriveCharge, 0);
    assert.equal(game.overdriveTime, 8);
    assert.equal(game._fireTimer, game._shotInterval());
  }
});

test('手动瞄准偏离有效目标不触发超载，已启动超载在升级时冻结', () => {
  const game = quiet();
  game.overdriveCharge = 100;
  const target = aliveTarget(game);
  game._updateWeapon(0.05, { manualAim: true, fire: true, aimX: game.player.x - 100, aimY: game.player.y });
  assert.equal(game.overdriveCharge, 100);
  game._fireTimer = 0;
  game._updateWeapon(0.05, { manualAim: true, fire: true, aimX: target.x, aimY: target.y });
  assert.equal(game.overdriveTime, 8);
  upgrade(game);
  tick(game, 1, { autoFire: true });
  assert.equal(game.overdriveTime, 8);
  assert.equal(game.chooseUpgrade(game.upgradeChoices[0]), true);
  tick(game, 0.1, { autoFire: false });
  assert.ok(game.overdriveTime < 8);
});

test('追踪仅接受未拥有的进化，重复追踪不清空计数，切换不改现有候选', () => {
  const game = quiet();
  assert.equal(game.trackBuild('damage'), false);
  assert.equal(game.trackBuild('unknown'), false);
  assert.equal(game.trackBuild('metalstorm'), true);
  game.trackingMisses = 2;
  assert.equal(game.trackBuild('metalstorm'), true);
  assert.equal(game.trackingMisses, 2);
  upgrade(game);
  const choices = game.upgradeChoices.slice();
  const state = game._rng.state;
  assert.equal(game.trackBuild('thunder'), true);
  assert.equal(game.trackingMisses, 0);
  assert.equal(game.trackingGuarantee, null);
  assert.deepEqual(game.upgradeChoices, choices);
  assert.equal(game._rng.state, state);
  assert.equal(game.trackBuild(null), true);
  assert.equal(game.trackedBuild, null);
  game.upgrades.gravity = 1;
  assert.equal(game.trackBuild('gravity'), false);
});

test('连续两个真实等级没有缺件，第三次保证配方缺件，其他位置保持随机候选', () => {
  // 这些种子的前两次自然候选均缺少对应配方，用真实随机序列验证第三次保底。
  for (const [id, seed] of [['metalstorm', 7919], ['thunder', 63352], ['shatter', 102947], ['gravity', 31676]]) {
    const game = quiet({ seed });
    game.trackBuild(id);
    const definition = global.Scrap.DATA.upgrades.find((item) => item.id === id);
    const parts = definition.requires.map((item) => item.id);
    for (let level = 1; level <= 2; level += 1) {
      const choices = upgrade(game);
      assert.equal(choices.some((choice) => parts.includes(choice)), false);
      assert.equal(game.trackingMisses, level);
      assert.equal(game.chooseUpgrade(choices[0]), true);
    }
    const guaranteed = upgrade(game);
    assert.equal(guaranteed.length, 3);
    assert.ok(parts.includes(game.trackingGuarantee));
    assert.ok(guaranteed.includes(game.trackingGuarantee));
    assert.equal(game.trackingMisses, 0);
    assert.equal(new Set(guaranteed).size, 3);
    assert.ok(guaranteed.every((choice) => game._upgrade(choice) < game._upgradeMax(choice)));
  }
});

test('出现缺件即清零未命中计数，不选缺件属于玩家取舍', () => {
  const game = quiet();
  game.trackBuild('metalstorm');
  game.trackingMisses = 1;
  game._rng.next = () => 0;
  const choices = upgrade(game);
  assert.ok(choices.includes('damage'));
  assert.equal(game.trackingMisses, 0);
  const other = choices.find((id) => !['damage', 'haste'].includes(id));
  assert.ok(other);
  game.chooseUpgrade(other);
  assert.equal(game.trackingMisses, 0);
});

test('重抽既不推进也不清空计数，并保留已经兑现的缺件保底', () => {
  const game = quiet();
  game.trackBuild('metalstorm');
  game._rng.next = () => 0.999999;
  upgrade(game);
  assert.equal(game.trackingMisses, 1);
  game._rng.next = () => 0;
  assert.equal(game.rerollUpgrades(), true);
  assert.ok(game.upgradeChoices.includes('damage'));
  assert.equal(game.trackingMisses, 1, '重抽出现缺件也不覆盖真实升级计数');
  game.chooseUpgrade(game.upgradeChoices.find((id) => !['damage', 'haste'].includes(id)));
  game.trackingMisses = 2;
  upgrade(game);
  const pin = game.trackingGuarantee;
  assert.ok(pin);
  assert.equal(game.trackingMisses, 0);
  assert.equal(game.rerollUpgrades(), true);
  assert.ok(game.upgradeChoices.includes(pin));
  assert.equal(game.trackingGuarantee, pin);
  assert.equal(game.trackingMisses, 0);
  assert.equal(game.rerolls, 0);
});

test('保底只选仍缺少且未满级的前置，配齐追踪进化优先且重抽保留', () => {
  const game = quiet();
  game.trackBuild('metalstorm');
  game.upgrades.damage = game._upgradeMax('damage');
  game.trackingMisses = 2;
  upgrade(game);
  assert.equal(game.trackingGuarantee, 'haste');
  assert.equal(game.chooseUpgrade('haste'), true);
  game.upgrades.chain = 2;
  game.upgrades.capacitor = 1;
  upgrade(game);
  assert.ok(game.upgradeChoices.includes('metalstorm'));
  assert.equal(game.trackingGuarantee, 'metalstorm');
  assert.equal(game.rerollUpgrades(), true);
  assert.ok(game.upgradeChoices.includes('metalstorm'));
  assert.equal(game.chooseUpgrade('metalstorm'), true);
  assert.equal(game.trackedBuild, null);
  assert.equal(game.trackingMisses, 0);
  assert.equal(game.trackingGuarantee, null);
});

test('追踪快照保留候选、保底、随机状态，恢复后的重抽和选择可重放', () => {
  const game = quiet();
  game.trackBuild('thunder');
  game.trackingMisses = 2;
  upgrade(game);
  const snapshot = game.serialize();
  const restored = Game.fromSnapshot(snapshot);
  assert.deepEqual(restored.serialize(), snapshot);
  assert.equal(restored.rerollUpgrades(), game.rerollUpgrades());
  assert.deepEqual(restored.serialize(), game.serialize());
  const choice = game.upgradeChoices[0];
  assert.equal(restored.chooseUpgrade(choice), game.chooseUpgrade(choice));
  assert.deepEqual(restored.serialize(), game.serialize());
});

test('v1 和 v2 显式迁移到 v3，保留旧随机数、背包、交互进度和候选', () => {
  for (const version of [1, 2]) {
    const game = quiet();
    game.player.bag = { scrap: 12, circuit: 3, core: 2 };
    const container = game.containers[0];
    game.player.x = container.x;
    game.player.y = container.y;
    tick(game, 0.3, { interact: true });
    upgrade(game);
    const legacy = game.serialize();
    legacy.version = version;
    delete legacy.trackedBuild;
    delete legacy.trackingMisses;
    delete legacy.trackingGuarantee;
    delete legacy.timers.summonNeedsRelease;
    delete legacy.interaction.kind;
    if (version === 1) {
      delete legacy.waveFlags;
      delete legacy.combo;
      delete legacy.comboTimer;
      delete legacy.bestCombo;
      delete legacy.overdriveCharge;
      delete legacy.overdriveTime;
      delete legacy.rerolls;
      delete legacy.timers.metalstormShots;
      delete legacy.timers.thunder;
      delete legacy.timers.gravity;
      ['metalstorm', 'thunder', 'shatter', 'gravity'].forEach((id) => delete legacy.upgrades[id]);
    }
    const restored = Game.fromSnapshot(legacy);
    assert.equal(restored.serialize().version, 3);
    assert.equal(restored._rng.state, legacy.rngState);
    assert.deepEqual(restored.player.bag, legacy.player.bag);
    assert.deepEqual(restored.upgradeChoices, legacy.upgradeChoices);
    assert.equal(restored.interaction.progress, legacy.interaction.progress);
    assert.equal(restored.interaction.kind, 'container');
    assert.equal(restored.trackedBuild, null);
    assert.equal(restored.trackingMisses, 0);
    assert.equal(restored.trackingGuarantee, null);
    assert.equal(restored._summonNeedsRelease, true);
    assert.equal(legacy.version, version, '迁移不修改传入的旧对象');
  }
});

test('v3 拒绝非法追踪、保底、交互保护与结算新增字段', () => {
  const game = quiet();
  game.trackBuild('metalstorm');
  game.trackingMisses = 2;
  upgrade(game);
  const edits = [
    (save) => { delete save.trackedBuild; },
    (save) => { save.trackedBuild = 'damage'; },
    (save) => { save.upgrades.metalstorm = 1; },
    (save) => { save.trackingMisses = 3; },
    (save) => { save.trackingMisses = 0.5; },
    (save) => { save.trackedBuild = null; },
    (save) => { save.trackingGuarantee = 'leech'; },
    (save) => { save.upgradeChoices = save.upgradeChoices.filter((id) => id !== save.trackingGuarantee); },
    (save) => { delete save.timers.summonNeedsRelease; },
    (save) => { save.timers.summonNeedsRelease = 1; },
    (save) => { save.timers.interactionKind = 'unknown'; },
    (save) => { save.interaction = { name: '唤醒守卫', kind: 'unknown', progress: 0, x: 100, y: 100 }; }
  ];
  for (const edit of edits) {
    const save = game.serialize();
    edit(save);
    assert.throws(() => Game.fromSnapshot(save), /远征存档/);
  }
  game.finish(true, 'extracted');
  for (const edit of [
    (save) => { delete save.result.weapon; },
    (save) => { save.result.medkitsLeft = -1; },
    (save) => { save.result.build = [{ id: 'unknown', level: 1 }]; },
    (save) => { save.result.build = [{ id: 'damage', level: 6 }]; }
  ]) {
    const save = game.serialize();
    edit(save);
    assert.throws(() => Game.fromSnapshot(save), /远征存档/);
  }
});

test('撤离开放只发一次事件，快照恢复不重复提示', () => {
  const game = quiet();
  game.elapsed = 44.96;
  tick(game, 0.05);
  assert.equal(game.exit.available, true);
  assert.equal(game.drainEvents().filter((event) => event.type === 'exit-open').length, 1);
  const restored = Game.fromSnapshot(game.serialize());
  tick(restored, 0.2);
  assert.equal(restored.drainEvents().some((event) => event.type === 'exit-open'), false);
});

test('结算新增真实武器、构筑和剩余急救包，旧结算快照可显式迁移', () => {
  const game = quiet({ weapon: 'scatter' });
  game.upgrades.damage = 2;
  game.upgrades.haste = 1;
  game.upgrades.metalstorm = 1;
  game.player.medkits = 1;
  game.player.bag = { scrap: 12, circuit: 3, core: 1 };
  const result = game.finish(false, 'storm');
  assert.equal(result.weapon, 'scatter');
  assert.deepEqual(result.build, [{ id: 'damage', level: 2 }, { id: 'haste', level: 1 }, { id: 'metalstorm', level: 1 }]);
  assert.equal(result.medkitsLeft, 1);
  assert.deepEqual(result.kept, { scrap: 4, circuit: 1, core: 0 });
  assert.equal(game.finish(true, 'ignored'), result);
  assert.deepEqual(Game.fromSnapshot(game.serialize()).result, result);
  const legacy = game.serialize();
  legacy.version = 2;
  delete legacy.result.weapon;
  delete legacy.result.build;
  delete legacy.result.medkitsLeft;
  const migrated = Game.fromSnapshot(legacy);
  assert.deepEqual(migrated.result, result);
});
