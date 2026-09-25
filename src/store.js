(function () {
  'use strict';
  const S = window.Scrap;
  const KEY = 'last-reclamation-station-v1';
  const fresh = () => ({ version: 1, resources: { scrap: 30, circuit: 4, core: 0 }, facilities: { workshop: 0, storage: 0, infirmary: 0, beacon: 0 }, selectedWeapon: 'rivet', selectedTool: 'magnet', settings: { music: 0.38, sfx: 0.68, muted: false, reducedMotion: false, autoFire: true }, stats: { runs: 0, escapes: 0, kills: 0, bossKills: 0, bestLoot: 0, time: 0 }, history: [], storyComplete: false, tutorialSeen: false, suspendedRun: null });
  function integer(n, max) { return Number.isInteger(n) && n >= 0 && n <= max; }
  // 存档只接受本版本明确的数据结构，损坏数据不能进入战斗和资源计算。
  function validate(p) {
    if (!p || p.version !== 1 || !p.resources || !p.facilities || !p.stats || !p.settings) throw new Error('存档版本或格式不正确。');
    for (const key of ['scrap', 'circuit', 'core']) if (!integer(p.resources[key], 10000000)) throw new Error('存档资源数据无效。');
    for (const f of S.DATA.facilities) if (!integer(p.facilities[f.id], f.max)) throw new Error('存档设施数据无效。');
    if (!S.DATA.weapons.some(w => w.id === p.selectedWeapon && w.unlock <= p.facilities.workshop) || !S.DATA.tools.some(t => t.id === p.selectedTool)) throw new Error('存档装备数据无效。');
    for (const key of ['runs', 'escapes', 'kills', 'bossKills', 'bestLoot']) if (!integer(p.stats[key], 100000000)) throw new Error('存档记录无效。');
    if (!Number.isFinite(p.stats.time) || p.stats.time < 0) throw new Error('存档时间无效。');
    for (const key of ['music', 'sfx']) if (!Number.isFinite(p.settings[key]) || p.settings[key] < 0 || p.settings[key] > 1) throw new Error('音量数据无效。');
    for (const key of ['muted', 'reducedMotion', 'autoFire']) if (typeof p.settings[key] !== 'boolean') throw new Error('设置数据无效。');
    if (typeof p.storyComplete !== 'boolean' || typeof p.tutorialSeen !== 'boolean' || !Array.isArray(p.history) || p.history.length > 20) throw new Error('存档记录格式无效。');
    for (const h of p.history) {
      if (!h || typeof h.success !== 'boolean' || typeof h.date !== 'string' || h.date.length > 50 || !Number.isFinite(h.elapsed) || h.elapsed < 0 || !integer(h.kills, 1000000) || !h.kept) throw new Error('远征日志格式无效。');
      for (const key of ['scrap', 'circuit', 'core']) if (!integer(h.kept[key], 10000000)) throw new Error('远征日志资源无效。');
      // 已发布的旧日志没有构筑摘要；新日志的三个字段必须成组完整，不能猜测装备或科技。
      if (['weapon', 'build', 'medkitsLeft'].some(key => Object.prototype.hasOwnProperty.call(h, key))) {
        if (!S.DATA.weapons.some(w => w.id === h.weapon) || !Array.isArray(h.build) || h.build.length > S.DATA.upgrades.length || !integer(h.medkitsLeft, 1000)) throw new Error('远征构筑记录无效。');
        const ids = new Set();
        for (const item of h.build) {
          const definition = item && S.DATA.upgrades.find(u => u.id === item.id);
          if (!definition || ids.has(item.id) || !integer(item.level, definition.max) || item.level < 1) throw new Error('远征科技记录无效。');
          ids.add(item.id);
        }
      }
    }
    if (p.suspendedRun !== null && (typeof p.suspendedRun !== 'object' || !p.suspendedRun.player)) throw new Error('中断远征数据无效。');
    return p;
  }
  S.Store = {
    error: null, fresh, validate,
    load() {
      try { const raw = localStorage.getItem(KEY); return raw ? validate(JSON.parse(raw)) : fresh(); }
      catch (e) { this.error = '无法读取本地存档：' + e.message + ' 你仍可游玩并导出存档。'; return fresh(); }
    },
    save(p) {
      try { localStorage.setItem(KEY, JSON.stringify(p)); this.error = null; return true; }
      catch (e) { this.error = '自动保存失败，请在设置中导出存档，避免进度丢失。'; return false; }
    },
    parse(raw) { if (raw.length > 5000000) throw new Error('存档文件过大。'); return validate(JSON.parse(raw)); },
    canAfford(p, cost) { return Object.keys(cost).every(k => p.resources[k] >= cost[k]); },
    nextGoal(p, cargo) {
      // 先推荐眼下可建的设施；都买不起时，选缺少背包格最少的一项。远征背包只参与预测，不提前入库。
      const keys = ['scrap', 'circuit', 'core'];
      const priority = ['workshop', 'storage', 'infirmary', 'beacon'];
      const candidates = S.DATA.facilities.filter(f => p.facilities[f.id] < f.max).map(f => {
        const targetLevel = p.facilities[f.id] + 1;
        const cost = { ...f.costs[targetLevel - 1] };
        const missing = Object.fromEntries(keys.map(key => [key, Math.max(0, cost[key] - p.resources[key] - (cargo ? cargo[key] : 0))]));
        const weapon = f.id === 'workshop' ? S.DATA.weapons.find(w => w.unlock === targetLevel) : null;
        return { kind: 'facility', id: f.id, name: f.name, targetLevel, cost, missing, affordable: keys.every(key => missing[key] === 0), unlockWeapon: weapon ? { id: weapon.id, name: weapon.name } : null, description: f.description };
      });
      const gap = g => g.missing.scrap + g.missing.circuit + g.missing.core * 3;
      candidates.sort((a, b) => Number(b.affordable) - Number(a.affordable) || gap(a) - gap(b) || priority.indexOf(a.id) - priority.indexOf(b.id));
      return candidates[0] || null;
    },
    buy(p, id) {
      const f = S.DATA.facilities.find(f => f.id === id);
      if (!f || p.facilities[id] >= f.max) return false;
      const cost = f.costs[p.facilities[id]];
      if (!this.canAfford(p, cost)) return false;
      for (const k of Object.keys(cost)) p.resources[k] -= cost[k];
      p.facilities[id]++; this.save(p); return true;
    },
    settle(p, r) {
      for (const k of ['scrap', 'circuit', 'core']) p.resources[k] += r.kept[k];
      p.stats.runs++; p.stats.escapes += r.success ? 1 : 0; p.stats.kills += r.kills;
      p.stats.bossKills += r.bossDefeated ? 1 : 0; p.stats.time += r.elapsed;
      p.stats.bestLoot = Math.max(p.stats.bestLoot, r.kept.scrap + r.kept.circuit + r.kept.core * 3);
      const entry = { success: r.success, elapsed: r.elapsed, kills: r.kills, date: new Date().toISOString(), kept: { ...r.kept }, bossDefeated: r.bossDefeated };
      // v1/v2 结算快照可继续入库；只有新规则提供了完整摘要时才写入日志。
      if (Object.prototype.hasOwnProperty.call(r, 'weapon') && Array.isArray(r.build) && Object.prototype.hasOwnProperty.call(r, 'medkitsLeft')) {
        entry.weapon = r.weapon;
        entry.build = r.build.map(item => ({ id: item.id, level: item.level }));
        entry.medkitsLeft = r.medkitsLeft;
      }
      p.history.unshift(entry);
      p.history = p.history.slice(0, 20); p.suspendedRun = null; this.save(p);
    }
  };
})();
