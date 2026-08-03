// Small synthesized sound effects via Web Audio — no external audio assets
// needed, so the game keeps working from a plain file:// double-click.
class SoundManager {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
    this.muted = false;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
  }

  setMuted(muted) {
    this.muted = muted;
  }

  _ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _tone({ freq, duration = 0.08, type = 'square', gain = 0.2, sweepTo = null, delay = 0 }) {
    if (this.muted || this.volume <= 0) return;
    const ctx = this._ensureContext();
    const startTime = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (sweepTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), startTime + duration);
    }

    const peak = Math.max(0.0001, gain * this.volume);
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(peak, startTime + 0.008);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gainNode).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  move() {
    this._tone({ freq: 220, duration: 0.045, type: 'square', gain: 0.1 });
  }

  rotate() {
    this._tone({ freq: 330, duration: 0.06, type: 'square', gain: 0.14 });
  }

  softDrop() {
    this._tone({ freq: 140, duration: 0.03, type: 'square', gain: 0.07 });
  }

  hardDrop() {
    this._tone({ freq: 220, duration: 0.14, type: 'sawtooth', gain: 0.22, sweepTo: 55 });
  }

  lock() {
    this._tone({ freq: 180, duration: 0.07, type: 'triangle', gain: 0.14 });
  }

  lineClear(count) {
    const steps = Math.max(1, count);
    for (let i = 0; i < steps; i++) {
      this._tone({ freq: 440 + i * 110, duration: 0.09, type: 'square', gain: 0.18, delay: i * 0.06 });
    }
  }

  levelUp() {
    this._tone({ freq: 523, duration: 0.18, type: 'triangle', gain: 0.2, sweepTo: 1046 });
  }

  gameOver() {
    this._tone({ freq: 220, duration: 0.45, type: 'sawtooth', gain: 0.2, sweepTo: 55 });
  }
}
