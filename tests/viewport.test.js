const test = require('node:test');
const assert = require('node:assert/strict');
const Viewport = require('../src/viewport.js');

function events(target = {}) {
  const listeners = new Map();
  target.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  };
  target.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  target.emit = type => { for (const fn of listeners.get(type) || []) fn(); };
  target.listenerCount = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return target;
}

function fixture({ width = 390, height = 844, touch = true, visual = true, padding = {}, scale = 1 } = {}) {
  const props = new Map();
  const style = { position: '', left: '', top: '', width: '', height: '', transform: '', transformOrigin: '',
    setProperty: (key, value) => props.set(key, value), getPropertyValue: key => props.get(key) || '', removeProperty: key => props.delete(key) };
  const calls = { fullscreen: 0, locks: [], unlock: 0, changes: [] };
  const document = events({ fullscreenElement: null });
  const parentElement = { requestFullscreen() { calls.fullscreen++; document.fullscreenElement = parentElement; document.emit('fullscreenchange'); return Promise.resolve(); } };
  const stage = { style, parentElement, getBoundingClientRect() {
    const rotated = style.transform.includes('rotate(90deg)');
    return { left: parseFloat(style.left) * scale, top: parseFloat(style.top) * scale,
      width: parseFloat(rotated ? style.height : style.width) * scale,
      height: parseFloat(rotated ? style.width : style.height) * scale };
  } };
  const orientation = { lock(value) { calls.locks.push(value); return Promise.resolve(); }, unlock() { calls.unlock++; } };
  const host = events({ innerWidth: width, innerHeight: height, navigator: { maxTouchPoints: touch ? 5 : 0 }, screen: { orientation }, document,
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', ...padding }) });
  if (visual) host.visualViewport = events({ width, height, offsetLeft: 0, offsetTop: 0 });
  const viewport = new Viewport(stage, { host, onChange: v => calls.changes.push({ width: v.width, height: v.height, rotated: v.rotated, touch: v.touch }) });
  return { viewport, stage, host, document, parentElement, orientation, calls, props };
}

test('标题保持原方向，点击进入即横屏且同步请求系统全屏', async () => {
  const { viewport, stage, calls, props } = fixture();
  assert.equal(viewport.rotated, false);
  assert.deepEqual([viewport.width, viewport.height], [390, 844]);
  const request = viewport.enter();
  assert.equal(calls.fullscreen, 1);
  assert.equal(viewport.rotated, true);
  assert.deepEqual([viewport.width, viewport.height], [844, 390]);
  assert.equal(stage.style.transform, 'translateX(390px) rotate(90deg)');
  assert.equal(props.get('--game-width'), '844px');
  assert.equal(props.get('--game-height'), '390px');
  assert.equal(await request, true);
  assert.deepEqual(calls.locks, ['landscape']);
});

test('系统转到横屏后撤掉舞台旋转，回到竖屏只旋转一次', async () => {
  const { viewport, stage, host, calls } = fixture();
  await viewport.enter();
  Object.assign(host.visualViewport, { width: 844, height: 390 });
  host.emit('orientationchange');
  assert.equal(viewport.rotated, false);
  assert.deepEqual([viewport.width, viewport.height], [844, 390]);
  assert.equal(stage.style.transform, 'translate(0, 0)');
  Object.assign(host.visualViewport, { width: 390, height: 844 });
  host.visualViewport.emit('resize');
  assert.equal(viewport.rotated, true);
  assert.equal(stage.style.transform, 'translateX(390px) rotate(90deg)');
  assert.equal(calls.fullscreen, 1);
  assert.equal(calls.locks.length, 1);
});

test('安全边距和视觉视口偏移从可用画布扣除，旋转坐标与向量一致', async () => {
  const { viewport, stage, host } = fixture({ padding: { paddingLeft: '8px', paddingRight: '14px', paddingTop: '47px', paddingBottom: '34px' } });
  Object.assign(host.visualViewport, { offsetLeft: 12, offsetTop: 23 });
  await viewport.enter();
  assert.deepEqual([viewport.width, viewport.height], [763, 368]);
  assert.equal(stage.style.left, '20px');
  assert.equal(stage.style.top, '70px');
  assert.deepEqual(viewport.toLocal(338, 170), { x: 100, y: 50 });
  assert.deepEqual(viewport.vectorToLocal(20, 60), { x: 60, y: -20 });
  Object.assign(host.visualViewport, { offsetLeft: 17 });
  host.visualViewport.emit('scroll');
  assert.equal(stage.style.left, '25px');
  assert.deepEqual(viewport.toLocal(343, 170), { x: 100, y: 50 });
});

test('父级 CSS 缩放后仍使用横屏逻辑坐标，不受旋转包围盒影响', async () => {
  const { viewport } = fixture({ scale: 2, padding: { paddingLeft: '10px', paddingTop: '20px' } });
  await viewport.enter();
  assert.deepEqual([viewport.width, viewport.height], [824, 380]);
  assert.deepEqual(viewport.toLocal(680, 240), { x: 100, y: 50 });
  assert.deepEqual(viewport.vectorToLocal(60, 20), { x: 10, y: -30 });
  const natural = fixture({ width: 1000, height: 700, scale: 2, touch: false });
  assert.deepEqual(natural.viewport.toLocal(200, 100), { x: 100, y: 50 });
  assert.deepEqual(natural.viewport.vectorToLocal(60, 20), { x: 30, y: 10 });
});

test('桌面窗口不请求系统全屏，小窗口可预览横屏与触屏布局', async () => {
  const wide = fixture({ width: 1280, height: 720, touch: false, visual: false });
  await wide.viewport.enter();
  assert.equal(wide.viewport.touch, false);
  assert.equal(wide.viewport.rotated, false);
  assert.equal(wide.calls.fullscreen, 0);
  assert.equal(wide.calls.locks.length, 0);
  const small = fixture({ touch: false });
  await small.viewport.enter();
  assert.equal(small.viewport.touch, true);
  assert.equal(small.viewport.rotated, true);
  assert.equal(small.calls.fullscreen, 0);
  assert.equal(small.calls.locks.length, 0);
});

test('全屏或方向锁被拒绝时横向游戏布局仍可使用，拒绝不向外抛出', async () => {
  const { viewport, parentElement, orientation, calls } = fixture();
  parentElement.requestFullscreen = () => Promise.reject(new Error('NotAllowedError'));
  orientation.lock = value => { calls.locks.push(value); return Promise.reject(new Error('SecurityError')); };
  assert.equal(await viewport.enter(), false);
  assert.equal(viewport.rotated, true);
  assert.deepEqual(calls.locks, ['landscape']);
  parentElement.requestFullscreen = () => { throw new Error('NotSupportedError'); };
  orientation.lock = () => { throw new Error('InvalidStateError'); };
  assert.equal(await viewport.enter(), false);
  assert.equal(viewport.width, 844);
});

test('浏览器没有全屏和方向锁 API 时直接采用舞台横屏', async () => {
  const { viewport, parentElement, host } = fixture();
  delete parentElement.requestFullscreen;
  delete host.screen.orientation;
  assert.equal(await viewport.enter(), false);
  assert.equal(viewport.rotated, true);
  assert.deepEqual(viewport.toLocal(340, 100), { x: 100, y: 50 });
});

test('已有全屏时直接锁横屏，退出全屏不会自动重复进入', async () => {
  const { viewport, document, parentElement, calls } = fixture();
  document.fullscreenElement = parentElement;
  await viewport.enter();
  assert.equal(calls.fullscreen, 0);
  assert.deepEqual(calls.locks, ['landscape']);
  document.fullscreenElement = null;
  document.emit('fullscreenchange');
  assert.equal(calls.fullscreen, 0);
  assert.equal(viewport.rotated, true);
  await viewport.enter();
  assert.equal(calls.fullscreen, 1);
});

test('重复进入共享同一个未完成请求，避免并发全屏和方向锁', async () => {
  const { viewport, parentElement, orientation, calls } = fixture();
  let finishFullscreen, finishLock;
  parentElement.requestFullscreen = () => { calls.fullscreen++; return new Promise(resolve => { finishFullscreen = resolve; }); };
  orientation.lock = value => { calls.locks.push(value); return new Promise(resolve => { finishLock = resolve; }); };
  const first = viewport.enter(), second = viewport.enter();
  assert.equal(first, second);
  assert.equal(calls.fullscreen, 1);
  finishFullscreen();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.locks, ['landscape']);
  assert.equal(viewport.enter(), first);
  finishLock();
  assert.equal(await first, true);
});

test('重复 resize 只在实际布局变化时通知，销毁移除所有监听并还原样式', async () => {
  const { viewport, stage, host, document, calls, props } = fixture();
  const initialCount = calls.changes.length;
  host.emit('resize'); host.visualViewport.emit('resize'); document.emit('fullscreenchange');
  assert.equal(calls.changes.length, initialCount);
  await viewport.enter();
  assert.equal(host.listenerCount(), 2);
  assert.equal(host.visualViewport.listenerCount(), 2);
  assert.equal(document.listenerCount(), 1);
  viewport.dispose();
  assert.equal(host.listenerCount() + host.visualViewport.listenerCount() + document.listenerCount(), 0);
  assert.equal(calls.unlock, 1);
  assert.equal(stage.style.transform, '');
  assert.equal(props.has('--game-width'), false);
  const lastCount = calls.changes.length;
  host.innerWidth = 999; host.emit('resize'); viewport.update();
  assert.equal(calls.changes.length, lastCount);
  assert.equal(await viewport.enter(), false);
  assert.equal(calls.fullscreen, 1);
  viewport.dispose();
  assert.equal(calls.unlock, 1);
});

test('全屏等待期间销毁不会继续请求方向锁', async () => {
  const { viewport, parentElement, calls } = fixture();
  let complete;
  parentElement.requestFullscreen = () => new Promise(resolve => { complete = resolve; });
  const pending = viewport.enter();
  viewport.dispose();
  complete();
  assert.equal(await pending, false);
  assert.equal(calls.locks.length, 0);
});

test('方向锁等待期间销毁，晚到的成功结果也会解除锁定', async () => {
  const { viewport, orientation, calls } = fixture();
  let complete;
  orientation.lock = () => new Promise(resolve => { complete = resolve; });
  const pending = viewport.enter();
  await new Promise(resolve => setImmediate(resolve));
  viewport.dispose();
  complete();
  await pending;
  assert.equal(calls.unlock, 1);
});
