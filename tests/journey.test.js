const assert = require('node:assert/strict');
const test = require('node:test');

global.window = global;
require('../src/data.js');
const Game = require('../src/game.js');

function approach(game, target) {
  const dx = target.x - game.player.x;
  const dy = target.y - game.player.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { x: 0, y: 0, distance: 0 };
  return { x: dx / length, y: dy / length, distance: length };
}

function blockedAt(game, x, y, radius) {
  if (x < radius || y < radius || x > game.world.w - radius || y > game.world.h - radius) return true;
  return game.obstacles.some((obstacle) => {
    const nearestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.w));
    const nearestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.h));
    return Math.hypot(x - nearestX, y - nearestY) < radius;
  });
}

function segmentHitsRect(x1, y1, x2, y2, rect, padding) {
  const p = padding || 0;
  const left = rect.x - p;
  const right = rect.x + rect.w + p;
  const top = rect.y - p;
  const bottom = rect.y + rect.h + p;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let enter = 0;
  let leave = 1;
  const clip = (direction, distanceToEdge) => {
    if (Math.abs(direction) < 1e-9) return distanceToEdge >= 0;
    const ratio = distanceToEdge / direction;
    if (direction < 0) {
      if (ratio > leave) return false;
      enter = Math.max(enter, ratio);
    } else {
      if (ratio < enter) return false;
      leave = Math.min(leave, ratio);
    }
    return true;
  };
  return clip(-dx, x1 - left) && clip(dx, right - x1) && clip(-dy, y1 - top) && clip(dy, bottom - y1);
}

function clearShot(game, target) {
  return !game.obstacles.some((obstacle) => segmentHitsRect(game.player.x, game.player.y, target.x, target.y, obstacle, 2));
}

// 测试控制器也只读取公开地图碰撞体，用网格绕过墙体，模拟玩家自己规划路线。
function findPath(game, target) {
  const cell = 60;
  const cols = Math.ceil(game.world.w / cell);
  const rows = Math.ceil(game.world.h / cell);
  const radius = game.player.r + 8;
  const toCell = (x, y) => ({ x: Math.max(0, Math.min(cols - 1, Math.floor(x / cell))), y: Math.max(0, Math.min(rows - 1, Math.floor(y / cell))) });
  const start = toCell(game.player.x, game.player.y);
  const goal = toCell(target.x, target.y);
  const key = (x, y) => `${x},${y}`;
  const free = (x, y) => !blockedAt(game, x * cell + cell / 2, y * cell + cell / 2, radius);
  const nearestFree = (origin) => {
    if (free(origin.x, origin.y)) return origin;
    for (let d = 1; d < 8; d += 1) {
      for (let y = origin.y - d; y <= origin.y + d; y += 1) {
        for (let x = origin.x - d; x <= origin.x + d; x += 1) {
          if (x >= 0 && x < cols && y >= 0 && y < rows && free(x, y)) return { x, y };
        }
      }
    }
    return origin;
  };
  const first = nearestFree(start);
  const last = nearestFree(goal);
  const queue = [first];
  const previous = new Map([[key(first.x, first.y), null]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (queue.length) {
    queue.sort((a, b) => (Math.abs(a.x - last.x) + Math.abs(a.y - last.y)) - (Math.abs(b.x - last.x) + Math.abs(b.y - last.y)));
    const current = queue.shift();
    if (current.x === last.x && current.y === last.y) break;
    for (const [dx, dy] of directions) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || !free(x, y)) continue;
      if (dx && dy && (!free(current.x + dx, current.y) || !free(current.x, current.y + dy))) continue;
      const nextKey = key(x, y);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, current);
      queue.push({ x, y });
    }
  }
  const path = [];
  let cursor = last;
  while (cursor) {
    path.unshift({ x: cursor.x * cell + cell / 2, y: cursor.y * cell + cell / 2 });
    cursor = previous.get(key(cursor.x, cursor.y));
  }
  path.push({ x: target.x, y: target.y });
  return path;
}

function nearestEnemy(game) {
  return game.enemies.filter((enemy) => enemy.hp > 0).reduce((best, enemy) => {
    if (!best) return enemy;
    return Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y) < Math.hypot(best.x - game.player.x, best.y - game.player.y) ? enemy : best;
  }, null);
}

function follow(game, key, target, pathState, frame, refreshEvery) {
  if (pathState.key !== key || !pathState.path.length || (refreshEvery && frame % refreshEvery === 0)) {
    pathState.key = key;
    pathState.path = findPath(game, target);
  }
  while (pathState.path.length > 1 && approach(game, pathState.path[0]).distance < 34) pathState.path.shift();
  return pathState.path[0] || target;
}

function inputFor(game, desired, frame, extra) {
  let move = approach(game, desired);
  const enemy = nearestEnemy(game);
  const enemyDistance = enemy ? Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y) : Infinity;
  // 敌人贴近时先拉开距离，避免测试控制器靠墙站桩换血；移动仍由 update 处理碰撞。
  if (enemy && enemyDistance < 135) move = approach(game, {
    x: game.player.x * 2 - enemy.x,
    y: game.player.y * 2 - enemy.y
  });
  const dash = Boolean(extra && extra.interact) ? false : (enemyDistance < 150 ? frame % 23 === 0 : frame % 53 === 0);
  const heal = game.player.hp < game.player.maxHp * 0.72 && game.player.medkits > 0 && frame % 19 === 0;
  return Object.assign({
    x: move.x,
    y: move.y,
    aimX: extra && extra.aimX,
    aimY: extra && extra.aimY,
    autoFire: true,
    dash,
    heal
  }, extra || {});
}

function runJourney(seed, options) {
  const opts = options || {};
  const game = new Game({
    seed,
    weapon: opts.weapon || 'rivet',
    tool: opts.tool || 'magnet',
    facilities: opts.facilities || {}
  });
  let phase = 'relays';
  let frame = 0;
  let pathState = { key: null, path: [] };
  let patrolIndex = 0;
  let lootFrames = 0;
  let bossPosition = null;
  const patrol = [
    { x: 2080, y: 560 }, { x: 2190, y: 900 }, { x: 1780, y: 1120 },
    { x: 1350, y: 900 }, { x: 980, y: 1450 }, { x: 520, y: 1420 },
    { x: 420, y: 820 }, { x: 900, y: 520 }
  ];
  const maxFrames = opts.maxFrames || 14000;

  while (frame < maxFrames && game.state !== 'result') {
    if (game.state === 'upgrade') {
      assert.ok(game.upgradeChoices.length > 0, '升级状态必须提供有效候选');
      const priority = ['damage', 'haste', 'hull', 'speed', 'freeze', 'pierce', 'crit', 'leech', 'regen', 'dash', 'capacitor', 'chain', 'magnet', 'orbit', 'salvage', 'ricochet'];
      const choice = priority.find((id) => game.upgradeChoices.indexOf(id) >= 0) || game.upgradeChoices[0];
      assert.equal(game.chooseUpgrade(choice), true);
      continue;
    }
    if (game.state !== 'running') break;

    if (phase === 'relays') {
      const relay = game.relays.find((item) => !item.active);
      if (!relay) {
        phase = 'wait';
        pathState = { key: null, path: [] };
        continue;
      }
      const waypoint = follow(game, `relay:${relay.id}`, relay, pathState, frame, 90);
      const move = approach(game, waypoint);
      const interact = Math.hypot(relay.x - game.player.x, relay.y - game.player.y) <= relay.r + game.player.r + 9;
      game.update(0.05, inputFor(game, waypoint, frame, {
        aimX: relay.x,
        aimY: relay.y,
        interact
      }));
      if (relay.active) pathState = { key: null, path: [] };
    } else if (phase === 'wait') {
      if (game.bossSpawned) {
        phase = 'boss';
        pathState = { key: null, path: [] };
        continue;
      }
      // 先搜集公开地图中的未开箱子；3/5 分钟补给箱加入同一列表，确保新目标可被真实走到。
      const container = game.containers
        .filter((item) => !item.opened)
        .sort((a, b) => Math.hypot(a.x - game.player.x, a.y - game.player.y) - Math.hypot(b.x - game.player.x, b.y - game.player.y))[0];
      let target;
      let key;
      let interact = false;
      if (container) {
        target = container;
        key = `container:${container.id}`;
        interact = Math.hypot(container.x - game.player.x, container.y - game.player.y) <= container.r + game.player.r + 9;
      } else {
        target = patrol[patrolIndex % patrol.length];
        key = `patrol:${patrolIndex % patrol.length}`;
        if (Math.hypot(target.x - game.player.x, target.y - game.player.y) < 55) {
          patrolIndex += 1;
          pathState = { key: null, path: [] };
          target = patrol[patrolIndex % patrol.length];
          key = `patrol:${patrolIndex % patrol.length}`;
        }
      }
      const waypoint = follow(game, key, target, pathState, frame, 100);
      game.update(0.05, inputFor(game, waypoint, frame, {
        aimX: target.x,
        aimY: target.y,
        interact
      }));
    } else if (phase === 'boss') {
      const boss = game.enemies.find((enemy) => enemy.type === 'boss' && enemy.hp > 0);
      if (!boss) {
        if (game.bossDefeated) {
          phase = 'loot';
          pathState = { key: null, path: [] };
          lootFrames = 0;
        } else {
          game.update(0.05, inputFor(game, patrol[patrolIndex % patrol.length], frame));
        }
      } else {
        bossPosition = { x: boss.x, y: boss.y };
        const bossDistance = Math.hypot(boss.x - game.player.x, boss.y - game.player.y);
        let desired;
        // 先绕开建筑获得真实视线；隔墙横移会让射击停摆，也会把玩家困在同一条走廊。
        if (!clearShot(game, boss) || bossDistance > 430) {
          desired = follow(game, `boss:${boss.id}`, boss, pathState, frame, 45);
        } else if (bossDistance < 235) {
          desired = { x: game.player.x * 2 - boss.x, y: game.player.y * 2 - boss.y };
        } else {
          // 在中距离横向移动，持续射击并避开 Boss 预警弹。
          desired = { x: game.player.x - (boss.y - game.player.y), y: game.player.y + (boss.x - game.player.x) };
        }
        game.update(0.05, inputFor(game, desired, frame, { aimX: boss.x, aimY: boss.y }));
      }
    } else if (phase === 'loot') {
      lootFrames += 1;
      const target = bossPosition || game.player;
      const waypoint = follow(game, 'boss-loot', target, pathState, frame, 80);
      game.update(0.05, inputFor(game, waypoint, frame));
      // 模拟玩家确认明确的核心交换；走位、容量和掉落仍完全由真实战斗规则处理。
      const exchange = game.getCoreExchange();
      if (exchange) assert.equal(game.exchangeCore(exchange.dropId), true);
      const nearbyDrop = game.drops.some((drop) => Math.hypot(drop.x - game.player.x, drop.y - game.player.y) < 120);
      if ((lootFrames > 100 && !nearbyDrop) || lootFrames > 240) {
        phase = 'exit';
        pathState = { key: null, path: [] };
      }
    } else {
      const waypoint = follow(game, 'exit', game.exit, pathState, frame, 100);
      const interact = Math.hypot(game.exit.x - game.player.x, game.exit.y - game.player.y) <= game.exit.r + game.player.r + 9;
      game.update(0.05, inputFor(game, waypoint, frame, {
        aimX: game.exit.x,
        aimY: game.exit.y,
        interact
      }));
    }
    frame += 1;
  }
  return { game, phase, frame, maxHpSeen: game.player.maxHp, bossPosition };
}

function summary(item) {
  return {
    seed: item.game.seed,
    success: Boolean(item.game.result && item.game.result.success),
    reason: item.game.result && item.game.result.reason,
    phase: item.phase,
    seconds: Number(item.game.elapsed.toFixed(1)),
    relays: item.game.relaysActivated,
    boss: item.game.bossDefeated,
    kills: item.game.kills,
    level: item.game.player.level,
    bestCombo: item.game.bestCombo,
    hp: Math.round(item.game.player.hp),
    healing: Math.round(item.game.stats.healing)
  };
}

test('默认装备至少有一条真实移动通关路线，并经历等待期与强化', () => {
  const seeds = [3, 17, 91, 1234];
  const results = seeds.map((seed) => runJourney(seed));
  console.log('[journey-default]', JSON.stringify(results.map(summary)));
  const success = results.filter((item) => item.game.result && item.game.result.success);
  assert.ok(success.length >= 1, `默认装备应至少有一条通关路线：${success.length}/${seeds.length}`);
  for (const item of success) {
    assert.equal(item.game.result.relaysActivated, 3);
    assert.equal(item.game.result.bossDefeated, true);
    assert.equal(item.game.result.reason, 'extracted');
    assert.ok(item.game.result.kept.core >= 3, '击破守卫后能通过核心交换带回至少三枚核心');
    assert.ok(item.game.result.elapsed >= 360, 'Boss 解锁前必须真实等待到第六分钟');
    assert.ok(item.game.player.level >= 2, '完整远征应通过击杀获得至少一次强化');
    assert.ok(item.game.bestCombo > 0, '完整远征应实际形成连击');
    assert.ok(Object.values(item.game.waveFlags).every(Boolean), '完整远征应经历四个定时清剿波次');
  }
});

test('设施二级与升级组合可以在多枚种子下完成 Boss 路线', () => {
  const facilities = { workshop: 2, storage: 2, infirmary: 2, beacon: 2 };
  const seeds = [6, 8, 10];
  const results = seeds.map((seed) => runJourney(seed, { facilities, weapon: 'rivet', tool: 'magnet' }));
  console.log('[journey-facility2]', JSON.stringify(results.map(summary)));
  const success = results.filter((item) => item.game.result && item.game.result.success);
  assert.ok(success.length >= 2, `设施二级通关率过低：${success.length}/${seeds.length}`);
  for (const item of success) {
    assert.equal(item.game.result.relaysActivated, 3);
    assert.equal(item.game.result.bossDefeated, true);
    assert.equal(item.game.result.reason, 'extracted');
    assert.ok(item.game.result.elapsed >= 360);
    assert.ok(item.game.stats.healing > 0, '远征控制器应在受伤后使用急救或恢复强化');
    assert.ok(item.game.bestCombo > 0);
  }
});
