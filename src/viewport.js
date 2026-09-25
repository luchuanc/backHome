(function (root, factory) {
  'use strict';
  const Viewport = factory();
  if (typeof module === 'object' && module.exports) module.exports = Viewport;
  if (root) (root.Scrap || (root.Scrap = {})).Viewport = Viewport;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  class Viewport {
    constructor(stage, { onChange, host = typeof window !== 'undefined' ? window : null } = {}) {
      if (!stage || !host) throw new TypeError('横屏控制器需要游戏容器和窗口。');
      this.stage = stage;
      this.host = host;
      this.onChange = onChange;
      this.active = false;
      this.width = 0;
      this.height = 0;
      this.rotated = false;
      this.touch = false;
      this._disposed = false;
      this._pending = null;
      this._locked = false;
      this._signature = '';
      this._listeners = [];
      this._originalStyle = {};
      for (const key of ['position', 'left', 'top', 'width', 'height', 'transform', 'transformOrigin']) this._originalStyle[key] = stage.style[key];
      for (const key of ['--game-width', '--game-height']) this._originalStyle[key] = stage.style.getPropertyValue(key);
      this._update = () => this.update();
      this._listen(host, 'resize');
      this._listen(host, 'orientationchange');
      this._listen(host.visualViewport, 'resize');
      this._listen(host.visualViewport, 'scroll');
      this._listen(host.document, 'fullscreenchange');
      this.update();
    }

    _listen(target, type) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, this._update);
      this._listeners.push([target, type]);
    }

    _hasTouch() {
      return Number(this.host.navigator && this.host.navigator.maxTouchPoints) > 0 || 'ontouchstart' in this.host;
    }

    update() {
      if (this._disposed) return;
      const host = this.host, visual = host.visualViewport;
      const physicalWidth = visual ? visual.width : host.innerWidth;
      const physicalHeight = visual ? visual.height : host.innerHeight;
      const padding = this.stage.parentElement && host.getComputedStyle ? host.getComputedStyle(this.stage.parentElement) : {};
      const inset = key => Math.max(0, parseFloat(padding[key]) || 0);
      const left = (visual ? visual.offsetLeft : 0) + inset('paddingLeft');
      const top = (visual ? visual.offsetTop : 0) + inset('paddingTop');
      const availableWidth = Math.max(1, physicalWidth - inset('paddingLeft') - inset('paddingRight'));
      const availableHeight = Math.max(1, physicalHeight - inset('paddingTop') - inset('paddingBottom'));
      this.touch = this._hasTouch() || Math.min(physicalWidth, physicalHeight) <= 600;
      this.rotated = this.active && this.touch && availableHeight > availableWidth;
      this.width = this.rotated ? availableHeight : availableWidth;
      this.height = this.rotated ? availableWidth : availableHeight;
      this._left = left;
      this._top = top;
      this._physicalWidth = availableWidth;
      this._physicalHeight = availableHeight;
      const signature = [left, top, this.width, this.height, this.rotated, this.touch].join(':');
      if (signature === this._signature) return;
      this._signature = signature;

      // 系统不允许锁定方向时，整个游戏舞台一起旋转，画面与触控仍共享横向逻辑坐标。
      Object.assign(this.stage.style, {
        position: 'absolute', left: left + 'px', top: top + 'px',
        width: this.width + 'px', height: this.height + 'px', transformOrigin: '0 0',
        transform: this.rotated ? 'translateX(' + availableWidth + 'px) rotate(90deg)' : 'translate(0, 0)'
      });
      this.stage.style.setProperty('--game-width', this.width + 'px');
      this.stage.style.setProperty('--game-height', this.height + 'px');
      if (this.onChange) this.onChange(this);
    }

    enter() {
      if (this._disposed) return Promise.resolve(false);
      this.active = true;
      this.update();
      if (!this._hasTouch()) return Promise.resolve(false);
      if (this._pending) return this._pending;

      // requestFullscreen 必须在这次点击的同步调用栈中执行，不能先等待其他异步操作。
      const document = this.host.document;
      const target = this.stage.parentElement || this.stage;
      let fullscreen;
      if (!document || !document.fullscreenElement) {
        try { fullscreen = target.requestFullscreen ? target.requestFullscreen() : undefined; }
        catch (_) { fullscreen = undefined; }
      }
      this._pending = Promise.resolve(fullscreen).catch(() => undefined).then(() => {
        if (this._disposed) return false;
        const orientation = this.host.screen && this.host.screen.orientation;
        if (!orientation || typeof orientation.lock !== 'function') return false;
        // HTTP 局域网、iOS 或权限策略可能拒绝锁屏；失败不影响已生效的舞台横屏。
        try { return Promise.resolve(orientation.lock('landscape')).then(() => { this._locked = true; return true; }, () => false); }
        catch (_) { return false; }
      }).then(locked => {
        this._pending = null;
        if (!this._disposed) this.update();
        else if (locked) this._unlock();
        return locked;
      });
      return this._pending;
    }

    _metrics() {
      const rect = this.stage.getBoundingClientRect();
      // 使用舞台实际显示尺寸修正外层缩放，不把旋转后的 Canvas 包围盒当作逻辑分辨率。
      return {
        left: rect.left, top: rect.top,
        width: rect.width || this._physicalWidth,
        height: rect.height || this._physicalHeight
      };
    }

    toLocal(clientX, clientY) {
      const rect = this._metrics();
      if (this.rotated) return { x: (clientY - rect.top) * this.width / rect.height, y: (rect.left + rect.width - clientX) * this.height / rect.width };
      return { x: (clientX - rect.left) * this.width / rect.width, y: (clientY - rect.top) * this.height / rect.height };
    }

    vectorToLocal(dx, dy) {
      const rect = this._metrics();
      if (this.rotated) return { x: dy * this.width / rect.height, y: -dx * this.height / rect.width };
      return { x: dx * this.width / rect.width, y: dy * this.height / rect.height };
    }

    _unlock() {
      if (!this._locked) return;
      const orientation = this.host.screen && this.host.screen.orientation;
      try { if (orientation && typeof orientation.unlock === 'function') orientation.unlock(); } catch (_) {}
      this._locked = false;
    }

    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      for (const [target, type] of this._listeners) target.removeEventListener(type, this._update);
      this._listeners.length = 0;
      this._unlock();
      for (const [key, value] of Object.entries(this._originalStyle)) {
        if (key.startsWith('--')) {
          if (value) this.stage.style.setProperty(key, value);
          else this.stage.style.removeProperty(key);
        } else this.stage.style[key] = value;
      }
    }
  }

  return Viewport;
});
