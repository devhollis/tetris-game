const DAS_DELAY = 170; // ms before auto-repeat kicks in
const ARR_INTERVAL = 50; // ms between auto-repeat moves

const DEFAULT_KEYMAP = {
  moveLeft: 'ArrowLeft',
  moveRight: 'ArrowRight',
  rotateCW: 'ArrowUp',
  rotateCCW: 'KeyZ',
  softDrop: 'ArrowDown',
  hardDrop: 'Space',
  pause: 'KeyP',
  restart: 'KeyR',
};

const ACTION_LABELS = {
  moveLeft: 'Move Left',
  moveRight: 'Move Right',
  rotateCW: 'Rotate CW',
  rotateCCW: 'Rotate CCW',
  softDrop: 'Soft Drop',
  hardDrop: 'Hard Drop',
  pause: 'Pause',
  restart: 'Restart',
};

class Input {
  constructor(callbacks, keymap = DEFAULT_KEYMAP) {
    this.callbacks = callbacks;
    this.setKeymap(keymap);
    this.heldDirection = null; // 'left' | 'right' | null -- which direction DAS is currently driving
    this.leftHeld = false;
    this.rightHeld = false;
    this.dasTimer = 0;
    this.softDropping = false;
    this.enabled = true;

    this._onKeyDown = this.onKeyDown.bind(this);
    this._onKeyUp = this.onKeyUp.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  setKeymap(keymap) {
    this.keymap = { ...keymap };
    this.actionForCode = {};
    for (const [action, code] of Object.entries(this.keymap)) {
      this.actionForCode[code] = action;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.heldDirection = null;
      this.leftHeld = false;
      this.rightHeld = false;
      this.softDropping = false;
    }
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    const action = this.actionForCode[e.code];
    if (!action) return;
    e.preventDefault();

    switch (action) {
      case 'moveLeft':
        if (!e.repeat) {
          this.callbacks.moveLeft();
          this.leftHeld = true;
          this.heldDirection = 'left';
          this.dasTimer = 0;
        }
        break;
      case 'moveRight':
        if (!e.repeat) {
          this.callbacks.moveRight();
          this.rightHeld = true;
          this.heldDirection = 'right';
          this.dasTimer = 0;
        }
        break;
      case 'softDrop':
        if (!e.repeat) {
          this.softDropping = true;
          this.callbacks.softDropStart();
        }
        break;
      case 'rotateCW':
        if (!e.repeat) this.callbacks.rotateCW();
        break;
      case 'rotateCCW':
        if (!e.repeat) this.callbacks.rotateCCW();
        break;
      case 'hardDrop':
        if (!e.repeat) this.callbacks.hardDrop();
        break;
      case 'pause':
        if (!e.repeat) this.callbacks.pause();
        break;
      case 'restart':
        if (!e.repeat) this.callbacks.restart();
        break;
    }
  }

  onKeyUp(e) {
    const action = this.actionForCode[e.code];
    if (!action) return;

    // If both directions were held (e.g. tapping the opposite way to
    // fine-tune position) and one is released, DAS should hand off to
    // whichever direction is still held rather than just stopping.
    if (action === 'moveLeft') {
      this.leftHeld = false;
      if (this.heldDirection === 'left') {
        this.heldDirection = this.rightHeld ? 'right' : null;
        this.dasTimer = 0;
      }
    }
    if (action === 'moveRight') {
      this.rightHeld = false;
      if (this.heldDirection === 'right') {
        this.heldDirection = this.leftHeld ? 'left' : null;
        this.dasTimer = 0;
      }
    }
    if (action === 'softDrop') {
      this.softDropping = false;
      this.callbacks.softDropEnd();
    }
  }

  isSoftDropping() {
    return this.softDropping;
  }

  // Handles delayed-auto-shift repeat movement; call once per frame.
  update(dt) {
    if (!this.enabled || !this.heldDirection) return;
    this.dasTimer += dt;
    if (this.dasTimer < DAS_DELAY) return;
    const over = this.dasTimer - DAS_DELAY;
    if (over >= ARR_INTERVAL || this.dasTimer - dt < DAS_DELAY) {
      this.dasTimer = DAS_DELAY + (over % ARR_INTERVAL);
      if (this.heldDirection === 'left') this.callbacks.moveLeft();
      else this.callbacks.moveRight();
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
