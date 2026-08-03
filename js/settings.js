const SETTINGS_STORAGE_KEY = 'tetris-settings-v1';
const SCREEN_SIZE_MULTIPLIER = { small: 0.85, medium: 1, large: 1.2 };
const VIEWPORT_FIT_MARGIN = 16; // px of breathing room kept between the scaled content and the viewport edge

function defaultSettingsState() {
  return {
    volume: 0.5,
    muted: false,
    screenSize: 'medium', // small | medium | large
    keymap: { ...DEFAULT_KEYMAP },
  };
}

function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Arrow')) return code.replace('Arrow', '') + ' Arrow';
  if (code.startsWith('Key')) return code.slice(3);
  if (code === 'Space') return 'Space';
  return code;
}

class Settings {
  constructor({ game, input, sound }) {
    this.game = game;
    this.input = input;
    this.sound = sound;
    this.state = this.load();
    this.pendingRebindAction = null;
    this._rebindListener = null;

    this.cacheDom();
    this.bindEvents();
    this.renderKeymapList();
    this.applyAll();
  }

  load() {
    const defaults = defaultSettingsState();
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        volume: typeof parsed.volume === 'number' ? parsed.volume : defaults.volume,
        muted: !!parsed.muted,
        screenSize: ['small', 'medium', 'large'].includes(parsed.screenSize) ? parsed.screenSize : defaults.screenSize,
        keymap: { ...defaults.keymap, ...(parsed.keymap || {}) },
      };
    } catch {
      return defaults;
    }
  }

  save() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // localStorage unavailable (e.g. private browsing) — settings just won't persist
    }
  }

  cacheDom() {
    this.modal = document.getElementById('settings-modal');
    this.openBtns = Array.from(document.querySelectorAll('.open-settings-btn'));
    this.closeBtn = document.getElementById('settings-close-btn');
    this.backdrop = this.modal.querySelector('.modal-backdrop');
    this.muteCheckbox = document.getElementById('setting-mute');
    this.volumeSlider = document.getElementById('setting-volume');
    this.sizeButtons = Array.from(document.querySelectorAll('.screen-size-btn'));
    this.keymapList = document.getElementById('keymap-list');
    this.resetBtn = document.getElementById('settings-reset-btn');
  }

  bindEvents() {
    this.openBtns.forEach((btn) => btn.addEventListener('click', () => this.open()));
    this.closeBtn.addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());

    this.muteCheckbox.addEventListener('change', () => {
      this.state.muted = this.muteCheckbox.checked;
      this.save();
      this.applySound();
    });

    this.volumeSlider.addEventListener('input', () => {
      this.state.volume = Number(this.volumeSlider.value) / 100;
      this.save();
      this.applySound();
    });

    this.sizeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.screenSize = btn.dataset.size;
        this.save();
        this.applyScreenSize();
        this.updateSizeButtons();
      });
    });

    this.resetBtn.addEventListener('click', () => {
      if (this.pendingRebindAction) this.cancelRebind();
      this.state = defaultSettingsState();
      this.save();
      this.applyAll();
      this.renderKeymapList();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.modal.classList.contains('hidden')) this.close();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.refreshLayoutScale(), 80);
    });
  }

  open() {
    this.game.openSettings();
    this.modal.classList.remove('hidden');
  }

  close() {
    if (this.pendingRebindAction) this.cancelRebind();
    this.modal.classList.add('hidden');
    this.game.closeSettings();
  }

  applyAll() {
    this.muteCheckbox.checked = this.state.muted;
    this.volumeSlider.value = Math.round(this.state.volume * 100);
    this.applySound();
    this.applyScreenSize();
    this.updateSizeButtons();
    this.input.setKeymap(this.state.keymap);
  }

  applySound() {
    this.sound.setMuted(this.state.muted);
    this.sound.setVolume(this.state.volume);
  }

  applyScreenSize() {
    this.refreshLayoutScale();
  }

  // Scales every visible `.scalable` screen (main menu, game board) down to
  // fit inside the current viewport, capped by the user's size preference —
  // so the board never gets clipped or forces a scrollbar, at any window size.
  refreshLayoutScale() {
    const preferenceScale = SCREEN_SIZE_MULTIPLIER[this.state.screenSize] || 1;
    const availW = window.innerWidth - VIEWPORT_FIT_MARGIN * 2;
    const availH = window.innerHeight - VIEWPORT_FIT_MARGIN * 2;

    document.querySelectorAll('.scalable').forEach((el) => {
      // `.scalable` elements are `position: fixed`, which per spec always
      // reports `offsetParent === null` — checking client rects instead
      // correctly detects a `display: none` ancestor regardless of position.
      if (el.getClientRects().length === 0) return;

      const naturalWidth = el.offsetWidth;
      const naturalHeight = el.offsetHeight;
      if (!naturalWidth || !naturalHeight) return;

      const fitScale = Math.min(availW / naturalWidth, availH / naturalHeight);
      const finalScale = Math.max(0.3, Math.min(preferenceScale, fitScale));
      el.style.transform = `translate(-50%, -50%) scale(${finalScale})`;
    });
  }

  updateSizeButtons() {
    this.sizeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.size === this.state.screenSize);
    });
  }

  renderKeymapList() {
    this.keymapList.innerHTML = '';
    Object.keys(DEFAULT_KEYMAP).forEach((action) => {
      const row = document.createElement('div');
      row.className = 'keybind-row';

      const label = document.createElement('span');
      label.textContent = ACTION_LABELS[action];

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'keybind-btn';
      btn.textContent = keyLabel(this.state.keymap[action]);
      btn.addEventListener('click', () => this.startRebind(action, btn));

      row.appendChild(label);
      row.appendChild(btn);
      this.keymapList.appendChild(row);
    });
  }

  startRebind(action, btn) {
    if (this.pendingRebindAction) this.cancelRebind();
    this.pendingRebindAction = action;
    btn.textContent = 'Press a key…';
    btn.classList.add('listening');
    this.input.setEnabled(false);

    this._rebindListener = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        this.cancelRebind();
        return;
      }
      this.applyRebind(action, e.code);
    };
    window.addEventListener('keydown', this._rebindListener, { capture: true });
  }

  applyRebind(action, code) {
    for (const other of Object.keys(this.state.keymap)) {
      if (other !== action && this.state.keymap[other] === code) {
        this.state.keymap[other] = null;
      }
    }
    this.state.keymap[action] = code;
    this.save();
    this.input.setKeymap(this.state.keymap);
    this.endRebindListening();
    this.renderKeymapList();
  }

  cancelRebind() {
    this.endRebindListening();
    this.renderKeymapList();
  }

  endRebindListening() {
    if (this._rebindListener) {
      window.removeEventListener('keydown', this._rebindListener, { capture: true });
      this._rebindListener = null;
    }
    this.pendingRebindAction = null;
    this.input.setEnabled(true);
  }
}
