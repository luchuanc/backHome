// 仅为浏览器验收生成独立测试存档；通过 localhost 的游戏导入界面使用，不读取或改写玩家存档。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {} };
require(path.join(root, 'src/data.js'));
require(path.join(root, 'src/store.js'));
const Game = require(path.join(root, 'src/game.js'));
const { Store } = global.Scrap;
const output = path.join(__dirname, 'fixtures');
fs.mkdirSync(output, { recursive: true });
function profile() {
  const p = Store.fresh();
  p.tutorialSeen = true;
  p.stats.runs = 2;
  return p;
}
function quietGame() {
  const game = new Game({ seed: 230923, weapon: 'rivet', tool: 'magnet' });
  game.enemies = [];
  game.bullets = [];
  game._spawnTimer = 999;
  game._spawnedOpeningGroup = true;
  game.events = [];
  return game;
}
function write(name, p, game) {
  if (game) {
    p.suspendedRun = game.serialize();
    Game.fromSnapshot(p.suspendedRun);
  }
  Store.validate(p);
  fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(p, null, 2));
}

write('first-expedition', Store.fresh());

const exchange = quietGame();
exchange.elapsed = 46;
exchange.exit.available = true;
exchange.player.bag = { scrap: 30, circuit: 0, core: 0 };
exchange.overdriveCharge = 100;
exchange._addDrop(exchange.player.x, exchange.player.y, 'scrap', 28, 9);
exchange._addDrop(exchange.player.x, exchange.player.y, 'core', 3, 11);
write('core-exchange', profile(), exchange);

const tech = quietGame();
tech.upgrades.damage = 1;
tech.upgrades.haste = 1;
tech.trackBuild('metalstorm');
tech._gainXp(45);
// 候选符合真实规则，固定三张便于检查最后一个配方卡和首次电场的表达。
tech.upgradeChoices = ['damage', 'capacitor', 'hull'];
write('technology', profile(), tech);

const summon = quietGame();
summon.elapsed = 120;
summon.waveFlags['75'] = true;
summon.relays.forEach(relay => { relay.active = true; relay.progress = 1; });
summon.relaysActivated = 3;
summon.player.x = summon.relays[0].x;
summon.player.y = summon.relays[0].y + 40;
summon.player.level = 4;
summon.upgrades.damage = 2;
summon.upgrades.haste = 1;
write('summon-ready', profile(), summon);

const exit = quietGame();
exit.elapsed = 62;
exit.exit.available = true;
exit.player.x = exit.exit.x;
exit.player.y = exit.exit.y;
exit.player.bag = { scrap: 18, circuit: 3, core: 1 };
exit.player.level = 5;
exit.player.medkits = 1;
exit.player.hp = 76;
exit.upgrades.damage = 2;
exit.upgrades.haste = 1;
exit.upgrades.metalstorm = 1;
const exitProfile = profile();
Store.buy(exitProfile, 'workshop');
write('extraction', exitProfile, exit);

const legacy = profile();
legacy.suspendedRun = exchange.serialize();
legacy.suspendedRun.version = 2;
delete legacy.suspendedRun.trackedBuild;
delete legacy.suspendedRun.trackingMisses;
delete legacy.suspendedRun.trackingGuarantee;
delete legacy.suspendedRun.timers.summonNeedsRelease;
Game.fromSnapshot(legacy.suspendedRun);
write('legacy-v2', legacy);
console.log('已生成 6 份隔离浏览器验收存档：' + output);
