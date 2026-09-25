(function () {
  'use strict';
  const S = window.Scrap;
  // 音乐、环境、效果与界面分别混音；所有声音本地合成，不依赖下载。
  class AudioEngine {
    constructor() { this.ctx = null; this.settings = null; this.mode = 'camp'; this.threat = 1; this.beat = 0; this.timer = null; this.voices = 0; this.last = {}; }
    start(settings) {
      this.settings = settings;
      if (!this.ctx) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC(); this.master = this.ctx.createGain();
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.value = -12; this.compressor.ratio.value = 5;
          this.master.connect(this.compressor); this.compressor.connect(this.ctx.destination);
          this.buses = {};
          for (const key of ['music', 'sfx', 'ui', 'ambience']) { this.buses[key] = this.ctx.createGain(); this.buses[key].connect(this.master); }
          const length = this.ctx.sampleRate * 0.5;
          this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
          const ch = this.noiseBuffer.getChannelData(0);
          for (let i = 0; i < length; i++) ch[i] = Math.random() * 2 - 1;
          this.nextBeat = this.ctx.currentTime + 0.15;
          this.timer = setInterval(() => this.schedule(), 100);
        } catch (_) { this.ctx = null; return; }
      }
      this.ctx.resume().catch(() => {}); this.apply(settings);
    }
    apply(settings) {
      this.settings = settings;
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const db = v => v <= 0 ? 0 : Math.pow(10, (-42 + v * 42) / 20);
      this.master.gain.setTargetAtTime(settings.muted ? 0 : 0.7, now, 0.05);
      this.buses.music.gain.setTargetAtTime(db(settings.music) * 0.8, now, 0.15);
      this.buses.ambience.gain.setTargetAtTime(db(settings.music) * 0.28, now, 0.15);
      this.buses.sfx.gain.setTargetAtTime(db(settings.sfx), now, 0.05);
      this.buses.ui.gain.setTargetAtTime(db(settings.sfx) * 0.7, now, 0.05);
    }
    tone(frequency, duration, { type = 'sine', gain = 0.12, end = frequency, bus = 'sfx', time, attack = 0.005 } = {}) {
      if (!this.ctx || this.voices >= 48 || this.settings?.muted) return;
      const t = time ?? this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(Math.max(20, frequency), t); o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      o.connect(g); g.connect(this.buses[bus]); o.start(t); o.stop(t + duration + 0.015);
      this.voices++; o.onended = () => { o.disconnect(); g.disconnect(); this.voices--; };
    }
    noise(duration, gain, freq = 900, bus = 'sfx', time) {
      if (!this.ctx || this.voices >= 48 || this.settings?.muted) return;
      const t = time ?? this.ctx.currentTime, src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      src.buffer = this.noiseBuffer; f.type = 'lowpass'; f.frequency.value = freq;
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(f); f.connect(g); g.connect(this.buses[bus]); src.start(t); src.stop(t + duration);
      this.voices++; src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); this.voices--; };
    }
    schedule() {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      if (this.nextBeat < now - 0.4) this.nextBeat = now + 0.05;
      while (this.nextBeat < now + 0.22) {
        const t = this.nextBeat, b = this.beat++, playing = this.mode === 'run';
        const notes = [130.81, 155.56, 196, 174.61, 130.81, 116.54, 155.56, 98];
        if (this.mode !== 'silent') {
          if (b % 2 === 0) this.tone(notes[(b / 2) % 8], 1.35, { gain: 0.14, bus: 'music', time: t, attack: 0.09 });
          if (b % 4 === 0) this.tone(notes[(b / 2) % 8] / 2, 1.75, { type: 'triangle', gain: 0.11, bus: 'music', time: t, attack: 0.08 });
          if (b % 4 === 2) this.tone(notes[(b / 2) % 8] * 4, 0.7, { gain: 0.055, bus: 'music', time: t });
          if (playing) {
            if (b % 2 === 0) this.tone(100, 0.17, { gain: 0.17, end: 38, bus: 'music', time: t });
            if (this.threat > 2 || b % 2) this.noise(0.06, 0.065, 2400, 'music', t);
            if (this.threat > 3) this.tone(notes[b % 8] * 2, 0.12, { type: 'triangle', gain: 0.065, bus: 'music', time: t + 0.22 });
          }
        }
        this.nextBeat += 60 / 88 / 2;
      }
    }
    setMode(mode, threat = 1) { this.mode = mode; this.threat = threat; }
    play(type) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const limits = { hit: 0.055, shot: 0.06, pickup: 0.065, kill: 0.06 };
      if (limits[type] && now - (this.last[type] || -1) < limits[type]) return;
      this.last[type] = now;
      const variation = 0.94 + Math.random() * 0.12;
      switch (type) {
        case 'shot': this.tone(160 * variation, 0.09, { type: 'triangle', gain: 0.11, end: 45 }); this.noise(0.04, 0.12, 1800); break;
        case 'hit': this.noise(0.06, 0.1, 1200); this.tone(220, 0.04, { gain: 0.065, end: 80 }); break;
        case 'kill': this.tone(95, 0.14, { type: 'triangle', gain: 0.12, end: 35 }); break;
        case 'hurt': this.tone(90, 0.22, { type: 'sawtooth', gain: 0.13, end: 40 }); this.noise(0.16, 0.16, 700); break;
        case 'pickup': this.tone(640 * variation, 0.065, { gain: 0.045, end: 900 }); break;
        case 'dash': this.noise(0.18, 0.11, 2600); this.tone(200, 0.16, { gain: 0.05, end: 650 }); break;
        case 'heal': case 'open': this.chime([392, 523, 659], 0.09); break;
        case 'upgrade': case 'relay': case 'purchase': this.chime([261, 392, 523, 784], 0.08); break;
        // 科技安装的机械落锁、进化的升调与超载低频扫音形成不同反馈层次。
        case 'install': this.noise(0.12, 0.12, 1400, 'ui'); this.chime([330, 494, 659], 0.055); break;
        case 'evolution': this.tone(110, 0.8, { type: 'triangle', gain: 0.16, end: 330, bus: 'ui' }); this.chime([262, 330, 392, 523, 784, 1047], 0.095); break;
        case 'overdrive': this.tone(65, 0.7, { type: 'sawtooth', gain: 0.13, end: 220 }); this.noise(0.45, 0.1, 800); this.chime([392, 587, 784], 0.12); break;
        case 'combo': this.chime([523, 659, 880], 0.055); break;
        case 'extract': case 'victory': this.chime([261, 329, 392, 523, 659, 784], 0.12); break;
        case 'boss': this.tone(70, 1.3, { type: 'sawtooth', gain: 0.12, end: 40 }); this.tone(73, 1.3, { gain: 0.1, end: 43 }); break;
        case 'defeat': this.chime([220, 196, 146, 110], 0.2); break;
        default: this.tone(500, 0.045, { gain: 0.055, bus: 'ui', end: 650 });
      }
      if (['hurt', 'boss', 'extract'].includes(type)) {
        // 压低音乐时不能超过用户设定的音量，尤其不能把静音重新抬高。
        const normalGain = (this.settings.music <= 0 ? 0 : Math.pow(10, (-42 + this.settings.music * 42) / 20)) * 0.8;
        const g = this.buses.music.gain; g.cancelScheduledValues(now); g.setTargetAtTime(Math.min(normalGain, 0.012), now, 0.025);
        g.setTargetAtTime(normalGain, now + 0.3, 0.3);
      }
    }
    chime(notes, spacing) { notes.forEach((f, i) => this.tone(f, 0.42, { gain: 0.1, bus: 'ui', time: this.ctx.currentTime + i * spacing })); }
  }
  S.AudioEngine = AudioEngine;
})();
