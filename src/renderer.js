/*
 * 最后一家回收站：Canvas 2D 渲染器
 * 这个文件只负责把 Game 的只读状态画出来，不参与游戏逻辑和数值更新。
 */
(function (root) {
  'use strict';

  var Scrap = root.Scrap = root.Scrap || {};
  var TAU = Math.PI * 2;
  var FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  // 图集坐标统一使用四等分，实际 PNG 尺寸由 naturalWidth/naturalHeight 决定。
  var WORLD_SPRITES = {
    obstacle: {
      buildingWide: [0, 0], buildingTall: [0, 1], car: [0, 2], barrel: [0, 3], scrap: [1, 0]
    },
    container: { crate: [1, 1], cache: [1, 2], medbox: [1, 3] },
    relay: { offline: [2, 0], active: [2, 1] },
    exit: [2, 2],
    drop: { scrap: [2, 3], circuit: [3, 0], core: [3, 1], xp: [3, 2], heal: [3, 3] },
    enemy: { crawler: [0, 1], runner: [0, 2], spitter: [0, 3], brute: [1, 0], boss: [1, 1] },
    player: [0, 0]
  };

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : (fallback || 0);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, finite(value, min)));
  }

  function hash(x, y, seed) {
    var value = Math.sin((x * 12.9898) + (y * 78.233) + (seed || 0) * 37.719) * 43758.5453;
    return value - Math.floor(value);
  }

  function safeText(value, fallback) {
    return value === undefined || value === null ? (fallback || '') : String(value);
  }

  function colorAlpha(color, alpha) {
    var value = safeText(color, '#ffffff');
    if (value.charAt(0) !== '#') return value;
    var raw = value.slice(1);
    if (raw.length === 3) {
      raw = raw.split('').map(function (part) { return part + part; }).join('');
    }
    if (raw.length !== 6) return value;
    var number = parseInt(raw, 16);
    return 'rgba(' + ((number >> 16) & 255) + ',' + ((number >> 8) & 255) + ',' + (number & 255) + ',' + clamp(alpha, 0, 1) + ')';
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var radius = Math.max(0, Math.min(Math.abs(w) / 2, Math.min(Math.abs(h) / 2, finite(r, 8))));
    var right = x + w;
    var bottom = y + h;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(right - radius, y);
    ctx.quadraticCurveTo(right, y, right, y + radius);
    ctx.lineTo(right, bottom - radius);
    ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
    ctx.lineTo(x + radius, bottom);
    ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function fillRoundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth) {
    roundRectPath(ctx, x, y, w, h, r);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function line(ctx, x1, y1, x2, y2, stroke, width, alpha) {
    ctx.save();
    ctx.strokeStyle = alpha === undefined ? stroke : colorAlpha(stroke, alpha);
    ctx.lineWidth = width || 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function circle(ctx, x, y, radius, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, finite(radius)), 0, TAU);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function polygon(ctx, points, fill, stroke, lineWidth) {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function worldEntityId(entity, index) {
    return safeText(entity && entity.id, 'entity-' + index);
  }

  function entityNumber(entity, key, fallback) {
    return finite(entity && entity[key], fallback);
  }

  function rectVisible(item, view, pad) {
    var extra = finite(pad, 40);
    var x = entityNumber(item, 'x', 0);
    var y = entityNumber(item, 'y', 0);
    var w = entityNumber(item, 'w', entityNumber(item, 'r', 16) * 2);
    var h = entityNumber(item, 'h', entityNumber(item, 'r', 16) * 2);
    return x + w > view.left - extra && x < view.right + extra && y + h > view.top - extra && y < view.bottom + extra;
  }

  function pointVisible(item, view, pad) {
    var extra = finite(pad, 40) + entityNumber(item, 'r', 12);
    var x = entityNumber(item, 'x', 0);
    var y = entityNumber(item, 'y', 0);
    return x > view.left - extra && x < view.right + extra && y > view.top - extra && y < view.bottom + extra;
  }

  function formatNumber(value) {
    var amount = Math.max(0, Math.round(finite(value, 0)));
    if (amount > 9999) return Math.floor(amount / 1000) + 'k';
    return String(amount);
  }

  function Renderer(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('Scrap.Renderer 需要 Canvas 元素');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.camera = { x: 1200, y: 900, zoom: 1 };
    this.reducedMotion = false;
    this._time = 0;
    this._lastGame = null;
    this._frame = 0;
    this._campArtImage = null;
    this._campArtSource = '';
    this._campArtState = 'idle';
    this._campArtRect = { x: 0, y: 0, w: 1, h: 1 };
    this._groundPattern = null;
    this._worldArtImages = { combat: null, environment: null };
    this._worldArtSources = { combat: '', environment: '' };
    this._worldArtStates = { combat: 'idle', environment: 'idle' };
    this._groundAtlasPatterns = null;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var canvas = this.canvas;
    var rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    var parent = canvas.parentElement;
    var parentWidth = finite(parent && parent.clientWidth, 0);
    var parentHeight = finite(parent && parent.clientHeight, 0);
    var viewportWidth = finite(root.innerWidth, 0);
    var viewportHeight = finite(root.innerHeight, 0);
    var width = finite(canvas.clientWidth, 0) || finite(rect && rect.width, 0) || parentWidth || viewportWidth || finite(canvas.width, 1280) || 1280;
    var height = finite(canvas.clientHeight, 0) || finite(rect && rect.height, 0) || parentHeight || viewportHeight || finite(canvas.height, 720) || 720;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.dpr = Math.min(1.5, Math.max(1, finite(root.devicePixelRatio, 1)));
    canvas.width = Math.max(1, Math.floor(this.width * this.dpr));
    canvas.height = Math.max(1, Math.floor(this.height * this.dpr));
    // 不写入 inline 宽高，交给 width:100%;height:100% 的布局随 viewport 变化。
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { width: this.width, height: this.height, dpr: this.dpr };
  };

  Renderer.prototype.setReducedMotion = function (value) {
    this.reducedMotion = Boolean(value);
  };

  // 素材脚本可能晚于 Renderer 执行，因此每次营地绘制前都检查一次来源是否出现。
  Renderer.prototype._ensureCampArt = function () {
    var source = typeof Scrap.campArt === 'string' ? Scrap.campArt : '';
    if (!source || source === this._campArtSource || this._campArtState === 'loading') return;
    this._campArtSource = source;
    this._campArtState = 'loading';
    if (typeof root.Image !== 'function') {
      this._campArtState = 'unavailable';
      return;
    }
    var image = new root.Image();
    var self = this;
    image.onload = function () {
      self._campArtImage = image;
      self._campArtState = image.naturalWidth > 0 && image.naturalHeight > 0 ? 'ready' : 'unavailable';
    };
    image.onerror = function () {
      self._campArtImage = null;
      self._campArtState = 'unavailable';
    };
    image.src = source;
  };

  // 战斗图集独立加载，素材脚本若晚于 renderer 注入，下一帧仍会自动接管。
  Renderer.prototype._ensureWorldArt = function () {
    var art = Scrap.worldArt || {};
    var self = this;
    ['combat', 'environment'].forEach(function (kind) {
      var source = typeof art[kind] === 'string' ? art[kind] : '';
      if (!source || source === self._worldArtSources[kind] || self._worldArtStates[kind] === 'loading') return;
      self._worldArtSources[kind] = source;
      self._worldArtStates[kind] = 'loading';
      self._groundAtlasPatterns = null;
      if (typeof root.Image !== 'function') {
        self._worldArtStates[kind] = 'unavailable';
        return;
      }
      var image = new root.Image();
      image.onload = function () {
        self._worldArtImages[kind] = image;
        self._worldArtStates[kind] = (image.naturalWidth || image.width) > 0 && (image.naturalHeight || image.height) > 0 ? 'ready' : 'unavailable';
        self._groundAtlasPatterns = null;
      };
      image.onerror = function () {
        self._worldArtImages[kind] = null;
        self._worldArtStates[kind] = 'unavailable';
        self._groundAtlasPatterns = null;
      };
      image.src = source;
    });
  };

  Renderer.prototype._atlasCell = function (kind, row, column) {
    if (this._worldArtStates[kind] !== 'ready') return null;
    var image = this._worldArtImages[kind];
    var imageWidth = image && (image.naturalWidth || image.width);
    var imageHeight = image && (image.naturalHeight || image.height);
    if (!image || imageWidth <= 0 || imageHeight <= 0) return null;
    var cellWidth = imageWidth / 4;
    var cellHeight = imageHeight / 4;
    return {
      image: image,
      sx: clamp(column, 0, 3) * cellWidth,
      sy: clamp(row, 0, 3) * cellHeight,
      sw: cellWidth,
      sh: cellHeight
    };
  };

  // 所有世界精灵通过一个小入口绘制，命中闪白和旋转不会污染外层 canvas 状态。
  Renderer.prototype._drawAtlasSprite = function (ctx, kind, row, column, x, y, width, height, rotation, hitFlash) {
    var cell = this._atlasCell(kind, row, column);
    if (!cell || !ctx || typeof ctx.drawImage !== 'function') return false;
    var drawWidth = Math.max(1, finite(width, cell.sw));
    var drawHeight = Math.max(1, finite(height, cell.sh));
    ctx.save();
    ctx.translate(finite(x, 0), finite(y, 0));
    if (Number.isFinite(rotation) && rotation) ctx.rotate(rotation);
    ctx.drawImage(cell.image, cell.sx, cell.sy, cell.sw, cell.sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    var flash = clamp(hitFlash, 0, 1);
    if (flash > 0) {
      ctx.globalAlpha = flash;
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(cell.image, cell.sx, cell.sy, cell.sw, cell.sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    }
    ctx.restore();
    return true;
  };

  // 生成图集的四个地面单元先缩成可重复的小纹理，正常战斗不再重复绘制旧矢量裂纹。
  Renderer.prototype._ensureGroundAtlasPatterns = function () {
    if (this._groundAtlasPatterns) return this._groundAtlasPatterns;
    var cells = [
      ['asphalt', 3, 0], ['road', 3, 1], ['grass', 3, 2], ['metal', 3, 3]
    ];
    var patterns = {};
    if (typeof this.ctx.createPattern !== 'function') return null;
    for (var i = 0; i < cells.length; i += 1) {
      var cell = this._atlasCell('environment', cells[i][1], cells[i][2]);
      if (!cell) return null;
      var tile = null;
      if (typeof root.OffscreenCanvas === 'function') tile = new root.OffscreenCanvas(128, 128);
      else if (root.document && typeof root.document.createElement === 'function') {
        tile = root.document.createElement('canvas');
        tile.width = 128;
        tile.height = 128;
      }
      if (!tile || typeof tile.getContext !== 'function') return null;
      var tileCtx = tile.getContext('2d');
      if (!tileCtx || typeof tileCtx.drawImage !== 'function') return null;
      tileCtx.clearRect(0, 0, 128, 128);
      tileCtx.drawImage(cell.image, cell.sx, cell.sy, cell.sw, cell.sh, 0, 0, 128, 128);
      patterns[cells[i][0]] = this.ctx.createPattern(tile, 'repeat');
      if (!patterns[cells[i][0]]) return null;
    }
    this._groundAtlasPatterns = patterns;
    return patterns;
  };

  // 返回营地素材归一化坐标对应的屏幕坐标，给 DOM 热点定位使用。
  Renderer.prototype.campAnchor = function (u, v) {
    var rect = this._campArtRect || { x: 0, y: 0, w: this.width, h: this.height };
    var image = this._campArtImage;
    var imageWidth = image && (image.naturalWidth || image.width);
    var imageHeight = image && (image.naturalHeight || image.height);
    if (this._campArtState === 'ready' && imageWidth > 0 && imageHeight > 0) {
      var imageScale = Math.min(this.width / imageWidth, this.height / imageHeight);
      rect = this._campArtRect = {
        x: (this.width - imageWidth * imageScale) / 2,
        y: (this.height - imageHeight * imageScale) / 2,
        w: imageWidth * imageScale,
        h: imageHeight * imageScale
      };
    } else if (this.width > 1 && this.height > 1) {
      var fallbackScale = Math.max(this.width / 980, this.height / 650);
      rect = this._campArtRect = {
        x: (this.width - 980 * fallbackScale) / 2,
        y: (this.height - 650 * fallbackScale) / 2,
        w: 980 * fallbackScale,
        h: 650 * fallbackScale
      };
    }
    return {
      x: rect.x + clamp(u, 0, 1) * rect.w,
      y: rect.y + clamp(v, 0, 1) * rect.h
    };
  };

  // 地面纹理只生成一次，使用小像素 tile 重复铺设，避免每帧创建大量细碎路径。
  Renderer.prototype._ensureGroundPattern = function () {
    if (this._groundPattern) return this._groundPattern;
    var tile = null;
    if (typeof root.OffscreenCanvas === 'function') {
      tile = new root.OffscreenCanvas(160, 160);
    } else if (root.document && typeof root.document.createElement === 'function') {
      tile = root.document.createElement('canvas');
      tile.width = 160;
      tile.height = 160;
    }
    if (!tile || typeof tile.getContext !== 'function' || typeof this.ctx.createPattern !== 'function') return null;
    var tileCtx = tile.getContext('2d');
    if (!tileCtx || typeof tileCtx.createPattern !== 'function') return null;
    tileCtx.clearRect(0, 0, 160, 160);
    for (var pebble = 0; pebble < 58; pebble += 1) {
      var px = Math.floor(hash(pebble, 3, 301) * 160);
      var py = Math.floor(hash(pebble, 7, 307) * 160);
      var pebbleSize = 1 + Math.floor(hash(pebble, 11, 313) * 3);
      tileCtx.fillStyle = colorAlpha(pebble % 5 === 0 ? '#b18452' : '#668079', 0.18 + hash(pebble, 13, 317) * 0.2);
      tileCtx.fillRect(px, py, pebbleSize, pebbleSize);
      if (pebble % 4 === 0) tileCtx.fillRect(px + 3, py + 1, 2, 1);
    }
    for (var crack = 0; crack < 7; crack += 1) {
      var crackX = hash(crack, 17, 331) * 150 + 4;
      var crackY = hash(crack, 19, 337) * 150 + 4;
      tileCtx.strokeStyle = colorAlpha(crack % 2 ? '#0b1a1e' : '#956149', 0.24);
      tileCtx.lineWidth = crack % 2 ? 1 : 1.5;
      tileCtx.beginPath();
      tileCtx.moveTo(crackX, crackY);
      tileCtx.lineTo(crackX + 7, crackY + 2);
      tileCtx.lineTo(crackX + 13, crackY - 5);
      tileCtx.lineTo(crackX + 23, crackY - 3);
      tileCtx.stroke();
    }
    for (var weed = 0; weed < 10; weed += 1) {
      var weedX = hash(weed, 23, 349) * 156 + 2;
      var weedY = hash(weed, 29, 353) * 154 + 4;
      tileCtx.strokeStyle = colorAlpha('#7aa07b', 0.28);
      tileCtx.lineWidth = 1;
      tileCtx.beginPath();
      tileCtx.moveTo(weedX, weedY + 6);
      tileCtx.lineTo(weedX - 2, weedY - 2);
      tileCtx.moveTo(weedX, weedY + 6);
      tileCtx.lineTo(weedX + 3, weedY);
      tileCtx.stroke();
    }
    this._groundPattern = this.ctx.createPattern(tile, 'repeat');
    return this._groundPattern;
  };

  Renderer.prototype.screenToWorld = function (clientX, clientY) {
    var rect = typeof this.canvas.getBoundingClientRect === 'function' ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    // 软横屏时先还原到游戏逻辑坐标，再经过相机；旋转后的包围盒不能直接当画布坐标。
    var point = Scrap.viewport ? Scrap.viewport.toLocal(clientX, clientY) : { x: finite(clientX, 0) - finite(rect.left, 0), y: finite(clientY, 0) - finite(rect.top, 0) };
    var px = point.x;
    var py = point.y;
    var zoom = Math.max(0.01, finite(this.camera.zoom, 1));
    return {
      x: finite(this.camera.x, 0) + (px - this.width / 2) / zoom,
      y: finite(this.camera.y, 0) + (py - this.height / 2) / zoom
    };
  };

  // 相机只在渲染器内部平滑跟随玩家，绝不写入 game，避免渲染影响模拟结果。
  Renderer.prototype._updateCamera = function (game) {
    var world = game && game.world ? game.world : { w: 2400, h: 1800 };
    var player = game && game.player ? game.player : null;
    var targetX = entityNumber(player, 'x', finite(world.w, 2400) / 2);
    var targetY = entityNumber(player, 'y', finite(world.h, 1800) / 2);
    var targetZoom = clamp(Math.min(this.width / 920, this.height / 650), 0.58, 1.12);
    if (this.width < this.height * 1.08) targetZoom = clamp(Math.min(this.width / 700, this.height / 780), 0.54, 0.94);
    var follow = this.reducedMotion ? 1 : 0.12;
    this.camera.x += (targetX - this.camera.x) * follow;
    this.camera.y += (targetY - this.camera.y) * follow;
    this.camera.zoom += (targetZoom - this.camera.zoom) * (this.reducedMotion ? 1 : 0.08);
    var halfW = this.width / (2 * Math.max(0.01, this.camera.zoom));
    var halfH = this.height / (2 * Math.max(0.01, this.camera.zoom));
    var worldW = Math.max(1, finite(world.w, 2400));
    var worldH = Math.max(1, finite(world.h, 1800));
    this.camera.x = worldW <= halfW * 2 ? worldW / 2 : clamp(this.camera.x, halfW, worldW - halfW);
    this.camera.y = worldH <= halfH * 2 ? worldH / 2 : clamp(this.camera.y, halfH, worldH - halfH);
  };

  Renderer.prototype._view = function (world) {
    var zoom = Math.max(0.01, finite(this.camera.zoom, 1));
    var halfW = this.width / (2 * zoom);
    var halfH = this.height / (2 * zoom);
    return {
      left: finite(this.camera.x, 0) - halfW,
      right: finite(this.camera.x, 0) + halfW,
      top: finite(this.camera.y, 0) - halfH,
      bottom: finite(this.camera.y, 0) + halfH,
      worldW: finite(world && world.w, 2400),
      worldH: finite(world && world.h, 1800)
    };
  };

  Renderer.prototype.draw = function (game, dt) {
    if (!game) return;
    this._ensureWorldArt();
    var elapsed = clamp(dt, 0, 0.05);
    this._time += elapsed;
    this._frame += 1;
    this._lastGame = game;
    this._updateCamera(game);
    var ctx = this.ctx;
    var shake = this._visualShake(game);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    var view = this._view(game.world);
    ctx.save();
    ctx.translate(this.width / 2 + shake.x, this.height / 2 + shake.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    this._drawGround(ctx, game, view);
    this._drawExit(ctx, game.exit, game);
    this._drawRelays(ctx, game.relays, view, game);
    this._drawObstacles(ctx, game.obstacles, view);
    this._drawContainers(ctx, game.containers, view);
    this._drawDrops(ctx, game.drops, view);
    this._drawBullets(ctx, game.bullets, view);
    this._drawEnemies(ctx, game.enemies, view, game);
    this._drawPlayer(ctx, game.player, game);
    this._drawEffects(ctx, game.effects, game.texts, view);
    this._drawWorldInteraction(ctx, game.interaction, view);
    ctx.restore();
  };

  // 命中只产生很轻的画面反馈，不暂停模拟时间；开启减少动态效果时完全关闭屏震。
  Renderer.prototype._visualShake = function (game) {
    if (this.reducedMotion || !game || !Array.isArray(game.effects)) return { x: 0, y: 0 };
    var intensity = 0;
    var effects = game.effects;
    var limit = Math.min(effects.length, 64);
    for (var i = 0; i < limit; i += 1) {
      var effect = effects[i];
      var type = safeText(effect && effect.type, '');
      if (type !== 'hit' && type !== 'hurt' && type !== 'burst' && type !== 'shot') continue;
      var life = Math.max(0, entityNumber(effect, 'life', 0));
      var maxLife = Math.max(0.01, entityNumber(effect, 'maxLife', 1));
      var pulse = clamp(life / maxLife, 0, 1);
      intensity = Math.max(intensity, type === 'burst' ? pulse * 2.2 : pulse * 0.9);
    }
    if (intensity <= 0) return { x: 0, y: 0 };
    return {
      x: Math.sin(this._time * 83.0) * intensity,
      y: Math.cos(this._time * 71.0) * intensity * 0.72
    };
  };

  Renderer.prototype._drawGround = function (ctx, game, view) {
    var worldW = view.worldW;
    var worldH = view.worldH;
    var atlasGround = this._ensureGroundAtlasPatterns();
    ctx.fillStyle = '#14282c';
    ctx.fillRect(0, 0, worldW, worldH);
    var groundPattern = atlasGround && atlasGround.asphalt ? atlasGround.asphalt : this._ensureGroundPattern();
    if (groundPattern) {
      var textureLeft = Math.max(0, view.left);
      var textureTop = Math.max(0, view.top);
      var textureRight = Math.min(worldW, view.right);
      var textureBottom = Math.min(worldH, view.bottom);
      if (textureRight > textureLeft && textureBottom > textureTop) {
        ctx.save();
        // 图集沥青本身细节密度较高，只作为材质层叠在深青灰底上。
        ctx.globalAlpha = atlasGround ? 0.56 : 0.9;
        ctx.fillStyle = groundPattern;
        ctx.fillRect(textureLeft, textureTop, textureRight - textureLeft, textureBottom - textureTop);
        ctx.restore();
      }
    }

    // 大块路网为玩家提供清晰的方向感，路面纹理全部限制在可见区域。
    ctx.save();
    ctx.globalAlpha = atlasGround && atlasGround.road ? 0.48 : 1;
    ctx.fillStyle = atlasGround && atlasGround.road ? atlasGround.road : '#1b3336';
    ctx.fillRect(0, 620, worldW, 180);
    ctx.fillRect(1060, 0, 190, worldH);
    ctx.fillStyle = atlasGround && atlasGround.road ? atlasGround.road : '#203c3f';
    ctx.fillRect(0, 654, worldW, 112);
    ctx.fillRect(1092, 0, 126, worldH);
    ctx.restore();
    // 图集道路已有浅色破损线；仅在程序化 fallback 时绘制旧标线，避免白线与黄线重叠。
    if (!atlasGround) {
      ctx.fillStyle = colorAlpha('#b59457', 0.28);
      for (var roadMark = Math.floor(view.left / 92) * 92; roadMark < view.right; roadMark += 92) {
        if (roadMark >= 0 && roadMark < worldW) {
          ctx.fillRect(roadMark + 11, 665, 28, 3);
          ctx.fillRect(roadMark + 55, 751, 17, 2);
        }
      }
      for (var roadSeam = Math.floor(view.top / 118) * 118; roadSeam < view.bottom; roadSeam += 118) {
        if (roadSeam >= 0 && roadSeam < worldH) {
          ctx.fillRect(1101, roadSeam + 23, 3, 29);
          ctx.fillRect(1208, roadSeam + 67, 2, 22);
        }
      }
      ctx.strokeStyle = '#d5a647';
      ctx.lineWidth = 3;
      ctx.setLineDash([30, 24]);
      ctx.beginPath();
      ctx.moveTo(0, 710);
      ctx.lineTo(worldW, 710);
      ctx.moveTo(1155, 0);
      ctx.lineTo(1155, worldH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = colorAlpha('#9db0a8', 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 655);
      ctx.lineTo(worldW, 655);
      ctx.moveTo(0, 765);
      ctx.lineTo(worldW, 765);
      ctx.moveTo(1094, 0);
      ctx.lineTo(1094, worldH);
      ctx.moveTo(1216, 0);
      ctx.lineTo(1216, worldH);
      ctx.stroke();
    }
    // 路口与撤离通道的低亮度灯池，给地面材质增加层次但不遮挡碰撞体。
    var lamps = [[1155, 710, 220], [360, 710, 150], [1740, 710, 170], [1155, 1180, 150]];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (var lamp = 0; lamp < lamps.length; lamp += 1) {
      var light = lamps[lamp];
      if (light[0] < view.left - light[2] || light[0] > view.right + light[2] || light[1] < view.top - light[2] || light[1] > view.bottom + light[2]) continue;
      var lampGradient = ctx.createRadialGradient(light[0], light[1], 0, light[0], light[1], light[2]);
      lampGradient.addColorStop(0, colorAlpha('#d5a84d', 0.095));
      lampGradient.addColorStop(0.34, colorAlpha('#a98a4b', 0.035));
      lampGradient.addColorStop(1, colorAlpha('#a98a4b', 0));
      ctx.fillStyle = lampGradient;
      ctx.beginPath();
      ctx.arc(light[0], light[1], light[2], 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (atlasGround) {
      // 生成的草砾 tile 只铺少量道路外斑块，保留道路标线的可读性。
      if (atlasGround.grass) {
        ctx.save();
        ctx.globalAlpha = 0.42;
        for (var grassX = Math.floor(view.left / 280) * 280; grassX <= view.right; grassX += 280) {
          for (var grassY = Math.floor(view.top / 240) * 240; grassY <= view.bottom; grassY += 240) {
            var grassSeed = hash(grassX / 280, grassY / 240, finite(game.seed, 1) + 41);
            if (grassSeed < 0.58 || (grassY > 590 && grassY < 820) || (grassX > 1030 && grassX < 1280)) continue;
            ctx.fillStyle = atlasGround.grass;
            ctx.fillRect(grassX + 18 + grassSeed * 46, grassY + 20 + hash(grassX, grassY, 43) * 58, 76, 52);
          }
        }
        ctx.restore();
      }
      if (atlasGround.metal) {
        ctx.save();
        ctx.globalAlpha = 0.24;
        [[84, 486, 156, 66], [1480, 512, 170, 70], [1910, 610, 144, 64]].forEach(function (pad) {
          if (pad[0] + pad[2] < view.left || pad[0] > view.right || pad[1] + pad[3] < view.top || pad[1] > view.bottom) return;
          ctx.fillStyle = atlasGround.metal;
          ctx.fillRect(pad[0], pad[1], pad[2], pad[3]);
        });
        ctx.restore();
      }
    } else {
      var left = Math.floor(view.left / 96) * 96;
      var right = Math.ceil(view.right / 96) * 96;
      var top = Math.floor(view.top / 96) * 96;
      var bottom = Math.ceil(view.bottom / 96) * 96;
      for (var gx = left; gx <= right; gx += 96) {
        for (var gy = top; gy <= bottom; gy += 96) {
          if (gx < 0 || gy < 0 || gx > worldW || gy > worldH) continue;
          var tileHash = hash(gx / 96, gy / 96, finite(game.seed, 1));
          if (tileHash > 0.54) {
            ctx.fillStyle = colorAlpha(tileHash > 0.8 ? '#49605d' : '#2e4948', 0.13);
            ctx.fillRect(gx + 11 + tileHash * 22, gy + 15, 2 + tileHash * 5, 2 + tileHash * 10);
          }
          if (tileHash < 0.18) {
            ctx.strokeStyle = colorAlpha('#6d8278', 0.22);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(gx + 16, gy + 68);
            ctx.lineTo(gx + 28, gy + 60);
            ctx.lineTo(gx + 36, gy + 70);
            ctx.lineTo(gx + 54, gy + 62);
            ctx.stroke();
          }
        }
      }

      // 旧素材加载失败时仍保持精细的程序化地面纹理。
      for (var cx = Math.floor(view.left / 170) * 170; cx <= view.right; cx += 170) {
        for (var cy = Math.floor(view.top / 140) * 140; cy <= view.bottom; cy += 140) {
          if (cx < 0 || cy < 0 || cx > worldW || cy > worldH) continue;
          var crackSeed = hash(cx / 170, cy / 140, finite(game.seed, 1) + 4);
          var px = cx + 24 + crackSeed * 90;
          var py = cy + 18 + hash(cx / 170, cy / 140, 13) * 88;
          if (py > 610 && py < 805 || px > 1050 && px < 1260) continue;
          ctx.strokeStyle = colorAlpha(crackSeed > 0.66 ? '#a25e4d' : '#0d1c20', crackSeed > 0.66 ? 0.19 : 0.4);
          ctx.lineWidth = crackSeed > 0.66 ? 2 : 1.2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + 12 + crackSeed * 15, py + 4);
          ctx.lineTo(px + 22 + crackSeed * 23, py - 11);
          if (crackSeed > 0.36) ctx.lineTo(px + 31 + crackSeed * 35, py - 5);
          ctx.stroke();
          if (crackSeed > 0.72) {
            ctx.fillStyle = colorAlpha('#5e7e6d', 0.35);
            ctx.beginPath();
            ctx.ellipse(px - 3, py + 4, 4, 9, -0.7, 0, TAU);
            ctx.ellipse(px + 4, py + 7, 3, 8, 0.4, 0, TAU);
            ctx.fill();
          }
        }
      }
      // 低成本的地面废料簇：每格固定种子，避免随帧闪烁，也不会把细节铺到屏幕外。
      for (var dx = Math.floor(view.left / 128) * 128; dx <= view.right; dx += 128) {
        for (var dy = Math.floor(view.top / 112) * 112; dy <= view.bottom; dy += 112) {
          if (dx < 0 || dy < 0 || dx > worldW || dy > worldH) continue;
          var debrisSeed = hash(dx / 128, dy / 112, finite(game.seed, 1) + 19);
          if (debrisSeed > 0.58 || (dy > 600 && dy < 810) || (dx > 1050 && dx < 1260)) continue;
          var debrisX = dx + 18 + hash(dx / 128, dy / 112, 23) * 78;
          var debrisY = dy + 18 + hash(dx / 128, dy / 112, 29) * 70;
          ctx.save();
          ctx.translate(debrisX, debrisY);
          ctx.rotate((debrisSeed - 0.5) * 2);
          ctx.fillStyle = colorAlpha(debrisSeed < 0.23 ? '#bd8e4e' : '#647773', 0.72);
          ctx.fillRect(-7, -2, 15, 4);
          ctx.fillStyle = colorAlpha('#182b2d', 0.65);
          ctx.fillRect(-4, 4, 8, 3);
          line(ctx, -12, 9, 12, 9, '#9b7650', 1.5, 0.5);
          ctx.restore();
        }
      }
    }
    ctx.strokeStyle = colorAlpha('#d8a948', 0.12);
    ctx.lineWidth = 5;
    ctx.strokeRect(22, 22, worldW - 44, worldH - 44);
    // 最后一层深青夜色把生成 tile 的高亮压回整体工业氛围，随后才绘制建筑和角色。
    ctx.fillStyle = colorAlpha('#0a2028', 0.15);
    ctx.fillRect(0, 0, worldW, worldH);
  };

  Renderer.prototype._drawExit = function (ctx, exit, game) {
    if (!exit) return;
    var x = entityNumber(exit, 'x', 1200);
    var y = entityNumber(exit, 'y', 1530);
    var radius = Math.max(30, entityNumber(exit, 'r', 88));
    var pulse = this.reducedMotion ? 0 : Math.sin(this._time * 3.5) * 5;
    ctx.save();
    // 生成出口平台负责实体外观，环形光效与进度仍是运行时反馈。
    this._drawAtlasSprite(ctx, 'environment', WORLD_SPRITES.exit[0], WORLD_SPRITES.exit[1], x, y, radius * 2.65, radius * 1.9, 0, 0);
    ctx.shadowColor = '#5fd0a8';
    ctx.shadowBlur = 24;
    circle(ctx, x, y, radius + pulse, colorAlpha('#2e987d', 0.13));
    ctx.shadowBlur = 0;
    ctx.setLineDash([14, 8]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#69d8aa';
    ctx.beginPath();
    ctx.arc(x, y, radius + pulse, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorAlpha('#d4f7ca', 0.78);
    ctx.beginPath();
    ctx.arc(x, y, radius - 16, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#87e1b5';
    ctx.font = '700 12px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(exit.called ? (exit.arrival > 0 ? '接应途中 · 迎击追兵' : '接应已抵达') : exit.available ? '撤离区' : '撤离点', x, y - 6);
    ctx.font = '600 10px ' + FONT;
    ctx.fillStyle = colorAlpha('#dbf6dd', 0.75);
    var remaining = Math.ceil(Math.max(0, 45 - entityNumber(game, 'elapsed', 0)));
    ctx.fillText(exit.called ? (exit.arrival > 0 ? Math.ceil(exit.arrival) + ' 秒 · 可移动躲避' : '按住交互登车') : exit.available ? '按住交互呼叫接应' : '45 秒后开放 · 剩余 ' + remaining + ' 秒', x, y + 13);
    if (finite(exit.progress, 0) > 0) {
      ctx.strokeStyle = '#f5cf62';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y, radius - 8, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(exit.progress, 0, 1));
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype._drawRelays = function (ctx, relays, view, game) {
    if (!Array.isArray(relays)) return;
    for (var i = 0; i < relays.length; i += 1) {
      var relay = relays[i];
      if (!pointVisible(relay, view, 220)) continue;
      var x = entityNumber(relay, 'x', 0);
      var y = entityNumber(relay, 'y', 0);
      var r = Math.max(15, entityNumber(relay, 'r', 25));
      var active = Boolean(relay.active);
      var flicker = this.reducedMotion ? 0 : Math.sin(this._time * 5 + i) * 2;
      ctx.save();
      var defense = game.defense && game.defense.relayId === relay.id ? game.defense : null;
      if (defense) {
        circle(ctx, x, y, 190, colorAlpha('#e5a841', 0.08), '#e5b456', 2);
        ctx.strokeStyle = '#f7d47d';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, 190, -Math.PI / 2, -Math.PI / 2 + TAU * defense.elapsed / 18);
        ctx.stroke();
      }
      ctx.shadowColor = active ? '#5dd6ba' : '#d0a54a';
      ctx.shadowBlur = active ? 24 : 12;
      circle(ctx, x, y, r + 8 + flicker, colorAlpha(active ? '#3d9d89' : '#835f31', active ? 0.22 : 0.18));
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = active ? '#67dec0' : '#c89d4f';
      ctx.setLineDash(active ? [6, 8] : [3, 6]);
      ctx.beginPath();
      ctx.arc(x, y, r + 9, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      var relayCell = WORLD_SPRITES.relay[active ? 'active' : 'offline'];
      if (!this._drawAtlasSprite(ctx, 'environment', relayCell[0], relayCell[1], x, y - 4, r * 2.8, r * 4.2, 0, 0)) {
        ctx.fillStyle = '#273b3a';
        ctx.fillRect(x - 5, y - r - 10, 10, r + 17);
        ctx.fillStyle = active ? '#b0f4d4' : '#f2c25a';
        circle(ctx, x, y - r - 10, 5, active ? '#69dabb' : '#e4a83f');
        line(ctx, x - 11, y + 7, x + 11, y + 7, active ? '#69dabb' : '#af8a4c', 2);
      }
      ctx.fillStyle = colorAlpha('#f3f3d1', 0.92);
      ctx.font = '700 10px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(defense ? (defense.elapsed >= 18 ? '击破金色精英' : '守点 ' + Math.ceil(18 - defense.elapsed) + ' 秒') : active ? 'ONLINE' : '守点挑战', x, y + r + 17);
      if (!active) {
        ctx.fillStyle = '#f1c15b';
        ctx.fillText(defense ? '留在圈内 · 可自由走位' : '核心 ×1 + 强化', x, y + r + 32);
      }
      var progress = clamp(relay.progress, 0, 1);
      if (!active && progress > 0) {
        ctx.strokeStyle = '#f1c15b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, r + 15, -Math.PI / 2, -Math.PI / 2 + progress * TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  Renderer.prototype._drawObstacles = function (ctx, obstacles, view) {
    if (!Array.isArray(obstacles)) return;
    for (var i = 0; i < obstacles.length; i += 1) {
      var obstacle = obstacles[i];
      if (!rectVisible(obstacle, view, 60)) continue;
      var x = entityNumber(obstacle, 'x', 0);
      var y = entityNumber(obstacle, 'y', 0);
      var w = Math.max(4, entityNumber(obstacle, 'w', 30));
      var h = Math.max(4, entityNumber(obstacle, 'h', 30));
      var kind = safeText(obstacle.kind, 'scrap');
      var idHash = hash(x / 37, y / 53, i + 8);
      ctx.save();
      ctx.fillStyle = colorAlpha('#071216', 0.58);
      // 硬边投影保持像素场景的体积感，避免建筑和物件像 UI 卡片。
      ctx.fillRect(x + 10, y + 13, w, h);
      var obstacleSpriteCell = null;
      if (kind === 'building') obstacleSpriteCell = h > w * 1.05 ? WORLD_SPRITES.obstacle.buildingTall : WORLD_SPRITES.obstacle.buildingWide;
      else obstacleSpriteCell = WORLD_SPRITES.obstacle[kind] || WORLD_SPRITES.obstacle.scrap;
      if (obstacleSpriteCell) {
        var obstacleDrawWidth = kind === 'building' ? Math.max(82, w * 1.46) : kind === 'barrel' ? Math.max(44, Math.max(w, h) * 1.7) : Math.max(52, w * 1.46);
        var obstacleDrawHeight = kind === 'building' ? Math.max(72, h * 1.48) : kind === 'barrel' ? Math.max(44, Math.max(w, h) * 1.7) : Math.max(44, h * 1.58);
        var obstacleDrawn = this._drawAtlasSprite(ctx, 'environment', obstacleSpriteCell[0], obstacleSpriteCell[1], x + w / 2, y + h / 2 - (kind === 'building' ? h * 0.08 : 0), obstacleDrawWidth, obstacleDrawHeight, kind === 'car' ? (idHash - 0.5) * 0.08 : 0, 0);
        if (obstacleDrawn) {
          ctx.restore();
          continue;
        }
      }
      if (kind === 'building') {
        var wall = ctx.createLinearGradient(x, y, x, y + h);
        wall.addColorStop(0, '#536663');
        wall.addColorStop(0.48, '#3e514f');
        wall.addColorStop(1, '#263b3d');
        ctx.fillStyle = wall;
        ctx.fillRect(x, y + 7, w, h - 7);
        // 屋顶硬边、金属瓦列和破损暗洞。
        polygon(ctx, [[x - 10, y + 8], [x + 10, y - 10], [x + w - 8, y - 10], [x + w + 12, y + 8], [x + w - 3, y + 16], [x + 3, y + 16]], '#26383a', '#8d9a88', 2);
        for (var roofRow = 0; roofRow < 3; roofRow += 1) {
          ctx.strokeStyle = colorAlpha(roofRow === 1 ? '#b09356' : '#536761', 0.78);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 4, y - 4 + roofRow * 6);
          ctx.lineTo(x + w - 4, y - 4 + roofRow * 6);
          ctx.stroke();
        }
        var holeX = x + w * (0.54 + idHash * 0.2);
        var holeW = Math.max(18, Math.min(46, w * 0.2));
        polygon(ctx, [[holeX, y - 9], [holeX + holeW * 0.26, y - 15], [holeX + holeW, y - 11], [holeX + holeW * 0.82, y + 3], [holeX + 8, y + 2]], '#0b171a', '#152729', 1);
        ctx.fillStyle = colorAlpha('#a15d4b', 0.65);
        ctx.fillRect(x + w * 0.12, y - 7, Math.max(7, w * 0.08), 5);
        ctx.fillRect(x + w * 0.36, y + 7, Math.max(8, w * 0.11), 4);
        // 低矮正面墙的金属瓦列与破窗。
        ctx.strokeStyle = colorAlpha('#9aaa91', 0.32);
        ctx.lineWidth = 1;
        for (var wallRow = y + 22; wallRow < y + h - 10; wallRow += 13) {
          ctx.beginPath();
          ctx.moveTo(x + 4, wallRow);
          ctx.lineTo(x + w - 4, wallRow);
          ctx.stroke();
        }
        ctx.fillStyle = '#162a2d';
        ctx.fillRect(x + w * 0.11, y + h * 0.29, Math.max(14, w * 0.16), Math.max(10, h * 0.17));
        ctx.fillRect(x + w * 0.68, y + h * 0.27, Math.max(14, w * 0.16), Math.max(10, h * 0.17));
        ctx.strokeStyle = colorAlpha('#e2b95a', 0.66);
        ctx.lineWidth = 2;
        ctx.strokeRect(x + w * 0.11, y + h * 0.29, Math.max(14, w * 0.16), Math.max(10, h * 0.17));
        ctx.strokeRect(x + w * 0.68, y + h * 0.27, Math.max(14, w * 0.16), Math.max(10, h * 0.17));
        ctx.fillStyle = colorAlpha(idHash > 0.5 ? '#e4b75a' : '#5bb499', 0.75);
        ctx.fillRect(x + w * 0.13, y + h * 0.32, Math.max(9, w * 0.12), 4);
        ctx.fillRect(x + w * 0.70, y + h * 0.30, Math.max(9, w * 0.12), 4);
        // 门框和两级门阶直贴地面，前墙保持低矮厚重。
        var doorW = Math.max(18, Math.min(34, w * 0.2));
        var doorX = x + w * 0.42;
        ctx.fillStyle = '#17292c';
        ctx.fillRect(doorX, y + h - 48, doorW, 48);
        ctx.strokeStyle = '#c99e51';
        ctx.lineWidth = 2;
        ctx.strokeRect(doorX, y + h - 48, doorW, 48);
        ctx.fillStyle = '#d9b15b';
        ctx.fillRect(doorX + doorW - 7, y + h - 25, 4, 4);
        polygon(ctx, [[doorX - 9, y + h], [doorX + doorW + 9, y + h], [doorX + doorW + 13, y + h + 7], [doorX - 13, y + h + 7]], '#465957', '#a68e5e', 1);
        polygon(ctx, [[doorX - 14, y + h + 7], [doorX + doorW + 14, y + h + 7], [doorX + doorW + 17, y + h + 13], [doorX - 18, y + h + 13]], '#273b3c', '#877a58', 1);
        // 屋顶通风机和墙面排水管。
        ctx.fillStyle = '#1b2c2e';
        ctx.fillRect(x + w * 0.2, y - 4, Math.max(22, w * 0.18), 8);
        ctx.fillStyle = '#7d9186';
        for (var vent = x + w * 0.22; vent < x + w * 0.36; vent += 9) ctx.fillRect(vent, y - 8, 4, 5);
        var pipeX = x + w * 0.9;
        line(ctx, pipeX, y + 13, pipeX, y + h * 0.83, '#bd8b4d', 3, 0.72);
        line(ctx, pipeX, y + h * 0.83, x + w * 0.65, y + h * 0.83, '#bd8b4d', 3, 0.72);
        circle(ctx, pipeX, y + h * 0.83, 3, '#324946', '#d4a955', 1);
        // 墙脚锈片与裂口，做成少量像素块而非模糊阴影。
        ctx.fillStyle = colorAlpha('#a65d4d', 0.68);
        ctx.fillRect(x + w * 0.06, y + h * 0.74, Math.max(6, w * 0.08), 5);
        ctx.fillRect(x + w * 0.76, y + h * 0.64, Math.max(7, w * 0.09), 4);
        ctx.fillStyle = colorAlpha('#182a2d', 0.72);
        ctx.fillRect(x + w * 0.22, y + h * 0.91, Math.max(10, w * 0.16), 7);
        ctx.strokeStyle = colorAlpha('#c2ad77', 0.42);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 7, w - 2, h - 7);
      } else if (kind === 'car') {
        var carColor = idHash > 0.5 ? '#50656a' : '#76584d';
        fillRoundRect(ctx, x, y, w, h, Math.min(10, Math.min(w, h) / 3), carColor, '#9da99b', 1.5);
        fillRoundRect(ctx, x + w * 0.2, y + h * 0.16, w * 0.6, h * 0.34, 5, '#1b3035', '#8ca5a0', 1);
        ctx.fillStyle = '#141e21';
        ctx.fillRect(x + 4, y + 5, 7, h - 10);
        ctx.fillRect(x + w - 11, y + 5, 7, h - 10);
        ctx.fillStyle = '#d9b559';
        ctx.fillRect(x + 6, y + h - 8, 7, 3);
        ctx.fillStyle = '#bf554b';
        ctx.fillRect(x + w - 13, y + h - 8, 7, 3);
      } else if (kind === 'barrel') {
        var barrelR = Math.min(w, h) * 0.38;
        circle(ctx, x + w / 2, y + h / 2, barrelR, '#6b5848', '#b0a17d', 2);
        line(ctx, x + w * 0.22, y + h * 0.32, x + w * 0.78, y + h * 0.32, '#ceb161', 3, 0.8);
        line(ctx, x + w * 0.2, y + h * 0.68, x + w * 0.8, y + h * 0.68, '#ceb161', 3, 0.75);
        circle(ctx, x + w * 0.5, y + h * 0.16, 2.5, '#e0bf62');
      } else {
        polygon(ctx, [[x + 3, y + h - 3], [x + w * 0.28, y + 4], [x + w * 0.58, y + h * 0.2], [x + w - 2, y + 3], [x + w - 8, y + h - 1]], '#536362', '#9aab99', 1.5);
        line(ctx, x + 5, y + h * 0.48, x + w - 6, y + h * 0.65, '#d2a54a', 2, 0.72);
        line(ctx, x + w * 0.35, y + h - 4, x + w * 0.65, y + 4, '#d2a54a', 2, 0.5);
      }
      ctx.restore();
    }
  };

  Renderer.prototype._drawContainers = function (ctx, containers, view) {
    if (!Array.isArray(containers)) return;
    for (var i = 0; i < containers.length; i += 1) {
      var box = containers[i];
      if (!pointVisible(box, view, 50)) continue;
      var x = entityNumber(box, 'x', 0);
      var y = entityNumber(box, 'y', 0);
      var r = Math.max(12, entityNumber(box, 'r', 20));
      var kind = safeText(box.kind, 'crate');
      var opened = Boolean(box.opened);
      ctx.save();
      ctx.fillStyle = colorAlpha('#071316', 0.7);
      // 箱体使用硬边投影和透视顶面，避免变成界面图标。
      var containerCell = WORLD_SPRITES.container[kind] || WORLD_SPRITES.container.crate;
      if (containerCell && this._drawAtlasSprite(ctx, 'environment', containerCell[0], containerCell[1], x, y - r * 0.08, r * 2.9, r * 2.55, 0, 0)) {
        var generatedProgress = clamp(box.progress, 0, 1);
        if (generatedProgress > 0 && !opened) {
          ctx.strokeStyle = '#f2ca63';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * generatedProgress);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      polygon(ctx, [[x - r + 6, y + r * 0.4], [x + r + 5, y + r * 0.4], [x + r + 9, y + r + 7], [x - r + 10, y + r + 7]], '#071316');
      if (kind === 'cache') {
        ctx.fillStyle = opened ? '#514b40' : '#8d6b3a';
        ctx.fillRect(x - r, y - r * 0.72, r * 2, r * 1.45);
        polygon(ctx, [[x - r - 2, y - r * 0.72], [x - r * 0.72, y - r - 3], [x + r + 2, y - r - 3], [x + r, y - r * 0.72]], opened ? '#70634d' : '#b58945', '#e6c46c', 1.5);
        ctx.fillStyle = colorAlpha('#d4a24e', 0.72);
        for (var cacheBand = -r + 5; cacheBand < r; cacheBand += 10) ctx.fillRect(x + cacheBand, y - r * 0.68, 5, 3);
        ctx.strokeStyle = '#e7c46b';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - r + 2, y - r * 0.68, r * 2 - 4, r * 1.31);
        ctx.fillStyle = opened ? '#776e55' : '#e3bb55';
        polygon(ctx, [[x - 6, y - 2], [x, y - 7], [x + 6, y - 2], [x, y + 7]], null, '#f0cd75', 2);
        ctx.fillRect(x - 3, y - 1, 6, 3);
      } else if (kind === 'medbox') {
        ctx.fillStyle = opened ? '#4b5b56' : '#607c6c';
        ctx.fillRect(x - r, y - r * 0.7, r * 2, r * 1.45);
        polygon(ctx, [[x - r, y - r * 0.7], [x - r * 0.72, y - r - 4], [x + r * 0.84, y - r - 4], [x + r, y - r * 0.7]], opened ? '#718177' : '#83a68a', '#b4d0ae', 1.5);
        ctx.strokeStyle = '#a7c5a7';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - r + 2, y - r * 0.64, r * 2 - 4, r * 1.27);
        ctx.fillStyle = '#e9ddbb';
        ctx.fillRect(x - 4, y - r * 0.32, 8, r * 0.95);
        ctx.fillRect(x - r * 0.42, y - 4, r * 0.84, 8);
        ctx.fillStyle = '#63bf8b';
        ctx.fillRect(x - 2, y - r * 0.23, 4, r * 0.72);
        ctx.fillRect(x - r * 0.27, y - 2, r * 0.54, 4);
        ctx.fillStyle = '#d7c788';
        ctx.fillRect(x - r * 0.32, y - r - 8, r * 0.64, 4);
      } else {
        ctx.fillStyle = opened ? '#4b5552' : '#75583d';
        ctx.fillRect(x - r, y - r * 0.66, r * 2, r * 1.4);
        polygon(ctx, [[x - r, y - r * 0.66], [x - r * 0.72, y - r - 4], [x + r * 0.85, y - r - 4], [x + r, y - r * 0.66]], opened ? '#66726a' : '#986f43', opened ? '#93a297' : '#d0a15c', 2);
        ctx.strokeStyle = opened ? '#87968d' : '#c59653';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - r + 2, y - r * 0.6, r * 2 - 4, r * 1.27);
        line(ctx, x - r + 4, y + 1, x + r - 4, y + 1, '#c59653', 2);
        line(ctx, x - r + 4, y + r * 0.42, x + r - 4, y + r * 0.42, '#a27945', 1);
        // 角铁与扣锁是箱子的实体轮廓，不使用圆角装饰。
        ctx.strokeStyle = '#d2aa61';
        ctx.lineWidth = 3;
        line(ctx, x - r + 3, y - r * 0.6, x - r + 3, y + r * 0.54, '#d2aa61', 3, 0.9);
        line(ctx, x + r - 3, y - r * 0.6, x + r - 3, y + r * 0.54, '#d2aa61', 3, 0.9);
        ctx.fillStyle = opened ? '#65716a' : '#d8b461';
        ctx.fillRect(x - 3, y - r * 0.08, 6, 8);
        ctx.fillStyle = '#1e2d2f';
        ctx.fillRect(x - 1, y + r * 0.02, 2, 3);
      }
      var progress = clamp(box.progress, 0, 1);
      if (progress > 0 && !opened) {
        ctx.strokeStyle = '#f2ca63';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  Renderer.prototype._drawDrops = function (ctx, drops, view) {
    if (!Array.isArray(drops)) return;
    for (var i = 0; i < drops.length; i += 1) {
      var drop = drops[i];
      if (!pointVisible(drop, view, 35)) continue;
      var x = entityNumber(drop, 'x', 0);
      var y = entityNumber(drop, 'y', 0);
      var r = Math.max(4, entityNumber(drop, 'r', 7));
      var type = safeText(drop.type, 'scrap');
      var palette = {
        scrap: { main: '#d7a950', edge: '#ffe19a' },
        circuit: { main: '#62c4c0', edge: '#c1fff0' },
        core: { main: '#e8776b', edge: '#ffc3a8' },
        xp: { main: '#9c8dff', edge: '#e2d7ff' },
        heal: { main: '#68d18f', edge: '#d3ffb7' }
      }[type] || { main: '#d7a950', edge: '#ffe19a' };
      var bob = this.reducedMotion ? 0 : Math.sin(this._time * 4 + i * 1.7) * 2;
      var isXp = type === 'xp';
      var visualRadius = isXp ? Math.min(r, 4) : r;
      ctx.save();
      ctx.shadowColor = palette.main;
      ctx.shadowBlur = isXp ? 8 : 12;
      var dropCell = WORLD_SPRITES.drop[type] || WORLD_SPRITES.drop.scrap;
      if (dropCell && this._drawAtlasSprite(ctx, 'combat', dropCell[0], dropCell[1], x, y + bob, isXp ? r * 2.35 : r * 2.7, isXp ? r * 2.35 : r * 2.7, 0, 0)) {
        // 资源数量只保留在实体资源上，经验点使用无文字的发光精灵。
        if (!isXp && (type === 'scrap' || type === 'circuit' || type === 'core') && finite(drop.amount, 0) > 1) {
          ctx.fillStyle = '#f7efcf';
          ctx.font = '700 9px ' + FONT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(formatNumber(drop.amount), x, y + bob + r + 4);
        }
        ctx.restore();
        continue;
      }
      ctx.translate(x, y + bob);
      if (type === 'circuit') {
        fillRoundRect(ctx, -r, -r * 0.7, r * 2, r * 1.4, 2, palette.main, palette.edge, 1.5);
        line(ctx, -r + 3, 0, r - 3, 0, '#12333a', 1.3);
        line(ctx, -2, -r * 0.7, -2, r * 0.7, '#12333a', 1.3);
        line(ctx, 4, -r * 0.7, 4, r * 0.7, '#12333a', 1.3);
      } else if (type === 'core') {
        polygon(ctx, [[0, -r - 2], [r, -r * 0.25], [r * 0.55, r], [-r * 0.55, r], [-r, -r * 0.25]], palette.main, palette.edge, 1.5);
        line(ctx, -3, -r * 0.55, 2, r * 0.55, palette.edge, 1, 0.8);
      } else if (type === 'heal') {
        fillRoundRect(ctx, -r, -r, r * 2, r * 2, 3, palette.main, palette.edge, 1.5);
        ctx.fillStyle = '#f6ffe2';
        ctx.fillRect(-2, -r + 3, 4, r * 2 - 6);
        ctx.fillRect(-r + 3, -2, r * 2 - 6, 4);
      } else if (isXp) {
        // 经验点只保留青紫色光点，避免高频掉落数字污染战斗画面。
        circle(ctx, 0, 0, visualRadius, '#9b8cff', '#dcd2ff', 1);
        circle(ctx, -1, -1, visualRadius * 0.42, '#72dfd0');
      } else {
        circle(ctx, 0, 0, r, palette.main, palette.edge, 1.3);
      }
      ctx.shadowBlur = 0;
      if (!isXp && (type === 'scrap' || type === 'circuit' || type === 'core') && finite(drop.amount, 0) > 1) {
        ctx.fillStyle = '#f7efcf';
        ctx.font = '700 9px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(formatNumber(drop.amount), 0, r + 4);
      }
      ctx.restore();
    }
  };

  Renderer.prototype._drawBullets = function (ctx, bullets, view) {
    if (!Array.isArray(bullets)) return;
    for (var i = 0; i < bullets.length; i += 1) {
      var bullet = bullets[i];
      if (!pointVisible(bullet, view, 90)) continue;
      var x = entityNumber(bullet, 'x', 0);
      var y = entityNumber(bullet, 'y', 0);
      var vx = entityNumber(bullet, 'vx', 0);
      var vy = entityNumber(bullet, 'vy', 0);
      var speed = Math.sqrt(vx * vx + vy * vy) || 1;
      var trail = clamp(speed * 0.028, 10, 32);
      var bulletColor = safeText(bullet.color, bullet.enemy ? '#e06a61' : '#f2c457');
      ctx.save();
      ctx.strokeStyle = colorAlpha(bulletColor, 0.28);
      ctx.lineWidth = Math.max(2, entityNumber(bullet, 'r', 4) * 1.8);
      ctx.beginPath();
      ctx.moveTo(x - vx / speed * trail, y - vy / speed * trail);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.shadowColor = bulletColor;
      ctx.shadowBlur = 10;
      circle(ctx, x, y, Math.max(2, entityNumber(bullet, 'r', 4)), bulletColor);
      ctx.restore();
    }
  };

  Renderer.prototype._drawEnemies = function (ctx, enemies, view, game) {
    if (!Array.isArray(enemies)) return;
    for (var i = 0; i < enemies.length; i += 1) {
      var enemy = enemies[i];
      if (!pointVisible(enemy, view, 80)) continue;
      var x = entityNumber(enemy, 'x', 0);
      var y = entityNumber(enemy, 'y', 0);
      var r = Math.max(7, entityNumber(enemy, 'r', 16));
      var angle = entityNumber(enemy, 'angle', 0);
      var type = safeText(enemy.type, 'crawler');
      if (enemy.elite) {
        ctx.save();
        circle(ctx, x, y, r + 13, null, '#f5c966', 2);
        ctx.fillStyle = '#f5c966';
        ctx.font = '700 11px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText(game.defense && game.defense.leaderId === enemy.id ? '核心精英' : '精英', x, y - r - 22);
        ctx.restore();
      }
      var hurt = clamp(entityNumber(enemy, 'hitFlash', 0), 0, 1);
      var body = type === 'boss' ? '#953e48' : type === 'brute' ? '#6e4146' : type === 'spitter' ? '#57466f' : type === 'runner' ? '#7c4645' : '#674853';
      var edge = type === 'boss' ? '#ff9b73' : type === 'brute' ? '#e78470' : type === 'spitter' ? '#d398e7' : type === 'runner' ? '#f18777' : '#e66f76';
      ctx.save();
      var enemyCell = WORLD_SPRITES.enemy[type] || WORLD_SPRITES.enemy.crawler;
      if (enemyCell && this._worldArtStates.combat === 'ready') {
        ctx.fillStyle = colorAlpha('#061013', 0.56);
        ctx.beginPath();
        ctx.ellipse(x + r * 0.28, y + r * 0.48, r * (type === 'boss' ? 1.65 : 1.25), r * 0.68, 0.18, 0, TAU);
        ctx.fill();
      }
      if (enemyCell && this._drawAtlasSprite(ctx, 'combat', enemyCell[0], enemyCell[1], x, y, type === 'boss' ? r * 3.8 : r * 3.05, type === 'boss' ? r * 3.8 : r * 3.05, angle + Math.PI / 2, hurt * 6)) {
        ctx.restore();
        this._drawEnemyBar(ctx, enemy, x, y, r, type);
        this._drawEnemyEvolutionFx(ctx, enemy, x, y, r, game, i);
        if (type === 'boss' && entityNumber(enemy, 'telegraph', 0) > 0) this._drawTelegraph(ctx, enemy, x, y, r);
        continue;
      }
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = colorAlpha('#061013', 0.65);
      ctx.beginPath();
      ctx.ellipse(5, 8, r * 1.05, r * 0.7, 0.2, 0, TAU);
      ctx.fill();
      ctx.shadowColor = edge;
      ctx.shadowBlur = type === 'boss' ? 22 : 9;
      if (type === 'crawler') {
        circle(ctx, 0, 0, r, hurt > 0 ? '#f6d9bc' : body, edge, 2);
        for (var leg = -1; leg <= 1; leg += 1) {
          line(ctx, -r * 0.45, leg * r * 0.55, -r - 7, leg * r * 0.8, edge, 2, 0.8);
          line(ctx, r * 0.45, leg * r * 0.55, r + 7, leg * r * 0.8, edge, 2, 0.8);
        }
        circle(ctx, r * 0.45, -r * 0.25, 2.3, '#f3d57f');
        circle(ctx, r * 0.45, r * 0.25, 2.3, '#f3d57f');
      } else if (type === 'runner') {
        polygon(ctx, [[r + 3, 0], [0, -r], [-r, -r * 0.45], [-r * 0.65, r * 0.7], [0, r], [r + 3, 0]], hurt > 0 ? '#f6d9bc' : body, edge, 2);
        line(ctx, -r * 0.35, -r * 0.7, -r - 7, -r - 5, edge, 2);
        line(ctx, -r * 0.35, r * 0.7, -r - 7, r + 5, edge, 2);
        circle(ctx, r * 0.32, 0, 2.5, '#f4db77');
      } else if (type === 'spitter') {
        circle(ctx, 0, 0, r, hurt > 0 ? '#f6d9bc' : body, edge, 2);
        circle(ctx, r * 0.45, 0, r * 0.28, '#1c2b35', edge, 1);
        line(ctx, -r * 0.65, -r * 0.3, -r * 0.9, -r, edge, 2);
        line(ctx, -r * 0.65, r * 0.3, -r * 0.9, r, edge, 2);
        ctx.fillStyle = '#d8aef0';
        ctx.beginPath();
        ctx.arc(r * 0.43, 0, r * 0.12, 0, TAU);
        ctx.fill();
      } else if (type === 'brute') {
        fillRoundRect(ctx, -r, -r, r * 2, r * 2, 7, hurt > 0 ? '#f6d9bc' : body, edge, 2.5);
        fillRoundRect(ctx, -r * 0.63, -r * 0.76, r * 1.26, r * 0.48, 4, '#1b3034', edge, 1);
        line(ctx, -r - 2, -r * 0.44, -r - 11, -r * 0.78, edge, 3);
        line(ctx, -r - 2, r * 0.44, -r - 11, r * 0.78, edge, 3);
        line(ctx, r + 2, -r * 0.44, r + 11, -r * 0.78, edge, 3);
        line(ctx, r + 2, r * 0.44, r + 11, r * 0.78, edge, 3);
      } else {
        var bossR = r * 1.12;
        ctx.shadowBlur = 28;
        circle(ctx, 0, 0, bossR + 5, colorAlpha('#ce4d56', 0.17), '#e46b64', 2);
        polygon(ctx, [[bossR + 8, 0], [bossR * 0.44, -bossR * 0.87], [-bossR * 0.5, -bossR * 0.8], [-bossR - 4, 0], [-bossR * 0.5, bossR * 0.8], [bossR * 0.44, bossR * 0.87]], hurt > 0 ? '#f6d9bc' : body, edge, 3);
        circle(ctx, bossR * 0.42, -bossR * 0.3, 4, '#fbd278');
        circle(ctx, bossR * 0.42, bossR * 0.3, 4, '#fbd278');
        line(ctx, -bossR * 0.55, -bossR * 0.8, -bossR * 0.7, -bossR - 12, edge, 3);
        line(ctx, -bossR * 0.55, bossR * 0.8, -bossR * 0.7, bossR + 12, edge, 3);
      }
      ctx.shadowBlur = 0;
      ctx.restore();
      this._drawEnemyBar(ctx, enemy, x, y, r, type);
      this._drawEnemyEvolutionFx(ctx, enemy, x, y, r, game, i);
      if (type === 'boss' && entityNumber(enemy, 'telegraph', 0) > 0) this._drawTelegraph(ctx, enemy, x, y, r);
    }
  };

  // 进化只改变表现：不改敌人速度、生命和任何模拟字段。
  Renderer.prototype._drawEnemyEvolutionFx = function (ctx, enemy, x, y, r, game, index) {
    var upgrades = game && game.upgrades ? game.upgrades : {};
    var hurt = clamp(entityNumber(enemy, 'hitFlash', 0) * 7, 0, 1);
    var slow = entityNumber(enemy, 'slowTimer', 0) > 0;
    if (finite(upgrades.shatter, 0) > 0 && hurt > 0) {
      ctx.save();
      ctx.globalAlpha = hurt * 0.85;
      ctx.strokeStyle = '#f4cf76';
      ctx.lineWidth = 2;
      for (var shard = 0; shard < 5; shard += 1) {
        var shardAngle = this._time * 2.2 + index * 0.7 + shard * TAU / 5;
        var inner = r * 1.05;
        var outer = r * (1.55 + (shard % 2) * 0.24);
        line(ctx, x + Math.cos(shardAngle) * inner, y + Math.sin(shardAngle) * inner, x + Math.cos(shardAngle + 0.16) * outer, y + Math.sin(shardAngle + 0.16) * outer, '#f4cf76', 2, hurt * 0.8);
      }
      ctx.restore();
    }
    if (finite(upgrades.gravity, 0) > 0 && slow) {
      ctx.save();
      ctx.strokeStyle = colorAlpha('#b48dff', 0.55);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.3 + (this.reducedMotion ? 0 : Math.sin(this._time * 7 + index) * 2), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  };

  Renderer.prototype._drawEnemyBar = function (ctx, enemy, x, y, r, type) {
    var maxHp = Math.max(1, entityNumber(enemy, 'maxHp', entityNumber(enemy, 'hp', 1)));
    var hp = clamp(entityNumber(enemy, 'hp', maxHp), 0, maxHp);
    var width = type === 'boss' ? 140 : Math.max(34, r * 2.4);
    var top = y - r - (type === 'boss' ? 25 : 12);
    ctx.save();
    ctx.fillStyle = colorAlpha('#081316', 0.82);
    roundRectPath(ctx, x - width / 2, top, width, type === 'boss' ? 8 : 5, 3);
    ctx.fill();
    ctx.fillStyle = type === 'boss' ? '#e66d66' : '#d6a15c';
    roundRectPath(ctx, x - width / 2 + 1, top + 1, (width - 2) * (hp / maxHp), type === 'boss' ? 6 : 3, 2);
    ctx.fill();
    if (type === 'boss') {
      ctx.fillStyle = '#ffd59a';
      ctx.font = '800 11px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('废土巨兽', x, top - 4);
    }
    ctx.restore();
  };

  Renderer.prototype._drawTelegraph = function (ctx, enemy, x, y, r) {
    var telegraph = clamp(entityNumber(enemy, 'telegraph', 0), 0, 1);
    var pulse = this.reducedMotion ? 0 : Math.sin(this._time * 10) * 3;
    ctx.save();
    ctx.strokeStyle = colorAlpha('#ee6d65', 0.55 + telegraph * 0.3);
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.7 + pulse, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffb06f';
    ctx.font = '800 12px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('警告 · 蓄力攻击', x, y - r * 1.8 - 8);
    ctx.restore();
  };

  Renderer.prototype._drawPlayer = function (ctx, player, game) {
    if (!player) return;
    var x = entityNumber(player, 'x', 0);
    var y = entityNumber(player, 'y', 0);
    var r = Math.max(10, entityNumber(player, 'r', 14));
    var angle = entityNumber(player, 'angle', 0);
    var input = game && game.input ? game.input : null;
    var moving = Boolean((input && (Math.abs(entityNumber(input, 'x', 0)) > 0.05 || Math.abs(entityNumber(input, 'y', 0)) > 0.05)) || player.moving);
    var walk = moving && !this.reducedMotion ? Math.sin(this._time * 14) * 2.5 : 0;
    ctx.save();
    var playerCell = WORLD_SPRITES.player;
    if (playerCell && this._worldArtStates.combat === 'ready') {
      ctx.fillStyle = colorAlpha('#061114', 0.62);
      ctx.beginPath();
      ctx.ellipse(x + r * 0.25, y + r * 0.55, r * 1.24, r * 0.72, 0.2, 0, TAU);
      ctx.fill();
    }
    // 手机战场纹理较密，给现有 imagegen 主角精灵加轻微轮廓光，碰撞尺寸保持原值。
    if (Scrap.viewport && Scrap.viewport.touch) {
      ctx.shadowColor = entityNumber(player, 'invulnerable', 0) > 0 ? '#c8ffe0' : '#f7d68a';
      ctx.shadowBlur = entityNumber(player, 'invulnerable', 0) > 0 ? 10 : 4;
    }
    if (playerCell && this._drawAtlasSprite(ctx, 'combat', playerCell[0], playerCell[1], x, y, r * 3.35, r * 3.35, angle + Math.PI / 2, 0)) {
      ctx.restore();
      this._drawPlayerBar(ctx, player, x, y, r);
      this._drawPlayerBoosts(ctx, player, game, x, y, r);
      return;
    }
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = colorAlpha('#061114', 0.72);
    ctx.beginPath();
    ctx.ellipse(3, 10, r * 1.08, r * 0.64, 0.2, 0, TAU);
    ctx.fill();
    // 先画背包和靴子，再用硬边外套/头盔建立清楚的人形轮廓。
    polygon(ctx, [[-r * 1.02, -r * 0.38], [-r * 0.72, -r * 0.68], [-r * 0.7, r * 0.62], [-r * 1.02, r * 0.48]], '#28555b', '#91c3a5', 1.4);
    ctx.fillStyle = '#172b31';
    ctx.fillRect(-r * 0.6, r * 0.37 + walk, r * 0.34, r * 0.82);
    ctx.fillRect(r * 0.2, r * 0.37 - walk, r * 0.34, r * 0.82);
    ctx.fillStyle = '#0f2025';
    ctx.fillRect(-r * 0.7, r * 1.06 + walk, r * 0.48, 4);
    ctx.fillRect(r * 0.12, r * 1.06 - walk, r * 0.48, 4);
    // 暖黄色外套和头盔是我方识别色，青绿色背包与敌方珊瑚色轮廓分离。
    polygon(ctx, [[-r * 0.72, -r * 0.55], [r * 0.48, -r * 0.6], [r * 0.78, r * 0.48], [r * 0.44, r * 0.82], [-r * 0.58, r * 0.78], [-r * 0.84, r * 0.12]], '#c4933f', '#f3d37b', 1.8);
    line(ctx, -r * 0.1, -r * 0.45, -r * 0.1, r * 0.64, '#f0cf6d', 1.5, 0.8);
    polygon(ctx, [[-r * 0.82, -r * 0.32], [-r * 1.2, r * 0.06], [-r * 0.88, r * 0.34], [-r * 0.52, r * 0.02]], '#d4a34a', '#f0ce79', 1.3);
    polygon(ctx, [[-r * 0.3, -r * 1.16], [r * 0.1, -r * 1.34], [r * 0.7, -r * 1.18], [r * 0.84, -r * 0.66], [-r * 0.32, -r * 0.66]], '#d5b45a', '#ffeb9f', 2.2);
    ctx.fillStyle = '#1a343b';
    ctx.fillRect(r * 0.02, -r * 0.94, r * 0.76, r * 0.27);
    ctx.fillStyle = '#f0c660';
    ctx.fillRect(r * 0.35, -r * 0.84, 5, 3);
    ctx.fillStyle = '#2d5e63';
    ctx.fillRect(-r * 0.74, -r * 0.47, r * 0.23, r * 0.52);
    line(ctx, r * 0.22, -r * 0.02, r * 1.9, -r * 0.02, '#9aa7a0', 3);
    line(ctx, r * 1.25, -r * 0.02, r * 2.12, -r * 0.02, '#d2b057', 2);
    ctx.fillStyle = '#f2c85d';
    ctx.fillRect(r * 1.98, -r * 0.19, 4, r * 0.28);
    if (entityNumber(player, 'invulnerable', 0) > 0) {
      ctx.strokeStyle = colorAlpha('#baf8dc', 0.72);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 7, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    this._drawPlayerBar(ctx, player, x, y, r);
    this._drawPlayerBoosts(ctx, player, game, x, y, r);
  };

  // 连击、超载和四种进化的光效围绕角色绘制，所有数值仍由 DOM/游戏逻辑负责。
  Renderer.prototype._drawPlayerBoosts = function (ctx, player, game, x, y, r) {
    var upgrades = game && game.upgrades ? game.upgrades : {};
    var combo = Math.max(0, entityNumber(game, 'combo', 0));
    var overdrive = Math.max(0, entityNumber(game, 'overdriveTime', 0));
    var metalstorm = finite(upgrades.metalstorm, 0) > 0;
    var thunder = finite(upgrades.thunder, 0) > 0;
    var gravity = finite(upgrades.gravity, 0) > 0;
    if (!overdrive && !combo && !metalstorm && !thunder && !gravity) return;
    var pulse = this.reducedMotion ? 0 : Math.sin(this._time * 8) * 2;
    ctx.save();
    if (overdrive || combo >= 3) {
      ctx.globalAlpha = overdrive ? 0.82 : clamp(combo / 24, 0.16, 0.56);
      ctx.strokeStyle = overdrive ? '#f5d06a' : '#7fe0ce';
      ctx.lineWidth = overdrive ? 3 : 2;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = overdrive ? 16 : 8;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.55 + (overdrive ? 0.12 : 0)) + pulse, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (metalstorm) {
      var metalCell = WORLD_SPRITES.drop.scrap;
      for (var shard = 0; shard < 2; shard += 1) {
        var metalAngle = this._time * (this.reducedMotion ? 0 : 2.7) + shard * Math.PI;
        var metalRadius = r * 1.85;
        if (!this._drawAtlasSprite(ctx, 'combat', metalCell[0], metalCell[1], x + Math.cos(metalAngle) * metalRadius, y + Math.sin(metalAngle) * metalRadius, r * 0.85, r * 0.85, metalAngle, 0)) {
          polygon(ctx, [[x + Math.cos(metalAngle) * metalRadius, y + Math.sin(metalAngle) * metalRadius - 4], [x + Math.cos(metalAngle + 1.5) * metalRadius + 3, y + Math.sin(metalAngle + 1.5) * metalRadius], [x + Math.cos(metalAngle + 3) * metalRadius, y + Math.sin(metalAngle + 3) * metalRadius + 4]], '#d7a950', '#ffe19a', 1);
        }
      }
    }
    if (thunder) {
      ctx.globalAlpha = 0.62;
      ctx.strokeStyle = '#79d8ee';
      ctx.lineWidth = 2;
      for (var arc = 0; arc < 3; arc += 1) {
        var arcStart = this.reducedMotion ? arc * TAU / 3 : this._time * 3 + arc * TAU / 3;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.05 + arc * 3, arcStart, arcStart + 0.62);
        ctx.stroke();
      }
    }
    if (gravity) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#b38fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.arc(x, y, r * 2.35 + pulse, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  };

  Renderer.prototype._drawPlayerBar = function (ctx, player, x, y, r) {
    var maxHp = Math.max(1, entityNumber(player, 'maxHp', 100));
    var hp = clamp(entityNumber(player, 'hp', maxHp), 0, maxHp);
    var width = 54;
    ctx.save();
    ctx.fillStyle = colorAlpha('#071215', 0.8);
    roundRectPath(ctx, x - width / 2, y - r - 16, width, 5, 2);
    ctx.fill();
    ctx.fillStyle = hp / maxHp < 0.3 ? '#df6d61' : '#6ad19e';
    roundRectPath(ctx, x - width / 2 + 1, y - r - 15, (width - 2) * hp / maxHp, 3, 1);
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype._drawEffects = function (ctx, effects, texts, view) {
    if (Array.isArray(effects)) {
      for (var i = 0; i < effects.length; i += 1) {
        var effect = effects[i];
        if (!pointVisible(effect, view, 100)) continue;
        this._drawEffect(ctx, effect, i);
      }
    }
    if (Array.isArray(texts)) {
      for (var j = 0; j < texts.length; j += 1) {
        var text = texts[j];
        if (!pointVisible(text, view, 40)) continue;
        var life = Math.max(0, entityNumber(text, 'life', 0));
        var maxLife = Math.max(0.01, entityNumber(text, 'maxLife', 1));
        var alpha = clamp(life / maxLife, 0, 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = safeText(text.color, '#ffe399');
        ctx.font = '800 13px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#091417';
        ctx.shadowBlur = 5;
        ctx.fillText(safeText(text.text), entityNumber(text, 'x', 0), entityNumber(text, 'y', 0) - (1 - alpha) * 20);
        ctx.restore();
      }
    }
  };

  // 交互提示贴在实体上，避免与 DOM 底部操作栏重复占用视觉空间。
  Renderer.prototype._drawWorldInteraction = function (ctx, interaction, view) {
    if (!interaction || !Number.isFinite(interaction.x) || !Number.isFinite(interaction.y)) return;
    if (!pointVisible(interaction, view, 45)) return;
    var x = interaction.x;
    var y = interaction.y;
    var progress = clamp(interaction.progress, 0, 1);
    var pulse = this.reducedMotion ? 0 : Math.sin(this._time * 5) * 2;
    ctx.save();
    ctx.shadowColor = '#e3bd5d';
    ctx.shadowBlur = 12;
    circle(ctx, x, y, 21 + pulse, colorAlpha('#d6ac4f', 0.1));
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#e5c262';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 24 + pulse, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
    ctx.stroke();
    // 实体旁的提示也按触屏切换；逆镜头缩放让手机上的交互字保持可读。
    var touch = Scrap.viewport && Scrap.viewport.touch;
    var badgeScale = touch ? 1 / Math.max(0.5, this.camera.zoom) : 1;
    var badgeWidth = (touch ? 36 : 22) * badgeScale;
    var badgeHeight = (touch ? 22 : 18) * badgeScale;
    var badgeY = y - 26 - badgeHeight;
    fillRoundRect(ctx, x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight, 4 * badgeScale, colorAlpha('#0a1b1e', 0.88), colorAlpha('#e2bd5b', 0.78), 1);
    ctx.fillStyle = '#f1d47b';
    ctx.font = '900 ' + ((touch ? 12 : 11) * badgeScale) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(touch ? '交互' : 'E', x, badgeY + badgeHeight / 2);
    ctx.restore();
  };

  Renderer.prototype._drawEffect = function (ctx, effect, index) {
    var x = entityNumber(effect, 'x', 0);
    var y = entityNumber(effect, 'y', 0);
    var life = Math.max(0, entityNumber(effect, 'life', 0));
    var maxLife = Math.max(0.01, entityNumber(effect, 'maxLife', 1));
    var p = clamp(1 - life / maxLife, 0, 1);
    var type = safeText(effect.type, 'hit');
    var color = safeText(effect.color, type === 'hurt' ? '#e87569' : '#f3c65e');
    var r = Math.max(4, entityNumber(effect, 'r', 12));
    ctx.save();
    ctx.globalAlpha = clamp(1 - p, 0.08, 1);
    ctx.translate(x, y);
    if (type === 'lightning') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(entityNumber(effect, 'x2', x) - x, entityNumber(effect, 'y2', y) - y);
      ctx.stroke();
    } else if (type === 'shot') {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      circle(ctx, 0, 0, r * (1 - p * 0.5), color);
      ctx.globalAlpha *= 0.6;
      circle(ctx, 0, 0, r * (2 + p), null, color, 2);
    } else if (type === 'dash') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, r + p * 14, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (type === 'ring') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r + p * r * 3, 0, TAU);
      ctx.stroke();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = type === 'burst' ? 3 : 2;
      var rays = type === 'burst' ? 12 : 6;
      for (var ray = 0; ray < rays; ray += 1) {
        var angle = ray / rays * TAU + index * 0.21;
        var inner = r * (0.24 + p * 0.3);
        var outer = r * (0.9 + p * 1.7);
        line(ctx, Math.cos(angle) * inner, Math.sin(angle) * inner, Math.cos(angle) * outer, Math.sin(angle) * outer, color, type === 'burst' ? 2 : 1.5, 0.85);
      }
      circle(ctx, 0, 0, r * (0.38 + p * 0.3), color);
      if (type === 'burst' && !this.reducedMotion) {
        // 爆炸粒子只由 effect 的稳定索引和渲染时间决定，不向 game.effects 追加对象。
        ctx.globalAlpha *= 0.86;
        ctx.fillStyle = color;
        for (var particle = 0; particle < 8; particle += 1) {
          var particleAngle = particle / 8 * TAU + index * 0.37;
          var particleDistance = r * (0.45 + p * 2.3 + hash(index, particle, 91) * 0.28);
          var particleSize = 1.5 + hash(index, particle, 97) * 2.2;
          var particleX = Math.cos(particleAngle) * particleDistance;
          var particleY = Math.sin(particleAngle) * particleDistance;
          ctx.fillRect(particleX - particleSize / 2, particleY - particleSize / 2, particleSize, particleSize);
        }
      }
    }
    ctx.restore();
  };

  /*
   * 画小地图和地图页都走同一套坐标映射，保证出口、敌人、中继站在两个界面一致。
   * 参数 canvas 可以是外部 canvas；传入 null 时复用当前渲染上下文。
   */
  Renderer.prototype.drawMap = function (game, canvas, large, suppliedCtx, offsetX, offsetY, suppliedW, suppliedH) {
    if (!game) return;
    var targetCtx = suppliedCtx || (canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : this.ctx);
    if (!targetCtx) return;
    var ownCanvas = !suppliedCtx && canvas && typeof canvas.getContext === 'function';
    var mapRect = ownCanvas && typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    var mapParent = ownCanvas ? canvas.parentElement : null;
    var mapWidth = finite(canvas && canvas.clientWidth, 0) || finite(mapRect && mapRect.width, 0) || finite(mapParent && mapParent.clientWidth, 0);
    var mapHeight = finite(canvas && canvas.clientHeight, 0) || finite(mapRect && mapRect.height, 0) || finite(mapParent && mapParent.clientHeight, 0);
    var w = suppliedW || (ownCanvas ? (mapWidth || finite(canvas.width, 210)) : (large ? Math.min(this.width - 60, 900) : 210));
    var h = suppliedH || (ownCanvas ? (mapHeight || finite(canvas.height, 154)) : (large ? Math.min(this.height - 60, 620) : 154));
    var ox = offsetX === undefined ? (large ? (this.width - w) / 2 : this.width - w - 18) : offsetX;
    var oy = offsetY === undefined ? (large ? (this.height - h) / 2 : 18) : offsetY;
    var world = game.world || { w: 2400, h: 1800 };
    var ww = Math.max(1, finite(world.w, 2400));
    var wh = Math.max(1, finite(world.h, 1800));
    targetCtx.save();
    if (ownCanvas) {
      var mapDpr = Math.min(1.5, Math.max(1, finite(root.devicePixelRatio, 1)));
      canvas.width = Math.floor(w * mapDpr);
      canvas.height = Math.floor(h * mapDpr);
      targetCtx.setTransform(mapDpr, 0, 0, mapDpr, 0, 0);
      ox = 0;
      oy = 0;
    }
    // 地图容器的标题和边框属于 UI，渲染器只负责填充坐标内容。
    var pad = 0;
    var ix = ox + pad;
    var iy = oy + pad;
    var iw = w - pad * 2;
    var ih = h - pad * 2;
    targetCtx.fillStyle = '#173033';
    targetCtx.fillRect(ix, iy, iw, ih);
    targetCtx.fillStyle = colorAlpha('#2c5754', 0.62);
    targetCtx.fillRect(ix, iy + ih * 0.36, iw, ih * 0.13);
    targetCtx.fillRect(ix + iw * 0.43, iy, iw * 0.08, ih);
    targetCtx.strokeStyle = colorAlpha('#d2a94f', 0.44);
    targetCtx.lineWidth = large ? 2 : 1;
    targetCtx.setLineDash([large ? 8 : 4, large ? 7 : 4]);
    targetCtx.beginPath();
    targetCtx.moveTo(ix, iy + ih * 0.425);
    targetCtx.lineTo(ix + iw, iy + ih * 0.425);
    targetCtx.moveTo(ix + iw * 0.47, iy);
    targetCtx.lineTo(ix + iw * 0.47, iy + ih);
    targetCtx.stroke();
    targetCtx.setLineDash([]);
    var mapPoint = function (item) {
      return { x: ix + entityNumber(item, 'x', 0) / ww * iw, y: iy + entityNumber(item, 'y', 0) / wh * ih };
    };
    var obstacles = Array.isArray(game.obstacles) ? game.obstacles : [];
    targetCtx.fillStyle = colorAlpha('#708079', 0.6);
    for (var i = 0; i < obstacles.length; i += 1) {
      var ob = obstacles[i];
      var p = mapPoint(ob);
      targetCtx.fillRect(p.x, p.y, Math.max(2, entityNumber(ob, 'w', 28) / ww * iw), Math.max(2, entityNumber(ob, 'h', 28) / wh * ih));
    }
    var relays = Array.isArray(game.relays) ? game.relays : [];
    for (var r = 0; r < relays.length; r += 1) {
      var rp = mapPoint(relays[r]);
      var defending = game.defense && game.defense.relayId === relays[r].id;
      circle(targetCtx, rp.x, rp.y, defending ? (large ? 9 : 5) : large ? 5 : 3, relays[r].active ? '#70dec0' : '#f5c966');
      if (large) {
        targetCtx.fillStyle = '#eadbb3';
        targetCtx.font = '11px ' + FONT;
        targetCtx.textAlign = 'center';
        targetCtx.fillText(relays[r].active ? '已接通' : defending ? '防守中' : '核心 + 强化', rp.x, rp.y + 19);
      }
    }
    // 未开的物资箱同步出现在地图上，定时投放的补给也沿用相同标记。
    for (var c = 0; c < game.containers.length; c += 1) {
      var container = game.containers[c];
      if (container.opened) continue;
      var cp = mapPoint(container);
      var size = large ? 5 : 3;
      targetCtx.fillStyle = container.kind === 'medbox' ? '#9ce1a5' : '#ded8b6';
      targetCtx.fillRect(cp.x - size / 2, cp.y - size / 2, size, size);
    }
    var exitPoint = mapPoint(game.exit || { x: 1200, y: 1530 });
    circle(targetCtx, exitPoint.x, exitPoint.y, large ? 6 : 4, '#70dcae', '#d4f7d2', 1);
    var enemies = Array.isArray(game.enemies) ? game.enemies : [];
    for (var e = 0; e < enemies.length; e += 1) {
      var ep = mapPoint(enemies[e]);
      circle(targetCtx, ep.x, ep.y, enemies[e].type === 'boss' || enemies[e].elite ? (large ? 6 : 4) : (large ? 3 : 2), enemies[e].elite ? '#f5c966' : enemies[e].type === 'boss' ? '#e46f65' : '#c6615a');
    }
    var playerPoint = mapPoint(game.player || { x: ww / 2, y: wh / 2 });
    circle(targetCtx, playerPoint.x, playerPoint.y, large ? 6 : 4, '#f2c65d', '#fff0ad', 1);
    targetCtx.restore();
  };

  Renderer.prototype.drawCamp = function (time, facilities) {
    var ctx = this.ctx;
    this._time = finite(time, this._time);
    this._ensureCampArt();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    var w = this.width;
    var h = this.height;
    var reduced = this.reducedMotion;
    // 营地是 DOM 叠加层下的纯场景底图，所有标题、状态和按钮由 UI 绘制。
    var gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#08181c');
    gradient.addColorStop(0.5, '#10272b');
    gradient.addColorStop(1, '#1b3030');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    var image = this._campArtImage;
    var imageWidth = image && (image.naturalWidth || image.width);
    var imageHeight = image && (image.naturalHeight || image.height);
    if (this._campArtState === 'ready' && image && imageWidth > 0 && imageHeight > 0) {
      // 素材按 contain 居中，周围保留暗色氛围，避免像一张孤立的贴图。
      var imageScale = Math.min(w / imageWidth, h / imageHeight);
      var imageDrawW = imageWidth * imageScale;
      var imageDrawH = imageHeight * imageScale;
      var imageX = (w - imageDrawW) / 2;
      var imageY = (h - imageDrawH) / 2;
      this._campArtRect = { x: imageX, y: imageY, w: imageDrawW, h: imageDrawH };
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.drawImage(image, imageX, imageY, imageDrawW, imageDrawH);
      ctx.restore();
    } else {
      // 图像还在加载或不可用时，保留可玩的程序化营地。
      var s = Math.max(w / 980, h / 650);
      var ox = (w - 980 * s) / 2;
      var oy = (h - 650 * s) / 2;
      this._campArtRect = { x: ox, y: oy, w: 980 * s, h: 650 * s };
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);
      this._drawCampWorld(ctx, facilities || {}, reduced);
      ctx.restore();
    }
    this._drawCampAtmosphere(ctx, this._campArtRect, reduced);
  };

  Renderer.prototype._drawCampAtmosphere = function (ctx, rect, reduced) {
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    // 像素素材与程序化营地的构图不同，素材坐标由美术标注，fallback 保留旧坐标。
    var assetReady = this._campArtState === 'ready';
    var fire = this.campAnchor(assetReady ? 0.486 : 0.275, assetReady ? 0.715 : 0.838);
    var beacon = this.campAnchor(assetReady ? 0.130 : 0.143, assetReady ? 0.050 : 0.27);
    var glowRadius = Math.max(36, Math.min(rect.w, rect.h) * 0.12);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    var fireGlow = ctx.createRadialGradient(fire.x, fire.y, 0, fire.x, fire.y, glowRadius);
    fireGlow.addColorStop(0, colorAlpha('#f4c25f', 0.28));
    fireGlow.addColorStop(0.42, colorAlpha('#e1844c', 0.11));
    fireGlow.addColorStop(1, colorAlpha('#e1844c', 0));
    ctx.fillStyle = fireGlow;
    ctx.beginPath();
    ctx.arc(fire.x, fire.y, glowRadius, 0, TAU);
    ctx.fill();
    var beaconGlow = ctx.createRadialGradient(beacon.x, beacon.y, 0, beacon.x, beacon.y, glowRadius * 0.82);
    beaconGlow.addColorStop(0, colorAlpha('#f4d16e', 0.22));
    beaconGlow.addColorStop(1, colorAlpha('#f4d16e', 0));
    ctx.fillStyle = beaconGlow;
    ctx.beginPath();
    ctx.arc(beacon.x, beacon.y, glowRadius * 0.82, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 少量尘埃采用固定种子分布，移动只改变位置，不向 game 写入状态。
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < 18; i += 1) {
      var drift = reduced ? 0 : (this._time * (0.008 + (i % 3) * 0.002));
      var dustX = rect.x + ((hash(i, 4, 57) + drift * 0.35) % 1) * rect.w;
      var dustY = rect.y + ((hash(i, 9, 71) + drift) % 1) * rect.h;
      var dustR = 0.8 + hash(i, 12, 83) * 1.8;
      circle(ctx, dustX, dustY, dustR, colorAlpha(i % 3 ? '#d0d8b7' : '#edc46b', 0.12));
    }
    var sparks = reduced ? 3 : 7;
    for (var spark = 0; spark < sparks; spark += 1) {
      var sparkPhase = reduced ? spark * 0.3 : this._time * 1.8 + spark * 0.91;
      var sparkX = fire.x + Math.sin(sparkPhase * 1.7) * (4 + spark * 1.8);
      var sparkY = fire.y - (sparkPhase % 1) * (13 + spark * 2);
      circle(ctx, sparkX, sparkY, 1.1 + (spark % 2) * 0.7, colorAlpha('#ffe59b', 0.72));
    }
    ctx.restore();
    var vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.27, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.73);
    vignette.addColorStop(0, colorAlpha('#071417', 0));
    vignette.addColorStop(1, colorAlpha('#071417', 0.32));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  };

  Renderer.prototype._drawCampWorld = function (ctx, facilities, reduced) {
    var t = reduced ? 0 : this._time;
    ctx.fillStyle = '#1b3738';
    ctx.fillRect(0, 0, 980, 650);
    ctx.strokeStyle = colorAlpha('#b0bf9b', 0.12);
    ctx.lineWidth = 1;
    for (var grid = -40; grid < 1040; grid += 48) {
      line(ctx, grid, 0, grid - 320, 650, '#9eb5a0', 1, 0.1);
      line(ctx, 0, grid, 980, grid + 160, '#9eb5a0', 1, 0.08);
    }
    ctx.fillStyle = '#263e3c';
    polygon(ctx, [[0, 250], [980, 150], [980, 250], [0, 370]], '#263e3c');
    polygon(ctx, [[400, 650], [520, 0], [600, 0], [580, 650]], '#243b3b');
    ctx.strokeStyle = '#dbaf4d';
    ctx.lineWidth = 5;
    ctx.setLineDash([24, 20]);
    line(ctx, 0, 309, 980, 201, '#d2a549', 4, 0.62);
    line(ctx, 556, 650, 566, 0, '#d2a549', 4, 0.54);
    ctx.setLineDash([]);

    // 营地中央的回收站主体：前墙、侧墙、错层屋顶和外露管线形成纵深。
    polygon(ctx, [[292, 431], [656, 411], [726, 449], [368, 475]], '#091719', '#102526', 2);
    var sideGradient = ctx.createLinearGradient(668, 185, 716, 430);
    sideGradient.addColorStop(0, '#344b4a');
    sideGradient.addColorStop(1, '#1d3436');
    polygon(ctx, [[650, 197], [706, 225], [706, 426], [650, 414]], sideGradient, '#7d9689', 2);
    for (var sideRib = 0; sideRib < 4; sideRib += 1) {
      line(ctx, 664 + sideRib * 11, 224 + sideRib * 3, 664 + sideRib * 11, 402, '#9aad95', 2, 0.34);
    }
    var buildingGradient = ctx.createLinearGradient(318, 190, 318, 430);
    buildingGradient.addColorStop(0, '#62756d');
    buildingGradient.addColorStop(0.42, '#4a5e58');
    buildingGradient.addColorStop(1, '#2e4644');
    polygon(ctx, [[318, 190], [650, 190], [668, 207], [668, 415], [318, 430]], buildingGradient, '#a0ad96', 3);
    // 屋顶由底檐、斜面和设备舱三层叠出厚度，边缘有锈蚀暖光。
    polygon(ctx, [[302, 190], [335, 157], [661, 157], [699, 191], [668, 211], [320, 211]], '#243a3b', '#9cab92', 2);
    polygon(ctx, [[335, 157], [660, 157], [681, 177], [321, 177]], '#53615b', '#bac09b', 2);
    ctx.fillStyle = '#172b2d';
    ctx.fillRect(354, 142, 214, 20);
    ctx.fillStyle = '#687a6f';
    ctx.fillRect(368, 136, 62, 7);
    ctx.fillRect(447, 136, 94, 7);
    ctx.strokeStyle = '#d0a44d';
    ctx.lineWidth = 3;
    line(ctx, 323, 179, 672, 179, '#d0a44d', 3, 0.7);
    line(ctx, 333, 187, 664, 187, '#889a8d', 2, 0.48);
    // 建筑招牌属于场景资产，保留在前墙内部而不承担界面信息。
    ctx.fillStyle = '#1c2f31';
    ctx.fillRect(336, 208, 315, 28);
    ctx.fillStyle = '#d3a94f';
    ctx.fillRect(344, 214, 150, 13);
    ctx.fillStyle = '#162629';
    ctx.font = '900 12px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('LAST LIGHT  //  RECOVERY', 354, 221);
    // 五扇不同亮度的窗户，配合柔和光晕表现室内活动。
    for (var win = 0; win < 5; win += 1) {
      var windowX = 344 + win * 58;
      ctx.save();
      ctx.shadowColor = win % 2 ? '#f0bd5a' : '#63c9ae';
      ctx.shadowBlur = 13;
      ctx.fillStyle = win % 2 ? '#e0b55b' : '#5da08c';
      ctx.fillRect(windowX, 268, 32, 21);
      ctx.shadowBlur = 0;
      ctx.fillStyle = colorAlpha('#172b2e', 0.7);
      ctx.fillRect(windowX + 4, 272, 24, 13);
      line(ctx, windowX + 16, 272, windowX + 16, 285, '#d8c87d', 1, 0.42);
      ctx.restore();
    }
    // 门、门阶、侧门雨檐以及连接地面的电缆。
    ctx.fillStyle = '#344a48';
    ctx.fillRect(346, 314, 70, 92);
    ctx.strokeStyle = '#d0aa59';
    ctx.lineWidth = 2;
    ctx.strokeRect(346, 314, 70, 92);
    ctx.fillStyle = '#1d2c2d';
    ctx.fillRect(354, 322, 54, 84);
    ctx.fillStyle = '#dcb461';
    ctx.fillRect(396, 364, 5, 5);
    polygon(ctx, [[334, 406], [428, 406], [442, 421], [320, 421]], '#4f5d55', '#bd9a56', 2);
    polygon(ctx, [[327, 421], [436, 421], [450, 435], [313, 435]], '#293e3d', '#9b8660', 1);
    ctx.fillStyle = '#1a2d30';
    ctx.fillRect(548, 326, 96, 95);
    ctx.fillStyle = '#d4aa55';
    ctx.fillRect(558, 340, 72, 8);
    ctx.fillStyle = '#9eb3a0';
    ctx.fillRect(558, 358, 72, 6);
    ctx.fillRect(558, 375, 50, 6);
    ctx.fillStyle = '#d4b45e';
    ctx.fillRect(624, 357, 7, 7);
    // 外露蒸汽管线、阀门和锈蚀接头，压住建筑过于平整的前立面。
    ctx.strokeStyle = '#b58d4d';
    ctx.lineWidth = 5;
    line(ctx, 448, 190, 448, 153, '#b58d4d', 5, 0.78);
    line(ctx, 448, 153, 606, 153, '#b58d4d', 5, 0.78);
    line(ctx, 606, 153, 606, 191, '#b58d4d', 5, 0.78);
    circle(ctx, 448, 153, 6, '#334846', '#dbb85b', 2);
    circle(ctx, 606, 153, 6, '#334846', '#dbb85b', 2);
    ctx.lineWidth = 3;
    line(ctx, 626, 238, 626, 306, '#83a093', 3, 0.66);
    line(ctx, 626, 306, 670, 306, '#83a093', 3, 0.66);
    circle(ctx, 626, 306, 5, '#2f4a48', '#d1a552', 2);
    // 门边和墙角的零件堆，使用多个不同轮廓避免通用方块感。
    polygon(ctx, [[268, 415], [304, 389], [337, 406], [323, 445], [278, 447]], '#50635e', '#b49b62', 2);
    line(ctx, 278, 431, 326, 417, '#d0ac58', 3, 0.78);
    line(ctx, 292, 443, 304, 398, '#9db39a', 2, 0.75);
    circle(ctx, 244, 451, 18, '#735546', '#ba9458', 2);
    line(ctx, 230, 449, 258, 449, '#d5af5c', 3, 0.78);
    circle(ctx, 274, 468, 11, '#5a766a', '#cba65b', 2);
    polygon(ctx, [[679, 425], [701, 397], [731, 407], [722, 443], [691, 447]], '#65756a', '#c19a55', 2);
    line(ctx, 686, 431, 723, 418, '#cfa652', 2, 0.75);
    // 左侧灯塔与旋转光束。
    ctx.fillStyle = colorAlpha('#0b191b', 0.6);
    ctx.fillRect(98, 156, 68, 292);
    polygon(ctx, [[108, 444], [132, 142], [170, 142], [188, 444]], '#536963', '#a8b79a', 2);
    ctx.fillStyle = '#20373a';
    ctx.fillRect(113, 162, 54, 28);
    ctx.fillStyle = '#e7c461';
    circle(ctx, 140, 176, 18, '#e9c05a', '#fff0ae', 2);
    ctx.globalAlpha = reduced ? 0.13 : 0.13 + (Math.sin(t * 2) + 1) * 0.08;
    polygon(ctx, [[140, 176], [310, 122], [404, 186], [140, 205]], '#f2cb62');
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#172b2d';
    ctx.fillRect(124, 224, 31, 96);
    ctx.fillStyle = '#d2a951';
    ctx.fillRect(119, 344, 43, 7);
    ctx.fillRect(116, 395, 49, 7);
    // 右侧塔吊和吊钩，建立明显的工业主视觉。
    ctx.fillStyle = '#182b2d';
    ctx.fillRect(745, 112, 18, 335);
    ctx.strokeStyle = '#c99f4d';
    ctx.lineWidth = 7;
    line(ctx, 754, 125, 920, 125, '#d6ac53', 7, 0.92);
    line(ctx, 754, 125, 824, 196, '#d6ac53', 3, 0.78);
    line(ctx, 820, 125, 820, 302, '#d6ac53', 3, 0.86);
    line(ctx, 887, 125, 887, 302, '#d6ac53', 3, 0.78);
    line(ctx, 820, 302, 887, 302, '#d6ac53', 3, 0.78);
    ctx.fillStyle = '#0f2023';
    ctx.fillRect(802, 430, 84, 17);
    ctx.fillStyle = '#af8750';
    ctx.fillRect(820, 435, 45, 6);
    ctx.strokeStyle = '#c8a34f';
    ctx.lineWidth = 2;
    line(ctx, 887, 125, 887, 366, '#cfaa57', 2, 0.9);
    line(ctx, 887, 366, 873, 387, '#cfaa57', 2, 0.9);
    line(ctx, 887, 366, 901, 387, '#cfaa57', 2, 0.9);
    polygon(ctx, [[852, 384], [920, 384], [908, 422], [865, 422]], '#7c6143', '#d1aa59', 2);
    // 屋顶风机。
    ctx.fillStyle = '#9fb3a1';
    ctx.fillRect(632, 65, 7, 105);
    circle(ctx, 635, 62, 7, '#c5d5b3', '#f1d577', 1);
    ctx.strokeStyle = '#d6b35e';
    ctx.lineWidth = 4;
    for (var blade = 0; blade < 3; blade += 1) {
      var ba = blade * TAU / 3 + t * (reduced ? 0 : 0.4);
      line(ctx, 635, 62, 635 + Math.cos(ba) * 44, 62 + Math.sin(ba) * 44, '#d2b05c', 4, 0.9);
    }
    // 集装箱、备件台和油桶。
    fillRoundRect(ctx, 190, 440, 145, 80, 8, '#4b6870', '#9db4a4', 2);
    ctx.strokeStyle = '#263d41';
    ctx.lineWidth = 3;
    for (var rib = 0; rib < 6; rib += 1) line(ctx, 204 + rib * 23, 448, 204 + rib * 23, 510, '#263d41', 3, 0.8);
    fillRoundRect(ctx, 472, 464, 126, 62, 7, '#876446', '#c9a05c', 2);
    ctx.fillStyle = '#172b2e';
    ctx.fillRect(490, 480, 90, 7);
    line(ctx, 490, 501, 572, 501, '#e1b75d', 2, 0.85);
    for (var barrel = 0; barrel < 3; barrel += 1) {
      circle(ctx, 710 + barrel * 28, 498, 15, barrel === 1 ? '#7e5549' : '#5c7464', '#c4a35d', 2);
      line(ctx, 700 + barrel * 28, 495, 720 + barrel * 28, 495, '#ddb960', 2, 0.8);
    }
    // 外圈围栏、门和入口灯。
    ctx.strokeStyle = '#9caf97';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.strokeRect(42, 96, 880, 440);
    ctx.setLineDash([]);
    ctx.fillStyle = '#d7b258';
    ctx.fillRect(450, 518, 90, 5);
    ctx.fillStyle = '#6dd2a5';
    circle(ctx, 484, 516, 7, '#73d4a9');
    circle(ctx, 507, 516, 7, '#73d4a9');
    // 远处杂草、碎片和营火，为场景增加小比例细节。
    for (var plant = 0; plant < 20; plant += 1) {
      var px = 55 + hash(plant, 4, 17) * 850;
      var py = 90 + hash(plant, 9, 31) * 450;
      if (px > 290 && px < 700 && py > 160 && py < 455) continue;
      ctx.strokeStyle = colorAlpha('#7da486', 0.64);
      ctx.lineWidth = 2;
      line(ctx, px, py + 9, px - 4, py - 5, '#7da486', 2, 0.65);
      line(ctx, px, py + 9, px + 6, py - 3, '#7da486', 2, 0.65);
    }
    ctx.fillStyle = '#f0c35f';
    circle(ctx, 268, 545, 13, '#da7b50');
    ctx.fillStyle = '#ffdc75';
    circle(ctx, 268, 539, 6, '#ffe4a2');
  };

  Scrap.Renderer = Renderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = Renderer;
}(typeof window !== 'undefined' ? window : globalThis));
