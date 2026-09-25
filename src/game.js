(function (root) {
  'use strict';

  const S = root.Scrap = root.Scrap || {};

  // 游戏核心不依赖渲染层，所有随机数都由这个可保存的生成器提供。
  function makeFallbackData() {
    const weapon = (id, damage, interval, speed, range, pellets, spread, pierce, color) => ({
      id, name: id, tag: '', description: '', damage, interval, speed, range, pellets, spread, pierce, unlock: 0, color
    });
    const ids = [
      ['damage', 5], ['haste', 4], ['speed', 3], ['hull', 4], ['magnet', 3], ['pierce', 3],
      ['ricochet', 2], ['chain', 3], ['orbit', 3], ['salvage', 3], ['regen', 3], ['crit', 4],
      ['dash', 3], ['freeze', 3], ['capacitor', 3], ['leech', 3]
    ];
    return {
      duration: 600,
      world: { w: 2400, h: 1800 },
      weapons: [
        weapon('rivet', 21, 0.34, 670, 590, 1, 0.035, 0, '#f6c76b'),
        weapon('scatter', 14, 0.85, 540, 330, 5, 0.4, 0, '#f39a6d'),
        weapon('arc', 26, 0.65, 780, 480, 1, 0, 0, '#7bddcf'),
        weapon('saw', 32, 0.95, 400, 440, 1, 0, 8, '#cfdf8c')
      ],
      tools: [{ id: 'magnet' }, { id: 'drone' }, { id: 'scanner' }],
      upgrades: ids.map(([id, max]) => ({ id, max })),
      facilities: [
        { id: 'workshop', max: 3 }, { id: 'storage', max: 3 },
        { id: 'infirmary', max: 3 }, { id: 'beacon', max: 3 }
      ]
    };
  }

  const DATA = S.DATA || makeFallbackData();
  const DEFAULT_WORLD = { w: 2400, h: 1800 };
  const EPS = 0.000001;
  // 进化属于战斗规则的稳定 ID。正式数据会提供名称和描述，核心在缺少新数据时仍能安全迁移旧战局。
  const EVOLUTION_DEFAULTS = [
    { id: 'metalstorm', name: '金属风暴', description: '每三次射击追加左右侧弹。', tag: '进化', max: 1, requires: [{ id: 'damage', level: 2 }, { id: 'haste', level: 1 }] },
    { id: 'thunder', name: '雷霆回路', description: '周期性召唤落雷打击附近敌人。', tag: '进化', max: 1, requires: [{ id: 'chain', level: 2 }, { id: 'capacitor', level: 1 }] },
    { id: 'shatter', name: '碎裂协议', description: '被减速的敌人死亡时引发爆炸。', tag: '进化', max: 1, requires: [{ id: 'freeze', level: 2 }, { id: 'ricochet', level: 1 }] },
    { id: 'gravity', name: '重力井', description: '周期性牵引附近普通敌人并造成伤害。', tag: '进化', max: 1, requires: [{ id: 'orbit', level: 2 }, { id: 'magnet', level: 1 }] }
  ];

  function upgradeDefinitions() {
    const definitions = new Map();
    (DATA.upgrades || []).forEach((upgrade) => {
      if (upgrade && typeof upgrade.id === 'string' && upgrade.id) definitions.set(upgrade.id, upgrade);
    });
    EVOLUTION_DEFAULTS.forEach((upgrade) => {
      if (!definitions.has(upgrade.id)) definitions.set(upgrade.id, upgrade);
    });
    return Array.from(definitions.values());
  }

  function requirementsMet(definition, levels) {
    if (!definition || !Array.isArray(definition.requires)) return true;
    return definition.requires.every((requirement) => {
      if (!requirement || typeof requirement.id !== 'string') return false;
      const level = Number.isFinite(levels && levels[requirement.id]) ? levels[requirement.id] : 0;
      return level >= Math.max(0, Math.floor(finite(requirement.level, 0)));
    });
  }

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function normalize(x, y) {
    const length = Math.hypot(x, y);
    return length > EPS ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  }

  function copy(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function invalidSnapshot() {
    throw new Error('无效的远征存档');
  }

  function finiteSnapshotTree(value, seen, depth) {
    if (typeof value === 'number' && !Number.isFinite(value)) invalidSnapshot();
    if (!value || typeof value !== 'object') return;
    if (depth > 12) invalidSnapshot();
    if (seen.has(value)) invalidSnapshot();
    seen.add(value);
    if (Array.isArray(value)) value.forEach((item) => finiteSnapshotTree(item, seen, depth + 1));
    else Object.keys(value).forEach((key) => finiteSnapshotTree(value[key], seen, depth + 1));
    seen.delete(value);
  }

  function snapshotNumber(object, key, min, max, integer) {
    const value = object && object[key];
    if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) invalidSnapshot();
    return value;
  }

  function snapshotArray(object, key, maxLength) {
    if (!Array.isArray(object && object[key]) || object[key].length > maxLength) invalidSnapshot();
    return object[key];
  }

  function snapshotEntityList(list, fields) {
    const ids = new Set();
    list.forEach((entity) => {
      if (!entity || typeof entity !== 'object' || typeof entity.id !== 'string' || !entity.id || entity.id.length > 100 || ids.has(entity.id)) invalidSnapshot();
      ids.add(entity.id);
      snapshotNumber(entity, 'x', -100000, 100000, false);
      snapshotNumber(entity, 'y', -100000, 100000, false);
      fields.forEach((field) => snapshotNumber(entity, field, -100000000, 100000000, false));
    });
  }

  function cloneSnapshotTree(value, seen) {
    if (!value || typeof value !== 'object') return value;
    const objects = seen || new WeakSet();
    if (objects.has(value)) invalidSnapshot();
    objects.add(value);
    const result = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach((key) => { result[key] = cloneSnapshotTree(value[key], objects); });
    objects.delete(value);
    return result;
  }

  function defaultWaveFlags() {
    return { '75': false, '150': false, '225': false, '300': false };
  }

  function migrateSnapshot(snapshot) {
    let source = snapshot;
    if (typeof source === 'string') {
      try { source = JSON.parse(source); } catch (error) { throw new Error('无效的远征存档'); }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) invalidSnapshot();
    const migrated = cloneSnapshotTree(source);
    if (migrated.version !== 1 && migrated.version !== 2 && migrated.version !== 3) invalidSnapshot();
    if (migrated.version === 1) {
      // v1 已发布存档只补战斗新增字段，不改玩家背包、设施或旧科技等级。
      migrated.version = 2;
      if (!Object.prototype.hasOwnProperty.call(migrated, 'bossUnlockTime')) migrated.bossUnlockTime = finite(DATA.bossUnlockTime, 360);
      if (!Object.prototype.hasOwnProperty.call(migrated, 'supplyFlags')) migrated.supplyFlags = { '180': false, '300': false };
      if (!Object.prototype.hasOwnProperty.call(migrated, 'waveFlags')) migrated.waveFlags = defaultWaveFlags();
      // 旧战局没有波次标记，按已消耗的远征时间补齐，避免恢复 300 秒战局时瞬间重刷四波。
      const elapsed = finite(migrated.elapsed, 0);
      if (migrated.waveFlags && typeof migrated.waveFlags === 'object' && !Array.isArray(migrated.waveFlags)) {
        [75, 150, 225, 300].forEach((threshold) => {
          if (elapsed >= threshold) migrated.waveFlags[String(threshold)] = true;
        });
      }
      if (!Object.prototype.hasOwnProperty.call(migrated, 'combo')) migrated.combo = 0;
      if (!Object.prototype.hasOwnProperty.call(migrated, 'comboTimer')) migrated.comboTimer = 0;
      if (!Object.prototype.hasOwnProperty.call(migrated, 'bestCombo')) migrated.bestCombo = 0;
      if (!Object.prototype.hasOwnProperty.call(migrated, 'overdriveCharge')) migrated.overdriveCharge = 0;
      if (!Object.prototype.hasOwnProperty.call(migrated, 'overdriveTime')) migrated.overdriveTime = 0;
      if (!Object.prototype.hasOwnProperty.call(migrated, 'rerolls')) migrated.rerolls = 2;
      migrated.timers = migrated.timers && typeof migrated.timers === 'object' ? migrated.timers : {};
      if (!Object.prototype.hasOwnProperty.call(migrated.timers, 'metalstormShots')) migrated.timers.metalstormShots = 0;
      if (!Object.prototype.hasOwnProperty.call(migrated.timers, 'thunder')) migrated.timers.thunder = 2;
      if (!Object.prototype.hasOwnProperty.call(migrated.timers, 'gravity')) migrated.timers.gravity = 2;
      migrated.upgrades = migrated.upgrades && typeof migrated.upgrades === 'object' ? migrated.upgrades : {};
      upgradeDefinitions().forEach((upgrade) => {
        if (!Object.prototype.hasOwnProperty.call(migrated.upgrades, upgrade.id)) migrated.upgrades[upgrade.id] = 0;
      });
    }
    if (migrated.version === 2) {
      // v2 没有蓝图追踪和主动召唤；只补新状态，不重抽候选或推进随机数。
      migrated.version = 3;
      migrated.trackedBuild = null;
      migrated.trackingMisses = 0;
      migrated.trackingGuarantee = null;
      if (!migrated.timers || typeof migrated.timers !== 'object' || Array.isArray(migrated.timers)) invalidSnapshot();
      migrated.timers.summonNeedsRelease = true;
      if (migrated.interaction && typeof migrated.interaction === 'object') {
        migrated.interaction.kind = migrated.timers.interactionKind;
      }
      if (migrated.result && typeof migrated.result === 'object') {
        if (!migrated.upgrades || typeof migrated.upgrades !== 'object') invalidSnapshot();
        migrated.result.weapon = migrated.weapon;
        migrated.result.build = upgradeDefinitions().filter((upgrade) => migrated.upgrades[upgrade.id] > 0)
          .map((upgrade) => ({ id: upgrade.id, level: migrated.upgrades[upgrade.id] }));
        migrated.result.medkitsLeft = migrated.player && migrated.player.medkits;
      }
    }
    return migrated;
  }

  function validateSnapshot(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || source.version !== 3) invalidSnapshot();
    finiteSnapshotTree(source, new WeakSet(), 0);
    snapshotNumber(source, 'seed', 0, 0xffffffff, true);
    snapshotNumber(source, 'rngState', 1, 0xffffffff, true);
    snapshotNumber(source, 'idCounter', 0, 100000000, true);
    if (['running', 'upgrade', 'result'].indexOf(source.state) < 0) invalidSnapshot();
    if (source.difficulty !== 'normal' && source.difficulty !== 'hard') invalidSnapshot();
    if (!(DATA.weapons || []).some((weapon) => weapon.id === source.weapon) || !(DATA.tools || []).some((tool) => tool.id === source.tool)) invalidSnapshot();
    if (!source.world || typeof source.world !== 'object') invalidSnapshot();
    snapshotNumber(source.world, 'w', 600, 10000, false);
    snapshotNumber(source.world, 'h', 600, 10000, false);
    snapshotNumber(source, 'duration', 1, 3600, false);
    snapshotNumber(source, 'elapsed', 0, source.duration, false);
    // 时间门槛和补给触发标记必须随远征保存，避免恢复后提前唤醒或重复刷箱。
    snapshotNumber(source, 'bossUnlockTime', 0, source.duration, false);
    snapshotNumber(source, 'threat', 1, 5, true);
    snapshotNumber(source, 'kills', 0, 100000000, true);
    snapshotNumber(source, 'relaysActivated', 0, 3, true);
    ['bossSpawned', 'bossDefeated'].forEach((key) => { if (typeof source[key] !== 'boolean') invalidSnapshot(); });
    if (!source.supplyFlags || typeof source.supplyFlags !== 'object' || Array.isArray(source.supplyFlags)) invalidSnapshot();
    ['180', '300'].forEach((key) => { if (typeof source.supplyFlags[key] !== 'boolean') invalidSnapshot(); });
    if (Object.keys(source.supplyFlags).some((key) => key !== '180' && key !== '300')) invalidSnapshot();
    if (!source.waveFlags || typeof source.waveFlags !== 'object' || Array.isArray(source.waveFlags)) invalidSnapshot();
    ['75', '150', '225', '300'].forEach((key) => { if (typeof source.waveFlags[key] !== 'boolean') invalidSnapshot(); });
    if (Object.keys(source.waveFlags).some((key) => key !== '75' && key !== '150' && key !== '225' && key !== '300')) invalidSnapshot();
    snapshotNumber(source, 'combo', 0, 100000000, true);
    snapshotNumber(source, 'comboTimer', 0, 4, false);
    snapshotNumber(source, 'bestCombo', 0, 100000000, true);
    snapshotNumber(source, 'overdriveCharge', 0, 100, false);
    snapshotNumber(source, 'overdriveTime', 0, 8, false);
    snapshotNumber(source, 'rerolls', 0, 99, true);
    snapshotNumber(source, 'trackingMisses', 0, 2, true);
    if (source.trackedBuild !== null && typeof source.trackedBuild !== 'string') invalidSnapshot();
    if (source.trackingGuarantee !== null && typeof source.trackingGuarantee !== 'string') invalidSnapshot();

    if (!source.facilities || typeof source.facilities !== 'object' || Array.isArray(source.facilities)) invalidSnapshot();
    (DATA.facilities || []).forEach((facility) => snapshotNumber(source.facilities, facility.id, 0, finite(facility.max, 3), true));
    const player = source.player;
    if (!player || typeof player !== 'object') invalidSnapshot();
    ['x', 'y', 'r', 'hp', 'maxHp', 'speed', 'dashCooldown', 'dashTime', 'capacity', 'xp', 'xpNext'].forEach((key) => snapshotNumber(player, key, 0, 100000000, false));
    ['medkits', 'level'].forEach((key) => snapshotNumber(player, key, key === 'level' ? 1 : 0, key === 'level' ? 100000 : 1000, true));
    if (typeof player.angle !== 'number' || !Number.isFinite(player.angle) || typeof player.invulnerable !== 'boolean') invalidSnapshot();
    if (player.hp > player.maxHp || player.maxHp <= 0 || player.capacity <= 0 || player.x > source.world.w || player.y > source.world.h) invalidSnapshot();
    if (!player.bag || typeof player.bag !== 'object') invalidSnapshot();
    ['scrap', 'circuit', 'core'].forEach((key) => snapshotNumber(player.bag, key, 0, 10000000, true));

    const enemies = snapshotArray(source, 'enemies', 256);
    const bullets = snapshotArray(source, 'bullets', 2048);
    const drops = snapshotArray(source, 'drops', 4096);
    const containers = snapshotArray(source, 'containers', 128);
    const obstacles = snapshotArray(source, 'obstacles', 256);
    const relays = snapshotArray(source, 'relays', 16);
    const effects = snapshotArray(source, 'effects', 4096);
    const texts = snapshotArray(source, 'texts', 2048);
    snapshotEntityList(enemies, ['r', 'hp', 'maxHp', 'angle', 'hitFlash', 'attackTimer', 'telegraph']);
    snapshotEntityList(bullets, ['vx', 'vy', 'r', 'life', 'damage']);
    snapshotEntityList(drops, ['amount', 'r']);
    snapshotEntityList(containers, ['r', 'progress']);
    snapshotEntityList(obstacles, ['w', 'h']);
    snapshotEntityList(relays, ['r', 'progress']);
    snapshotEntityList(effects, ['life', 'maxLife', 'r']);
    snapshotEntityList(texts, ['life', 'maxLife']);
    const enemyTypes = new Set(['crawler', 'runner', 'spitter', 'brute', 'boss']);
    const bulletKinds = new Set(['rivet', 'scatter', 'arc', 'saw', 'drone', 'enemy', 'fragment']);
    const dropTypes = new Set(['scrap', 'circuit', 'core', 'xp', 'heal']);
    const containerKinds = new Set(['crate', 'cache', 'medbox']);
    const obstacleKinds = new Set(['building', 'car', 'barrel', 'scrap']);
    const effectTypes = new Set(['hit', 'burst', 'dash', 'ring', 'lightning', 'shot']);
    enemies.forEach((entity) => { if (!enemyTypes.has(entity.type)) invalidSnapshot(); });
    bullets.forEach((entity) => { if (!bulletKinds.has(entity.kind) || typeof entity.enemy !== 'boolean') invalidSnapshot(); });
    drops.forEach((entity) => { if (!dropTypes.has(entity.type)) invalidSnapshot(); });
    containers.forEach((entity) => { if (!containerKinds.has(entity.kind) || typeof entity.opened !== 'boolean') invalidSnapshot(); });
    obstacles.forEach((entity) => { if (!obstacleKinds.has(entity.kind) || entity.w <= 0 || entity.h <= 0) invalidSnapshot(); });
    relays.forEach((entity) => { if (typeof entity.active !== 'boolean') invalidSnapshot(); });
    effects.forEach((entity) => { if (!effectTypes.has(entity.type)) invalidSnapshot(); });
    texts.forEach((entity) => { if (typeof entity.text !== 'string') invalidSnapshot(); });
    snapshotArray(source, 'events', 8192);
    snapshotArray(source, 'upgradeChoices', 3);
    if (!source.upgrades || typeof source.upgrades !== 'object' || Array.isArray(source.upgrades)) invalidSnapshot();
    upgradeDefinitions().forEach((upgrade) => snapshotNumber(source.upgrades, upgrade.id, 0, finite(upgrade.max, 99), true));
    if (!source.exit || typeof source.exit !== 'object') invalidSnapshot();
    ['x', 'y', 'r', 'progress'].forEach((key) => snapshotNumber(source.exit, key, 0, 100000, false));
    if (typeof source.exit.available !== 'boolean') invalidSnapshot();
    if (source.result !== null && typeof source.result !== 'object') invalidSnapshot();
    if (source.state === 'result' && !source.result) invalidSnapshot();
    if (source.state !== 'result' && source.result !== null) invalidSnapshot();
    if (source.interaction !== null && typeof source.interaction !== 'object') invalidSnapshot();
    if (!source.stats || typeof source.stats !== 'object' || Array.isArray(source.stats)) invalidSnapshot();
    if (!source.timers || typeof source.timers !== 'object' || Array.isArray(source.timers)) invalidSnapshot();
    const definitions = upgradeDefinitions();
    const upgradeIds = new Set(definitions.map((upgrade) => upgrade.id));
    const tracked = definitions.find((upgrade) => upgrade.id === source.trackedBuild);
    if (source.trackedBuild !== null && (!tracked || !Array.isArray(tracked.requires) || source.upgrades[tracked.id] > 0)) invalidSnapshot();
    if (source.trackedBuild === null && (source.trackingMisses !== 0 || source.trackingGuarantee !== null)) invalidSnapshot();
    const choiceIds = snapshotArray(source, 'upgradeChoices', 3);
    if (new Set(choiceIds).size !== choiceIds.length || choiceIds.some((id) => !upgradeIds.has(id))) invalidSnapshot();
    choiceIds.forEach((id) => {
      const definition = definitions.find((upgrade) => upgrade.id === id);
      if (!definition || source.upgrades[id] >= definition.max || !requirementsMet(definition, source.upgrades)) invalidSnapshot();
    });
    if (source.state === 'upgrade' && choiceIds.length < 1) invalidSnapshot();
    if (source.state !== 'upgrade' && choiceIds.length > 0) invalidSnapshot();
    if (source.trackingGuarantee !== null) {
      const pin = source.trackingGuarantee;
      const missingPart = tracked && tracked.requires.some((requirement) => requirement.id === pin && source.upgrades[pin] < requirement.level);
      const readyEvolution = tracked && pin === tracked.id && requirementsMet(tracked, source.upgrades);
      if (source.state !== 'upgrade' || !choiceIds.includes(pin) || (!missingPart && !readyEvolution)) invalidSnapshot();
    }
    if (source.result !== null) {
      if (!(DATA.weapons || []).some((weapon) => weapon.id === source.result.weapon)) invalidSnapshot();
      snapshotNumber(source.result, 'medkitsLeft', 0, 1000, true);
      const build = snapshotArray(source.result, 'build', definitions.length);
      const installed = new Set();
      build.forEach((item) => {
        const definition = item && definitions.find((upgrade) => upgrade.id === item.id);
        if (!definition || installed.has(item.id)) invalidSnapshot();
        installed.add(item.id);
        snapshotNumber(item, 'level', 1, definition.max, true);
      });
    }
    Object.keys(source.upgrades).forEach((id) => { if (!upgradeIds.has(id)) invalidSnapshot(); });
    ['shots', 'hits', 'damageDealt', 'damageTaken', 'enemyShots', 'pickups', 'opened', 'healing', 'dashes', 'criticals', 'timeInThreat']
      .forEach((key) => snapshotNumber(source.stats, key, 0, 1000000000, false));
    ['fire', 'hurtCooldown', 'spawn', 'drone', 'regen', 'orbit', 'orbitAngle', 'interactionProgress']
      .forEach((key) => snapshotNumber(source.timers, key, -100000000, 100000000, false));
    snapshotNumber(source.timers, 'metalstormShots', 0, 100000000, true);
    snapshotNumber(source.timers, 'thunder', 0, 100000000, false);
    snapshotNumber(source.timers, 'gravity', 0, 100000000, false);
    if (!source.timers.dashDirection || typeof source.timers.dashDirection !== 'object') invalidSnapshot();
    snapshotNumber(source.timers.dashDirection, 'x', -1, 1, false);
    snapshotNumber(source.timers.dashDirection, 'y', -1, 1, false);
    ['lastDashInput', 'lastHealInput', 'spawnedOpeningGroup', 'summonNeedsRelease'].forEach((key) => {
      if (typeof source.timers[key] !== 'boolean') invalidSnapshot();
    });
    if (source.timers.interactionId !== null && typeof source.timers.interactionId !== 'string') invalidSnapshot();
    const interactionKinds = ['exit', 'container', 'relay', 'summon'];
    if (source.timers.interactionKind !== null && !interactionKinds.includes(source.timers.interactionKind)) invalidSnapshot();
    if (source.interaction !== null) {
      if (!interactionKinds.includes(source.interaction.kind) || typeof source.interaction.name !== 'string') invalidSnapshot();
      snapshotNumber(source.interaction, 'progress', 0, 1, false);
      ['x', 'y'].forEach((key) => snapshotNumber(source.interaction, key, 0, 100000, false));
    }
    finiteSnapshotTree(source.stats, new WeakSet(), 0);
    finiteSnapshotTree(source.timers, new WeakSet(), 0);
    return source;
  }

  function circleIntersectsRect(circle, rect, padding) {
    const p = finite(padding, 0);
    const nearestX = clamp(circle.x, rect.x - p, rect.x + rect.w + p);
    const nearestY = clamp(circle.y, rect.y - p, rect.y + rect.h + p);
    return distance(circle.x, circle.y, nearestX, nearestY) < circle.r;
  }

  function segmentIntersectsRect(x1, y1, x2, y2, rect, padding) {
    const p = finite(padding, 0);
    const left = rect.x - p;
    const right = rect.x + rect.w + p;
    const top = rect.y - p;
    const bottom = rect.y + rect.h + p;
    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;
    const clip = (pValue, qValue) => {
      if (Math.abs(pValue) < EPS) return qValue >= 0;
      const r = qValue / pValue;
      if (pValue < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    return clip(-dx, x1 - left) && clip(dx, right - x1) &&
      clip(-dy, y1 - top) && clip(dy, bottom - y1);
  }

  function segmentIntersectsCircle(x1, y1, x2, y2, cx, cy, radius) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared > EPS ? clamp(((cx - x1) * dx + (cy - y1) * dy) / lengthSquared, 0, 1) : 0;
    const nearestX = x1 + dx * ratio;
    const nearestY = y1 + dy * ratio;
    return distance(nearestX, nearestY, cx, cy) <= radius;
  }

  function pointInObstacle(x, y, radius, obstacles) {
    return obstacles.some((obstacle) => circleIntersectsRect({ x, y, r: radius }, obstacle, 0));
  }

  class Rng {
    constructor(seed) {
      this.state = (finite(seed, Date.now()) >>> 0) || 0x6d2b79f5;
    }

    next() {
      // xorshift32 足够满足单机战局的可复现需求，不把 Math.random 混入战局状态。
      let x = this.state >>> 0;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.state = x >>> 0;
      return this.state / 4294967296;
    }

    range(min, max) {
      return min + (max - min) * this.next();
    }

    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    }
  }

  class Game {
    constructor(options) {
      const opts = options || {};
      this.data = DATA;
      const sourceWorld = opts.world || DATA.world || DEFAULT_WORLD;
      this.world = {
        w: Math.max(600, finite(sourceWorld.w, DEFAULT_WORLD.w)),
        h: Math.max(600, finite(sourceWorld.h, DEFAULT_WORLD.h))
      };
      // 展示和结算保留用户传入的 0 种子，随机生成器内部再使用非零状态。
      this.seed = finite(opts.seed, Date.now()) >>> 0;
      this._rng = new Rng(this.seed || 0x6d2b79f5);
      this._idCounter = 0;
      this.state = 'running';
      this.difficulty = opts.difficulty === 'hard' ? 'hard' : 'normal';
      this.duration = Math.max(1, finite(DATA.duration, 600));
      this.bossUnlockTime = clamp(finite(DATA.bossUnlockTime, 360), 0, this.duration);
      this.elapsed = 0;
      this.threat = this.difficulty === 'hard' ? 2 : 1;
      this.facilities = this._normalizeFacilities(opts.facilities);
      this.weapon = this._weaponId(opts.weapon);
      // 保留显式 ID 方便 UI 与快照消费者读取，同时 weapon 仍是构造参数使用的字符串。
      this.weaponId = this.weapon;
      this.tool = this._toolId(opts.tool);
      this.toolId = this.tool;
      this.exit = {
        x: this.world.w * 0.5,
        y: this.world.h - 270,
        r: 88,
        progress: 0,
        available: false
      };
      const maxHp = 100 + this.facilities.infirmary * 15;
      this.player = {
        x: this.exit.x,
        y: this.exit.y - 115,
        r: 14,
        hp: maxHp,
        maxHp,
        speed: 180,
        angle: -Math.PI / 2,
        dashCooldown: 0,
        dashTime: 0,
        medkits: 2,
        invulnerable: false,
        capacity: 30 + this.facilities.storage * 12,
        bag: { scrap: 0, circuit: 0, core: 0 },
        xp: 0,
        xpNext: 45,
        level: 1
      };
      this.enemies = [];
      this.bullets = [];
      this.drops = [];
      this.containers = [];
      this.obstacles = [];
      this.relays = [];
      this.effects = [];
      this.texts = [];
      this.kills = 0;
      this.relaysActivated = 0;
      this.bossSpawned = false;
      this.bossDefeated = false;
      // 时间补给只触发一次，随快照保存，避免恢复远征后重复刷资源。
      this.supplyFlags = { '180': false, '300': false };
      // 定时小怪波次只触发一次，避免恢复快照后重复刷同一波目标。
      this.waveFlags = defaultWaveFlags();
      // 连击和超载是公开战斗状态，升级暂停时由 update 的早退保证计时冻结。
      this.combo = 0;
      this.comboTimer = 0;
      this.bestCombo = 0;
      this.overdriveCharge = 0;
      this.overdriveTime = 0;
      this.rerolls = 2;
      this.trackedBuild = null;
      this.trackingMisses = 0;
      // 记录本次升级已兑现的保底，重抽不能把它排除掉。
      this.trackingGuarantee = null;
      this.upgradeChoices = [];
      this.upgrades = {};
      upgradeDefinitions().forEach((upgrade) => { this.upgrades[upgrade.id] = 0; });
      this.result = null;
      this.events = [];
      this.interaction = null;
      this.stats = {
        shots: 0,
        hits: 0,
        damageDealt: 0,
        damageTaken: 0,
        enemyShots: 0,
        pickups: 0,
        opened: 0,
        healing: 0,
        dashes: 0,
        criticals: 0,
        timeInThreat: 0
      };

      this._fireTimer = 0;
      this._hurtCooldown = 0;
      this._spawnTimer = 1.6;
      this._droneTimer = 1.8;
      this._regenTimer = 0;
      this._orbitTimer = 0;
      this._orbitAngle = 0;
      this._metalstormShots = 0;
      this._thunderTimer = 2;
      this._gravityTimer = 2;
      this._shatterStormActive = false;
      this._interactionId = null;
      this._interactionKind = null;
      this._interactionProgress = 0;
      this._summonNeedsRelease = false;
      this._lastDashInput = false;
      this._lastHealInput = false;
      this._dashDirection = { x: 0, y: -1 };
      this._spawnedOpeningGroup = false;

      this._buildMap();
    }

    _weaponId(id) {
      const found = (DATA.weapons || []).find((weapon) => weapon.id === id);
      return found ? found.id : ((DATA.weapons || [])[0] || { id: 'rivet' }).id;
    }

    _toolId(id) {
      const found = (DATA.tools || []).find((tool) => tool.id === id);
      return found ? found.id : ((DATA.tools || [])[0] || { id: 'magnet' }).id;
    }

    _normalizeFacilities(facilities) {
      const source = facilities || {};
      const output = {};
      (DATA.facilities || []).forEach((facility) => {
        output[facility.id] = clamp(Math.floor(finite(source[facility.id], 0)), 0, finite(facility.max, 3));
      });
      ['workshop', 'storage', 'infirmary', 'beacon'].forEach((id) => {
        if (!(id in output)) output[id] = clamp(Math.floor(finite(source[id], 0)), 0, 3);
      });
      return output;
    }

    _id(prefix) {
      this._idCounter += 1;
      return `${prefix}-${this._idCounter}`;
    }

    _buildMap() {
      const addObstacle = (x, y, w, h, kind) => {
        this.obstacles.push({ id: this._id('obstacle'), x, y, w, h, kind });
      };
      // 建筑留出道路和南侧出生区，容器与中继站均不放在碰撞体内。
      addObstacle(210, 205, 310, 190, 'building');
      addObstacle(760, 175, 280, 260, 'building');
      addObstacle(1420, 220, 360, 210, 'building');
      addObstacle(1950, 200, 265, 280, 'building');
      addObstacle(240, 720, 300, 245, 'building');
      addObstacle(820, 690, 390, 205, 'building');
      addObstacle(1500, 720, 270, 300, 'building');
      addObstacle(1930, 980, 290, 230, 'building');
      addObstacle(590, 1160, 340, 160, 'building');
      addObstacle(1210, 1040, 260, 190, 'building');
      addObstacle(1730, 1320, 320, 145, 'building');
      addObstacle(1040, 500, 85, 36, 'car');
      addObstacle(1280, 600, 95, 40, 'car');
      addObstacle(1810, 570, 70, 70, 'barrel');
      addObstacle(590, 520, 68, 58, 'scrap');
      addObstacle(1370, 1430, 75, 58, 'scrap');
      addObstacle(2200, 650, 80, 60, 'barrel');

      const addContainer = (x, y, r, kind) => {
        if (!pointInObstacle(x, y, r, this.obstacles)) {
          this.containers.push({ id: this._id('container'), x, y, r, kind, opened: false, progress: 0 });
        }
      };
      addContainer(410, 510, 30, 'crate');
      addContainer(675, 300, 30, 'crate');
      addContainer(1180, 420, 34, 'cache');
      addContainer(1320, 760, 30, 'crate');
      addContainer(1830, 420, 34, 'cache');
      addContainer(2070, 760, 30, 'crate');
      addContainer(450, 1080, 30, 'crate');
      addContainer(1040, 1320, 30, 'medbox');
      addContainer(1510, 1260, 30, 'crate');
      addContainer(2140, 1400, 34, 'cache');

      // 三个站点分布在北部三个道路节点，避开建筑碰撞体，任何一条路线都能到达。
      const relayPoints = [[610, 470], [1190, 220], [2250, 350]];
      relayPoints.forEach(([x, y]) => {
        if (!pointInObstacle(x, y, 25, this.obstacles)) {
          this.relays.push({ id: this._id('relay'), x, y, r: 25, active: false, progress: 0 });
        }
      });
    }

    _emit(type, text, extra) {
      const event = Object.assign({ type }, extra || {});
      if (text) event.text = text;
      this.events.push(event);
      return event;
    }

    drainEvents() {
      const events = this.events;
      this.events = [];
      return events;
    }

    _weapon() {
      return (DATA.weapons || []).find((weapon) => weapon.id === this.weapon) || (DATA.weapons || [])[0];
    }

    _upgradeDefinition(id) {
      return upgradeDefinitions().find((upgrade) => upgrade.id === id) || null;
    }

    _upgradeMax(id) {
      const upgrade = this._upgradeDefinition(id);
      return upgrade ? finite(upgrade.max, 0) : 0;
    }

    _upgrade(id) {
      return finite(this.upgrades[id], 0);
    }

    _damageMultiplier() {
      return (1 + this._upgrade('damage') * 0.22) * (1 + this.facilities.workshop * 0.05);
    }

    _shotInterval() {
      const weapon = this._weapon() || { interval: 0.5 };
      const overdrive = this.overdriveTime > 0 ? 0.65 : 1;
      return Math.max(0.06, finite(weapon.interval, 0.5) * (1 - this._upgrade('haste') * 0.14) * overdrive);
    }

    _moveSpeed() {
      const overdrive = this.overdriveTime > 0 ? 1.12 : 1;
      return finite(this.player.speed, 180) * (1 + this._upgrade('speed') * 0.12) * overdrive;
    }

    _pickupRadius() {
      return 48 + (this.tool === 'magnet' ? 72 : 0) + this._upgrade('magnet') * 45 + (this.overdriveTime > 0 ? 160 : 0);
    }

    _bagWeight() {
      const bag = this.player.bag;
      return finite(bag.scrap, 0) + finite(bag.circuit, 0) + finite(bag.core, 0) * 3;
    }

    _resourceWeight(type) {
      return type === 'core' ? 3 : 1;
    }

    _resourceMultiplier() {
      return (1 + this.facilities.beacon * 0.1) * (1 + this._upgrade('salvage') * 0.25) * (this.tool === 'scanner' ? 1.2 : 1);
    }

    _startOverdrive() {
      if (this.state !== 'running' || this.overdriveTime > 0 || this.overdriveCharge < 100) return;
      this.overdriveCharge = 0;
      this.overdriveTime = 8;
      this._emit('overdrive', '超载启动：火力、机动与回收范围提升。', { duration: 8 });
      this._addEffect('ring', this.player.x, this.player.y, '#7bddcf', 0.65, 60);
    }

    _recordKillCombo(enemy) {
      this.combo += 1;
      this.comboTimer = 4;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      if (this.combo === 10 || this.combo === 25 || this.combo === 50) {
        this._emit('combo', `${this.combo} 连击！`, { combo: this.combo });
      }
      if (this.overdriveTime <= 0) {
        const amount = enemy && (enemy.elite || enemy.type === 'boss') ? 16 : 8;
        const wasReady = this.overdriveCharge >= 100;
        this.overdriveCharge = clamp(this.overdriveCharge + amount, 0, 100);
        if (!wasReady && this.overdriveCharge >= 100) {
          this._emit('overdrive-ready', '超载就绪：下次对有效目标开火时启动。');
        }
      }
    }

    _updateCombatTimers(dt) {
      if (this.comboTimer > 0) {
        this.comboTimer = Math.max(0, this.comboTimer - dt);
        if (this.comboTimer <= 0) this.combo = 0;
      }
      if (this.overdriveTime > 0) {
        this.overdriveTime = Math.max(0, this.overdriveTime - dt);
        if (this.overdriveTime <= 0) this.overdriveCharge = 0;
      }
    }

    _shatterExplosion(sourceEnemy) {
      if (this._shatterStormActive || !sourceEnemy || sourceEnemy._shatterTriggered) return;
      sourceEnemy._shatterTriggered = true;
      this._shatterStormActive = true;
      // 冰爆是覆盖敌群的爽点：范围和 UI 文案保持 120，单个目标基础伤害为 70。
      this._addEffect('burst', sourceEnemy.x, sourceEnemy.y, '#8ee6ff', 0.45, 120);
      const targets = this.enemies.filter((enemy) => enemy !== sourceEnemy && enemy.hp > 0 && distance(enemy.x, enemy.y, sourceEnemy.x, sourceEnemy.y) <= 120);
      targets.forEach((enemy) => this._damageEnemy(enemy, 70 * this._damageMultiplier(), 'shatter'));
      // 同一爆炸风暴中被炸死的减速敌人不能递归触发下一圈爆炸。
      this._shatterStormActive = false;
    }

    _updateEvolutions(dt) {
      if (this._upgrade('thunder') > 0) {
        this._thunderTimer -= dt;
        if (this._thunderTimer <= 0) {
          this._thunderTimer = 2;
          const targets = this.enemies
            .filter((enemy) => enemy.hp > 0 && distance(enemy.x, enemy.y, this.player.x, this.player.y) <= 250)
            .sort((a, b) => distance(a.x, a.y, this.player.x, this.player.y) - distance(b.x, b.y, this.player.x, this.player.y))
            .slice(0, 5);
          targets.forEach((enemy) => {
            this._addEffect('lightning', this.player.x, this.player.y, '#7bddcf', 0.32, 5, { x2: enemy.x, y2: enemy.y });
            this._damageEnemy(enemy, 60 * this._damageMultiplier(), 'thunder');
          });
        }
      } else {
        this._thunderTimer = 2;
      }
      if (this._upgrade('gravity') > 0) {
        this._gravityTimer -= dt;
        if (this._gravityTimer <= 0) {
          this._gravityTimer = 2;
          this._addEffect('ring', this.player.x, this.player.y, '#cfdf8c', 0.35, 80);
          this.enemies.slice().forEach((enemy) => {
            if (enemy.hp <= 0 || enemy.type === 'boss') return;
            if (distance(enemy.x, enemy.y, this.player.x, this.player.y) > 220) return;
            const pull = normalize(this.player.x - enemy.x, this.player.y - enemy.y);
            this._resolveCircle(enemy, pull.x * 80, pull.y * 80);
            this._separateEnemyFromPlayer(enemy);
            this._damageEnemy(enemy, 35 * this._damageMultiplier(), 'gravity');
          });
        }
      } else {
        this._gravityTimer = 2;
      }
    }

    _addEffect(type, x, y, color, life, r, extra) {
      const effect = Object.assign({
        id: this._id('effect'), x: finite(x, 0), y: finite(y, 0), type,
        life: finite(life, 0.25), maxLife: finite(life, 0.25), color: color || '#f6c76b', r: finite(r, 10)
      }, extra || {});
      this.effects.push(effect);
      return effect;
    }

    _addText(text, x, y, color) {
      this.texts.push({
        id: this._id('text'), x: finite(x, 0), y: finite(y, 0), text: String(text),
        color: color || '#f6c76b', life: 0.8, maxLife: 0.8
      });
    }

    _addDrop(x, y, type, amount, r) {
      const safeAmount = Math.max(0, Math.floor(finite(amount, 0)));
      if (!safeAmount && type !== 'heal') return;
      this.drops.push({ id: this._id('drop'), x, y, type, amount: safeAmount || 1, r: finite(r, 10) });
    }

    _safeSpawnPoint(minDistance) {
      const min = finite(minDistance, 240);
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const angle = this._rng.range(0, Math.PI * 2);
        const radius = this._rng.range(Math.max(160, min), Math.max(220, min + 300));
        const x = clamp(this.player.x + Math.cos(angle) * radius, 45, this.world.w - 45);
        const y = clamp(this.player.y + Math.sin(angle) * radius, 45, this.world.h - 45);
        if (distance(x, y, this.player.x, this.player.y) < 120) continue;
        if (pointInObstacle(x, y, 24, this.obstacles)) continue;
        if (this.enemies.some((enemy) => distance(x, y, enemy.x, enemy.y) < 52)) continue;
        return { x, y };
      }
      return { x: 90, y: 90 };
    }

    _spawnEnemy(type, x, y, elite) {
      const presets = {
        crawler: { r: 16, hp: 42, speed: 72, damage: 10, color: '#d86e66' },
        runner: { r: 13, hp: 34, speed: 125, damage: 8, color: '#ee956b' },
        spitter: { r: 18, hp: 64, speed: 52, damage: 13, color: '#be83a1' },
        brute: { r: 25, hp: 175, speed: 38, damage: 25, color: '#b65f5a' },
        boss: { r: 46, hp: 2400, speed: 46, damage: 22, color: '#ff655b' }
      };
      const preset = presets[type] || presets.crawler;
      const multiplier = this.difficulty === 'hard' ? 1.15 : 1;
      const enemy = {
        id: this._id('enemy'), type, x: finite(x, 80), y: finite(y, 80), r: preset.r,
        hp: preset.hp * multiplier * (elite ? 1.35 : 1),
        maxHp: preset.hp * multiplier * (elite ? 1.35 : 1), angle: 0,
        hitFlash: 0, attackTimer: this._rng.range(0.2, 0.9), contactTimer: this._rng.range(0.1, 0.5), telegraph: 0,
        speed: preset.speed, damage: preset.damage * multiplier, color: preset.color,
        elite: Boolean(elite), slowTimer: 0, slowAmount: 0
      };
      if (type === 'boss') {
        enemy.hp = 2400 * multiplier;
        enemy.maxHp = enemy.hp;
        enemy.attackTimer = 1.3;
      }
      if (pointInObstacle(enemy.x, enemy.y, enemy.r, this.obstacles)) {
        const safe = this._safeSpawnPoint(300);
        enemy.x = safe.x;
        enemy.y = safe.y;
      }
      this.enemies.push(enemy);
      return enemy;
    }

    _spawnOpeningGroup() {
      if (this._spawnedOpeningGroup) return;
      this._spawnedOpeningGroup = true;
      for (let i = 0; i < 3; i += 1) {
        const point = this._safeSpawnPoint(260 + i * 15);
        this._spawnEnemy(i === 2 ? 'runner' : 'crawler', point.x, point.y, false);
      }
    }

    _spawnWave() {
      const cap = 8 + this.threat * 4 + (this.bossSpawned ? 4 : 0);
      if (this.enemies.filter((enemy) => enemy.type !== 'boss').length >= cap) return;
      const roll = this._rng.next();
      let type = 'crawler';
      // 每段概率互斥，避免喷吐者分支吞掉高威胁下的追击者。
      if (this.elapsed < 30) type = roll < 0.72 ? 'crawler' : 'runner';
      else if (this.threat === 1) type = roll < 0.78 ? 'crawler' : 'runner';
      else if (roll < 0.58) type = 'crawler';
      else if (roll < 0.78) type = 'spitter';
      else if (this.threat < 4 || roll < 0.83) type = 'runner';
      else type = 'brute';
      const elite = type !== 'crawler' && this._rng.next() < 0.08 + this.threat * 0.015;
      const point = this._safeSpawnPoint(300 + this.threat * 20);
      this._spawnEnemy(type, point.x, point.y, elite);
    }

    _spawnTimedWave(threshold) {
      const key = String(threshold);
      if (this.waveFlags[key]) return;
      this.waveFlags[key] = true;
      const cap = 8 + this.threat * 4 + (this.bossSpawned ? 4 : 0);
      const available = Math.max(0, cap - this.enemies.filter((enemy) => enemy.type !== 'boss').length);
      const count = Math.min(8, available);
      for (let i = 0; i < count; i += 1) {
        const point = this._safeSpawnPoint(260 + i * 8);
        const type = i % 4 === 3 ? 'runner' : 'crawler';
        this._spawnEnemy(type, point.x, point.y, false);
      }
      this._emit('toast', `${Math.floor(threshold / 60)} 分钟清剿波次已抵达：附近出现了 ${count} 个失控小型机械。`, {
        waveTime: threshold, count
      });
    }

    _updateTimedWaves() {
      [75, 150, 225, 300].forEach((threshold) => {
        if (this.elapsed >= threshold) this._spawnTimedWave(threshold);
      });
    }

    _spawnBoss() {
      if (this.bossSpawned) return;
      this.bossSpawned = true;
      const point = { x: this.world.w * 0.5, y: 470 };
      const safe = pointInObstacle(point.x, point.y, 48, this.obstacles) ? this._safeSpawnPoint(500) : point;
      const boss = this._spawnEnemy('boss', safe.x, safe.y, false);
      this._emit('boss', '北部能源塔已唤醒，巨型守卫正在靠近。', { enemyId: boss.id });
      this._addEffect('ring', boss.x, boss.y, '#ff655b', 1.2, 110);
    }

    _findTimedSupplyPoint(startAngle, radius) {
      const baseAngle = finite(startAngle, 0);
      const baseRadius = finite(radius, 100);
      for (let ring = 0; ring < 3; ring += 1) {
        const candidateRadius = baseRadius + ring * 35;
        for (let step = 0; step < 12; step += 1) {
          const angle = baseAngle + (Math.PI * 2 * step) / 12;
          const x = clamp(this.player.x + Math.cos(angle) * candidateRadius, 48, this.world.w - 48);
          const y = clamp(this.player.y + Math.sin(angle) * candidateRadius, 48, this.world.h - 48);
          if (pointInObstacle(x, y, 34, this.obstacles)) continue;
          if (this.containers.some((container) => distance(x, y, container.x, container.y) < container.r + 40)) continue;
          if (this.enemies.some((enemy) => distance(x, y, enemy.x, enemy.y) < enemy.r + 28)) continue;
          if (!this._hasLineOfSight(this.player.x, this.player.y, x, y)) continue;
          return { x, y };
        }
      }
      return { x: clamp(this.player.x, 48, this.world.w - 48), y: clamp(this.player.y, 48, this.world.h - 48) };
    }

    _spawnTimedSupplies(threshold) {
      const key = String(threshold);
      if (this.supplyFlags[key]) return;
      this.supplyFlags[key] = true;
      const first = this._findTimedSupplyPoint(this._rng.range(0, Math.PI * 2), 96);
      // 先登记医疗箱，再寻找稀有箱，避免两次随机落点重叠导致其中一个不可交互。
      this.containers.push({ id: this._id('container'), x: first.x, y: first.y, r: 28, kind: 'medbox', opened: false, progress: 0 });
      const second = this._findTimedSupplyPoint(this._rng.range(0, Math.PI * 2), 140);
      this.containers.push({ id: this._id('container'), x: second.x, y: second.y, r: 34, kind: 'cache', opened: false, progress: 0 });
      this._emit('toast', `${Math.floor(threshold / 60)} 分钟补给已投放：医疗箱与稀有补给箱就在附近。`, { supplyTime: threshold });
      this._addEffect('ring', first.x, first.y, '#7bddcf', 0.8, 30);
      this._addEffect('ring', second.x, second.y, '#f6c76b', 0.8, 36);
    }

    _updateTimedSupplies() {
      [180, 300].forEach((threshold) => {
        if (this.elapsed >= threshold) this._spawnTimedSupplies(threshold);
      });
    }

    _targetEnemy(manualAim, aimX, aimY) {
      let best = null;
      let bestDistance = Infinity;
      const weapon = this._weapon() || { range: 500 };
      this.enemies.forEach((enemy) => {
        if (enemy.hp <= 0) return;
        const d = distance(this.player.x, this.player.y, enemy.x, enemy.y);
        if (d > finite(weapon.range, 500) + enemy.r) return;
        if (!this._hasLineOfSight(this.player.x, this.player.y, enemy.x, enemy.y)) return;
        if (manualAim && Number.isFinite(aimX) && Number.isFinite(aimY)) {
          const aim = normalize(aimX - this.player.x, aimY - this.player.y);
          const candidate = normalize(enemy.x - this.player.x, enemy.y - this.player.y);
          const dot = aim.x * candidate.x + aim.y * candidate.y;
          if (dot < 0.72) return;
        }
        if (d < bestDistance) {
          best = enemy;
          bestDistance = d;
        }
      });
      return best;
    }

    _hasLineOfSight(x1, y1, x2, y2) {
      return !this.obstacles.some((obstacle) => segmentIntersectsRect(x1, y1, x2, y2, obstacle, 2));
    }

    _createPlayerBullet(direction, target, weapon, damage, pierce, allowCritical) {
      const shotDirection = normalize(direction.x, direction.y);
      const kind = weapon.id === 'arc' ? 'arc' : weapon.id === 'saw' ? 'saw' : weapon.id === 'scatter' ? 'scatter' : 'rivet';
      let finalDamage = damage;
      if (allowCritical && this._rng.next() < this._upgrade('crit') * 0.12) {
        finalDamage *= 2;
        this.stats.criticals += 1;
      }
      const sourceX = this.player.x + shotDirection.x * 18;
      const sourceY = this.player.y + shotDirection.y * 18;
      return {
        id: this._id('bullet'), x: sourceX, y: sourceY,
        vx: shotDirection.x * finite(weapon.speed, 500), vy: shotDirection.y * finite(weapon.speed, 500),
        r: weapon.id === 'saw' ? 12 : 5, life: finite(weapon.range, 500) / finite(weapon.speed, 500) + 0.25,
        enemy: false, color: weapon.color || '#f6c76b', kind,
        damage: finalDamage, baseDamage: damage,
        range: finite(weapon.range, 500), travel: 0, pierce, basePierce: pierce, hitIds: [],
        targetId: target ? target.id : null, originX: sourceX, originY: sourceY,
        phase: 'out', returnStarted: false, bounces: 0,
        // 电弧自带两跳，其余主武器从零开始，只叠加 chain 科技提供的额外跳数。
        chainBudget: (kind === 'arc' ? 2 : 0) + this._upgrade('chain')
      };
    }

    _fireWeapon(direction, target) {
      const weapon = this._weapon();
      if (!weapon) return;
      this.player.angle = Math.atan2(direction.y, direction.x);
      const damageBase = finite(weapon.damage, 10) * this._damageMultiplier();
      const pellets = Math.max(1, Math.floor(finite(weapon.pellets, 1)));
      const spread = finite(weapon.spread, 0);
      const pierce = Math.max(0, Math.floor(finite(weapon.pierce, 0)) + this._upgrade('pierce'));
      const baseAngle = Math.atan2(direction.y, direction.x);
      for (let i = 0; i < pellets; i += 1) {
        const angle = baseAngle + (pellets === 1 ? 0 : this._rng.range(-spread, spread));
        this.bullets.push(this._createPlayerBullet({ x: Math.cos(angle), y: Math.sin(angle) }, target, weapon, damageBase, pierce, true));
      }
      this._metalstormShots = this._upgrade('metalstorm') > 0 ? this._metalstormShots + 1 : 0;
      let sideShots = 0;
      if (this._upgrade('metalstorm') > 0 && this._metalstormShots % 3 === 0) {
        [-1, 1].forEach((side) => {
          const angle = baseAngle + side * 0.22;
          this.bullets.push(this._createPlayerBullet({ x: Math.cos(angle), y: Math.sin(angle) }, target, weapon, damageBase * 0.7, pierce, false));
          sideShots += 1;
        });
      }
      this._fireTimer = this._shotInterval();
      this.stats.shots += pellets + sideShots;
      const effectX = this.player.x + direction.x * 18;
      const effectY = this.player.y + direction.y * 18;
      this._addEffect('shot', effectX, effectY, weapon.color || '#f6c76b', 0.12, 8, {
        x2: effectX + direction.x * 24, y2: effectY + direction.y * 24
      });
      this._emit('shot', weapon.name || '开火', { weapon: weapon.id, pellets: pellets + sideShots, metalstorm: sideShots > 0 });
    }

    _fireDrone() {
      if (this.tool !== 'drone') return;
      const target = this._targetEnemy(false);
      if (!target) return;
      const direction = normalize(target.x - this.player.x, target.y - this.player.y);
      const damage = 10 * this._damageMultiplier();
      this.bullets.push({
        id: this._id('bullet'), x: this.player.x, y: this.player.y,
        vx: direction.x * 610, vy: direction.y * 610, r: 4, life: 0.9,
        enemy: false, color: '#91d5e4', kind: 'drone', damage, baseDamage: damage,
          range: 550, travel: 0, pierce: 0, basePierce: 0, hitIds: [], targetId: target.id,
        originX: this.player.x, originY: this.player.y, phase: 'out', chainBudget: 0
      });
      this.stats.shots += 1;
      this._emit('shot', '无人机支援射击', { weapon: 'drone' });
      this._addEffect('shot', this.player.x, this.player.y, '#91d5e4', 0.1, 6);
    }

    _fireEnemy(enemy, direction, spreadCount) {
      const count = spreadCount || 1;
      for (let i = 0; i < count; i += 1) {
        const base = Math.atan2(direction.y, direction.x);
        const angle = base + (count === 1 ? 0 : (i - (count - 1) / 2) * 0.14);
        this.bullets.push({
          id: this._id('bullet'), x: enemy.x, y: enemy.y,
          vx: Math.cos(angle) * 260, vy: Math.sin(angle) * 260,
          r: enemy.type === 'boss' ? 8 : 5, life: enemy.type === 'boss' ? 3 : 2.4,
          enemy: true, color: enemy.type === 'boss' ? '#ff655b' : '#c77aa2', kind: 'enemy',
          damage: enemy.damage, baseDamage: enemy.damage, range: 800, travel: 0,
          pierce: 0, basePierce: 0, hitIds: [], targetId: null, originX: enemy.x, originY: enemy.y,
          phase: 'out', chainBudget: 0
        });
      }
      this.stats.enemyShots += count;
      this._addEffect('shot', enemy.x, enemy.y, enemy.color, 0.14, 9);
    }

    _resolveCircle(entity, speedX, speedY) {
      // 分轴移动再回退，允许沿墙滑动；同时每次都以实体半径检查实际碰撞体。
      const moveAxis = (axis, amount) => {
        const previous = entity[axis];
        entity[axis] = clamp(previous + amount, entity.r, (axis === 'x' ? this.world.w : this.world.h) - entity.r);
        if (this.obstacles.some((obstacle) => circleIntersectsRect(entity, obstacle, 0))) entity[axis] = previous;
      };
      moveAxis('x', speedX);
      moveAxis('y', speedY);
    }

    _movePlayer(dt, input) {
      const requested = normalize(finite(input.x, 0), finite(input.y, 0));
      if (this.player.dashTime > 0) {
        this._resolveCircle(this.player, this._dashDirection.x * this._moveSpeed() * 2.8 * dt, this._dashDirection.y * this._moveSpeed() * 2.8 * dt);
      } else if (requested.x || requested.y) {
        this.player.angle = Math.atan2(requested.y, requested.x);
        this._resolveCircle(this.player, requested.x * this._moveSpeed() * dt, requested.y * this._moveSpeed() * dt);
      }
      if (Number.isFinite(input.aimX) && Number.isFinite(input.aimY)) {
        const aim = normalize(input.aimX - this.player.x, input.aimY - this.player.y);
        if (aim.x || aim.y) this.player.angle = Math.atan2(aim.y, aim.x);
      }
    }

    _tryDash(input) {
      const pressed = Boolean(input.dash);
      if (pressed && !this._lastDashInput && this.player.dashCooldown <= 0 && this.player.dashTime <= 0) {
        const requested = normalize(finite(input.x, 0), finite(input.y, 0));
        this._dashDirection = requested.x || requested.y ? requested : { x: Math.cos(this.player.angle), y: Math.sin(this.player.angle) };
        this.player.dashTime = 0.18;
        this.player.dashCooldown = Math.max(0.45, 1.2 - this._upgrade('dash') * 0.2);
        this.player.invulnerable = true;
        this.stats.dashes += 1;
        this._emit('dash', '涡轮冲刺', { x: this.player.x, y: this.player.y });
        this._addEffect('dash', this.player.x, this.player.y, '#7bddcf', 0.3, 24);
        if (this._upgrade('capacitor') > 0) {
          this._addEffect('ring', this.player.x, this.player.y, '#7bddcf', 0.35, 45 + this._upgrade('capacitor') * 10);
          this.enemies.slice().forEach((enemy) => {
            if (distance(this.player.x, this.player.y, enemy.x, enemy.y) < 45 + this._upgrade('capacitor') * 10) {
              this._damageEnemy(enemy, 18 * this._upgrade('capacitor') * this._damageMultiplier(), 'capacitor');
            }
          });
        }
      }
      this._lastDashInput = pressed;
    }

    _tryHeal(input) {
      const pressed = Boolean(input.heal);
      if (pressed && !this._lastHealInput && this.player.medkits > 0 && this.player.hp < this.player.maxHp - EPS) {
        const amount = this.player.maxHp * 0.4;
        this.player.hp = clamp(this.player.hp + amount, 0, this.player.maxHp);
        this.player.medkits -= 1;
        this.stats.healing += amount;
        this._emit('heal', `急救包恢复 ${Math.round(amount)} 点生命`, { amount });
        this._addEffect('burst', this.player.x, this.player.y, '#7bddcf', 0.45, 22);
      }
      this._lastHealInput = pressed;
    }

    _updatePlayerTimers(dt) {
      this.player.dashCooldown = Math.max(0, this.player.dashCooldown - dt);
      if (this.player.dashTime > 0) {
        this.player.dashTime = Math.max(0, this.player.dashTime - dt);
      }
      this.player.invulnerable = this.player.dashTime > 0;
      this._hurtCooldown = Math.max(0, this._hurtCooldown - dt);
      this._regenTimer += dt;
      if (this._upgrade('regen') > 0 && this._regenTimer >= 1 && this.player.hp < this.player.maxHp) {
        const ticks = Math.floor(this._regenTimer);
        this._regenTimer -= ticks;
        const amount = ticks * this._upgrade('regen') * 0.9;
        this.player.hp = clamp(this.player.hp + amount, 0, this.player.maxHp);
        this.stats.healing += amount;
      }
    }

    _updateWeapon(dt, input) {
      this._fireTimer = Math.max(0, this._fireTimer - dt);
      const autoFire = input.autoFire !== false;
      const manualAim = Boolean(input.manualAim);
      const wantsFire = manualAim ? Boolean(input.fire) : (autoFire || Boolean(input.fire));
      if (!wantsFire || this._fireTimer > 0) return;
      const target = this._targetEnemy(manualAim, input.aimX, input.aimY);
      // 只有本帧真的能向射程和视线内的活目标开火，才消费满格超载。
      if (target && this.overdriveCharge >= 100) this._startOverdrive();
      let direction;
      if (target) direction = normalize(target.x - this.player.x, target.y - this.player.y);
      else if (Number.isFinite(input.aimX) && Number.isFinite(input.aimY)) direction = normalize(input.aimX - this.player.x, input.aimY - this.player.y);
      else direction = { x: Math.cos(this.player.angle), y: Math.sin(this.player.angle) };
      if (!direction.x && !direction.y) direction = { x: 1, y: 0 };
      this._fireWeapon(direction, target);
    }

    _updateDrone(dt) {
      if (this.tool !== 'drone') return;
      this._droneTimer -= dt;
      if (this._droneTimer <= 0) {
        this._droneTimer = 2.15;
        this._fireDrone();
      }
    }

    _updateOrbit(dt) {
      const level = this._upgrade('orbit');
      if (!level) return;
      this._orbitAngle += dt * (1.6 + level * 0.2);
      this._orbitTimer -= dt;
      if (this._orbitTimer > 0) return;
      this._orbitTimer = 0.28;
      const bladeCount = Math.max(1, Math.min(3, Math.floor(level)));
      const radius = 38 + bladeCount * 10;
      const hitIds = new Set();
      for (let index = 0; index < bladeCount; index += 1) {
        // 每级是一枚独立刀片，等角分布保证升级会增加实际覆盖率。
        const angle = this._orbitAngle + (Math.PI * 2 * index) / bladeCount;
        const x = this.player.x + Math.cos(angle) * radius;
        const y = this.player.y + Math.sin(angle) * radius;
        const target = this.enemies.find((enemy) => {
          return enemy.hp > 0 && !hitIds.has(enemy.id) && distance(x, y, enemy.x, enemy.y) < enemy.r + 11;
        });
        if (target) {
          hitIds.add(target.id);
          // 同一 tick 内每个目标最多吃一枚刀片的伤害，避免大体型敌人重复受击。
          this._damageEnemy(target, 8 * this._damageMultiplier(), 'orbit');
        }
        this._addEffect('ring', x, y, '#cfdf8c', 0.1, 8);
      }
    }

    _updateSpawns(dt) {
      if (!this._spawnedOpeningGroup && this.elapsed >= 1.5) this._spawnOpeningGroup();
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0) {
        this._spawnTimer = Math.max(1.8, 5.8 - this.threat * 0.62);
        this._spawnWave();
      }
      this._updateTimedWaves();
      // 主动召唤之外仍保留第六分钟的自动唤醒，玩家可继续探索等待。
      if (this.relaysActivated >= 3 && this.elapsed >= this.bossUnlockTime) this._spawnBoss();
    }

    _enemyMove(enemy, dt) {
      const toPlayer = normalize(this.player.x - enemy.x, this.player.y - enemy.y);
      enemy.angle = Math.atan2(toPlayer.y, toPlayer.x);
      const distanceToPlayer = distance(enemy.x, enemy.y, this.player.x, this.player.y);
      const slow = enemy.slowTimer > 0 ? (1 - enemy.slowAmount) : 1;
      const speed = finite(enemy.speed, 60) * slow;
      let move = 1;
      if (enemy.type === 'spitter' && distanceToPlayer > 260) move = 0.6;
      if (enemy.type === 'boss' && distanceToPlayer < 260) move = 0.15;
      this._resolveCircle(enemy, toPlayer.x * speed * move * dt, toPlayer.y * speed * move * dt);
    }

    _separateEnemyFromPlayer(enemy) {
      const minimum = enemy.r + this.player.r + 1;
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      const current = Math.hypot(dx, dy);
      if (current >= minimum) return;
      const normal = current > EPS ? { x: dx / current, y: dy / current } : { x: Math.cos(enemy.angle || 0), y: Math.sin(enemy.angle || 0) };
      const oldX = enemy.x;
      const oldY = enemy.y;
      enemy.x = clamp(this.player.x + normal.x * minimum, enemy.r, this.world.w - enemy.r);
      enemy.y = clamp(this.player.y + normal.y * minimum, enemy.r, this.world.h - enemy.r);
      if (this.obstacles.some((obstacle) => circleIntersectsRect(enemy, obstacle, 0))) {
        enemy.x = oldX;
        enemy.y = oldY;
      }
    }

    _updateEnemy(enemy, dt) {
      enemy.hitFlash = Math.max(0, finite(enemy.hitFlash, 0) - dt);
      enemy.attackTimer = Math.max(0, finite(enemy.attackTimer, 0) - dt);
      enemy.contactTimer = Math.max(0, finite(enemy.contactTimer, 0) - dt);
      enemy.slowTimer = Math.max(0, finite(enemy.slowTimer, 0) - dt);
      if (enemy.hp <= 0) return;
      const d = distance(enemy.x, enemy.y, this.player.x, this.player.y);
      this._enemyMove(enemy, dt);
      this._separateEnemyFromPlayer(enemy);
      const ranged = enemy.type === 'spitter' || enemy.type === 'boss';
      const wasTelegraphing = enemy.telegraph > 0;
      if (wasTelegraphing) enemy.telegraph = Math.max(0, enemy.telegraph - dt);
      // 预警结束的这一帧只发射一次；冷却归零后重新进入预警，避免只攻击一次或每帧攻击。
      if (ranged && wasTelegraphing && enemy.telegraph <= 0 && !enemy._telegraphFired) {
        enemy._telegraphFired = true;
        const direction = normalize(this.player.x - enemy.x, this.player.y - enemy.y);
        this._fireEnemy(enemy, direction, enemy.type === 'boss' ? 5 : 1);
      }
      const canSpit = enemy.type === 'boss' || (d < 720 && this._hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y));
      if (ranged && canSpit && enemy.attackTimer <= 0 && enemy.telegraph <= 0) {
        enemy.telegraph = enemy.type === 'boss' ? 0.7 : 0.28;
        enemy.attackTimer = enemy.type === 'boss' ? 3.8 : 1.8;
        enemy._telegraphFired = false;
      }
      const contactRange = enemy.r + this.player.r + 3;
      if (distance(enemy.x, enemy.y, this.player.x, this.player.y) <= contactRange && enemy.contactTimer <= 0 && enemy.type !== 'spitter' && enemy.type !== 'boss') {
        this._damagePlayer(enemy.damage, enemy.type);
        enemy.contactTimer = enemy.type === 'runner' ? 0.72 : 0.95;
      }
      if (enemy.type === 'boss' && d <= contactRange && enemy.contactTimer <= 0) {
        this._damagePlayer(enemy.damage, 'boss');
        enemy.contactTimer = 1.1;
      }
    }

    _updateEnemies(dt) {
      this.enemies.forEach((enemy) => this._updateEnemy(enemy, dt));
    }

    _damagePlayer(amount, source) {
      if (this.state !== 'running' || this.player.invulnerable || this.player.hp <= 0 || this._hurtCooldown > 0) return;
      const damage = Math.max(0, finite(amount, 0));
      if (!damage) return;
      this.player.hp = clamp(this.player.hp - damage, 0, this.player.maxHp);
      // 同一轮 Boss 散射或多个近身单位不能在一帧内叠加整组伤害。
      this._hurtCooldown = 0.18;
      this.stats.damageTaken += damage;
      this._emit('hurt', `受到 ${Math.ceil(damage)} 点伤害`, { amount: damage, source });
      this._addEffect('hit', this.player.x, this.player.y, '#ff655b', 0.22, 16);
      this._addText(`-${Math.ceil(damage)}`, this.player.x, this.player.y - 23, '#ff8d78');
      if (this.player.hp <= 0) this.finish(false, 'destroyed');
    }

    _damageEnemy(enemy, amount, source) {
      if (!enemy || enemy.hp <= 0) return;
      let damage = Math.max(0, finite(amount, 0));
      if (!damage) return;
      enemy.hp = clamp(enemy.hp - damage, 0, enemy.maxHp);
      enemy.hitFlash = 0.12;
      this.stats.hits += 1;
      this.stats.damageDealt += damage;
      this._emit('hit', `命中造成 ${Math.ceil(damage)} 点伤害`, { enemyId: enemy.id, amount: damage, source });
      this._addEffect('hit', enemy.x, enemy.y, source === 'capacitor' ? '#7bddcf' : '#f6c76b', 0.18, 10);
      this._addText(Math.ceil(damage), enemy.x, enemy.y - enemy.r - 8, '#f6c76b');
      if (this._upgrade('freeze') > 0 && source !== 'orbit') {
        enemy.slowTimer = Math.max(enemy.slowTimer, 1.25);
        enemy.slowAmount = Math.min(0.5, 0.18 * this._upgrade('freeze'));
      }
      if (enemy.hp <= 0) this._killEnemy(enemy);
    }

    _killEnemy(enemy) {
      if (enemy._dead) return;
      enemy._dead = true;
      this.kills += 1;
      this._emit('kill', `${enemy.type === 'boss' ? '巨型守卫' : '敌人'}已回收`, { enemyId: enemy.id, enemyType: enemy.type });
      this._recordKillCombo(enemy);
      if (this._upgrade('shatter') > 0 && enemy.slowTimer > 0) this._shatterExplosion(enemy);
      this._addEffect('burst', enemy.x, enemy.y, enemy.type === 'boss' ? '#ff655b' : '#f6c76b', 0.5, enemy.r + 10);
      this._addDrop(enemy.x, enemy.y, 'xp', enemy.type === 'boss' ? 150 : enemy.type === 'brute' ? 42 : 18, 9);
      const resourceAmount = enemy.type === 'boss' ? 28 : enemy.type === 'brute' ? 12 : this._rng.int(2, 6);
      this._addDrop(enemy.x + 8, enemy.y, 'scrap', resourceAmount, 9);
      if (enemy.type === 'spitter' || enemy.type === 'brute' || this._rng.next() < 0.22) {
        this._addDrop(enemy.x - 8, enemy.y, 'circuit', enemy.type === 'boss' ? 8 : this._rng.int(1, 3), 9);
      }
      if (enemy.type === 'boss') {
        this.bossDefeated = true;
        this._addDrop(enemy.x, enemy.y + 14, 'core', 3, 11);
        this._emit('toast', '巨型守卫已坍塌，能源核心散落在废墟中。');
      } else if (enemy.elite || (enemy.type === 'brute' && this._rng.next() < 0.35)) {
        this._addDrop(enemy.x, enemy.y - 10, 'core', 1, 11);
      }
      if (this._upgrade('leech') > 0) {
        const interval = Math.max(2, 6 - this._upgrade('leech'));
        if (this.kills % interval === 0) {
          const amount = 5 + this._upgrade('leech') * 2;
          this.player.hp = clamp(this.player.hp + amount, 0, this.player.maxHp);
          this.stats.healing += amount;
          this._emit('heal', `残骸修复恢复 ${amount} 点生命`, { amount, source: 'leech' });
        }
      }
    }

    _updateBullets(dt) {
      const survivors = [];
      const spawned = [];
      this.bullets.forEach((bullet) => {
        if (bullet.life <= 0) return;
        const oldX = bullet.x;
        const oldY = bullet.y;
        if (bullet.kind === 'saw' && bullet.phase === 'in') {
          const direction = normalize(this.player.x - bullet.x, this.player.y - bullet.y);
          bullet.vx = direction.x * 460;
          bullet.vy = direction.y * 460;
          if (distance(bullet.x, bullet.y, this.player.x, this.player.y) < 25) {
            bullet.life = 0;
          }
        }
        const nextX = bullet.x + bullet.vx * dt;
        const nextY = bullet.y + bullet.vy * dt;
        const wallHit = this.obstacles.some((obstacle) => segmentIntersectsRect(oldX, oldY, nextX, nextY, obstacle, bullet.r));
        if (wallHit) {
          if (bullet.kind === 'saw' && bullet.phase === 'out' && bullet.bounces < 1) {
            bullet.bounces += 1;
            bullet.vx *= -1;
            bullet.vy *= -1;
          } else {
            bullet.life = 0;
          }
        } else {
          bullet.x = nextX;
          bullet.y = nextY;
        }
        const travel = distance(oldX, oldY, bullet.x, bullet.y);
        bullet.travel += travel;
        bullet.life -= dt;
        if (bullet.kind === 'saw' && bullet.phase === 'out' && bullet.travel >= bullet.range) {
          bullet.phase = 'in';
          bullet.returnStarted = true;
          bullet.hitIds = [];
          bullet.pierce = finite(bullet.basePierce, bullet.pierce);
          bullet.life = Math.max(bullet.life, distance(bullet.x, bullet.y, this.player.x, this.player.y) / 460 + 0.2);
          this._addEffect('ring', bullet.x, bullet.y, bullet.color, 0.18, 15);
        }
        if (bullet.life <= 0) return;
        if (bullet.enemy) {
          if (segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, this.player.x, this.player.y, bullet.r + this.player.r)) {
            this._damagePlayer(bullet.damage, 'projectile');
            return;
          }
        } else {
          let consumed = false;
          for (let i = 0; i < this.enemies.length; i += 1) {
            const enemy = this.enemies[i];
            if (enemy.hp <= 0 || bullet.hitIds.indexOf(enemy.id) !== -1) continue;
            if (!segmentIntersectsCircle(oldX, oldY, bullet.x, bullet.y, enemy.x, enemy.y, bullet.r + enemy.r)) continue;
            bullet.hitIds.push(enemy.id);
            this._damageEnemy(enemy, bullet.damage, bullet.kind);
            // 破片和无人机是独立副武器，不继承主武器连锁，避免递归扩散。
            if (bullet.kind !== 'fragment' && bullet.kind !== 'drone') this._chainArc(enemy, bullet);
            if (this._upgrade('ricochet') > 0 && bullet.kind !== 'drone' && bullet.kind !== 'arc' && bullet.kind !== 'fragment') this._ricochet(enemy, bullet, spawned);
            if (bullet.pierce > 0) bullet.pierce -= 1;
            else if (bullet.kind !== 'saw' || bullet.phase === 'in') consumed = true;
            if (consumed) break;
          }
          if (consumed) return;
        }
        survivors.push(bullet);
      });
      this.bullets = survivors.concat(spawned);
    }

    _cleanupDeadEnemies() {
      this.enemies = this.enemies.filter((enemy) => enemy && enemy.hp > 0 && !enemy._dead);
    }

    _chainArc(sourceEnemy, bullet) {
      let budget = Math.max(0, Math.floor(finite(bullet.chainBudget, 0)));
      if (!budget) return;
      if (!Array.isArray(bullet.hitIds)) bullet.hitIds = [];
      const visited = new Set(bullet.hitIds);
      // 即使调用方尚未把首个命中写入 hitIds，也不能让连锁回头命中起点自身。
      if (sourceEnemy && sourceEnemy.id && !visited.has(sourceEnemy.id)) {
        visited.add(sourceEnemy.id);
        bullet.hitIds.push(sourceEnemy.id);
      }
      let current = sourceEnemy;
      while (budget > 0) {
        let next = null;
        let best = 150;
        this.enemies.forEach((enemy) => {
          if (enemy.hp <= 0 || visited.has(enemy.id)) return;
          const d = distance(current.x, current.y, enemy.x, enemy.y);
          if (d < best && this._hasLineOfSight(current.x, current.y, enemy.x, enemy.y)) {
            best = d;
            next = enemy;
          }
        });
        if (!next) break;
        visited.add(next.id);
        bullet.hitIds.push(next.id);
        this._addEffect('lightning', current.x, current.y, '#7bddcf', 0.22, 4, { x2: next.x, y2: next.y });
        this._damageEnemy(next, bullet.damage * 0.72, 'chain');
        current = next;
        budget -= 1;
      }
      // chainBudget 是这枚子弹的总余额；穿透和回旋再次命中时只能消费剩余跳数。
      bullet.chainBudget = budget;
    }

    _ricochet(enemy, bullet, spawned) {
      const count = this._upgrade('ricochet');
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / Math.max(1, count) + this._rng.range(-0.3, 0.3);
        spawned.push({
          id: this._id('bullet'), x: enemy.x, y: enemy.y,
          vx: Math.cos(angle) * 360, vy: Math.sin(angle) * 360,
          r: 4, life: 0.34, enemy: false, color: '#f39a6d', kind: 'fragment',
          damage: bullet.baseDamage * 0.35, baseDamage: bullet.baseDamage * 0.35,
          range: 140, travel: 0, pierce: 0, basePierce: 0, hitIds: [enemy.id], targetId: null,
          originX: enemy.x, originY: enemy.y, phase: 'out', chainBudget: 0
        });
      }
    }

    _dropPickup(drop) {
      if (drop.type === 'xp') {
        if (this.state !== 'running') return 0;
        this._gainXp(drop.amount);
        this.stats.pickups += 1;
        this._emit('pickup', `经验 +${drop.amount}`, { dropType: drop.type, amount: drop.amount });
        return drop.amount;
      }
      if (drop.type === 'heal') {
        if (this.player.medkits >= 5) return 0;
        this.player.medkits += 1;
        this.stats.pickups += 1;
        this._emit('pickup', '获得急救包', { dropType: drop.type, amount: 1 });
        return 1;
      }
      const unitWeight = this._resourceWeight(drop.type);
      const room = Math.floor((this.player.capacity - this._bagWeight()) / unitWeight);
      if (room <= 0) return 0;
      const amount = Math.min(room, drop.amount);
      this.player.bag[drop.type] = finite(this.player.bag[drop.type], 0) + amount;
      this.stats.pickups += 1;
      this._emit('pickup', `获得${drop.type === 'scrap' ? '废铁' : drop.type === 'circuit' ? '电路' : '能源核心'} ×${amount}`, {
        dropType: drop.type, amount
      });
      return amount;
    }

    _collectDrops() {
      const survivors = [];
      const radius = this._pickupRadius();
      // 先收核心再收普通材料；装不下时仍留在地面，绝不静默丢弃背包内容。
      const ordered = this.drops.filter((drop) => drop.type === 'core')
        .concat(this.drops.filter((drop) => drop.type !== 'core'));
      ordered.forEach((drop) => {
        if (distance(this.player.x, this.player.y, drop.x, drop.y) > radius + drop.r) {
          survivors.push(drop);
          return;
        }
        const picked = this._dropPickup(drop);
        drop.amount -= picked;
        if (drop.amount > 0) survivors.push(drop);
        else this._addEffect('burst', drop.x, drop.y, drop.type === 'core' ? '#7bddcf' : '#f6c76b', 0.22, 10);
      });
      this.drops = survivors;
    }

    _coreExchangeForDrop(drop) {
      if (!drop || drop.type !== 'core' || drop.amount < 1) return null;
      if (distance(this.player.x, this.player.y, drop.x, drop.y) > this._pickupRadius() + drop.r) return null;
      const room = this.player.capacity - this._bagWeight();
      const coreAmount = Math.min(Math.floor(drop.amount), Math.floor((room + this.player.bag.scrap) / 3));
      if (coreAmount < 1) return null;
      const scrapCost = Math.max(0, Math.ceil(coreAmount * 3 - room));
      if (scrapCost <= 0 || scrapCost > this.player.bag.scrap) return null;
      return { dropId: drop.id, coreAmount, scrapCost };
    }

    getCoreExchange() {
      if (this.state !== 'running') return null;
      for (const drop of this.drops) {
        const offer = this._coreExchangeForDrop(drop);
        if (offer) return offer;
      }
      return null;
    }

    exchangeCore(dropId) {
      if (this.state !== 'running' || typeof dropId !== 'string') return false;
      const drop = this.drops.find((item) => item.id === dropId);
      const offer = this._coreExchangeForDrop(drop);
      if (!offer) return false;
      // 确认后在同一步内腾出最小空间并装入核心，不给重叠废铁回填的机会。
      this.player.bag.scrap -= offer.scrapCost;
      this.player.bag.core += offer.coreAmount;
      drop.amount -= offer.coreAmount;
      this.stats.pickups += 1;
      if (drop.amount <= 0) this.drops = this.drops.filter((item) => item !== drop);
      this._addEffect('burst', drop.x, drop.y, '#7bddcf', 0.35, 18);
      this._emit('pickup', `获得能源核心 ×${offer.coreAmount}`, { dropType: 'core', amount: offer.coreAmount });
      this._emit('toast', `已舍弃 ${offer.scrapCost} 废铁，装入 ${offer.coreAmount} 枚核心。`);
      return true;
    }

    _gainXp(amount) {
      this.player.xp += Math.max(0, finite(amount, 0));
      if (this.state !== 'running') return;
      while (this.player.xp >= this.player.xpNext) {
        this.player.xp -= this.player.xpNext;
        this.player.level += 1;
        this.player.xpNext = Math.floor(55 + this.player.level * 22);
        const choices = this._availableUpgradeChoices([], true);
        if (!choices.length) continue;
        this.upgradeChoices = choices;
        this.state = 'upgrade';
        this._emit('upgrade', '等级提升，选择一项强化。', { choices: choices.slice(), level: this.player.level });
        break;
      }
    }

    _availableUpgradeDefinitions(excluded) {
      const blocked = new Set(Array.isArray(excluded) ? excluded : []);
      return upgradeDefinitions().filter((upgrade) => {
        return !blocked.has(upgrade.id) && this._upgrade(upgrade.id) < finite(upgrade.max, 0) && requirementsMet(upgrade, this.upgrades);
      });
    }

    _upgradeChoiceWeight(upgrade) {
      let score = 1;
      if (this._upgrade(upgrade.id) > 0) score += 2;
      if (Array.isArray(upgrade.requires)) score += 8;
      // 已经点亮进化路线的前置科技优先出现，但保留基础科技的随机分散度。
      const isPrerequisite = upgradeDefinitions().some((evolution) => {
        return Array.isArray(evolution.requires) && evolution.requires.some((requirement) => requirement.id === upgrade.id) && !requirementsMet(evolution, this.upgrades);
      });
      if (isPrerequisite) score += 4;
      return score;
    }

    _pickWeightedUpgrade(pool) {
      if (!pool.length) return null;
      const total = pool.reduce((sum, upgrade) => sum + this._upgradeChoiceWeight(upgrade), 0);
      let cursor = this._rng.next() * total;
      let index = pool.length - 1;
      for (let i = 0; i < pool.length; i += 1) {
        cursor -= this._upgradeChoiceWeight(pool[i]);
        if (cursor < 0) { index = i; break; }
      }
      return pool.splice(index, 1)[0];
    }

    trackBuild(id) {
      if (this.state === 'result') return false;
      if (id !== null) {
        const evolution = this._upgradeDefinition(id);
        if (!evolution || !Array.isArray(evolution.requires) || this._upgrade(id) > 0) return false;
      }
      if (this.trackedBuild === id) return true;
      this.trackedBuild = id;
      this.trackingMisses = 0;
      this.trackingGuarantee = null;
      return true;
    }

    _trackedMissingDefinitions() {
      const evolution = this._upgradeDefinition(this.trackedBuild);
      if (!evolution || !Array.isArray(evolution.requires) || this._upgrade(evolution.id) > 0) return [];
      const legal = this._availableUpgradeDefinitions();
      return legal.filter((upgrade) => evolution.requires.some((requirement) => {
        return requirement.id === upgrade.id && this._upgrade(upgrade.id) < requirement.level;
      }));
    }

    _availableUpgradeChoices(excluded, newLevel) {
      const legal = this._availableUpgradeDefinitions();
      const definitions = this._availableUpgradeDefinitions(excluded);
      const tracked = legal.find((upgrade) => upgrade.id === this.trackedBuild && Array.isArray(upgrade.requires));
      const missing = this._trackedMissingDefinitions();
      if (newLevel) this.trackingGuarantee = null;
      let trackedGuarantee = tracked || legal.find((upgrade) => upgrade.id === this.trackingGuarantee);
      if (!trackedGuarantee && newLevel && this.trackingMisses >= 2 && missing.length) {
        trackedGuarantee = this._pickWeightedUpgrade(missing.slice());
      }
      if (trackedGuarantee) {
        this.trackingGuarantee = trackedGuarantee.id;
        // 已兑现的缺件保底和已配齐的追踪进化允许留在重抽中。
        if (!definitions.some((upgrade) => upgrade.id === trackedGuarantee.id)) definitions.unshift(trackedGuarantee);
      }
      const readyEvolutions = definitions.filter((upgrade) => Array.isArray(upgrade.requires));
      const choices = [];
      // 优先追踪保底；未追踪时仍保留原有的就绪进化保证。
      const guaranteed = trackedGuarantee || this._pickWeightedUpgrade(readyEvolutions.slice());
      if (guaranteed) {
        choices.push(guaranteed.id);
        const index = definitions.indexOf(guaranteed);
        if (index >= 0) definitions.splice(index, 1);
      }
      while (choices.length < 3 && definitions.length) {
        const picked = this._pickWeightedUpgrade(definitions);
        if (!picked) break;
        choices.push(picked.id);
      }
      if (newLevel && this.trackedBuild) {
        if (tracked || missing.some((upgrade) => choices.includes(upgrade.id))) this.trackingMisses = 0;
        else if (missing.length) this.trackingMisses = Math.min(2, this.trackingMisses + 1);
        else this.trackingMisses = 0;
      }
      return choices;
    }

    chooseUpgrade(id) {
      if (this.state !== 'upgrade' || this.upgradeChoices.indexOf(id) === -1) return false;
      const max = this._upgradeMax(id);
      const definition = this._upgradeDefinition(id);
      if (!max || this._upgrade(id) >= max || !requirementsMet(definition, this.upgrades)) return false;
      this.upgrades[id] = this._upgrade(id) + 1;
      if (id === 'hull') {
        this.player.maxHp += 25;
        this.player.hp = clamp(this.player.hp + 25, 0, this.player.maxHp);
      }
      this.upgradeChoices = [];
      this.trackingGuarantee = null;
      if (id === this.trackedBuild) {
        this.trackedBuild = null;
        this.trackingMisses = 0;
      }
      this.state = 'running';
      this._emit('upgrade', `已安装强化：${id}`, { id, level: this.upgrades[id] });
      // 一次拾取可能跨过多个等级，下一次选择仍会在战斗冻结状态下出现。
      if (this.player.xp >= this.player.xpNext) this._gainXp(0);
      return true;
    }

    rerollUpgrades() {
      if (this.state !== 'upgrade' || this.rerolls <= 0) return false;
      const previous = this.upgradeChoices.slice();
      const legalDefinitions = this._availableUpgradeDefinitions();
      if (!legalDefinitions.some((upgrade) => !previous.includes(upgrade.id))) return false;
      // 普通旧候选先排除，追踪保底由生成器保留；重抽不改变连续未命中的计数。
      const freshChoices = this._availableUpgradeChoices(previous);
      if (!freshChoices.length) return false;
      // 新项不足三项时，用旧候选按同一权重补齐，保持选择面完整且不重复。
      const targetCount = Math.min(3, legalDefinitions.length);
      const choices = freshChoices.slice(0, targetCount);
      const freshIds = new Set(choices);
      const oldPool = legalDefinitions.filter((upgrade) => previous.indexOf(upgrade.id) >= 0 && !freshIds.has(upgrade.id));
      while (choices.length < targetCount && oldPool.length) {
        const picked = this._pickWeightedUpgrade(oldPool);
        if (!picked) break;
        choices.push(picked.id);
      }
      this.rerolls -= 1;
      this.upgradeChoices = choices;
      this._emit('upgrade', '已重抽强化候选。', { choices: choices.slice(), reroll: true, rerolls: this.rerolls });
      return true;
    }

    _findInteraction() {
      const player = this.player;
      if (this.exit.available && distance(player.x, player.y, this.exit.x, this.exit.y) <= this.exit.r + player.r + 10) {
        return { id: 'exit', kind: 'exit', name: '撤离', x: this.exit.x, y: this.exit.y, duration: Math.max(0.8, 2 - this.facilities.beacon * 0.35) };
      }
      let best = null;
      let bestDistance = Infinity;
      this.containers.forEach((container) => {
        if (container.opened) return;
        const d = distance(player.x, player.y, container.x, container.y);
        if (d <= container.r + player.r + 24 && d < bestDistance) {
          best = { id: container.id, kind: 'container', name: container.kind === 'medbox' ? '打开医疗箱' : '搜集补给', x: container.x, y: container.y, duration: 0.9 };
          bestDistance = d;
        }
      });
      this.relays.forEach((relay) => {
        const summon = relay.active && this.relaysActivated >= 3 && !this.bossSpawned;
        if (relay.active && !summon) return;
        const d = distance(player.x, player.y, relay.x, relay.y);
        if (d <= relay.r + player.r + 24 && d < bestDistance) {
          best = {
            id: relay.id, kind: summon ? 'summon' : 'relay', name: summon ? '唤醒守卫' : '激活中继站',
            x: relay.x, y: relay.y, duration: summon ? 2 : 1.3
          };
          bestDistance = d;
        }
      });
      return best;
    }

    _openContainer(container) {
      if (!container || container.opened) return;
      container.opened = true;
      container.progress = 1;
      this.stats.opened += 1;
      const multiplier = this._resourceMultiplier();
      if (container.kind === 'medbox') {
        this._addDrop(container.x, container.y, 'heal', 1, 10);
      } else if (container.kind === 'cache') {
        // 稀有箱固定至少给一枚核心，保证非 Boss 路线也能成长。
        this._addDrop(container.x - 7, container.y, 'core', 1, 11);
        this._addDrop(container.x + 9, container.y, 'scrap', Math.ceil(16 * multiplier), 9);
        this._addDrop(container.x, container.y + 10, 'circuit', Math.ceil(3 * multiplier), 9);
      } else {
        this._addDrop(container.x - 6, container.y, 'scrap', Math.ceil(this._rng.int(8, 16) * multiplier), 9);
        this._addDrop(container.x + 7, container.y, 'circuit', Math.ceil(this._rng.int(1, 3) * multiplier), 9);
      }
      this._emit('open', container.kind === 'medbox' ? '医疗箱已打开' : '补给箱已打开', { containerId: container.id });
      this._addEffect('burst', container.x, container.y, '#f6c76b', 0.45, 26);
    }

    _activateRelay(relay) {
      if (!relay || relay.active) return;
      relay.active = true;
      relay.progress = 1;
      this.relaysActivated += 1;
      if (this.relaysActivated >= 3) this._summonNeedsRelease = true;
      this._emit('relay', `中继站 ${this.relaysActivated}/3 已激活`, { relayId: relay.id, count: this.relaysActivated });
      this._addEffect('ring', relay.x, relay.y, '#7bddcf', 0.7, 42);
      this._gainXp(90);
      const relayHeal = Math.min(15, Math.max(0, this.player.maxHp - this.player.hp));
      if (relayHeal > 0) {
        this.player.hp += relayHeal;
        this.stats.healing += relayHeal;
        this._emit('heal', `中继站医疗脉冲恢复 ${Math.ceil(relayHeal)} 点生命`, { amount: relayHeal, source: 'relay' });
      }
      if (this.relaysActivated >= 3) {
        this._emit('toast', '三站已接通：松手后可在任一中继站长按 2 秒唤醒守卫，也可继续搜集，等待第 6 分钟自动唤醒。');
      }
    }

    _updateInteraction(dt, input) {
      const held = Boolean(input.interact);
      // 激活最后一站的持续按住不能顺带召唤，恢复存档也保留这道松手保护。
      if (!held) this._summonNeedsRelease = false;
      const target = this._findInteraction();
      if (!target) {
        if (this._interactionId && this._interactionKind === 'container') {
          const oldContainer = this.containers.find((container) => container.id === this._interactionId);
          if (oldContainer && !oldContainer.opened) oldContainer.progress = 0;
        }
        if (this._interactionId && this._interactionKind === 'relay') {
          const oldRelay = this.relays.find((relay) => relay.id === this._interactionId);
          if (oldRelay && !oldRelay.active) oldRelay.progress = 0;
        }
        this.interaction = null;
        this._interactionId = null;
        this._interactionKind = null;
        this._interactionProgress = 0;
        this.exit.progress = 0;
        return;
      }
      if (this._interactionId !== target.id || this._interactionKind !== target.kind) {
        if (this._interactionId && this._interactionKind === 'container') {
          const oldContainer = this.containers.find((container) => container.id === this._interactionId);
          if (oldContainer && !oldContainer.opened) oldContainer.progress = 0;
        }
        if (this._interactionId && this._interactionKind === 'relay') {
          const oldRelay = this.relays.find((relay) => relay.id === this._interactionId);
          if (oldRelay && !oldRelay.active) oldRelay.progress = 0;
        }
        this._interactionId = target.id;
        this._interactionKind = target.kind;
        this._interactionProgress = 0;
      }
      if (held && !(target.kind === 'summon' && this._summonNeedsRelease)) this._interactionProgress = clamp(this._interactionProgress + dt / target.duration, 0, 1);
      else this._interactionProgress = 0;
      if (target.kind === 'container') {
        const container = this.containers.find((item) => item.id === target.id);
        if (container) container.progress = this._interactionProgress;
      }
      if (target.kind === 'relay') {
        const relay = this.relays.find((item) => item.id === target.id);
        if (relay) relay.progress = this._interactionProgress;
      }
      this.interaction = { kind: target.kind, name: target.name, progress: this._interactionProgress, x: target.x, y: target.y };
      if (target.kind === 'exit') this.exit.progress = this._interactionProgress;
      if (this._interactionProgress < 1) return;
      if (target.kind === 'exit') {
        this._emit('extract', '撤离通道已确认，正在返回营地。');
        this.finish(true, 'extracted');
      } else if (target.kind === 'container') {
        this._openContainer(this.containers.find((container) => container.id === target.id));
      } else if (target.kind === 'relay') {
        this._activateRelay(this.relays.find((relay) => relay.id === target.id));
      } else if (target.kind === 'summon' && this.state === 'running') {
        this._spawnBoss();
      }
      this.interaction = null;
      this._interactionId = null;
      this._interactionKind = null;
      this._interactionProgress = 0;
      this.exit.progress = 0;
    }

    _updateEffects(dt) {
      this.effects = this.effects.filter((effect) => {
        effect.life -= dt;
        return effect.life > 0;
      });
      this.texts = this.texts.filter((text) => {
        text.life -= dt;
        return text.life > 0;
      });
    }

    _updateThreat(dt) {
      this.threat = clamp((this.difficulty === 'hard' ? 2 : 1) + Math.floor(this.elapsed / 120), 1, 5);
      this.stats.timeInThreat += dt * this.threat;
      if (!this.exit.available && this.elapsed >= 45) {
        this.exit.available = true;
        this._emit('exit-open', '撤离通道已开放，随时可回南部出口带资源返回营地。');
      }
    }

    update(dt, input) {
      if (this.state !== 'running') return;
      const delta = clamp(finite(dt, 0), 0, 0.05);
      if (delta <= 0) return;
      const controls = Object.assign({
        x: 0, y: 0, aimX: undefined, aimY: undefined, manualAim: false,
        fire: false, autoFire: true, dash: false, interact: false, heal: false
      }, input || {});
      this.elapsed = Math.min(this.duration, this.elapsed + delta);
      this._updateCombatTimers(delta);
      this._updateThreat(delta);
      this._tryDash(controls);
      this._tryHeal(controls);
      this._updatePlayerTimers(delta);
      this._movePlayer(delta, controls);
      this._updateWeapon(delta, controls);
      this._updateDrone(delta);
      this._updateOrbit(delta);
      this._updateSpawns(delta);
      this._updateTimedSupplies();
      this._updateEnemies(delta);
      this._updateEvolutions(delta);
      this._updateBullets(delta);
      this._cleanupDeadEnemies();
      this._collectDrops();
      this._updateInteraction(delta, controls);
      this._updateEffects(delta);
      if (this.elapsed >= this.duration && this.state === 'running') this.finish(false, 'storm');
      if (this.player.hp <= 0 && this.state === 'running') this.finish(false, 'destroyed');
    }

    finish(success, reason) {
      if (this.state === 'result' && this.result) return this.result;
      const originalBag = {
        scrap: Math.max(0, Math.floor(finite(this.player.bag.scrap, 0))),
        circuit: Math.max(0, Math.floor(finite(this.player.bag.circuit, 0))),
        core: Math.max(0, Math.floor(finite(this.player.bag.core, 0)))
      };
      const kept = success ? Object.assign({}, originalBag) : {
        scrap: Math.floor(originalBag.scrap * 0.35),
        circuit: Math.floor(originalBag.circuit * 0.35),
        core: 0
      };
      const lost = {
        scrap: originalBag.scrap - kept.scrap,
        circuit: originalBag.circuit - kept.circuit,
        core: originalBag.core - kept.core
      };
      this.state = 'result';
      this.result = {
        success: Boolean(success),
        reason: reason || (success ? 'extracted' : 'failed'),
        elapsed: this.elapsed,
        kills: this.kills,
        level: this.player.level,
        bag: originalBag,
        kept,
        lost,
        bossDefeated: Boolean(this.bossDefeated),
        relaysActivated: this.relaysActivated,
        seed: this.seed,
        weapon: this.weapon,
        build: upgradeDefinitions().filter((upgrade) => this._upgrade(upgrade.id) > 0)
          .map((upgrade) => ({ id: upgrade.id, level: this._upgrade(upgrade.id) })),
        medkitsLeft: this.player.medkits
      };
      this.upgradeChoices = [];
      this.trackingGuarantee = null;
      this.interaction = null;
      this.exit.progress = 0;
      this._emit('result', success ? '远征成功，资源已带回营地。' : '远征失败，部分资源遗失。', { result: copy(this.result) });
      return this.result;
    }

    serialize() {
      const snapshot = {
        version: 3,
        seed: this.seed,
        rngState: this._rng.state >>> 0,
        idCounter: this._idCounter,
        state: this.state,
        difficulty: this.difficulty,
        weapon: this.weapon,
        tool: this.tool,
        facilities: copy(this.facilities),
        world: copy(this.world),
        elapsed: this.elapsed,
        duration: this.duration,
        bossUnlockTime: this.bossUnlockTime,
        threat: this.threat,
        player: copy(this.player),
        enemies: copy(this.enemies),
        bullets: copy(this.bullets),
        drops: copy(this.drops),
        containers: copy(this.containers),
        obstacles: copy(this.obstacles),
        relays: copy(this.relays),
        effects: copy(this.effects),
        texts: copy(this.texts),
        exit: copy(this.exit),
        kills: this.kills,
        relaysActivated: this.relaysActivated,
        bossSpawned: this.bossSpawned,
        bossDefeated: this.bossDefeated,
        supplyFlags: copy(this.supplyFlags),
        waveFlags: copy(this.waveFlags),
        combo: this.combo,
        comboTimer: this.comboTimer,
        bestCombo: this.bestCombo,
        overdriveCharge: this.overdriveCharge,
        overdriveTime: this.overdriveTime,
        rerolls: this.rerolls,
        trackedBuild: this.trackedBuild,
        trackingMisses: this.trackingMisses,
        trackingGuarantee: this.trackingGuarantee,
        upgradeChoices: copy(this.upgradeChoices),
        upgrades: copy(this.upgrades),
        result: copy(this.result),
        events: copy(this.events),
        interaction: copy(this.interaction),
        stats: copy(this.stats),
        timers: {
          fire: this._fireTimer,
          hurtCooldown: this._hurtCooldown,
          spawn: this._spawnTimer,
          drone: this._droneTimer,
          regen: this._regenTimer,
          orbit: this._orbitTimer,
          orbitAngle: this._orbitAngle,
          metalstormShots: this._metalstormShots,
          thunder: this._thunderTimer,
          gravity: this._gravityTimer,
          interactionId: this._interactionId,
          interactionKind: this._interactionKind,
          interactionProgress: this._interactionProgress,
          summonNeedsRelease: this._summonNeedsRelease,
          lastDashInput: this._lastDashInput,
          lastHealInput: this._lastHealInput,
          dashDirection: copy(this._dashDirection),
          spawnedOpeningGroup: this._spawnedOpeningGroup
        }
      };
      return snapshot;
    }

    static fromSnapshot(snapshot) {
      const source = migrateSnapshot(snapshot);
      validateSnapshot(source);
      const game = new Game({
        seed: finite(source.seed, Date.now()), weapon: source.weapon, tool: source.tool,
        facilities: source.facilities, difficulty: source.difficulty, world: source.world
      });
      const allowedStates = ['running', 'upgrade', 'result'];
      game.state = allowedStates.indexOf(source.state) >= 0 ? source.state : 'running';
      game.seed = finite(source.seed, game.seed) >>> 0;
      game._rng.state = (finite(source.rngState, game.seed || 0x6d2b79f5) >>> 0) || (game.seed || 0x6d2b79f5);
      game._idCounter = Math.max(0, Math.floor(finite(source.idCounter, game._idCounter)));
      game.duration = Math.max(1, finite(source.duration, game.duration));
      game.elapsed = clamp(finite(source.elapsed, 0), 0, game.duration);
      game.bossUnlockTime = clamp(finite(source.bossUnlockTime, game.bossUnlockTime), 0, game.duration);
      game.threat = clamp(finite(source.threat, 1), 1, 5);
      game.player = Object.assign(game.player, copy(source.player));
      game.player.bag = Object.assign({ scrap: 0, circuit: 0, core: 0 }, source.player.bag || {});
      game.player.maxHp = Math.max(1, finite(game.player.maxHp, 100));
      game.player.hp = clamp(finite(game.player.hp, game.player.maxHp), 0, game.player.maxHp);
      game.player.capacity = Math.max(1, finite(game.player.capacity, 30));
      game.enemies = Array.isArray(source.enemies) ? copy(source.enemies) : [];
      game.bullets = Array.isArray(source.bullets) ? copy(source.bullets) : [];
      game.drops = Array.isArray(source.drops) ? copy(source.drops) : [];
      game.containers = Array.isArray(source.containers) ? copy(source.containers) : game.containers;
      game.obstacles = Array.isArray(source.obstacles) ? copy(source.obstacles) : game.obstacles;
      game.relays = Array.isArray(source.relays) ? copy(source.relays) : game.relays;
      game.effects = Array.isArray(source.effects) ? copy(source.effects) : [];
      game.texts = Array.isArray(source.texts) ? copy(source.texts) : [];
      game.exit = Object.assign(game.exit, copy(source.exit || {}));
      game.kills = Math.max(0, Math.floor(finite(source.kills, 0)));
      game.relaysActivated = clamp(Math.floor(finite(source.relaysActivated, 0)), 0, 3);
      game.bossSpawned = Boolean(source.bossSpawned);
      game.bossDefeated = Boolean(source.bossDefeated);
      game.supplyFlags = {
        '180': Boolean(source.supplyFlags['180']),
        '300': Boolean(source.supplyFlags['300'])
      };
      game.waveFlags = {
        '75': Boolean(source.waveFlags['75']),
        '150': Boolean(source.waveFlags['150']),
        '225': Boolean(source.waveFlags['225']),
        '300': Boolean(source.waveFlags['300'])
      };
      game.combo = Math.max(0, Math.floor(finite(source.combo, 0)));
      game.comboTimer = clamp(finite(source.comboTimer, 0), 0, 4);
      game.bestCombo = Math.max(0, Math.floor(finite(source.bestCombo, 0)));
      game.overdriveCharge = clamp(finite(source.overdriveCharge, 0), 0, 100);
      game.overdriveTime = clamp(finite(source.overdriveTime, 0), 0, 8);
      game.rerolls = Math.max(0, Math.floor(finite(source.rerolls, 2)));
      game.trackedBuild = source.trackedBuild;
      game.trackingMisses = source.trackingMisses;
      game.trackingGuarantee = source.trackingGuarantee;
      game.upgradeChoices = Array.isArray(source.upgradeChoices) ? source.upgradeChoices.slice() : [];
      game.upgrades = Object.assign(game.upgrades, copy(source.upgrades || {}));
      game.result = source.result ? copy(source.result) : null;
      game.events = Array.isArray(source.events) ? copy(source.events) : [];
      game.interaction = source.interaction ? copy(source.interaction) : null;
      game.stats = Object.assign(game.stats, copy(source.stats || {}));
      const timers = source.timers || {};
      game._fireTimer = finite(timers.fire, 0);
      game._hurtCooldown = Math.max(0, finite(timers.hurtCooldown, 0));
      game._spawnTimer = finite(timers.spawn, 1.6);
      game._droneTimer = finite(timers.drone, 1.8);
      game._regenTimer = finite(timers.regen, 0);
      game._orbitTimer = finite(timers.orbit, 0);
      game._orbitAngle = finite(timers.orbitAngle, 0);
      game._metalstormShots = Math.max(0, Math.floor(finite(timers.metalstormShots, 0)));
      game._thunderTimer = Math.max(0, finite(timers.thunder, 2));
      game._gravityTimer = Math.max(0, finite(timers.gravity, 2));
      game._interactionId = timers.interactionId || null;
      game._interactionKind = timers.interactionKind || null;
      game._interactionProgress = clamp(finite(timers.interactionProgress, 0), 0, 1);
      game._summonNeedsRelease = timers.summonNeedsRelease;
      game._lastDashInput = Boolean(timers.lastDashInput);
      game._lastHealInput = Boolean(timers.lastHealInput);
      game._dashDirection = Object.assign({ x: 0, y: -1 }, timers.dashDirection || {});
      game._spawnedOpeningGroup = Boolean(timers.spawnedOpeningGroup);
      return game;
    }
  }

  S.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
})(typeof window !== 'undefined' ? window : globalThis);
