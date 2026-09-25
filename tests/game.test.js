const assert = require('node:assert/strict');
const test = require('node:test');

global.window = global;
require('../src/data.js');
const Game = require('../src/game.js');

function tick(game, seconds, input) {
  const count = Math.ceil(seconds / 0.05);
  for (let i = 0; i < count; i += 1) game.update(0.05, input || {});
}

function fresh(options) {
  return new Game(Object.assign({ seed: 123 }, options || {}));
}

test('初始化拥有可达地图、三座中继站和有限状态', () => {
  const game = fresh();
  assert.equal(game.state, 'running');
  assert.equal(game.relays.length, 3);
  assert.equal(game.containers.length, 10);
  assert.ok(game.obstacles.length >= 10);
  assert.equal(game.player.bag.scrap, 0);
  assert.equal(game.player.capacity, 30);
  for (const entity of [...game.obstacles, ...game.containers, ...game.relays]) {
    assert.ok(entity.id && Number.isFinite(entity.x) && Number.isFinite(entity.y));
  }
});

test('相同种子与输入可以重放相同的核心状态', () => {
  const a = fresh({ seed: 987654 });
  const b = fresh({ seed: 987654 });
  const input = { x: 0.6, y: -0.2, fire: true, autoFire: true };
  for (let i = 0; i < 80; i += 1) {
    a.update(0.05, input);
    b.update(0.05, input);
  }
  assert.deepEqual(a.serialize(), b.serialize());
});

test('四种武器产生不同弹道，而墙体会遮挡弹道', () => {
  const kinds = {};
  for (const weapon of ['rivet', 'scatter', 'arc', 'saw']) {
    const game = fresh({ weapon, seed: 30 });
    game._spawnEnemy('crawler', 1200, 1200, false);
    game.update(0.05, { autoFire: true });
    kinds[weapon] = game.bullets.filter((bullet) => !bullet.enemy).map((bullet) => bullet.kind);
    assert.ok(kinds[weapon].length > 0, `${weapon} 应该能发射`);
  }
  assert.equal(kinds.scatter.length, 5);
  assert.equal(kinds.rivet[0], 'rivet');
  assert.equal(kinds.arc[0], 'arc');
  assert.equal(kinds.saw[0], 'saw');

  const blocked = fresh({ seed: 31 });
  blocked.player.x = 170;
  blocked.player.y = 300;
  blocked._spawnEnemy('crawler', 600, 300, false);
  blocked.update(0.05, { manualAim: true, fire: true, autoFire: false, aimX: 600, aimY: 300 });
  assert.equal(blocked.bullets.length, 0, '墙前射出的子弹在同一帧应被遮挡');
});

test('chain科技作用于所有主武器，且每枚子弹的连锁预算只消费一次', () => {
  const weapons = ['rivet', 'scatter', 'arc', 'saw'];
  for (const weapon of weapons) {
    const game = fresh({ weapon, seed: 4040 });
    game.upgrades.chain = 1;
    // 测试链路本身，排除随机地图障碍对 150 距离视线的干扰。
    game.obstacles = [];
    const source = game._spawnEnemy('crawler', game.player.x + 100, game.player.y, false);
    source.x = game.player.x + 100;
    source.y = game.player.y;
    source.speed = 0;
    source.hp = 1000;
    source.maxHp = 1000;
    const chained = [];
    [90, 180, 270, 360].forEach((offset) => {
      const enemy = game._spawnEnemy('crawler', source.x + offset, source.y, false);
      enemy.x = source.x + offset;
      enemy.y = source.y;
      enemy.speed = 0;
      enemy.hp = 1000;
      enemy.maxHp = 1000;
      chained.push(enemy);
    });
    const bullet = game._createPlayerBullet({ x: 1, y: 0 }, source, game._weapon(), 100, 2, false);
    bullet.x = source.x - 20;
    bullet.y = source.y;
    bullet.vx = 200;
    bullet.vy = 0;
    bullet.life = 1;
    bullet.range = 1000;
    game.bullets = [bullet];
    game._updateBullets(0.2);

    const expectedJumps = weapon === 'arc' ? 3 : 1;
    assert.equal(chained[0].hp, 1000 - 100 * 0.72, `${weapon} 应能触发 chain 额外连锁`);
    for (let i = 1; i < chained.length; i += 1) {
      if (i < expectedJumps) assert.equal(chained[i].hp, 1000 - 100 * 0.72, `${weapon} 连锁跳数应正确`);
      else assert.equal(chained[i].hp, 1000, `${weapon} 不应超出 chainBudget`);
    }
    assert.equal(bullet.chainBudget, 0, `${weapon} 的连锁预算应在本枚子弹上耗尽`);
  }
});

test('玩家和敌人不能穿过建筑碰撞体，冲刺有无敌帧', () => {
  const game = fresh();
  game.player.x = 180;
  game.player.y = 300;
  tick(game, 1.2, { x: 1, y: 0, autoFire: false });
  assert.ok(game.player.x + game.player.r <= 210 + 0.01);
  const oldHp = game.player.hp;
  game._damagePlayer(20, 'test');
  assert.equal(game.player.hp, oldHp - 20);
  game.update(0.05, { dash: true, x: 1, y: 0, autoFire: false });
  const hpDuringDash = game.player.hp;
  game._damagePlayer(20, 'test');
  assert.equal(game.player.hp, hpDuringDash);
});

test('远程敌人和 Boss 会按预警冷却持续攻击，单轮不会叠加整组伤害', () => {
  const game = fresh({ seed: 606 });
  game.player.x = 1800;
  game.player.y = 1200;
  game._spawnEnemy('boss', 1800, 600, false);
  const hp = game.player.hp;
  tick(game, 2.8, { autoFire: false });
  assert.ok(game.stats.enemyShots >= 5, 'Boss 第一轮预警后应发射散射弹');
  const damageAfterFirstVolley = hp - game.player.hp;
  assert.ok(damageAfterFirstVolley <= 22, '同一轮散射不应对玩家叠加五次伤害');
  tick(game, 4.8, { autoFire: false });
  assert.ok(game.stats.enemyShots >= 10, 'Boss 冷却结束后应发起第二轮攻击');
});

test('贴脸目标不会永久穿入玩家，近距离弹道仍能命中', () => {
  const game = fresh({ weapon: 'scatter', seed: 707 });
  const enemy = game._spawnEnemy('crawler', game.player.x + 2, game.player.y, false);
  enemy.speed = 0;
  enemy.hp = 1000;
  enemy.maxHp = 1000;
  game.update(0.05, { autoFire: true, aimX: enemy.x, aimY: enemy.y });
  assert.ok(game.stats.hits > 0, '贴脸的霰弹仍应被扫掠弹道命中');
  const survivor = game.enemies.find((item) => item.id === enemy.id);
  if (survivor) assert.ok(Math.hypot(survivor.x - game.player.x, survivor.y - game.player.y) >= survivor.r + game.player.r - 0.01);
});

test('分裂破片只生成一层，不会在密集敌群中指数扩散', () => {
  const game = fresh({ seed: 808 });
  game.upgrades.ricochet = 2;
  for (let i = 0; i < 8; i += 1) {
    const enemy = game._spawnEnemy('crawler', 1300 + (i % 4) * 22, 1415 + Math.floor(i / 4) * 24, false);
    enemy.speed = 0;
    enemy.hp = 1000;
    enemy.maxHp = 1000;
  }
  tick(game, 1.2, { autoFire: true });
  assert.ok(game.bullets.length < 80, '破片数量应保持有界');
  const fragmentCount = game.bullets.filter((bullet) => bullet.kind === 'fragment').length;
  assert.ok(fragmentCount <= game.stats.hits * 2, '每次命中最多生成两枚破片');
});

test('箱子按住互动完成后会留下可拾取资源，容量不足不会吞掉掉落', () => {
  const game = fresh();
  const cache = game.containers.find((container) => container.kind === 'cache');
  game.player.x = cache.x;
  game.player.y = cache.y;
  tick(game, 1.05, { interact: true, autoFire: false });
  assert.equal(cache.opened, true);
  assert.ok(game.player.bag.core > 0 || game.drops.some((drop) => drop.type === 'core'));

  const limited = fresh();
  const limitedCache = limited.containers.find((container) => container.kind === 'cache');
  limited.player.x = limitedCache.x;
  limited.player.y = limitedCache.y;
  limited.player.capacity = 1;
  tick(limited, 1.05, { interact: true, autoFire: false });
  assert.ok(limited.drops.some((drop) => drop.type === 'core'), '装不下的核心必须留在地面');
});

test('升级候选始终来自未满级强化，选择后恢复战斗', () => {
  const game = fresh({ seed: 55 });
  game._gainXp(100);
  assert.equal(game.state, 'upgrade');
  assert.ok(game.upgradeChoices.length > 0 && game.upgradeChoices.length <= 3);
  for (const id of game.upgradeChoices) {
    const max = global.Scrap.DATA.upgrades.find((upgrade) => upgrade.id === id).max;
    assert.ok(game.upgrades[id] < max);
  }
  const choice = game.upgradeChoices[0];
  assert.equal(game.chooseUpgrade(choice), true);
  assert.equal(game.state, 'running');
  assert.equal(game.upgrades[choice], 1);
});

test('三个中继站先锁定信号，达到守卫时间后唤醒 Boss 且至少掉落三个核心', () => {
  const game = fresh({ seed: 77 });
  game.elapsed = 50;
  game.exit.available = true;
  game.relays.forEach((relay) => {
    game.player.x = relay.x;
    game.player.y = relay.y;
    tick(game, 1.4, { interact: true, autoFire: false });
    if (game.state === 'upgrade') game.chooseUpgrade(game.upgradeChoices[0]);
  });
  assert.equal(game.relaysActivated, 3);
  assert.equal(game.bossSpawned, false, '中继站不应在第六分钟前直接生成 Boss');
  game.bossUnlockTime = game.elapsed + 0.1;
  tick(game, 0.15, { autoFire: false });
  assert.equal(game.bossSpawned, true);
  const boss = game.enemies.find((enemy) => enemy.type === 'boss');
  assert.ok(boss);
  assert.equal(boss.maxHp, 2400);
  game._damageEnemy(boss, boss.hp + 1, 'test');
  assert.equal(game.bossDefeated, true);
  assert.ok(game.drops.some((drop) => drop.type === 'core' && drop.amount >= 3));
});

test('出口按住两秒成功撤离，失败只保留 35% 普通资源且核心丢失', () => {
  const game = fresh({ facilities: { beacon: 3 } });
  game.elapsed = 45;
  game.exit.available = true;
  game.player.x = game.exit.x;
  game.player.y = game.exit.y;
  tick(game, 1.1, { interact: true, autoFire: false });
  assert.equal(game.state, 'result');
  assert.equal(game.result.success, true);
  assert.deepEqual(game.result.kept, { scrap: 0, circuit: 0, core: 0 });

  const failed = fresh();
  failed.player.bag = { scrap: 10, circuit: 7, core: 2 };
  const first = failed.finish(false, 'destroyed');
  const second = failed.finish(true, 'ignored');
  assert.deepEqual(first, second);
  assert.deepEqual(first.kept, { scrap: 3, circuit: 2, core: 0 });
  assert.deepEqual(first.lost, { scrap: 7, circuit: 5, core: 2 });
});

test('快照包含顶层 player 并恢复随机数、战斗和交互进度', () => {
  const original = fresh({ seed: 8080, tool: 'drone' });
  original.player.x = 410;
  original.player.y = 510;
  tick(original, 0.35, { interact: true, autoFire: true });
  const snapshot = original.serialize();
  assert.ok(snapshot.player && snapshot.rngState !== undefined);
  const restored = Game.fromSnapshot(snapshot);
  assert.deepEqual(restored.serialize(), snapshot);
  for (let i = 0; i < 20; i += 1) {
    const input = { x: 0.2, y: -0.4, autoFire: true };
    original.update(0.05, input);
    restored.update(0.05, input);
  }
  assert.deepEqual(restored.serialize(), original.serialize());
});

test('快照导入拒绝版本错误、非有限关键数值和异常数组长度', () => {
  const snapshot = fresh({ seed: 909 }).serialize();
  const badVersion = JSON.parse(JSON.stringify(snapshot));
  badVersion.version = 99;
  assert.throws(() => Game.fromSnapshot(badVersion), /远征存档/);
  const badNumber = JSON.parse(JSON.stringify(snapshot));
  badNumber.player.hp = Infinity;
  assert.throws(() => Game.fromSnapshot(badNumber), /远征存档/);
  const badArray = JSON.parse(JSON.stringify(snapshot));
  badArray.enemies = new Array(257).fill({ id: 'bad', x: 0, y: 0 });
  assert.throws(() => Game.fromSnapshot(badArray), /远征存档/);
  const missingPlayer = JSON.parse(JSON.stringify(snapshot));
  delete missingPlayer.player;
  assert.throws(() => Game.fromSnapshot(missingPlayer), /远征存档/);
  const stuckUpgrade = JSON.parse(JSON.stringify(snapshot));
  stuckUpgrade.state = 'upgrade';
  stuckUpgrade.upgradeChoices = [];
  assert.throws(() => Game.fromSnapshot(stuckUpgrade), /远征存档/);
  const bogusChoice = JSON.parse(JSON.stringify(snapshot));
  bogusChoice.state = 'upgrade';
  bogusChoice.upgradeChoices = ['does-not-exist'];
  assert.throws(() => Game.fromSnapshot(bogusChoice), /远征存档/);
});

test('定时补给只触发一次，且中断快照会保留触发标记', () => {
  const game = fresh({ seed: 1010 });
  const initialCount = game.containers.length;
  game.elapsed = 179.95;
  game.update(0.05, { autoFire: false });
  assert.equal(game.supplyFlags['180'], true);
  assert.equal(game.containers.length, initialCount + 2);
  assert.ok(game.drainEvents().some((event) => event.type === 'toast' && /3 分钟补给/.test(event.text)));
  const onceCount = game.containers.length;
  game.update(0.05, { autoFire: false });
  assert.equal(game.containers.length, onceCount);

  game.elapsed = 299.95;
  game.update(0.05, { autoFire: false });
  assert.equal(game.supplyFlags['300'], true);
  assert.equal(game.containers.length, initialCount + 4);
  const restored = Game.fromSnapshot(game.serialize());
  assert.deepEqual(restored.supplyFlags, game.supplyFlags);
  assert.deepEqual(restored.serialize(), game.serialize());
});

test('连击充满超载后等待有效射击，升级暂停期间计时冻结并可恢复', () => {
  const game = fresh({ seed: 1212 });
  for (let i = 0; i < 13; i += 1) {
    const enemy = game._spawnEnemy('crawler', 420 + i * 22, 420, false);
    enemy.speed = 0;
    game._damageEnemy(enemy, enemy.hp + 1, 'test');
  }
  assert.equal(game.combo, 13);
  assert.equal(game.bestCombo, 13);
  assert.equal(game.overdriveCharge, 100);
  assert.equal(game.overdriveTime, 0);
  const events = game.drainEvents();
  assert.ok(events.some((event) => event.type === 'combo' && event.combo === 10));
  assert.ok(!events.some((event) => event.type === 'overdrive'));
  // 清场后保留能量，下一次真实有效射击才开始消耗爆发窗口。
  game.obstacles = [];
  game.enemies = [];
  const target = game._spawnEnemy('crawler', game.player.x + 100, game.player.y, false);
  target.speed = 0;
  game._fireTimer = 0;
  game.update(0.05, { autoFire: true });
  assert.equal(game.overdriveCharge, 0);
  assert.equal(game.overdriveTime, 8);
  assert.ok(game.drainEvents().some((event) => event.type === 'overdrive'));
  game.state = 'upgrade';
  const pausedTime = game.overdriveTime;
  tick(game, 1, { autoFire: false });
  assert.equal(game.overdriveTime, pausedTime);
  game.state = 'running';
  tick(game, 4.1, { autoFire: false });
  assert.equal(game.combo, 0);
  assert.ok(game.overdriveTime < pausedTime);
});

test('进化前置、重抽和四种科技机制均有真实战斗效果', () => {
  const metalstorm = fresh({ seed: 1313 });
  metalstorm.upgrades.damage = 2;
  metalstorm.upgrades.haste = 1;
  metalstorm.state = 'upgrade';
  metalstorm.upgradeChoices = metalstorm._availableUpgradeChoices();
  assert.ok(metalstorm.upgradeChoices.includes('metalstorm'), '满足前置后必须出现进化');
  const previous = metalstorm.upgradeChoices.slice();
  assert.equal(metalstorm.rerollUpgrades(), true);
  assert.equal(metalstorm.rerolls, 1);
  assert.notDeepEqual(metalstorm.upgradeChoices, previous);
  metalstorm.upgradeChoices = ['metalstorm'];
  assert.equal(metalstorm.chooseUpgrade('metalstorm'), true);
  metalstorm.bullets = [];
  metalstorm._metalstormShots = 0;
  metalstorm._fireWeapon({ x: 1, y: 0 }, null);
  metalstorm._fireWeapon({ x: 1, y: 0 }, null);
  metalstorm._fireWeapon({ x: 1, y: 0 }, null);
  assert.equal(metalstorm.bullets.length, 5, '金属风暴第三次射击应追加左右两枚弹');

  const thunder = fresh({ seed: 1414 });
  thunder.upgrades.chain = 2;
  thunder.upgrades.capacitor = 1;
  thunder.upgrades.thunder = 1;
  for (let i = 0; i < 5; i += 1) {
    const enemy = thunder._spawnEnemy('crawler', thunder.player.x - 120 + i * 35, thunder.player.y - 120, false);
    enemy.speed = 0;
  }
  thunder._thunderTimer = 0;
  thunder.update(0.05, { autoFire: false });
  assert.ok(thunder.effects.filter((effect) => effect.type === 'lightning').length >= 5);
  assert.ok(thunder.stats.damageDealt >= 5 * 60);

  const shatter = fresh({ seed: 1515 });
  shatter.upgrades.freeze = 2;
  shatter.upgrades.ricochet = 1;
  shatter.upgrades.shatter = 1;
  const source = shatter._spawnEnemy('crawler', shatter.player.x + 120, shatter.player.y, false);
  const target = shatter._spawnEnemy('brute', source.x + 35, source.y, false);
  const inside = shatter._spawnEnemy('brute', source.x + 80, source.y, false);
  const outside = shatter._spawnEnemy('brute', source.x + 130, source.y, false);
  source.speed = 0;
  target.speed = 0;
  inside.speed = 0;
  outside.speed = 0;
  target.x = source.x + 35;
  target.y = source.y;
  inside.x = source.x + 80;
  inside.y = source.y;
  outside.x = source.x + 130;
  outside.y = source.y;
  source.slowTimer = 1;
  source.hp = 1;
  target.slowTimer = 1;
  target.hp = 1;
  const insideHp = inside.maxHp;
  const outsideHp = outside.maxHp;
  shatter._damageEnemy(source, 2, 'test');
  assert.equal(target.hp, 0, '减速敌人应被冰爆击破，且不能递归触发下一圈');
  assert.equal(inside.hp, insideHp - 70, '冰爆单个目标基础伤害应为 70');
  assert.equal(outside.hp, outsideHp, '冰爆范围外目标不应受伤');
  const shatterEffects = shatter.effects.filter((effect) => effect.type === 'burst' && effect.r === 120);
  assert.equal(shatterEffects.length, 1, '同一冰爆风暴中不得递归连爆');
  assert.equal(shatterEffects[0].color, '#8ee6ff');

  const orbit = fresh({ seed: 1555 });
  orbit.upgrades.orbit = 3;
  const orbitRadius = 68;
  const overlap = orbit._spawnEnemy('crawler', orbit.player.x, orbit.player.y, false);
  overlap.r = 60;
  overlap.maxHp = 1000;
  overlap.hp = 1000;
  overlap.x = orbit.player.x + Math.cos(Math.PI / 3) * orbitRadius;
  overlap.y = orbit.player.y + Math.sin(Math.PI / 3) * orbitRadius;
  const bladeOne = orbit._spawnEnemy('crawler', orbit.player.x, orbit.player.y, false);
  bladeOne.maxHp = 1000;
  bladeOne.hp = 1000;
  bladeOne.x = orbit.player.x + Math.cos((Math.PI * 2) / 3) * orbitRadius;
  bladeOne.y = orbit.player.y + Math.sin((Math.PI * 2) / 3) * orbitRadius;
  const bladeTwo = orbit._spawnEnemy('crawler', orbit.player.x, orbit.player.y, false);
  bladeTwo.maxHp = 1000;
  bladeTwo.hp = 1000;
  bladeTwo.x = orbit.player.x + Math.cos((Math.PI * 4) / 3) * orbitRadius;
  bladeTwo.y = orbit.player.y + Math.sin((Math.PI * 4) / 3) * orbitRadius;
  orbit._orbitAngle = 0;
  orbit._orbitTimer = 0;
  orbit._updateOrbit(0);
  assert.equal(overlap.hp, 992, '同一 tick 内重叠刀片对同一目标最多造成一次 8 点伤害');
  assert.equal(bladeOne.hp, 992);
  assert.equal(bladeTwo.hp, 992);
  assert.equal(orbit.effects.filter((effect) => effect.type === 'ring').length, 3, '3 级环绕应生成 3 枚等角刀片');

  const gravity = fresh({ seed: 1616 });
  gravity.upgrades.orbit = 2;
  gravity.upgrades.magnet = 1;
  gravity.upgrades.gravity = 1;
  const pulled = gravity._spawnEnemy('crawler', gravity.player.x + 180, gravity.player.y, false);
  pulled.x = gravity.player.x + 180;
  pulled.y = gravity.player.y;
  pulled.speed = 0;
  const before = Math.hypot(pulled.x - gravity.player.x, pulled.y - gravity.player.y);
  gravity._gravityTimer = 0;
  gravity.update(0.05, { autoFire: false });
  assert.ok(Math.hypot(pulled.x - gravity.player.x, pulled.y - gravity.player.y) < before);
  assert.ok(pulled.hp < pulled.maxHp);
});

test('重抽候选不足三项时用旧候选补齐，且没有新候选不消耗次数', () => {
  const game = fresh({ seed: 1819 });
  const legal = ['damage', 'haste', 'speed', 'hull'];
  Object.keys(game.upgrades).forEach((id) => { game.upgrades[id] = game._upgradeMax(id); });
  legal.forEach((id) => { game.upgrades[id] = 0; });
  game.state = 'upgrade';
  game.upgradeChoices = ['damage', 'haste', 'speed'];
  game.rerolls = 2;
  assert.equal(game._availableUpgradeDefinitions().length, 4);
  assert.equal(game.rerollUpgrades(), true);
  assert.equal(game.rerolls, 1);
  assert.equal(game.upgradeChoices.length, 3, '只有 1 个新候选时仍应保持三选一');
  assert.ok(game.upgradeChoices.includes('hull'), '新候选必须进入重抽结果');
  assert.equal(new Set(game.upgradeChoices).size, 3);
  assert.equal(game.upgradeChoices.filter((id) => legal.slice(0, 3).includes(id)).length, 2);

  const noNew = fresh({ seed: 1820 });
  Object.keys(noNew.upgrades).forEach((id) => { noNew.upgrades[id] = noNew._upgradeMax(id); });
  noNew.upgrades.damage = 0;
  noNew.state = 'upgrade';
  noNew.upgradeChoices = ['damage'];
  noNew.rerolls = 2;
  assert.equal(noNew.rerollUpgrades(), false);
  assert.equal(noNew.rerolls, 2, '没有任何新候选时不应扣除重抽次数');
  assert.deepEqual(noNew.upgradeChoices, ['damage']);
});

test('版本一快照迁移到版本三时补齐新增字段并保留旧背包与科技', () => {
  const game = fresh({ seed: 1717 });
  game.player.bag = { scrap: 12, circuit: 4, core: 1 };
  game.upgrades.damage = 2;
  const legacy = game.serialize();
  legacy.version = 1;
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
  const restored = Game.fromSnapshot(legacy);
  assert.equal(restored.serialize().version, 3);
  assert.deepEqual(restored.player.bag, game.player.bag);
  assert.equal(restored.upgrades.damage, 2);
  assert.equal(restored.combo, 0);
  assert.equal(restored.rerolls, 2);
  assert.deepEqual(restored.waveFlags, { '75': false, '150': false, '225': false, '300': false });
});

test('版本一快照按已过去时间迁移清剿波次标记，避免恢复首帧补刷', () => {
  const game = fresh({ seed: 1919 });
  game.elapsed = 300;
  const legacy = game.serialize();
  legacy.version = 1;
  delete legacy.waveFlags;
  const restored = Game.fromSnapshot(legacy);
  assert.deepEqual(restored.waveFlags, { '75': true, '150': true, '225': true, '300': true });
  restored.drainEvents();
  restored.update(0.05, { autoFire: false });
  assert.equal(restored.drainEvents().some((event) => event.waveTime), false, '已完成波次恢复后首帧不应重复预告');
});

test('定时清剿波次只刷一次且遵守普通敌人预算', () => {
  const game = fresh({ seed: 1818 });
  game._spawnedOpeningGroup = true;
  game._spawnTimer = 100;
  game.elapsed = 74.95;
  game.update(0.05, { autoFire: false });
  assert.equal(game.waveFlags['75'], true);
  const count = game.enemies.length;
  assert.ok(count > 0 && count <= 8);
  game.update(0.05, { autoFire: false });
  assert.equal(game.enemies.length, count);
  assert.ok(game.drainEvents().some((event) => event.type === 'toast' && /清剿波次/.test(event.text)));
});
