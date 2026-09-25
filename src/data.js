(function () {
  'use strict';
  const S = window.Scrap = window.Scrap || {};
  S.DATA = {
    duration: 600,
    bossUnlockTime: 360,
    world: { w: 2400, h: 1800 },
    weapons: [
      { id: 'rivet', name: '铆钉步枪', tag: '精准 · 均衡', description: '回收员的老伙计。稳定射速与射程，适合边移动边清理废墟。', damage: 21, interval: 0.34, speed: 670, range: 590, pellets: 1, spread: 0.035, pierce: 0, unlock: 0, color: '#f6c76b' },
      { id: 'scatter', name: '破门霰弹', tag: '近距 · 爆发', description: '一次发射五枚破片。靠近目标，让每一发废铁物尽其用。', damage: 14, interval: 0.85, speed: 540, range: 330, pellets: 5, spread: 0.4, pierce: 0, unlock: 1, color: '#f39a6d' },
      { id: 'arc', name: '电弧发射器', tag: '连锁 · 控场', description: '电流会跃向附近敌人，适合处理成群的失控机械。', damage: 26, interval: 0.65, speed: 780, range: 480, pellets: 1, spread: 0, pierce: 0, unlock: 2, color: '#7bddcf' },
      { id: 'saw', name: '回旋圆锯', tag: '穿透 · 回收', description: '发射穿透敌人的圆锯，随后飞回身边，去与回都能造成伤害。', damage: 32, interval: 0.95, speed: 400, range: 440, pellets: 1, spread: 0, pierce: 8, unlock: 3, color: '#cfdf8c' }
    ],
    tools: [
      { id: 'magnet', name: '磁力背包', description: '拾取范围扩大，散落的材料自动靠拢。', icon: 'magnet' },
      { id: 'drone', name: '伴飞无人机', description: '定时攻击附近敌人，多一位安静可靠的伙伴。', icon: 'drone' },
      { id: 'scanner', name: '地质探测器', description: '开箱获得额外材料，适合以回收为主的远征。', icon: 'radar' }
    ],
    upgrades: [
      { id: 'damage', name: '钨钢弹芯', description: '武器伤害 +22%。', tag: '火力', max: 5 },
      { id: 'haste', name: '超频扳机', description: '射击间隔缩短 14%。', tag: '火力', max: 4 },
      { id: 'speed', name: '液压助力', description: '移动速度 +12%。', tag: '机动', max: 3 },
      { id: 'hull', name: '复合装甲', description: '生命上限 +25，并恢复 25 点生命。', tag: '生存', max: 4 },
      { id: 'magnet', name: '强磁线圈', description: '拾取范围扩大 45。', tag: '回收', max: 3 },
      { id: 'pierce', name: '贯穿改装', description: '弹道额外穿透 1 个目标。', tag: '火力', max: 3 },
      { id: 'ricochet', name: '分裂破片', description: '命中时释放额外伤害破片。', tag: '火力', max: 2 },
      { id: 'chain', name: '跃迁电容', description: '命中时电流连接额外敌人。', tag: '电能', max: 3 },
      { id: 'orbit', name: '废铁卫星', description: '增加一枚环绕自身、伤害敌人的废铁。', tag: '防御', max: 3 },
      { id: 'salvage', name: '精细拆解', description: '搜集容器获得更多材料。', tag: '回收', max: 3 },
      { id: 'regen', name: '纳米修补', description: '持续缓慢恢复生命。', tag: '生存', max: 3 },
      { id: 'crit', name: '弱点识别', description: '暴击概率 +12%，暴击造成双倍伤害。', tag: '火力', max: 4 },
      { id: 'dash', name: '涡轮冲刺', description: '冲刺冷却缩短，危急时更快脱身。', tag: '机动', max: 3 },
      { id: 'freeze', name: '冷凝剂', description: '命中使敌人减速。', tag: '控场', max: 3 },
      { id: 'capacitor', name: '应急电场', description: '冲刺时释放电场，伤害附近敌人。', tag: '电能', max: 3 },
      { id: 'leech', name: '残骸修复', description: '每击败数个敌人，利用残骸恢复生命。', tag: '生存', max: 3 },
      { id: 'metalstorm', name: '金属风暴', description: '每三次射击追加两枚侧翼弹，造成主弹 70% 伤害。', tag: '进化', max: 1, requires: [{ id: 'damage', level: 2 }, { id: 'haste', level: 1 }] },
      { id: 'thunder', name: '雷暴核心', description: '每 2 秒落雷，打击 250 范围内最多 5 个目标。', tag: '进化', max: 1, requires: [{ id: 'chain', level: 2 }, { id: 'capacitor', level: 1 }] },
      { id: 'shatter', name: '碎冰连爆', description: '击破减速目标，引爆 120 范围的寒冰冲击。', tag: '进化', max: 1, requires: [{ id: 'freeze', level: 2 }, { id: 'ricochet', level: 1 }] },
      { id: 'gravity', name: '引力绞盘', description: '每 2 秒牵引 220 范围内的机械，再用环绕锯刃收割。', tag: '进化', max: 1, requires: [{ id: 'orbit', level: 2 }, { id: 'magnet', level: 1 }] }
    ],
    // 进化配方与模拟层共用升级定义，界面不会自行猜测解锁条件。
    builds: [
      { id: 'metalstorm', name: '弹幕工程', color: '#f2b958', glyph: 'damage', flavor: '稳步加速，把整条街变成弹幕。', members: ['damage','haste','pierce','crit'], result: '每三次射击追加双侧弹' },
      { id: 'thunder', name: '电能回路', color: '#6fe2e1', glyph: 'chain', flavor: '让每次命中，变成下一次连锁。', members: ['chain','capacitor','dash'], result: '周期落雷，最多连击五个目标' },
      { id: 'shatter', name: '冰爆装置', color: '#9ecdf5', glyph: 'freeze', flavor: '先冻结节奏，再引爆整个敌群。', members: ['freeze','ricochet','speed'], result: '击破减速目标，触发范围爆炸' },
      { id: 'gravity', name: '引力回收', color: '#c2a4f4', glyph: 'orbit', flavor: '把敌人拉过来，让废铁转起来。', members: ['orbit','magnet','salvage'], result: '范围牵引，环绕锯刃近身收割' }
    ],
    facilities: [
      { id: 'workshop', name: '武器工作台', description: '每级解锁一把武器，并提升基础伤害。', max: 3, costs: [{ scrap: 24, circuit: 3, core: 0 }, { scrap: 48, circuit: 7, core: 1 }, { scrap: 75, circuit: 10, core: 2 }] },
      { id: 'storage', name: '扩容仓库', description: '每级增加 12 格远征背包容量。', max: 3, costs: [{ scrap: 18, circuit: 2, core: 0 }, { scrap: 35, circuit: 4, core: 0 }, { scrap: 55, circuit: 7, core: 1 }] },
      { id: 'infirmary', name: '医疗站', description: '每级增加 15 点最大生命。出发时补满急救包。', max: 3, costs: [{ scrap: 20, circuit: 2, core: 0 }, { scrap: 38, circuit: 5, core: 0 }, { scrap: 60, circuit: 8, core: 1 }] },
      { id: 'beacon', name: '撤离信标', description: '每级加快撤离，并提升回收效率。', max: 3, costs: [{ scrap: 22, circuit: 3, core: 0 }, { scrap: 42, circuit: 5, core: 1 }, { scrap: 65, circuit: 9, core: 1 }] }
    ],
    resourceNames: { scrap: '废铁', circuit: '电路', core: '能源核心' },
    storyCost: { scrap: 120, circuit: 12, core: 3 }
  };
})();
