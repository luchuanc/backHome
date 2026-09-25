# 最后一家回收站 — 实现契约

完整离线单机浏览器游戏，原生 Canvas 2D + 普通脚本，无 CDN，无构建要求。画面：深青灰废土，暖黄标识，青绿安全区，珊瑚红危险；细致的俯视角手绘工业游戏画面。界面中文。

## 文件责任
- 主代理：index.html、styles.css、src/data.js、src/store.js、src/audio.js、src/ui.js、测试与文档。
- simulation 代理：仅 src/game.js 和 tests/game.test.js。
- renderer 代理：仅 src/renderer.js。
所有脚本 IIFE，在 window.Scrap 命名空间导出；Node 单测可令 global.window=global。顺序 data, camp-art, world-art, ui-art, store, audio, game, renderer, viewport, ui。

## Data
Scrap.DATA = {weapons:[{id,name,tag,description,damage,interval,speed,range,pellets,spread,pierce,unlock,color}], upgrades:[{id,name,description,tag,max}], facilities:[{id,name,description,max,costs:[{scrap,circuit,core}]}], tools:[{id,name,description}], duration:600, world:{w:2400,h:1800}}。
weapon ids: rivet, scatter, arc, saw。升级 ids: damage, haste, speed, hull, magnet, pierce, ricochet, chain, orbit, salvage, regen, crit, dash, freeze, capacitor, leech。工具 ids: magnet, drone, scanner。
设施 ids: workshop, storage, infirmary, beacon。

## Game
new Scrap.Game({weapon:'rivet',tool:'magnet',facilities:{workshop:0,storage:0,infirmary:0,beacon:0},difficulty:'normal',seed:123})。
字段：state='running'|'upgrade'|'result'; world={w,h}; elapsed, duration, threat(1-5), seed; player={x,y,r:14,hp,maxHp,speed,angle,dashCooldown,dashTime,medkits,invulnerable,capacity,bag:{scrap,circuit,core},xp,xpNext,level}; enemies=[],bullets=[],drops=[],containers=[],obstacles=[],relays=[],effects=[],texts=[]; exit={x:1200,y:1530,r:88,progress:0,available:false}; kills, relaysActivated, bossSpawned,bossDefeated; upgradeChoices=[upgrade ids]; upgrades={id:count}; result=null; events=[]; interaction=null|{name,progress,x,y}; stats={shots,damageDealt,...}。
每个实体必须 id，坐标 x,y。
enemy={id,type:'crawler'|'runner'|'spitter'|'brute'|'boss',x,y,r,hp,maxHp,angle,hitFlash,attackTimer,telegraph:0}；bullet={id,x,y,vx,vy,r,life,enemy:boolean,color,kind,damage}; drop={id,x,y,type:'scrap'|'circuit'|'core'|'xp'|'heal',amount,r}; container={id,x,y,r,kind:'crate'|'cache'|'medbox',opened,progress}; obstacle={id,x,y,w,h,kind:'building'|'car'|'barrel'|'scrap'}（x,y 为矩形左上角）。relay={id,x,y,r:25,active,progress}。
effect={x,y,type:'hit'|'burst'|'dash'|'ring'|'lightning'|'shot',life,maxLife,color,r, [x2,y2]}; text={x,y,text,color,life,maxLife}。
bag weight = scrap+circuit+core*3。核心保留明确容量判断。所有属性初始化为有限值。

update(dt,input) 真实时间 dt 秒，上限 0.05；input={x,y,aimX,aimY,manualAim:false,fire:false,autoFire:true,dash:false,interact:false,heal:false}。x/y 为 -1..1。autoFire 默认开启，瞄准最近范围敌人；manualAim 为按住鼠标左键。dash/heal 按边沿触发由 UI 控制。游戏暂停由 UI 停止调用 update。upgrade 状态冻结战斗；chooseUpgrade(id) 校验候选，升级后恢复。drainEvents()返回并清空事件。finish(success,reason)幂等；result={success,reason,elapsed,kills,level,bag:{...},kept:{...},lost:{...},bossDefeated,relaysActivated,seed}。失败保留35% scrap/circuit，核心丢失；胜利保留全部。背包装不下的掉落留在地面，不消失。
事件：{type:'shot'|'hit'|'hurt'|'kill'|'pickup'|'dash'|'heal'|'open'|'relay'|'boss'|'upgrade'|'extract'|'result'|'toast',text?,...}。
可选方法 serialize()和静态 fromSnapshot(snapshot)恢复完整战局含随机数状态，给中断存档使用；若实现困难及时沟通，不要静默删去功能。

## 核心玩法
一局600秒。出生点靠近撤离点，前30秒弱敌可学习；45秒后可以随时在出口按住E两秒撤离。拾荒箱按住E 0.9秒打开。3个中继站按住E 1.3秒激活后锁定Boss信号，可在已接通中继重新长按2秒提前唤醒Boss，或第6分钟自动在地图北部唤醒（2400生命）；第3和第5分钟各在可达位置生成医疗箱与稀有补给箱，给生存阶段提供探索目标；Boss击败至少掉3核心。6分后压力提高；10分钟风暴结束失败。精英概率掉核心，稀有箱至少1核心以便非Boss路线也能成长。通过击败敌人拾经验升等级，三选一强化。每次升级提供有效未满级候选，禁止不可用强化。4武器必须实质不同：铆钉直射、霰弹散射、电弧连锁、圆锯穿透回旋。角色碰撞墙体、敌人不能在墙内出生；子弹要处理遮挡（除特定穿透能力）。初始2急救包，Q回复40%。冲刺有无敌帧与冷却；自动射击，无弹药焦虑。工具磁铁扩大拾取；无人机定时额外射击；探测器提高资源发现/开箱效果。设施工作台每级提高少量伤害，仓库每级+12容量，医疗每级+15生命，信标每级缩短撤离与提高资源收益。保持公平且可通关的难度曲线。

## Renderer
new Scrap.Renderer(canvas); resize()读取client宽高, dpr<=1.5; draw(game,dt)只渲染不改变游戏；drawCamp(time,facilities)营地/标题画面；screenToWorld(clientX,clientY)基于摄像机返回{x,y}；drawMap(game,canvas,large=false)画小地图（地图坐标可文字表达）。camera={x,y,zoom}; setReducedMotion(bool)。如需要其他实体字段可自行增加，及时告知 simulation。
世界应该有地面裂痕、道路标线、建筑阴影、管线、集装箱、植被、照明、出口灯环；玩家有头盔背包武器、步行动画；敌人轮廓明显、血条；命中粒子、伤害字、枪口闪光、弹道、可读的Boss预警；显示互动E标签。画出实际碰撞体不要仅装饰。营地以完整轻等距回收站场景为主视觉，设施热点直接对应建筑，工作台、塔吊、灯塔、围栏、风力设备等统一风格。场景不是通用占位几何，尽可能精细有层次。

## UI/储存/音频
UI完整流程：标题→营地→装备选择→出发→初次引导→战斗→强化→撤离/死亡/超时→结算→营地。营地有设施、仓库资源、4武器与工具、远征日志、设置。修复灯塔（额外最终目标支付120 scrap+12 circuit+3 core且击败Boss）完成故事后可继续玩。
存档版本化、安全解析、存储失败提示、导入导出JSON、明确覆盖确认（游戏内）、中断远征恢复、设置持久化。切出页面自动暂停并保存，回来不自动继续。键盘WASD/箭头、空格冲刺、E互动、Q急救、M地图、Esc暂停，触屏支持虚拟摇杆和操作按钮；窄竖屏提示横屏但界面仍可操作。
音频WebAudio程序生成，首次手势启用，音乐/音效独立音量，静音、节制的动态音乐，无外部资源。


## 1.1 风暴回路补充契约

新增进化 ID：metalstorm、thunder、shatter、gravity，`requires:[{id,level}]` 来自 DATA.upgrades。UI 从同一字段读取配方，`DATA.builds` 只描述流派颜色与归类，不自行推断解锁条件。新增 `rerollUpgrades():boolean`，每局 2 次；可用项足够时始终三选一，有替代候选才扣次数。

公开状态：combo、comboTimer、bestCombo、overdriveCharge、overdriveTime、rerolls、waveFlags。1.1 远征快照为 version 2；当前版本与兼容规则见下方 1.2 补充。营地存档主版本不变。迁移按 elapsed 标记已过去的敌潮，不能恢复后补刷。

所有主武器的弹道可获得 chain 科技；arc 自带 2 跳，其余武器基础 0 跳。每枚弹道的连锁预算只消耗不重置，碎片与无人机不递归连锁。Orbit 1/2/3 级对应 1/2/3 枚等角度刀片，同 tick 同目标至多命中一次。冰爆半径 120、基础伤害 70，禁止同一风暴递归引爆。

世界图集与 UI 图集均为 imagegen 输出的 PNG。图集按实际尺寸等分读取；图片内嵌独立 HTML。大图 data URL 转换为页面 Blob URL 后设置 CSS 变量，避免浏览器 CSS 变量长度限制。程序只处理裁切、排列、光效与实时反馈，不重新生成替代插画。


## 自动横屏

`Scrap.Viewport` 统一逻辑画布尺寸与物理触点转换。启动按钮用户手势内调用 `enter()`；原生全屏和方向锁被拒绝不阻止游戏，竖屏通过整体舞台旋转90度保持横向布局。UI全部位于 `#game-viewport` 内；尺寸断点使用 `@container game`，尺寸单位基于 `--game-width/height`，不能重新引入物理视口 vw/vh 布局。坐标点使用 `viewport.toLocal()`，摇杆位移向量使用 `viewport.vectorToLocal()`；浏览器DOM按钮自行处理变换。尺寸变化清除活动输入，营地锚点与画布一同调整。

`npm run lan` 以 0.0.0.0:8766 监听，保留默认 `npm start` 的 127.0.0.1:8765 入口。只提供当前游戏项目静态资源。

## 1.2 回收行动补充契约

- `getCoreExchange()` 返回 `null` 或 `{dropId,coreAmount,scrapCost}`，只针对拾取范围内一个真实核心掉落栈。代价为获取这些核心所需腾出的最小废铁量，不丢电路。UI暂停并明确展示代价；`exchangeCore(dropId):boolean` 当场重新验证并一次扣料入包。正常拾取先处理核心，装不下的物资不消失。
- 三站接通后已激活中继提供 `interaction.kind='summon', name='唤醒守卫'`，长按2秒触发。这替换原规则的六分钟强制等待，原六分钟自动唤醒条件仍保留，Boss只能出现一次。最后一站激活后必须先松手，防止把激活动作误延续为挑战；`timers.summonNeedsRelease` 随快照保存。
- 常规生成概率：前30秒爬行/奔袭72/28%；其后威胁1为78/22%，威胁2–3为爬行58%、喷吐20%、奔袭22%，威胁4–5为爬行58%、喷吐20%、奔袭5%、重型17%。定时波次和精英判定不变。
- 超载100且计时0表示就绪；武器冷却结束、有射程内无遮挡存活目标且玩家实际开火时才启动8秒。新增 `overdrive-ready` 提示，不添加移动端技能按钮。撤离首次开放产生 `exit-open` 事件，以已保存的 `exit.available` 防止恢复重播。
- `trackBuild(id|null):boolean`、`trackedBuild`、`trackingMisses`（0–2）、`trackingGuarantee`（null或本次保底科技ID）。只允许追踪未拥有的进化，配方取 `DATA.upgrades.requires`。连续两次新等级首抽没有可用缺件，下次保证一张；重抽不修改计数且保留已兑现保底，配齐的追踪进化优先提供。切换追踪清零计数，不重新生成当次候选。进化安装后结束追踪。
- 当前快照 version 3；version 1先做既有迁移，再与version 2显式补入追踪字段与松手保护。新字段严格校验。`result` 追加 `weapon`、`build:[{id,level}]`、`medkitsLeft`。营地v1日志允许已发布旧记录无这三个字段；新摘要要求成组、合法ID和等级，不凭空补齐。
- `Store.nextGoal(profile,cargo?)` 返回null或 `{kind:'facility',id,name,targetLevel,cost,missing,affordable,unlockWeapon:null|{id,name},description}`。优先可支付设施，再按所缺背包格数排序，同缺口按工作台/仓库/医疗/信标。cargo只做成功带回预测，不改变库存。设施满级后不推荐。
