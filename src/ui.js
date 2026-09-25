(function () {
  'use strict';
  const S = window.Scrap, D = S.DATA;
  const $ = id => document.getElementById(id);
  // 全部图标取自 imagegen 图集；布局和文字继续保持真实可交互。
  const iconCells = { home:['interface',0],settings:['interface',1],sound:['interface',2],mute:['interface',3],pause:['interface',4],map:['interface',5],book:['interface',6],lock:['interface',7],arrow:['interface',8],close:['interface',9],check:['interface',10],download:['interface',11],beacon:['interface',12],workshop:['interface',13],storage:['interface',14],infirmary:['interface',15],rivet:['combat',7],scatter:['combat',8],arc:['combat',9],saw:['combat',10],scrap:['combat',11],circuit:['combat',12],core:['combat',13],drone:['combat',6],radar:['interface',5],skull:['combat',1],target:['tech',11],flag:['interface',12] };
  ['damage','haste','speed','hull','magnet','pierce','ricochet','chain','orbit','salvage','regen','crit','dash','freeze','capacitor','leech'].forEach((id,i) => { iconCells[id] = ['tech',i]; });
  ['metalstorm','thunder','shatter','gravity'].forEach((id,i) => { iconCells[id] = ['evolutions',i]; });
  function icon(key, size = 22) {
    const [atlas, cell] = iconCells[key] || iconCells.circuit, n = atlas === 'evolutions' ? 2 : 4;
    return `<span class="art-icon art-${atlas}" aria-hidden="true" style="width:${size}px;height:${size}px;background-position:${cell % n / (n - 1) * 100}% ${Math.floor(cell / n) / (n - 1) * 100}%"></span>`;
  }
  function installArt() {
    // 大图的 data URL 会超过浏览器 CSS 变量长度限制，转为本页有效的 Blob URL，离线包也能直接加载。
    const artURL = src => {
      const bytes = Uint8Array.from(atob(src.slice('data:image/png;base64,'.length)), c => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    };
    for (const [name, src] of Object.entries(S.uiArt || {})) document.documentElement.style.setProperty('--art-' + name, `url("${artURL(src)}")`);
    if (S.worldArt) document.documentElement.style.setProperty('--art-combat', `url("${artURL(S.worldArt.combat)}")`);
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon && S.uiArt?.interface) favicon.href = S.uiArt.interface;
  }
  const esc = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const formatTime = t => `${Math.floor(Math.max(0, t) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, t) % 60).toString().padStart(2, '0')}`;
  let profile = S.Store.load(), view = 'title', campTab = 'facilities', game = null, paused = false, modalType = '', returnModal = '', resultSettled = false;
  const renderer = new S.Renderer($('world')), audio = new S.AudioEngine();
  let frame = 0, previous = performance.now(), saveClock = 0, toastTimer, upgradeSignature = '', aim = { x: 0, y: 0 }, pointer = { x: 0, y: 0 }, mouseDown = false, touchMove = { x: 0, y: 0 }, touchInteract = false;
  const keys = new Set(), actions = { dash: false, heal: false };
  const touchPointers = new Map();
  let mobileBannerKey = '', mobileBannerUntil = 0;
  let lastInstallFeedback = '', exchangeReturnPause = false;
  let viewport, isTouch = matchMedia('(pointer:coarse)').matches;
  let mousePath = [], interactAssist = false, assistTarget = null;
  function effectiveAutoFire() { return profile.settings.autoFire || isTouch; }
  function applySettings() { audio.apply(profile.settings); renderer.setReducedMotion(profile.settings.reducedMotion); document.body.classList.toggle('reduced-motion', profile.settings.reducedMotion); }
  function save() { S.Store.save(profile); updateSaveWarning(); }
  function updateSaveWarning() { $('save-warning').hidden = !S.Store.error; $('save-warning').textContent = S.Store.error || ''; }
  function toast(text, duration = 3000) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), duration); }
  function clearInput() { keys.clear(); mouseDown = false; touchMove.x = 0; touchMove.y = 0; touchInteract = false; actions.dash = false; actions.heal = false; mousePath = []; interactAssist = false; assistTarget = null; resetJoystick(); resetTouchPointers(); }
  function setView(v) { view = v; document.body.dataset.view = v; $('hud').hidden = v !== 'run'; $('touch-controls').hidden = v !== 'run' || !isTouch; clearInput(); }
  function resources(r = profile.resources, labels = true) { return `<div class="resource-strip">${['scrap', 'circuit', 'core'].map(k => `<span class="resource" title="${D.resourceNames[k]}">${icon(k, 18)}<span>${r[k]}</span>${labels ? `<small>${D.resourceNames[k]}</small>` : ''}</span>`).join('')}</div>`; }
  function resourceGap(missing) { return ['scrap', 'circuit', 'core'].filter(k => missing[k] > 0).map(k => `${missing[k]} ${D.resourceNames[k]}`).join('、'); }
  function goalCopy(goal, inRun = false) {
    if (!goal) return '营地设施已全部升级，可继续收集灯塔材料或尝试不同科技。';
    const target = `${goal.name} LV.${goal.targetLevel}`;
    return goal.affordable ? `${inRun ? '回营可升级' : '现在可升级'}${target}${goal.unlockWeapon ? `，解锁${goal.unlockWeapon.name}` : ''}` : `${target}还缺 ${resourceGap(goal.missing)}${inRun ? '，带回后继续建设' : ''}`;
  }
  function bossReadyCopy() {
    const nextSupply = [180, 300].find(t => t > game.elapsed);
    return `当前 LV.${game.player.level} · ${nextSupply ? `下批补给 ${formatTime(nextSupply - game.elapsed)}` : '补给均已投放'} · ${game.elapsed < D.bossUnlockTime ? `${formatTime(D.bossUnlockTime - game.elapsed)} 后自动唤醒` : '守卫信号已就绪'}`;
  }
  // 结算和日志共用真实安装记录；进化优先，其余按等级排列，最多显示四项。
  function keyBuild(build) {
    return build.slice().sort((a, b) => Number(!!D.upgrades.find(u => u.id === b.id).requires) - Number(!!D.upgrades.find(u => u.id === a.id).requires) || b.level - a.level).slice(0, 4);
  }
  function title() {
    setView('title'); audio.setMode('camp');
    $('screen').innerHTML = `<div class="game-version">${icon('home', 18)} LAST SALVAGE · 1.3 / 突围行动</div><main class="game-title"><div class="game-title-stamp">生 存 · 拾 荒 · 重 建</div><h1>最后一家<span>回收站</span></h1><div class="game-title-rule"><i></i><span>THE LAST SALVAGE</span><i></i></div></main><nav class="main-menu" aria-label="游戏主菜单"><button class="menu-main" data-action="camp"><span class="menu-cursor">▶</span>${profile.stats.runs || profile.tutorialSeen ? '继续游戏' : '开始游戏'}<span class="menu-key">ENTER</span></button><button data-action="help">生存手册</button><button data-action="settings">游戏设置</button><small>单机冒险 · 本地自动保存</small></nav><div class="title-bottom-line">风暴之外，还有一盏为你留着的灯。</div>`;
  }
  function costHTML(cost) { return `<div class="cost">${Object.keys(cost).filter(k => cost[k] > 0).map(k => `<span class="${profile.resources[k] < cost[k] ? 'insufficient' : ''}" title="${D.resourceNames[k]}">${icon(k, 12)}${cost[k]}</span>`).join('')}</div>`; }
  function facilityHTML() {
    return `<p class="section-caption">把带回来的零件，变成下一次出发的底气。</p>${D.facilities.map(f => {
      const lv = profile.facilities[f.id], max = lv >= f.max, cost = f.costs[lv];
      return `<article class="facility"><div class="facility-icon">${icon(f.id, 31)}</div><div><h3>${f.name}<small>LV. ${lv}</small></h3><p>${f.description}</p>${max ? '<div class="cost green">已完成全部升级</div>' : costHTML(cost)}<div class="level-pips">${[1, 2, 3].map(n => `<i class="${n <= lv ? 'on' : ''}"></i>`).join('')}</div></div><button class="purchase" data-action="buy" data-id="${f.id}" ${max || !S.Store.canAfford(profile, cost) ? 'disabled' : ''} aria-label="升级${f.name}">${max ? '已满级' : '升级 ↗'}</button></article>`;
    }).join('')}<div class="story-panel"><h3>${icon('beacon', 16)} ${profile.storyComplete ? '北境灯塔已经重燃' : '长期目标 · 重燃北境灯塔'}</h3><p>${profile.storyComplete ? '信号穿过了风暴。这里不再是一座孤岛。继续远征，给更多归来的人留下物资。' : '击败废墟守卫，带回能源核心，向荒野发出第一束安全信号。'}</p>${profile.storyComplete ? '<span class="tag green">故事已完成 · 可继续远征</span>' : `<div class="checkline ${profile.stats.bossKills ? 'green' : 'muted'}">${profile.stats.bossKills ? '✓' : '○'} 击败废墟守卫 ${profile.stats.bossKills ? '1 / 1' : '0 / 1'}</div>${costHTML(D.storyCost)}<button class="button-secondary" style="margin-top:12px" data-action="restore" ${!profile.stats.bossKills || !S.Store.canAfford(profile, D.storyCost) ? 'disabled' : ''}>修复北境灯塔 ${icon('arrow', 15)}</button>`}</div>`;
  }
  function loadoutHTML() {
    const selected = D.weapons.find(w => w.id === profile.selectedWeapon), tool = D.tools.find(t => t.id === profile.selectedTool);
    return `<p class="section-caption">武器没有弹药限制。升级工作台，解锁更多打法。</p>${D.weapons.map(w => { const locked = w.unlock > profile.facilities.workshop; return `<button class="weapon-option ${profile.selectedWeapon === w.id ? 'selected' : ''}" data-action="weapon" data-id="${w.id}" ${locked ? 'disabled' : ''} aria-pressed="${profile.selectedWeapon === w.id}">${icon(w.id, 43)}<span><strong>${w.name}</strong><small>${locked ? `工作台 LV.${w.unlock} 解锁` : w.tag}</small></span>${icon(locked ? 'lock' : profile.selectedWeapon === w.id ? 'check' : 'arrow', 16)}</button>`; }).join('')}<p class="weapon-description">${selected.description}</p><div class="eyebrow" style="font-size:9px;margin:20px 0 12px">随身工具 / 三选一</div><div class="tool-grid">${D.tools.map(t => `<button class="tool-option ${profile.selectedTool === t.id ? 'selected' : ''}" data-action="tool" data-id="${t.id}" aria-pressed="${profile.selectedTool === t.id}">${icon(t.icon, 24)}${t.name}</button>`).join('')}</div><p class="weapon-description">${tool.description}</p>`;
  }
  function historyHTML() {
    return `<div class="stats-row"><span><strong>${profile.stats.runs}</strong><small>总远征</small></span><span><strong>${profile.stats.escapes}</strong><small>安全归来</small></span><span><strong>${profile.stats.bossKills}</strong><small>守卫击破</small></span></div>${profile.history.length ? profile.history.map((h, i) => {
      const summary = h.weapon && h.build ? `${D.weapons.find(w => w.id === h.weapon).name}${h.build.length ? ' · ' + keyBuild(h.build).map(t => D.upgrades.find(u => u.id === t.id).name + (t.level > 1 ? ` ${t.level}级` : '')).join(' / ') : ' · 未安装科技'}` : '';
      return `<div class="run-log"><div><span class="${h.success ? 'green' : 'red'}">${h.success ? '安全撤离' : '紧急救援'}</span><small>远征 ${String(profile.stats.runs - i).padStart(3, '0')} · ${formatTime(h.elapsed)} · 击破 ${h.kills}</small>${summary ? `<small class="run-log-build">${summary}</small>` : ''}</div><div>${resources(h.kept, false)}<small style="text-align:right">${esc(new Date(h.date).toLocaleDateString('zh-CN'))}</small></div></div>`;
    }).join('') : '<p class="empty-note">远征日志还是空白。<br>第一段故事，等你带回来。</p>'}`;
  }
  function camp() {
    setView('camp'); closeModal(); audio.setMode('camp'); game = null;
    $('screen').innerHTML = `<div class="camp-game-hud"><div class="camp-location"><span class="status-dot"></span>07 号回收站 <small>安全区</small></div><div class="camp-wallet">${resources()}</div><div class="camp-corner-controls"><button class="icon-button" data-action="mute" aria-label="${profile.settings.muted ? '开启声音' : '静音'}">${icon(profile.settings.muted ? 'mute' : 'sound', 18)}</button><button class="icon-button" data-action="settings" aria-label="设置">${icon('settings', 18)}</button></div></div><div class="camp-quest"><span class="quest-icon">${icon('beacon', 22)}</span><div><strong>${profile.storyComplete ? '灯塔已重燃' : '主线 · 重燃北境灯塔'}</strong><small>${profile.storyComplete ? '信号已送达。继续为营地带回物资。' : `${profile.stats.bossKills ? '✓' : '○'} 击败废墟守卫　${profile.resources.core} / 3 能源核心`}</small></div><button data-action="story" aria-label="查看灯塔任务">${icon('arrow', 18)}</button></div><div class="camp-hotspots">${[
      ['workshop', '武器工作台', 0.468, 0.320], ['infirmary', '医疗站', 0.147, 0.520], ['storage', '扩容仓库', 0.832, 0.476], ['beacon', '撤离信标', 0.128, 0.226]
    ].map(([id, name, u, v]) => `<button class="camp-hotspot" data-action="facility" data-id="${id}" data-u="${u}" data-v="${v}"><span class="hotspot-pin">${icon(id, 22)}</span><span class="hotspot-name">${name} <small>LV.${profile.facilities[id]}</small></span></button>`).join('')}</div><div class="camp-character-tag">${icon('target', 12)} 回收员 · 07</div><div class="game-dock"><div class="dock-slots"><button data-action="tab" data-id="loadout">${icon(profile.selectedWeapon, 28)}<span>装备</span><small>01</small></button><button data-action="tab" data-id="facilities">${icon('workshop', 26)}<span>设施</span><small>02</small></button><button data-action="tab" data-id="history">${icon('book', 26)}<span>日志</span><small>03</small></button><button data-action="tech">${icon('chain', 30)}<span>科技</span><small>04</small></button></div><div class="dock-loadout"><strong>${D.weapons.find(w => w.id === profile.selectedWeapon).name}</strong><small>${D.tools.find(t => t.id === profile.selectedTool).name} · 生命 ${100 + profile.facilities.infirmary * 15} · 背包 ${30 + profile.facilities.storage * 12}</small></div><button class="deploy-button" data-action="${profile.suspendedRun ? 'continue' : 'depart'}"><span><small>${profile.suspendedRun ? '远征进度已保存' : '目的地 / 北境废料场'}</small><strong>${profile.suspendedRun ? '继续中断的远征' : '开始远征'}</strong></span>${icon('arrow', 27)}</button></div><div class="camp-scene-hint">点击营地设施进行建设 · 外出收集材料，回来升级装备</div>`;
    positionCampHotspots();
    if (profile.suspendedRun) toast('上次远征已保存，可以继续探索。', 2800);
  }
  function positionCampHotspots() {
    document.querySelectorAll('.camp-hotspot').forEach(el => {
      const u = Number(el.dataset.u), v = Number(el.dataset.v);
      const pos = renderer.campAnchor ? renderer.campAnchor(u, v) : { x: renderer.width * u, y: renderer.height * v };
      el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
    });
  }
  function openCampPanel(tab) {
    campTab = tab;
    const title = { facilities: '营地设施', loadout: '出发装备', history: '远征日志' }[tab];
    showModal('camp-panel', `<div class="inventory-heading">${icon(tab === 'loadout' ? 'rivet' : tab === 'history' ? 'book' : 'workshop', 28)}<h2 id="modal-title">${title}</h2></div><button class="icon-button modal-close" data-action="close" aria-label="关闭面板">${icon('close', 16)}</button><div class="inventory-wallet">${resources()}</div>${tab === 'facilities' ? facilityHTML() : tab === 'loadout' ? loadoutHTML() : historyHTML()}<div class="modal-actions"><button class="button-secondary" data-action="close">返回营地</button></div>`, `inventory-modal ${tab === 'loadout' ? 'equipment-modal' : ''}`);
  }
  function facilityPanel(id) {
    const f = D.facilities.find(f => f.id === id); if (!f) return;
    campTab = id;
    const lv = profile.facilities[id], cost = f.costs[lv];
    showModal('facility-panel', `<div class="facility-portrait">${icon(id, 82)}</div><div class="eyebrow">营地设施 / LEVEL ${lv}</div><h2 id="modal-title">${f.name}</h2><p class="intro">${f.description}</p><div class="level-pips large-pips">${[1,2,3].map(n => `<i class="${lv >= n ? 'on' : ''}"></i>`).join('')}</div><div class="divider"></div>${cost ? `<p class="section-caption">升级至 LV.${lv + 1} 所需材料</p>${costHTML(cost)}` : '<p class="green">已完成全部升级</p>'}<div class="inventory-wallet">仓库：${resources()}</div><div class="modal-actions"><button class="button-secondary" data-action="close">返回营地</button><button class="button-primary" data-action="buy" data-id="${id}" ${!cost || !S.Store.canAfford(profile, cost) ? 'disabled' : ''}>${cost ? '升级设施' : '已满级'} ${icon('workshop', 18)}</button></div>`, 'facility-modal');
  }
  function showModal(type, html, className = '') {
    modalType = type; $('overlay').hidden = false; $('overlay').innerHTML = `<section class="modal ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${html}</section>`;
    for (const id of ['screen', 'hud', 'touch-controls']) $(id).inert = true;
    clearInput(); $('overlay').querySelector('.modal').focus({ preventScroll: true });
  }
  function closeModal() { for (const id of ['screen', 'hud', 'touch-controls']) $(id).inert = false; modalType = ''; $('overlay').hidden = true; $('overlay').innerHTML = ''; clearInput(); }
  function help(inRun = false) {
    if (inRun) {
      // 第一趟只教完成小闭环所需的动作，完整规则留在暂停菜单的生存手册。
      showModal('tutorial', `<div class="eyebrow">FIRST EXPEDITION</div><h2 id="modal-title">打出一套火力，再带核心回家。</h2><p class="intro">击破敌群获得强化，挑战中继夺取核心，决定何时突围。</p><div class="quick-tutorial-steps"><div><span>01</span><strong>移动，自动开火</strong><p>${isTouch ? '拖动左下摇杆。右下大按钮冲刺避险。' : 'WASD 移动。空格冲刺避险。'}武器会自动攻击。</p></div><div><span>02</span><strong>守点，夺取能源核心</strong><p>找到地图金色中继，${isTouch ? '按住右侧守点按钮' : '按住 E'} 启动。圈内累计防守 18 秒并击破精英，获得核心与强化。</p></div><div><span>03</span><strong>呼叫接应，迎击追兵</strong><p>45 秒后南侧撤离点开放。进入绿圈${isTouch ? '按住呼叫按钮' : '按住 E'} 呼叫接应，边打边等，抵达后再登车。</p></div></div><p class="quick-tutorial-note">先击破身边敌人、拾取蓝色经验。箱子是沿途补给，地图金点是挑战目标。</p><div class="modal-actions"><button class="button-primary" data-action="tutorial-done">记住了，出发 ${icon('arrow', 18)}</button></div>`, 'quick-tutorial');
      return;
    }
    showModal('help', `<div class="eyebrow">FIELD MANUAL / 01</div><h2 id="modal-title">先活着，再满载而归。</h2><p class="intro">别急着捡完所有东西。回收站会一直等你。</p><div class="tutorial-list"><div class="tutorial-step"><span class="step-number">01</span><div><strong>移动靠你，射击交给武器。</strong><p>${isTouch ? '在左下区域按下并拖动摇杆，武器自动攻击附近敌人。右下大按钮冲刺，提供短暂无敌；按钮显示剩余冷却。' : 'WASD 或方向键移动，武器自动攻击附近敌人。按住鼠标左键可手动瞄准，鼠标右键点击地面可自动寻路。空格冲刺，在危险中短暂无敌。'}</p></div></div><div class="tutorial-step"><span class="step-number">02</span><div><strong>${isTouch ? '找到箱子，按住右侧按钮搜集。' : '找到箱子，按住 E 拆解。'}</strong><p>${isTouch ? '靠近箱子会出现搜集按钮，持续按住完成搜集，松手取消。' : '靠近箱子后按住 E，或点击交互提示自动拆解；移动可取消。'}材料自动拾取；能源核心占 3 格，其余材料占 1 格。核心优先拾取；空间不足时，靠近核心点击「换取核心」，确认用废铁腾位并立即拾取。</p></div></div><div class="tutorial-step"><span class="step-number">03</span><div><strong>记住回家的方向，也能选择挑战。</strong><p>45 秒后，南侧绿色撤离点开放。按住交互 1 秒呼叫接应，迎击追兵 8 秒后再按住登车；信标会缩短等待。金色中继可启动守点：圈内累计防守 18 秒，迎击三波敌群并击破携带核心的精英；离圈进度保留。完成获得至少一次强化和治疗；三座接通后，可在任意中继长按 2 秒提前唤醒守卫，也可继续搜集，等第 6 分钟自动唤醒。第 3、5 分钟会出现补给。</p></div></div></div>${isTouch ? '<div class="controls-grid"><span>急救：按钮显示剩余数量</span><span>地图：点击右上小地图</span><span>背包：点击右上容量</span><span>交互：按住执行，松手取消</span></div>' : `<div class="controls-grid"><span><span class="key">Q</span>急救，恢复 40% 生命</span><span><span class="key">M</span>查看完整地图</span><span><span class="key">Esc</span>暂停、设置与背包</span><span><span class="key">E</span>按住搜集 / 激活 / 撤离</span></div>`}<div class="callout">风暴会在 10 分钟后吞没废料场。失败时保留 35% 废铁和电路，能源核心全部丢失。击破为超载充能；满能量后进入就绪状态，下一次有效射击爆发 8 秒。科技需先完成配方，再在之后的升级选择中安装进化；可在蓝图追踪一条配方，连续两次升级未出现缺件，下次保底，重抽保留保底配件。${isTouch ? '点击底部科技入口查看蓝图。' : '按 T 查看蓝图。'}局内科技回营地后清空。</div><p class="rotate-note">进入游戏会自动横屏。触屏使用左侧摇杆移动，右侧按钮冲刺、急救与交互。</p><div class="modal-actions"><button class="button-primary" data-action="close">我知道了 ${icon('arrow', 18)}</button></div>`);
  }
  function buildHUD() {
    $('hud').innerHTML = `<div class="hud-top"><div class="health-panel"><div class="health-title"><strong class="desktop-only">回收员 · 07</strong><span id="mobile-level" class="mobile-only"></span><span id="hp-value"></span></div><div class="meter"><div class="meter-fill" id="hp-fill"></div></div><div class="meter xp-meter"><div class="meter-fill" id="xp-fill"></div></div><div class="health-sub"><span id="weapon-label"></span><span id="level-label"></span></div></div><div class="time-panel"><div class="eyebrow">风暴抵达倒计时</div><div class="time" id="run-time"></div><div class="threat-bars" id="threat-bars">${[1, 2, 3, 4, 5].map(n => `<i data-level="${n}"></i>`).join('')}</div></div><div class="hud-right"><div class="bag-panel"><div class="resource-strip" id="run-resources"></div><div class="bag-weight"><span>回收背包</span><span id="bag-value"></span></div><div class="meter"><div class="meter-fill" id="bag-fill"></div></div></div><div class="hud-buttons"><button class="icon-button" data-action="pause" aria-label="暂停游戏">${icon('pause', 17)}</button><button class="icon-button" data-action="map" aria-label="打开地图">${icon('map', 17)}</button></div></div></div><div class="run-banner" id="run-banner"></div><div class="overdrive-panel" id="overdrive-panel"><div><span id="overdrive-label">超载核心</span><strong id="overdrive-value">0%</strong></div><div class="overdrive-meter"><i id="overdrive-fill"></i></div><small id="overdrive-note">击破充能 · 就绪后有效射击爆发</small></div><div class="combo-panel" id="combo-panel" hidden><strong id="combo-count"></strong><span id="combo-caption">连续击破</span><i id="combo-life"></i></div><button class="run-tech-strip" data-action="tech" aria-label="查看科技蓝图"><span class="tech-strip-title">科技 <kbd class="desktop-only">T</kbd></span><span id="mobile-tech-count" class="mobile-only"></span><span id="run-tech-icons"></span></button><div class="boss-bar" id="boss-bar" hidden><strong>废墟守卫 / THE WARDEN</strong><div class="meter"><div class="meter-fill" id="boss-fill"></div></div></div><div class="objectives"><div class="eyebrow">当前远征 / OBJECTIVE</div><p id="objective-main"></p><small id="objective-sub"></small></div><div class="hud-controls"><span><span class="key">W A S D</span>移动</span><span><span class="key">E</span>按住交互</span><span><span class="key">右键</span>寻路</span><span><span class="key">M</span>地图</span><span><span class="key">Esc</span>暂停</span></div><div class="action-bar"><button class="action-slot" data-action="dash" aria-label="冲刺">${icon('dash', 21)}<span><strong>冲刺 <span class="muted">SPACE</span></strong><small id="dash-label"></small></span><i class="cooldown" id="dash-fill"></i></button><button class="action-slot" data-action="heal" aria-label="使用急救包">${icon('infirmary', 21)}<span><strong>急救 <span class="muted">Q</span></strong><small id="heal-label"></small></span></button></div><div class="minimap-wrap"><button data-action="map" aria-label="查看完整地图"><div class="minimap-title"><span>NORTH YARD</span><span>M ↗</span></div><canvas id="minimap" width="350" height="262"></canvas></button></div><button class="interaction-hint" id="interaction-hint" data-action="interact-assist" hidden><span id="interaction-text"></span><div class="meter"><div class="meter-fill" id="interaction-fill"></div></div></button><button id="core-exchange" class="core-exchange-hud" data-action="core-exchange" hidden>${icon('core',22)}<span>换取核心</span></button><button id="mobile-bag" class="mobile-only" data-action="pause" aria-label="打开背包整理">${icon('storage',22)}<span id="mobile-bag-value"></span></button>`;
    for (const [id, art] of [['touch-heal','infirmary'], ['touch-dash','dash'], ['touch-interact','target']]) $(id).querySelector('.touch-action-icon').innerHTML = icon(art,26);
  }
  function depart(resume = false) {
    audio.start(profile.settings); closeModal(); resultSettled = false; upgradeSignature = ''; saveClock = 0; mobileBannerKey = ''; mobileBannerUntil = 0; lastInstallFeedback = ''; exchangeReturnPause = false;
    try {
      game = resume && profile.suspendedRun ? S.Game.fromSnapshot(profile.suspendedRun) : new S.Game({ weapon: profile.selectedWeapon, tool: profile.selectedTool, facilities: { ...profile.facilities }, difficulty: 'normal', seed: Math.floor(Date.now() % 2147483646) });
    } catch (e) {
      toast('远征存档无法恢复，可导出备份后放弃该次远征。', 5000);
      showModal('bad-snapshot', `<div class="eyebrow">RECOVERY</div><h2 id="modal-title">远征数据无法恢复</h2><p class="intro">营地进度仍然保留。可先到设置导出存档，再放弃本次远征。</p><div class="modal-actions"><button class="button-secondary" data-action="discard-snapshot">放弃中断远征</button><button class="button-primary" data-action="close">返回</button></div>`); return;
    }
    if (game.state === 'result') { profile.suspendedRun = null; save(); camp(); return; }
    setView('run'); $('screen').innerHTML = ''; buildHUD(); paused = false; audio.setMode('run', game.threat); checkpoint(); updateHUD();
    if (!profile.tutorialSeen) { paused = true; help(true); }
    else if (resume) { paused = true; pauseMenu('中断的远征已恢复，准备好后继续。'); }
    else toast(isTouch ? '靠近补给箱，按住右侧搜集按钮。' : '前方有补给箱。靠近后按住 E 搜集。', 4500);
  }
  function checkpoint() {
    if (game && game.state !== 'result' && typeof game.serialize === 'function') { profile.suspendedRun = game.serialize(); save(); }
  }
  function objectiveCopy() {
    const exitHint = game.exit.available ? '南侧绿圈可呼叫接应，迎击追兵后登车。' : `撤离点将在 ${Math.max(0, Math.ceil(45 - game.elapsed))} 秒后开放。`;
    if (game.exit.called) return { main: game.exit.arrival > 0 ? `迎击追兵 · 接应 ${Math.ceil(game.exit.arrival)} 秒` : '接应抵达 · 返回南侧登车', sub: game.exit.arrival > 0 ? '不用按住交互，自由走位、射击和冲刺。' : '进入绿圈按住交互，带着战利品回家。' };
    if (game.defense) {
      const defense = game.defense, relay = game.relays.find(r => r.id === defense.relayId);
      const inside = Math.hypot(game.player.x - relay.x, game.player.y - relay.y) <= 190;
      const leaderAlive = game.enemies.some(e => e.id === defense.leaderId && e.hp > 0);
      return { main: defense.elapsed >= 18 ? (leaderAlive ? '击破金色精英 · 完成守点' : '回到金圈 · 接通中继') : `${inside ? '守点' : '回到金圈'} · 剩余 ${Math.ceil(18 - defense.elapsed)} 秒`, sub: `第 ${defense.wave}/3 波 · 精英掉落核心，接通奖励强化。${inside ? '圈内自由走位，无需按住交互。' : '离圈进度保留，地图金圈标出站点。'}` };
    }
    if (game.bossDefeated) return { main: isTouch ? '携带核心撤离' : '守卫已击破，带核心安全撤离。', sub: exitHint };
    if (game.bossSpawned) return { main: isTouch ? '击败北侧守卫' : '废墟守卫已苏醒 · 前往北侧', sub: exitHint };
    if (game.relaysActivated >= 3) return { main: isTouch ? '中继长按唤醒 / 继续搜集' : '中继长按 2 秒唤醒守卫，也可继续搜集', sub: bossReadyCopy() };
    if (game.player.level < 2) return { main: '击破敌群 · 拾取经验强化', sub: '武器自动开火，靠近蓝色经验；空格 / 冲刺按钮躲避。' };
    return { main: isTouch ? `守点夺核心 ${game.relaysActivated}/3` : `挑战中继 · 核心 + 强化 · ${game.relaysActivated} / 3`, sub: `地图金点是守点挑战；三站完成可主动召唤守卫。${exitHint}` };
  }
  function updateHUD() {
    if (!game || view !== 'run') return;
    const p = game.player, weight = p.bag.scrap + p.bag.circuit + p.bag.core * 3;
    $('hp-value').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`; $('hp-fill').style.width = `${Math.max(0, p.hp / p.maxHp * 100)}%`; $('hp-fill').style.background = p.hp / p.maxHp < 0.3 ? 'var(--red)' : 'var(--green)';
    $('mobile-level').textContent = `LV.${p.level}`;
    $('hud').classList.toggle('low-health', p.hp / p.maxHp < 0.3);
    $('xp-fill').style.width = `${Math.min(100, p.xp / p.xpNext * 100)}%`; $('weapon-label').textContent = D.weapons.find(w => w.id === game.weapon).name; $('level-label').textContent = `LV.${p.level} · 击破 ${game.kills}`;
    $('run-time').textContent = formatTime(game.duration - game.elapsed); $('run-time').style.color = game.duration - game.elapsed < 90 ? 'var(--red)' : 'var(--ink)';
    $('threat-bars').classList.toggle('danger', game.threat >= 4); $('threat-bars').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < game.threat));
    $('run-resources').innerHTML = ['scrap', 'circuit', 'core'].map(k => `<span class="resource" title="${D.resourceNames[k]}">${icon(k, 14)}${p.bag[k]}</span>`).join('');
    $('bag-value').textContent = `${weight} / ${p.capacity}`; $('bag-fill').style.width = `${Math.min(100, weight / p.capacity * 100)}%`;
    $('mobile-bag-value').textContent = `${weight}/${p.capacity}`; $('mobile-bag').classList.toggle('full', weight >= p.capacity);
    const exchange = game.getCoreExchange();
    $('core-exchange').hidden = !exchange;
    if (exchange) {
      $('core-exchange').dataset.dropId = String(exchange.dropId);
      $('core-exchange').setAttribute('aria-label', `换取 ${exchange.coreAmount} 能源核心，需丢弃 ${exchange.scrapCost} 废铁`);
    } else delete $('core-exchange').dataset.dropId;
    $('dash-label').textContent = p.dashCooldown > 0 ? `${p.dashCooldown.toFixed(1)} 秒后就绪` : '已就绪 · 短暂无敌'; $('dash-fill').style.width = `${p.dashCooldown <= 0 ? 100 : Math.max(0, 100 - p.dashCooldown / Math.max(0.45, 1.2 - (game.upgrades.dash || 0) * 0.2) * 100)}%`; $('heal-label').textContent = `剩余 ${p.medkits} 包 · 恢复 40%`;
    const objective = objectiveCopy();
    $('objective-main').textContent = objective.main;
    $('objective-sub').textContent = objective.sub;
    // 移动端只在事件发生时短暂提示，避免常驻横幅占住战场。
    if (isTouch) {
      const key = weight >= p.capacity ? 'full' : game.duration - game.elapsed < 90 ? 'storm' : game.elapsed < 7 ? 'intro' : '';
      if (key !== mobileBannerKey) { mobileBannerKey = key; mobileBannerUntil = game.elapsed + (key === 'intro' ? 7 - game.elapsed : 4); }
      $('run-banner').textContent = { full: '满包仍可升级 · 可换核心', storm: '风暴逼近 · 立即撤离', intro: '左侧移动 · 右侧冲刺' }[key] || '';
      $('run-banner').hidden = !key || game.elapsed >= mobileBannerUntil;
    } else {
      $('run-banner').hidden = false;
    $('run-banner').textContent = weight >= p.capacity ? '背包满也能升级 · 守点夺核心' : game.elapsed < 25 ? `${effectiveAutoFire() ? '自动射击已开启' : '按住左键射击'} · 击破敌群，拾取蓝色经验` : game.duration - game.elapsed < 90 ? '风暴逼近，立刻返回撤离点！' : `威胁等级 ${game.threat} / 5 · ${effectiveAutoFire() ? '自动射击' : '手动射击'}`;
    }
    const boss = game.enemies.find(e => e.type === 'boss' && e.hp > 0);
    $('hud').classList.toggle('boss-active', !!boss);
    $('boss-bar').hidden = !boss; if (boss) $('boss-fill').style.width = `${boss.hp / boss.maxHp * 100}%`;
    const inter = game.interaction; $('interaction-hint').hidden = !inter;
    if (inter) { $('interaction-text').textContent = `${interactAssist ? '进行中' : isTouch ? '按住右侧按钮' : '按住 E / 点击'} · ${inter.name}${inter.name === '唤醒守卫' ? ' · 持续 2 秒' : ''}`; $('interaction-fill').style.width = `${Math.max(0, Math.min(1, inter.progress)) * 100}%`; }
    const overdrive = game.overdriveTime > 0, overdriveReady = !overdrive && game.overdriveCharge >= 100;
    $('overdrive-panel').classList.toggle('active', overdrive);
    $('overdrive-panel').classList.toggle('ready', overdriveReady);
    $('hud').classList.toggle('overdrive-active', overdrive);
    updateTouchActions(p, inter);
    $('overdrive-label').textContent = overdrive ? '超载爆发' : overdriveReady ? '超载就绪' : '超载核心';
    $('overdrive-value').textContent = overdrive ? game.overdriveTime.toFixed(1) + 's' : Math.floor(game.overdriveCharge) + '%';
    $('overdrive-fill').style.width = (overdrive ? game.overdriveTime / 8 * 100 : game.overdriveCharge) + '%';
    $('overdrive-note').textContent = overdrive ? '射速 +54% · 加速移动 · 范围回收' : overdriveReady ? '下一次有效射击爆发 8 秒' : '击破充能 · 就绪后有效射击爆发';
    $('overdrive-panel').setAttribute('aria-label', `${$('overdrive-label').textContent}，${$('overdrive-note').textContent}`);
    $('combo-panel').hidden = game.combo < 3;
    $('combo-count').textContent = game.combo + ' COMBO';
    $('combo-caption').textContent = game.combo >= 25 ? '势不可挡' : game.combo >= 10 ? '连锁回收' : '连续击破';
    $('combo-life').style.width = Math.max(0,game.comboTimer / 4 * 100) + '%';
    const techSignature = isTouch + ':' + Object.entries(game.upgrades).filter(([,v]) => v > 0).map(([k,v]) => k + ':' + v).join(',');
    if ($('run-tech-icons').dataset.signature !== techSignature) {
      $('run-tech-icons').dataset.signature = techSignature;
      const installed = Object.entries(game.upgrades).filter(([,v]) => v > 0);
      $('mobile-tech-count').textContent = installed.length;
      $('run-tech-icons').innerHTML = installed.slice(isTouch ? -3 : -10).map(([id,lv]) => `<span title="${D.upgrades.find(u => u.id === id).name} · ${lv}级">${icon(id,26)}<b>${lv}</b></span>`).join('') || '<small>拾取经验，构建你的流派</small>';
    }
    renderer.drawMap(game, $('minimap'));
  }
  function updateTouchActions(p, inter) {
    // 触屏按钮读取真实战斗状态，冷却、数量和不可用原因与桌面共用同一份数值。
    const cooldown = Math.max(0, p.dashCooldown), duration = Math.max(0.45, 1.2 - (game.upgrades.dash || 0) * 0.2);
    $('touch-dash').disabled = cooldown > 0;
    $('touch-dash').style.setProperty('--charge', `${Math.max(0, 1 - cooldown / duration) * 360}deg`);
    $('touch-dash-state').textContent = cooldown > 0 ? `${cooldown.toFixed(1)}s` : '就绪';
    $('touch-heal').disabled = p.medkits <= 0 || p.hp >= p.maxHp;
    $('touch-heal-state').textContent = `×${p.medkits}`;
    $('touch-heal').title = p.medkits <= 0 ? '急救包已用完' : p.hp >= p.maxHp ? '生命已满' : '恢复 40% 生命';
    $('touch-heal').setAttribute('aria-description', $('touch-heal').title);
    $('touch-interact').hidden = !inter;
    if (!inter) { touchInteract = false; return; }
    // 这些名称由 Game._findInteraction 明确产出，不猜测不存在的 kind 字段。
    const labels = { '呼叫接应 · 迎击追兵': '呼叫', '登车撤离': '登车', '打开医疗箱': '开箱', '搜集补给': '搜集', '守点挑战 · 核心 + 强化': '守点', '唤醒守卫': '唤醒' };
    $('touch-interact-label').textContent = labels[inter.name] || '交互';
    $('touch-interact').setAttribute('aria-label', `按住${inter.name}${inter.name === '唤醒守卫' ? ' 2 秒' : ''}`);
    $('touch-interact-state').textContent = inter.progress > 0 ? `${Math.floor(inter.progress * 100)}%` : inter.name === '唤醒守卫' ? '按住2秒' : '按住';
    $('touch-interact').style.setProperty('--charge', `${Math.max(0, Math.min(1, inter.progress)) * 360}deg`);
  }
  function coreExchangePanel(dropId) {
    if (!game || game.state !== 'running') return;
    const offer = game.getCoreExchange();
    if (!offer || offer.dropId !== dropId) { if (paused) pauseMenu('附近核心或背包已变化，请重新查看。未丢弃任何材料。'); else toast('附近核心或背包已变化，请重新靠近查看。'); return; }
    exchangeReturnPause = paused;
    paused = true; clearInput(); checkpoint(); audio.setMode('silent');
    showModal('core-exchange', `<div class="exchange-emblem">${icon('core', 58)}</div><div class="eyebrow">RECOVERY PRIORITY</div><h2 id="modal-title">给能源核心腾个位置</h2><p class="exchange-terms">丢弃 <strong>${offer.scrapCost}</strong> 废铁，拾取 <strong>${offer.coreAmount}</strong> 能源核心</p><p class="intro">每枚核心占 3 格。确认后一次完成交换，普通材料不会抢占刚腾出的空间。</p><p class="settings-note">仅交换眼前这堆核心。其他材料不变，取消不会丢弃资源。</p><div class="modal-actions"><button class="button-secondary" data-action="cancel-core-exchange">取消</button><button class="button-primary" data-action="confirm-core-exchange" data-drop-id="${esc(offer.dropId)}">确认交换 ${icon('core', 20)}</button></div>`, 'core-exchange-modal');
  }
  function cancelCoreExchange() { if (exchangeReturnPause) pauseMenu(); else resumeGame(); }
  function pauseMenu(message = '') {
    if (!game || game.state === 'result') return;
    paused = true; clearInput(); checkpoint(); audio.setMode('silent');
    const p = game.player, offer = game.getCoreExchange();
    const ready = game.relaysActivated >= 3 && !game.bossSpawned;
    const firstGoal = profile.stats.runs === 0 ? S.Store.nextGoal(profile, p.bag) : null;
    showModal('pause', `<div class="eyebrow">TAKE A BREATH</div><h2 id="modal-title">远征已暂停</h2><p class="intro">${message || '风暴也会等你准备好。进度已自动保存。'}</p><div class="pause-summary"><span><strong>${formatTime(game.elapsed)}</strong>远征时长</span><span><strong>${game.kills}</strong>击破目标</span><span><strong>${p.bag.scrap + p.bag.circuit + p.bag.core * 3} / ${p.capacity}</strong>背包容量</span></div>${ready ? `<div class="ready-brief"><strong>挑战时机由你决定</strong><p>在任意已接通中继长按 2 秒唤醒守卫，或继续搜集。</p><small>${bossReadyCopy()}</small></div>` : ''}${firstGoal ? `<p class="first-run-goal">${icon(firstGoal.id, 21)} ${goalCopy(firstGoal, true)}${game.exit.available ? ' · 南侧撤离点已开放' : ''}</p>` : ''}<div class="divider"></div><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px">背包整理</span>${resources(p.bag, false)}</div>${offer ? `<button class="exchange-pause-button button-primary" data-action="core-exchange" data-drop-id="${esc(offer.dropId)}">${icon('core',22)} 换取 ${offer.coreAmount} 能源核心 <small>丢弃 ${offer.scrapCost} 废铁</small></button>` : ''}<div class="save-actions"><button class="button-secondary" data-action="discard" data-id="scrap" ${p.bag.scrap <= 0 ? 'disabled' : ''}>丢弃 ${Math.min(10, p.bag.scrap)} 废铁</button><button class="button-secondary" data-action="discard" data-id="circuit" ${p.bag.circuit <= 0 ? 'disabled' : ''}>丢弃 ${Math.min(3, p.bag.circuit)} 电路</button></div><p class="settings-note">靠近核心可用「换取核心」一次完成腾位与拾取。手动丢弃仅腾空位，附近材料仍会拾入；核心占 3 格，丢弃不会收回。</p><div class="pause-buttons"><button class="button-primary" data-action="resume">继续远征 ${icon('arrow', 17)}</button><button class="button-secondary" data-action="settings">声音与游戏设置</button><button class="button-secondary" data-action="help">操作手册</button><button class="button-secondary" data-action="save-camp">保存远征，返回营地</button><button class="button-ghost" data-action="abandon">呼叫救援，结束本次远征</button></div>`);
  }
  function resumeGame() {
    closeModal(); paused = false; clearInput(); audio.start(profile.settings); audio.setMode('run', game.threat);
    if (game.state === 'upgrade') showUpgrade();
  }
  function techRoute(id) { return D.builds.find(b => b.id === id || b.members.includes(id)); }
  function recipeHTML(id, levels, nextId = '') {
    const evo = D.upgrades.find(u => u.id === id);
    return evo.requires.map(r => {
      const current = levels[r.id] || 0, after = current + (r.id === nextId ? 1 : 0);
      return `<span class="recipe-part ${current >= r.level ? 'complete' : after >= r.level ? 'almost' : ''}">${icon(r.id,24)}<span>${D.upgrades.find(u => u.id === r.id).name}<b>${r.id === nextId && current < r.level ? `${current} → ${Math.min(after,r.level)}` : Math.min(current,r.level)} / ${r.level}</b></span></span>`;
    }).join('<i class="recipe-plus">+</i>');
  }
  function techDelta(id, level) {
    const n = level + 1;
    const lines = {
      damage: `科技伤害 ${100 + level * 22}% → ${100 + n * 22}%`,
      haste: `射击间隔 ${100 - level * 14}% → ${100 - n * 14}%`,
      speed: `移动速度 +${level * 12}% → +${n * 12}%`, hull: '生命上限 +25 · 立即恢复 25',
      magnet: `额外拾取范围 ${level * 45} → ${n * 45}`, pierce: `额外穿透 ${level} → ${n} 个目标`,
      ricochet: `命中破片 ${level} → ${n} 枚`, chain: `额外连锁 ${level} → ${n} 个目标`,
      orbit: `环绕锯刃 ${level} → ${n} 枚`, salvage: `开箱材料 +${level * 25}% → +${n * 25}%`,
      regen: `每秒恢复 ${(level * .9).toFixed(1)} → ${(n * .9).toFixed(1)}`, crit: `暴击率 ${level * 12}% → ${n * 12}% · 2倍伤害`,
      dash: `冲刺冷却 ${(1.2-level*.2).toFixed(1)}s → ${(1.2-n*.2).toFixed(1)}s`,
      freeze: `减速 ${Math.min(50,level*18)}% → ${Math.min(50,n*18)}%`,
      capacitor: `冲刺电场基础伤害 ${level*18} → ${n*18}`, leech: `每 ${Math.max(2,6-n)} 次击破恢复 ${5+n*2} 生命`,
      metalstorm: '每 3 次射击 · 追加 2 枚侧翼弹', thunder: '2 秒 / 次 · 最多打击 5 个目标',
      shatter: '减速击破 → 范围寒冰爆炸', gravity: '2 秒 / 次 · 220 范围牵引'
    };
    return lines[id];
  }
  function installFeedback(id, previousLevel) {
    const u = D.upgrades.find(item => item.id === id);
    const triggers = { capacitor: '下一次冲刺释放电场', chain: '子弹命中后连锁到附近敌人', orbit: '靠近敌人，绕身锯刃造成伤害', freeze: '命中敌人即可减速', leech: '累计击破触发回血' };
    // 只有本次安装真正补齐配方时才提示下一次进化，卡片预览不能冒充已获得。
    const completed = D.upgrades.find(evo => !game.upgrades[evo.id] && evo.requires?.some(r => r.id === id && previousLevel < r.level) && evo.requires.every(r => game.upgrades[r.id] >= r.level));
    return `${u.name}已安装 · ${techDelta(id, previousLevel)}${triggers[id] ? ` · ${triggers[id]}` : ''}${completed ? ` · ${completed.name}配方已齐，下次升级可选进化` : ''}`;
  }
  function trackedRecipeHTML() {
    if (!game.trackedBuild) return '';
    const evo = D.upgrades.find(u => u.id === game.trackedBuild);
    const ready = evo.requires.every(r => (game.upgrades[r.id] || 0) >= r.level);
    return `<div class="tracking-summary">${icon(evo.id, 30)}<div><strong>追踪 · ${evo.name}</strong><span>${ready ? '配方已齐 · 等待安装进化' : evo.requires.map(r => `${D.upgrades.find(u => u.id === r.id).name} ${Math.min(game.upgrades[r.id] || 0, r.level)}/${r.level}`).join(' + ')}</span></div><small>${ready ? '在候选中选择进化装置' : game.trackingMisses >= 2 ? '下次升级保底缺件' : `缺件未出现 ${game.trackingMisses}/2 次`}</small></div>`;
  }
  function showUpgrade() {
    if (!game || game.state !== 'upgrade') return;
    const signature = game.player.level + ':' + game.upgradeChoices.join(',') + ':' + game.rerolls + ':' + game.trackedBuild;
    if (modalType === 'upgrade' && signature === upgradeSignature) return;
    upgradeSignature = signature; audio.setMode('silent'); audio.play('upgrade');
    const acquired = Object.entries(game.upgrades).filter(([,lv]) => lv > 0), feedback = lastInstallFeedback;
    lastInstallFeedback = '';
    const tracked = game.trackedBuild && D.upgrades.find(u => u.id === game.trackedBuild);
    showModal('upgrade', `<div class="tech-screen-heading"><div><div class="eyebrow">FIELD ENGINEERING · LV.${game.player.level}</div><h2 id="modal-title">选择你的下一块拼图</h2><p class="intro ${feedback ? 'install-feedback' : ''}">${feedback || '科技可以组成进化装置。战斗已暂停。'}</p></div><button class="blueprint-button" data-action="tech">${icon('book',28)} 查看进化蓝图</button></div>${trackedRecipeHTML()}<div class="upgrade-grid">${game.upgradeChoices.map((id,i) => {
      const u = D.upgrades.find(u => u.id === id), level = game.upgrades[id] || 0, route = techRoute(id), evolution = !!u.requires;
      const evo = route && D.upgrades.find(t => t.id === route.id);
      const willUnlock = !evolution && evo && !game.upgrades[evo.id] && evo.requires.every(r => (game.upgrades[r.id] || 0) + (r.id === id ? 1 : 0) >= r.level);
      const prerequisite = !evolution && evo?.requires.some(r => r.id === id);
      const continuing = !evolution && route && route.members.some(k => game.upgrades[k] > 0);
      const trackedPart = tracked && (tracked.id === id || tracked.requires.some(r => r.id === id && level < r.level));
      return `<button class="upgrade-choice tech-choice ${evolution ? 'evolution' : ''} ${trackedPart ? 'tracked-choice' : ''}" style="--tech-color:${route?.color || '#a5cd9a'}" data-action="upgrade" data-id="${id}"><div class="tech-card-top"><span>${trackedPart ? evolution ? '追踪进化 · 可安装' : '追踪配件' : evolution ? '传奇进化' : route?.name || '生存支援'}</span><span class="tech-rank">${evolution ? 'EX' : 'LV.' + (level+1)}</span></div><div class="tech-art">${icon(id,evolution ? 150 : 108)}</div><div class="tech-card-body"><div class="tech-signal">${evolution ? '配方已完成 · 改变战斗方式' : willUnlock ? '装后配方齐 · 下次升级选进化' : continuing ? '与已装科技形成协同' : prerequisite ? '进化配件 · 可推进配方' : level ? '已有科技 · 强化升级' : '新装置'}</div><h3>${u.name}</h3><p>${u.description}</p><strong class="tech-delta">${techDelta(id,level)}</strong>${route && !evolution ? `<div class="tech-recipe-caption">${prerequisite ? '进化配方' : '同系进化 · 需以下配方'} / ${evo.name}</div><div class="tech-recipe">${recipeHTML(evo.id,game.upgrades,id)}</div>` : `<div class="tech-flavor">${route?.flavor || '活得更久，才有下一次爆发。'}</div>`}</div><span class="choose-label">安装科技 <span class="key">${i+1}</span>${icon('arrow',18)}</span></button>`;
    }).join('')}</div><div class="tech-bottom"><div class="installed-tech"><span>已装科技</span>${acquired.length ? acquired.slice(-9).map(([id,lv]) => `<span title="${D.upgrades.find(u=>u.id===id).name} ${lv}级">${icon(id,30)}<b>${lv}</b></span>`).join('') : '<small>第一块拼图由你决定</small>'}</div><button class="button-secondary reroll-button" data-action="reroll" ${game.rerolls <= 0 ? 'disabled' : ''}>${icon('workshop',24)} 重抽选项 <strong>${game.rerolls} / 2</strong></button></div>`, 'upgrade-modal technology-modal');
  }
  function showTechCodex(preserveReturn = false) {
    // 切换追踪只刷新蓝图内容，不能把原来的升级选择返回路径改成战斗。
    if (!preserveReturn) returnModal = modalType === 'upgrade' ? 'upgrade' : view === 'run' ? 'run' : 'camp';
    if (game) { paused = true; checkpoint(); }
    const levels = game ? game.upgrades : {}, canTrack = view === 'run' && game && game.state !== 'result';
    showModal('codex', `<div class="eyebrow">ENGINEERING BLUEPRINTS</div><h2 id="modal-title">从零件，到王牌。</h2><button class="icon-button modal-close" data-action="close-tech" aria-label="关闭科技蓝图">${icon('close',22)}</button><p class="intro">先安装配方科技，再在升级选择中获得进化。${canTrack ? '本局可追踪一条配方，也可同时组装其他流派。' : '进入远征后可追踪一条配方。'}</p><div class="blueprint-grid">${D.builds.map(b => {
      const owned = levels[b.id] > 0, u = D.upgrades.find(u => u.id === b.id), tracked = canTrack && game.trackedBuild === b.id;
      const ready = u.requires.every(r => (levels[r.id] || 0) >= r.level);
      return `<article class="blueprint ${tracked ? 'tracked-blueprint' : ''}" style="--tech-color:${b.color}"><div class="blueprint-art">${icon(b.id,112)}</div><div><small>${b.name} / ${owned ? '已进化' : ready ? '配方已齐' : canTrack ? '组装中' : '进化配方'}</small><h3>${u.name}</h3><p>${u.description}</p><div class="tech-recipe">${recipeHTML(b.id,levels)}</div>${canTrack ? `<button class="blueprint-track ${tracked ? 'selected' : ''}" data-action="track-build" data-id="${tracked ? '' : b.id}" aria-pressed="${tracked}" ${owned ? 'disabled' : ''}>${icon(owned ? 'check' : tracked ? 'target' : 'flag',18)}${owned ? '已进化' : tracked ? '正在追踪 · 取消' : '追踪这条配方'}</button>` : '<span class="blueprint-camp-note">远征中选择追踪</span>'}</div></article>`;
    }).join('')}</div><p class="tracking-rule">连续两次升级未出现追踪缺件，下次保底；重抽保留保底配件。配方凑齐后，还需在升级候选中选择进化装置。</p><p class="settings-note">科技和追踪仅在本次远征生效。每局有 2 次重抽，可自由更换追踪配方。</p><div class="modal-actions"><button class="button-primary" data-action="close-tech">${returnModal === 'upgrade' ? '返回科技选择' : returnModal === 'run' ? '返回远征' : '返回营地'} ${icon('arrow',22)}</button></div>`, 'blueprint-modal');
  }
  function closeTechCodex() {
    if (returnModal === 'upgrade') { closeModal(); paused=false; upgradeSignature=''; showUpgrade(); }
    else if (returnModal === 'run') resumeGame(); else { closeModal(); camp(); }
    returnModal='';
  }
  function showResult() {
    if (!game || !game.result) return;
    const r = game.result;
    if (!resultSettled) { S.Store.settle(profile, r); resultSettled = true; updateSaveWarning(); }
    paused = true; audio.setMode('camp'); audio.play(r.success ? 'victory' : 'defeat');
    // 旧结算快照没有构筑摘要，仅在展示时读取已恢复的真实远征状态。
    const weaponId = r.weapon === undefined ? game.weapon : r.weapon;
    const build = r.build === undefined ? Object.entries(game.upgrades).filter(([,level]) => level > 0).map(([id,level]) => ({ id, level })) : r.build;
    const medkitsLeft = r.medkitsLeft === undefined ? game.player.medkits : r.medkitsLeft;
    const weapon = D.weapons.find(w => w.id === weaponId), keyTech = keyBuild(build), goal = S.Store.nextGoal(profile);
    const reasons = { destroyed: '救援无人机找到了你。先回家，明天还能再出发。', death: '救援无人机找到了你。先回家，明天还能再出发。', storm: '风暴吞没了废料场。救援无人机带回了你与部分物资。', timeout: '风暴吞没了废料场。救援无人机带回了你与部分物资。', abandon: '救援信号已收到。无人机带你返回了回收站。', extracted: '门为你留着，灯也为你亮着。欢迎回家。', extraction: '门为你留着，灯也为你亮着。欢迎回家。' };
    showModal('result', `<div class="result-emblem">${icon(r.success ? 'home' : 'infirmary', 29)}</div><div class="eyebrow">${r.success ? 'WELCOME HOME, SCAVENGER' : 'ANOTHER DAY, ANOTHER CHANCE'}</div><h2 id="modal-title">${r.success ? '这一趟，值得。' : '人回来，就好。'}</h2><p class="intro">${reasons[r.reason] || (r.success ? '物资已送入仓库。欢迎回到回收站。' : '本次远征结束，保留的物资已送入仓库。')}</p><div class="result-stats"><span><strong>${formatTime(r.elapsed)}</strong><small>远征时长</small></span><span><strong>${r.kills}</strong><small>击破目标</small></span><span><strong>LV.${r.level}</strong><small>最终等级</small></span></div><div class="result-build"><div class="result-weapon">${icon(weapon.id, 32)}<span><small>本局武器与关键科技</small><strong>${weapon.name}</strong></span></div><div class="result-tech">${keyTech.length ? keyTech.map(item => `<span>${icon(item.id, 25)}<span>${D.upgrades.find(u => u.id === item.id).name}<b>${D.upgrades.find(u => u.id === item.id).requires ? '进化' : `LV.${item.level}`}</b></span></span>`).join('') : '<small>本局尚未安装科技</small>'}</div></div><div class="eyebrow" style="font-size:9px">本次入库</div>${['scrap', 'circuit', 'core'].map(k => `<div class="loot-row"><span class="resource">${icon(k, 18)}${D.resourceNames[k]}</span><span><span class="mono">+${r.kept[k]}</span>${!r.success && r.lost[k] ? `<small class="muted" style="margin-left:15px;font-size:10px">遗失 ${r.lost[k]}</small>` : ''}</span></div>`).join('')}${r.bossDefeated ? '<div class="callout">废墟守卫已击破。营地已记录这次胜利，可以着手修复北境灯塔。</div>' : ''}${!r.success ? `<p class="settings-note">结束时剩余 ${medkitsLeft} 个急救包。紧急救援保留 35% 废铁和电路；能源核心无法带回。营地设施永久保留。</p>` : ''}${goal ? `<div class="result-next-goal"><span>${icon(goal.id, 35)}</span><div><small>${goal.affordable ? '这趟之后，可以建设' : '下一趟有了新目标'}</small><h3>${goal.name} LV.${goal.targetLevel}</h3><p>${goal.affordable ? goal.description : `还需带回 ${resourceGap(goal.missing)}`}</p>${goal.unlockWeapon ? `<strong>升级解锁：${goal.unlockWeapon.name}</strong>` : ''}</div></div>` : '<p class="settings-note">营地设施已全部升级。下一趟可以尝试不同武器与科技组合。</p>'}<div class="modal-actions"><button class="${goal ? 'button-secondary' : 'button-primary'}" data-action="result-camp">回到营地</button>${goal ? `<button class="button-primary" data-action="result-facility" data-id="${goal.id}">${goal.affordable ? '去升级' : '查看建设'} ${icon('arrow', 18)}</button>` : ''}</div>`, `result-modal ${r.success ? '' : 'failed'}`);
  }
  function mapModal() {
    if (!game || game.state === 'result' || game.state === 'upgrade') return;
    paused = true; clearInput(); audio.setMode('silent');
    showModal('map', `<div class="eyebrow">NORTH YARD / EXPEDITION 01</div><h2 id="modal-title">北境废料场</h2><button class="icon-button modal-close" data-action="resume" aria-label="关闭地图">${icon('close', 17)}</button><p class="intro">金色站点：守点 18 秒、击破精英，拿核心与强化。三站完成可长按中继 2 秒唤醒守卫。南侧绿圈呼叫接应后突围。</p><canvas id="large-map" width="1440" height="1080" aria-label="废料场地图"></canvas><div class="map-legend"><span><i style="background:#f6c76b"></i>回收员</span><span><i style="background:#8cd3b0"></i>撤离点</span><span><i style="background:#f5c966"></i>守点 / 核心精英</span><span><i style="background:#ef8c78"></i>敌人 / 守卫</span><span><i style="background:#ded8b6"></i>补给 / 医疗箱</span><span>${isTouch ? '点击右上角关闭地图' : '按 M 或 Esc 返回'}</span></div>`, 'map-modal');
    renderer.drawMap(game, $('large-map'), true);
  }
  function settings() {
    if (view === 'run') { paused = true; checkpoint(); audio.setMode('silent'); }
    const s = profile.settings;
    showModal('settings', `<div class="eyebrow">STATION PREFERENCES</div><h2 id="modal-title">把节奏，调成自己的。</h2><button class="icon-button modal-close" data-action="close" aria-label="关闭设置">${icon('close', 17)}</button><div class="settings-row"><label for="music-volume">音乐与氛围<small>根据探索与危险变化的废土旋律</small></label><input id="music-volume" type="range" min="0" max="1" step="0.01" value="${s.music}" data-setting="music" aria-label="音乐音量"></div><div class="settings-row"><label for="sfx-volume">音效<small>战斗、拾取与界面反馈</small></label><input id="sfx-volume" type="range" min="0" max="1" step="0.01" value="${s.sfx}" data-setting="sfx" aria-label="音效音量"></div><div class="settings-row"><label for="muted-setting">全部静音</label><input id="muted-setting" type="checkbox" data-setting="muted" ${s.muted ? 'checked' : ''}></div><div class="settings-row"><label for="motion-setting">减少动态效果<small>关闭画面震动与界面动效</small></label><input id="motion-setting" type="checkbox" data-setting="reducedMotion" ${s.reducedMotion ? 'checked' : ''}></div><div class="settings-row"><label for="auto-setting">自动瞄准与射击<small>关闭后，按住鼠标左键瞄准射击</small></label><input id="auto-setting" type="checkbox" data-setting="autoFire" ${s.autoFire ? 'checked' : ''}></div><div class="eyebrow" style="font-size:9px;margin-top:24px">本地存档</div><div class="save-actions"><button class="button-secondary" data-action="export">${icon('download', 15)}导出存档</button><button class="button-secondary" data-action="import" ${view === 'run' ? 'disabled' : ''}>导入存档</button><button class="button-ghost red" data-action="reset" ${view === 'run' ? 'disabled' : ''}>重置进度</button></div><p class="settings-note">进度保存在当前浏览器。更换浏览器或清理网站数据前，请先导出备份。远征中每 10 秒保存一次，暂停时立即保存。</p><div class="modal-actions"><button class="button-primary" data-action="close">保存并返回 ${icon('check', 17)}</button></div>`);
  }
  function confirmModal(type, titleText, content, action, actionName) {
    showModal(type, `<div class="eyebrow">PLEASE CONFIRM</div><h2 id="modal-title">${titleText}</h2><p class="intro">${content}</p><div class="modal-actions"><button class="button-secondary" data-action="cancel-confirm">取消</button><button class="button-danger" data-action="${action}">${actionName}</button></div>`);
  }
  let pendingImport = null;
  function exportSave() {
    checkpoint(); const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `最后一家回收站-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('存档已导出，请妥善保管。');
  }
  function importSave() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    // 选择器挂在页面内，确保文件选择期间目标节点有效；完成或取消后再清理。
    input.hidden = true; document.body.appendChild(input);
    input.addEventListener('cancel', () => input.remove(), { once: true });
    input.addEventListener('change', async () => {
      try {
        const f = input.files[0]; if (!f) return;
        if (f.size > 5000000) throw new Error('文件过大。');
        pendingImport = S.Store.parse(await f.text());
        if (pendingImport.suspendedRun) S.Game.fromSnapshot(pendingImport.suspendedRun);
        confirmModal('confirm-import', '导入并覆盖本地进度？', `这份存档记录了 ${pendingImport.stats.runs} 次远征，仓库有 ${pendingImport.resources.scrap} 废铁。当前进度将被覆盖。`, 'confirm-import', '确认导入');
      } catch (e) { pendingImport = null; toast('无法导入：' + e.message, 5000); }
      finally { input.remove(); }
    }); input.click();
  }
  function closeContext() {
    if (modalType === 'codex') { closeTechCodex(); return; }
    if (modalType === 'core-exchange') { cancelCoreExchange(); return; }
    if (['upgrade', 'result', 'tutorial'].includes(modalType)) return;
    if (modalType === 'map') { resumeGame(); return; }
    if (view === 'run') pauseMenu(); else { closeModal(); if (view === 'camp') camp(); else title(); }
  }
  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-action]'); if (!btn || btn.disabled) return;
    audio.start(profile.settings); audio.play('ui');
    const action = btn.dataset.action, id = btn.dataset.id;
    // 必须在进入游戏的用户手势内申请全屏，拒绝时仍由游戏视口保持横向布局。
    if (['camp', 'depart', 'continue', 'resume', 'tutorial-done'].includes(action)) viewport.enter();
    switch (action) {
      case 'camp': camp(); break;
      case 'tab': openCampPanel(id); break;
      case 'facility': facilityPanel(id); break;
      case 'story': openCampPanel('facilities'); break;
      case 'tech': showTechCodex(); break;
      case 'close-tech': closeTechCodex(); break;
      case 'track-build': if (game?.trackBuild(id || null)) { checkpoint(); showTechCodex(true); } break;
      case 'reroll': if (game?.rerollUpgrades()) { upgradeSignature=''; showUpgrade(); checkpoint(); } break;
      case 'buy': if (S.Store.buy(profile, id)) { const wasFacility = modalType === 'facility-panel'; updateSaveWarning(); audio.play('purchase'); camp(); if (wasFacility) facilityPanel(id); else openCampPanel('facilities'); toast(`${D.facilities.find(f => f.id === id).name}已升级。`); } break;
      case 'weapon': { const w = D.weapons.find(w => w.id === id); if (w && w.unlock <= profile.facilities.workshop) { profile.selectedWeapon = id; save(); camp(); openCampPanel('loadout'); } break; }
      case 'tool': if (D.tools.some(t => t.id === id)) { profile.selectedTool = id; save(); camp(); openCampPanel('loadout'); } break;
      case 'depart': depart(); break;
      case 'continue': depart(true); break;
      case 'tutorial-done': profile.tutorialSeen = true; save(); resumeGame(); break;
      case 'help': help(false); break;
      case 'close': closeContext(); break;
      case 'pause': if (game?.state === 'running' && !modalType) pauseMenu(); break;
      case 'resume': resumeGame(); break;
      case 'map': mapModal(); break;
      case 'dash': if (!paused) actions.dash = true; break;
      case 'heal': if (!paused) actions.heal = true; break;
      case 'interact-assist': if (!paused && game?.interaction) { interactAssist = !interactAssist; assistTarget = { x: game.interaction.x, y: game.interaction.y }; mousePath = []; } break;
      case 'upgrade': if (game?.state === 'upgrade') {
        const previousLevel = game.upgrades[id] || 0;
        if (!game.chooseUpgrade(id)) break;
        audio.play(D.upgrades.find(u => u.id === id).requires ? 'evolution' : 'install');
        lastInstallFeedback = installFeedback(id, previousLevel); upgradeSignature = ''; checkpoint();
        if (game.state !== 'upgrade') { closeModal(); paused = false; toast(lastInstallFeedback, 4500); lastInstallFeedback = ''; }
        else showUpgrade();
      } break;
      case 'settings': settings(); break;
      case 'mute': profile.settings.muted = !profile.settings.muted; applySettings(); save(); if (view === 'camp') camp(); else if (view === 'title') title(); break;
      case 'discard': if (game && ['scrap', 'circuit'].includes(id)) { const n = Math.min(id === 'scrap' ? 10 : 3, game.player.bag[id]); game.player.bag[id] -= n; pauseMenu(); toast(`已腾出 ${n} 格空间。`); } break;
      case 'core-exchange': coreExchangePanel(btn.dataset.dropId); break;
      case 'cancel-core-exchange': cancelCoreExchange(); break;
      case 'confirm-core-exchange': if (game) {
        // 目标编号绑定到确认按钮；资源与距离由引擎在扣除前重新校验。
        if (game.exchangeCore(btn.dataset.dropId)) { checkpoint(); resumeGame(); updateHUD(); toast('能源核心已收好，交换完成。'); }
        else pauseMenu('核心目标或背包已变化，本次未扣除任何资源。请重新查看附近核心。');
      } break;
      case 'save-camp': checkpoint(); camp(); break;
      case 'result-camp': camp(); break;
      case 'result-facility': camp(); facilityPanel(id); break;
      case 'abandon': confirmModal('confirm-abandon', '呼叫救援，提前结束？', '救援后保留 35% 废铁和电路，能源核心全部丢失。如果只是暂时离开，可以取消并选择保存远征。', 'confirm-abandon', '确认呼叫救援'); break;
      case 'confirm-abandon': game.finish(false, 'abandon'); closeModal(); showResult(); break;
      case 'cancel-confirm': if (view === 'run') pauseMenu(); else settings(); break;
      case 'export': exportSave(); break;
      case 'import': if (view !== 'run') importSave(); break;
      case 'confirm-import': if (pendingImport) { profile = pendingImport; pendingImport = null; save(); applySettings(); camp(); toast('存档已恢复。'); } break;
      case 'reset': confirmModal('confirm-reset', '重新开始这段旅程？', '本地营地、装备、资源、远征记录和中断的远征都将清空。建议先导出一份存档。', 'confirm-reset', '清空并重新开始'); break;
      case 'confirm-reset': profile = S.Store.fresh(); save(); applySettings(); closeModal(); title(); toast('新的旅程开始了。'); break;
      case 'discard-snapshot': profile.suspendedRun = null; save(); camp(); break;
      case 'restore': if (profile.stats.bossKills && S.Store.canAfford(profile, D.storyCost) && !profile.storyComplete) {
        for (const k of Object.keys(D.storyCost)) profile.resources[k] -= D.storyCost[k];
        profile.storyComplete = true; save(); audio.play('victory');
        showModal('ending', `<div class="result-emblem">${icon('beacon', 30)}</div><div class="eyebrow">THE LIGHT FINDS A WAY</div><h2 id="modal-title">荒野里，终于有了回音。</h2><p class="journal-quote">“这里是 07 号回收站。<br>我们有灯，有热水，<br>还有一张为你留着的椅子。”</p><p class="intro">许久之后，无线电里传来一声轻轻的回答。<br>世界并没有结束。它只是等着被一点一点修好。</p><div class="divider"></div><p class="settings-note">北境灯塔已修复 · 主线完成<br>营地和装备保留，你仍可以继续远征、升级设施、尝试新的武器组合。</p><div class="modal-actions"><button class="button-primary" data-action="result-camp">为明天，再出发 ${icon('arrow', 18)}</button></div>`, 'result-modal');
      } break;
    }
  });
  document.addEventListener('input', e => {
    const input = e.target; if (!input.dataset.setting) return;
    const k = input.dataset.setting;
    profile.settings[k] = input.type === 'checkbox' ? input.checked : Number(input.value);
    audio.start(profile.settings); applySettings(); save();
  });
  // 战斗键盘输入只在战斗面板生效，弹窗中的焦点导航不会触发移动和射击。
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && modalType) {
      const focusable = [...$('overlay').querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
      if (focusable.length) {
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement.classList.contains('modal'))) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    }
    const key = e.key.toLowerCase();
    if (e.target.matches('input')) return;
    if (view !== 'run') { if (key === 'escape' && modalType) closeContext(); else if (key === 'enter' && view === 'title' && !modalType) { viewport.enter(); audio.start(profile.settings); camp(); } return; }
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'escape', 'm', 'e', 'q'].includes(key)) e.preventDefault();
    if (e.repeat && ['escape', 'm', ' ', 'q'].includes(key)) return;
    if (modalType === 'upgrade' && ['1', '2', '3'].includes(key)) { const btn = $('overlay').querySelectorAll('[data-action="upgrade"]')[Number(key) - 1]; if (btn) btn.click(); return; }
    if (key === 'escape') {
      if (!modalType) pauseMenu(); else if (modalType === 'pause' || modalType === 'map') resumeGame(); else closeContext();
      return;
    }
    if (key === 't' && !modalType) { showTechCodex(); return; }
    if (key === 'm' && (modalType === 'map' || !modalType)) { if (modalType === 'map') resumeGame(); else mapModal(); return; }
    if (modalType || paused) return;
    keys.add(key); if (key === ' ') actions.dash = true; if (key === 'q') actions.heal = true;
  });
  document.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  $('world').addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY }; });
  $('world').addEventListener('pointerdown', e => { if (view === 'run' && !modalType && e.button === 0 && e.pointerType !== 'touch') { mouseDown = true; pointer = { x: e.clientX, y: e.clientY }; } });
  // 右键寻路是可选的单手操作方式，键盘或摇杆输入会立即接管移动。
  function routeTo(target) {
    const cell = 40, cols = Math.ceil(game.world.w / cell), rows = Math.ceil(game.world.h / cell), p = game.player;
    const point = idx => ({ x: (idx % cols + 0.5) * cell, y: (Math.floor(idx / cols) + 0.5) * cell });
    const index = (x, y) => Math.max(0, Math.min(rows - 1, Math.floor(y / cell))) * cols + Math.max(0, Math.min(cols - 1, Math.floor(x / cell)));
    const blocked = idx => { const v = point(idx); return v.x < p.r || v.x > game.world.w - p.r || v.y < p.r || v.y > game.world.h - p.r || game.obstacles.some(o => v.x > o.x - p.r - 4 && v.x < o.x + o.w + p.r + 4 && v.y > o.y - p.r - 4 && v.y < o.y + o.h + p.r + 4); };
    const start = index(p.x, p.y), dest = index(target.x, target.y), queue = [start], prev = new Map([[start, -1]]);
    let found = start, best = Infinity;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q], v = point(cur), d = Math.hypot(v.x - target.x, v.y - target.y);
      if (d < best) { best = d; found = cur; } if (cur === dest) break;
      const cx = cur % cols, cy = Math.floor(cur / cols);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = cx + dx, ny = cy + dy, ni = ny * cols + nx;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || prev.has(ni) || blocked(ni)) continue;
        prev.set(ni, cur); queue.push(ni);
      }
    }
    const route = [];
    while (found !== start && found !== -1) { route.push(point(found)); found = prev.get(found); }
    route.reverse();
    return route;
  }
  $('world').addEventListener('pointerdown', e => {
    if (view === 'run' && !modalType && !paused && e.button === 2) {
      mousePath = routeTo(renderer.screenToWorld(e.clientX, e.clientY)); interactAssist = false; assistTarget = null;
    }
  });
  window.addEventListener('pointerup', () => { mouseDown = false; });
  $('world').addEventListener('contextmenu', e => e.preventDefault());
  let joystickId = null, joystickOrigin = null;
  function resetJoystick() {
    const id = joystickId; joystickId = null; joystickOrigin = null; touchMove = { x: 0, y: 0 };
    const zone = $('joystick-zone'), stick = $('joystick');
    if (id !== null && zone.hasPointerCapture(id)) zone.releasePointerCapture(id);
    zone.classList.remove('active');
    for (const prop of ['left', 'top', 'bottom']) stick.style.removeProperty(prop);
    $('stick').style.transform = '';
  }
  function moveJoystick(e) {
    if (!joystickOrigin) return;
    // 以按下点作为输入原点，边缘夹取和边框不会让“只按住”变成误移动。
    // 位移仍共用舞台的逆旋转，手机竖握时拖动方向与显示方向一致。
    const delta = viewport.vectorToLocal(e.clientX - joystickOrigin.x, e.clientY - joystickOrigin.y);
    const dx = delta.x, dy = delta.y, max = $('joystick').clientWidth * 0.34, len = Math.hypot(dx, dy), scale = len > max ? max / len : 1;
    touchMove = len <= 5 ? { x: 0, y: 0 } : { x: dx * scale / max, y: dy * scale / max }; $('stick').style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
  }
  $('joystick-zone').addEventListener('pointerdown', e => {
    if (view !== 'run' || modalType || paused || joystickId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const zone = $('joystick-zone'), stick = $('joystick'), p = viewport.toLocal(e.clientX, e.clientY), radius = stick.offsetWidth / 2;
    // 起摇中心限制在左下操作区内，按钮与科技入口不会被摇杆捕获。
    const cx = Math.max(radius, Math.min(zone.clientWidth - radius, p.x - zone.offsetLeft));
    const cy = Math.max(radius, Math.min(zone.clientHeight - radius, p.y - zone.offsetTop));
    Object.assign(stick.style, { left: `${cx - radius}px`, top: `${cy - radius}px`, bottom: 'auto' });
    joystickId = e.pointerId; joystickOrigin = { x: e.clientX, y: e.clientY }; zone.setPointerCapture(e.pointerId); zone.classList.add('active'); moveJoystick(e); e.preventDefault();
  });
  $('joystick-zone').addEventListener('pointermove', e => { if (e.pointerId === joystickId) moveJoystick(e); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('joystick-zone').addEventListener(event, e => { if (e.pointerId === joystickId) resetJoystick(); });
  function resetTouchPointers() {
    const captured = [...touchPointers]; touchPointers.clear(); touchInteract = false;
    for (const [button, id] of captured) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
  }
  document.querySelectorAll('[data-touch]').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      if (view !== 'run' || modalType || paused || btn.disabled || touchPointers.has(btn) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      touchPointers.set(btn, e.pointerId); btn.setPointerCapture(e.pointerId);
      const a = btn.dataset.touch; if (a === 'interact') touchInteract = true; else actions[a] = true; e.preventDefault();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(event, e => {
      if (touchPointers.get(btn) !== e.pointerId) return;
      touchPointers.delete(btn); if (btn.dataset.touch === 'interact') touchInteract = false;
    });
  });
  function backgroundPause() {
    clearInput(); if (view === 'run' && game && game.state !== 'result') { checkpoint(); if (!modalType || modalType === 'map') pauseMenu('你暂时离开了页面，远征已经安全暂停。'); else paused = true; }
    audio.setMode('silent');
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) backgroundPause(); else if (view !== 'run') audio.setMode('camp'); });
  window.addEventListener('blur', backgroundPause);
  window.addEventListener('pagehide', checkpoint);
  function viewportChanged(current) {
    isTouch = current.touch; document.body.classList.toggle('touch-layout', isTouch);
    clearInput(); joystickId = null;
    $('touch-controls').hidden = view !== 'run' || !isTouch;
    renderer.resize(); if (view === 'camp') positionCampHotspots();
  }
  function loop(now) {
    const dt = Math.min(0.05, (now - previous) / 1000); previous = now; frame++;
    if (view === 'run' && game) {
      if (!paused && !modalType && game.state === 'running') {
        // 镜头跟随移动时仍以鼠标的屏幕位置重新计算瞄准，避免准星漂移。
        if (mouseDown) aim = renderer.screenToWorld(pointer.x, pointer.y);
        let x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + touchMove.x;
        let y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0) + touchMove.y;
        if (x || y) { mousePath = []; interactAssist = false; }
        else if (mousePath.length) {
          while (mousePath.length && Math.hypot(mousePath[0].x - game.player.x, mousePath[0].y - game.player.y) < 9) mousePath.shift();
          if (mousePath.length) { const next = mousePath[0], len = Math.hypot(next.x - game.player.x, next.y - game.player.y); x = (next.x - game.player.x) / len; y = (next.y - game.player.y) / len; }
        }
        if (interactAssist && (!game.interaction || game.interaction.x !== assistTarget?.x || game.interaction.y !== assistTarget?.y)) { interactAssist = false; assistTarget = null; }
        game.update(dt, { x, y, aimX: mouseDown ? aim.x : undefined, aimY: mouseDown ? aim.y : undefined, manualAim: mouseDown, fire: mouseDown, autoFire: effectiveAutoFire(), dash: actions.dash, interact: keys.has('e') || touchInteract || interactAssist, heal: actions.heal });
        actions.dash = false; actions.heal = false; saveClock += dt;
        if (saveClock >= 10) { checkpoint(); saveClock = 0; }
      }
      if (game.state === 'upgrade' && (!modalType || modalType === 'upgrade')) showUpgrade();
      if (game.state === 'result' && !resultSettled) showResult();
      for (const event of game.drainEvents()) {
        if (!['upgrade', 'result', 'toast'].includes(event.type)) audio.play(event.type);
        if (event.type === 'toast' && event.text) toast(event.text);
        if (event.type === 'overdrive-ready') toast('超载就绪 · 下一次有效射击爆发 8 秒', 3000);
        if (event.type === 'overdrive') toast('超载爆发！射速与回收范围全面提升', 2400);
        if (event.type === 'relay') toast(game.relaysActivated >= 3 ? '三站接通 · 可在中继长按 2 秒唤醒守卫，也可继续搜集。' : `中继站已接通 · ${game.relaysActivated} / 3`, game.relaysActivated >= 3 ? 5000 : 3000);
        if (event.type === 'exit-open') toast('南侧绿圈可呼叫接应 · 想要核心与强化，继续挑战金色中继。', 5000);
        if (event.type === 'boss') toast('北侧检测到巨大能量反应。废墟守卫已苏醒！', 4500);
      }
      renderer.draw(game, paused || modalType ? 0 : dt);
      if (frame % 4 === 0) updateHUD();
      if (!paused && !modalType) audio.setMode('run', game.threat);
    } else if (frame % 2 === 0) { renderer.drawCamp(now / 1000, profile.facilities); if (view === 'camp' && frame % 30 === 0) positionCampHotspots(); }
    requestAnimationFrame(loop);
  }
  viewport = new S.Viewport($('game-viewport'), { onChange: viewportChanged });
  S.viewport = viewport;
  installArt(); applySettings(); title(); renderer.resize(); updateSaveWarning(); requestAnimationFrame(loop);
})();
