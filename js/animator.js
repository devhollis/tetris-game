const FLASH_INTERVAL = 80; // ms between flash toggles
const FLASH_TOGGLES = 6; // number of on/off toggles before collapsing
const COLLAPSE_DURATION = 220; // ms for rows to smoothly drop into place

const IMPACT_DURATION = 180; // ms for the hard-drop landing flash to fade
const SHAKE_DURATION = 160; // ms for the hard-drop screen shake to settle
const SHAKE_MAGNITUDE = 6; // px of peak shake displacement
const TRAIL_DURATION = 150; // ms for the hard-drop woosh streak to fade
const TRAIL_MAX_ROWS = 6; // cap the streak length for very long drops

class Animator {
  constructor(board) {
    this.board = board;
    this.phase = 'idle'; // 'idle' | 'flash' | 'collapse'
    this.clearingRows = [];
    this.flashTimer = 0;
    this.flashOn = true;
    this.flashCount = 0;
    this.collapseTimer = 0;
    this.onComplete = null;

    this.impact = null; // { cells, elapsed } — hard-drop landing flash
    this.shake = null; // { elapsed } — hard-drop screen shake
    this.trail = null; // { cells, dropDistance, elapsed } — hard-drop woosh streak
  }

  triggerHardDropImpact(cells, dropDistance = 0) {
    this.impact = { cells, elapsed: 0 };
    this.shake = { elapsed: 0 };
    this.trail = dropDistance > 0 ? { cells, dropDistance, elapsed: 0 } : null;
  }

  start(rowIndices, onComplete) {
    this.clearingRows = rowIndices.slice().sort((a, b) => a - b);
    this.phase = 'flash';
    this.flashTimer = 0;
    this.flashOn = true;
    this.flashCount = 0;
    this.collapseTimer = 0;
    this.onComplete = onComplete;
  }

  isActive() {
    return this.phase !== 'idle';
  }

  update(dt) {
    if (this.impact) {
      this.impact.elapsed += dt;
      if (this.impact.elapsed >= IMPACT_DURATION) this.impact = null;
    }
    if (this.shake) {
      this.shake.elapsed += dt;
      if (this.shake.elapsed >= SHAKE_DURATION) this.shake = null;
    }
    if (this.trail) {
      this.trail.elapsed += dt;
      if (this.trail.elapsed >= TRAIL_DURATION) this.trail = null;
    }

    if (this.phase === 'flash') {
      this.flashTimer += dt;
      if (this.flashTimer >= FLASH_INTERVAL) {
        this.flashTimer = 0;
        this.flashOn = !this.flashOn;
        this.flashCount++;
        if (this.flashCount >= FLASH_TOGGLES) {
          this.phase = 'collapse';
          this.collapseTimer = 0;
        }
      }
    } else if (this.phase === 'collapse') {
      this.collapseTimer += dt;
      if (this.collapseTimer >= COLLAPSE_DURATION) {
        this.board.clearRows(this.clearingRows);
        const cb = this.onComplete;
        this.phase = 'idle';
        this.clearingRows = [];
        this.onComplete = null;
        if (cb) cb();
      }
    }
  }

  isRowClearing(rowIndex) {
    return this.phase === 'flash' && this.clearingRows.includes(rowIndex);
  }

  isFlashOn() {
    return this.flashOn;
  }

  shouldSkipRow(rowIndex) {
    return this.phase === 'collapse' && this.clearingRows.includes(rowIndex);
  }

  getDropOffset(rowIndex) {
    if (this.phase !== 'collapse') return 0;
    const dropCount = this.clearingRows.filter((cr) => cr > rowIndex).length;
    if (dropCount === 0) return 0;
    const t = Math.min(1, this.collapseTimer / COLLAPSE_DURATION);
    const eased = t * t * (3 - 2 * t); // smoothstep easing
    return dropCount * CELL_SIZE * eased;
  }

  getImpactFlash() {
    if (!this.impact) return null;
    const t = this.impact.elapsed / IMPACT_DURATION;
    return { cells: this.impact.cells, alpha: 0.65 * (1 - t) };
  }

  getTrail() {
    if (!this.trail) return null;
    const t = this.trail.elapsed / TRAIL_DURATION;
    return {
      cells: this.trail.cells,
      rows: Math.min(this.trail.dropDistance, TRAIL_MAX_ROWS),
      alpha: 1 - t,
    };
  }

  getShakeOffset() {
    if (!this.shake) return { x: 0, y: 0 };
    const t = this.shake.elapsed / SHAKE_DURATION;
    const magnitude = SHAKE_MAGNITUDE * (1 - t);
    // Decaying oscillation rather than random jitter, so it reads as a
    // deliberate "thud" instead of noise.
    const wave = Math.sin(t * Math.PI * 5);
    return { x: 0, y: magnitude * wave };
  }
}
