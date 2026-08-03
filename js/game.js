class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.nextCanvas = document.getElementById('next-canvas');
    this.loadingEl = document.getElementById('loading');
    this.mainMenuEl = document.getElementById('main-menu');
    this.gameContainerEl = document.querySelector('.game-container');
    this.twoPlayerEl = document.getElementById('two-player-screen');
    this.menu1pBtn = document.getElementById('menu-1p-btn');
    this.menu2pBtn = document.getElementById('menu-2p-btn');
    this.backToMenuBtn = document.getElementById('menu-btn');
    this.battleMenuBtn = document.getElementById('battle-menu-btn');
    this.overlayEl = document.getElementById('overlay');
    this.overlayTitleEl = document.getElementById('overlay-title');
    this.overlayMessageEl = document.getElementById('overlay-message');
    this.restartBtn = document.getElementById('restart-btn');
    this.scoreEl = document.getElementById('score');
    this.levelEl = document.getElementById('level');
    this.linesEl = document.getElementById('lines');

    this.board = new Board();
    this.animator = new Animator(this.board);
    this.renderer = null;
    this.sprites = null;
    this.battleMatch = null;

    this.state = 'loading'; // loading | menu | playing | paused | clearing | gameover
    this.bag = [];
    this.currentPiece = null;
    this.nextType = null;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.lastTime = 0;

    this.settingsOpen = false;
    this.wasPlayingBeforeSettings = false;

    this.sound = new SoundManager();

    this.input = new Input({
      moveLeft: () => this.moveLeft(),
      moveRight: () => this.moveRight(),
      rotateCW: () => this.rotate(1),
      rotateCCW: () => this.rotate(-1),
      hardDrop: () => this.hardDrop(),
      softDropStart: () => {},
      softDropEnd: () => {},
      pause: () => this.togglePause(),
      restart: () => {
        if (this.state === 'playing' || this.state === 'paused' || this.state === 'gameover') this.restart();
      },
    });

    this.settings = new Settings({ game: this, input: this.input, sound: this.sound });

    this.restartBtn.addEventListener('click', () => this.restart());
    this.menu1pBtn.addEventListener('click', () => this.startSinglePlayer());
    this.menu2pBtn.addEventListener('click', () => this.startTwoPlayer());
    this.backToMenuBtn.addEventListener('click', () => this.showMainMenu());
    this.battleMenuBtn.addEventListener('click', () => this.showMainMenu());
    this.loop = this.loop.bind(this);
  }

  async init() {
    this.sprites = await loadSprites('assets/');
    this.renderer = new Renderer(this.canvas, this.nextCanvas, this.sprites);
    this.loadingEl.classList.add('hidden');
    this.showMainMenu();
    requestAnimationFrame(this.loop);
  }

  hideAllScreens() {
    this.mainMenuEl.classList.add('hidden');
    this.gameContainerEl.classList.add('hidden');
    this.twoPlayerEl.classList.add('hidden');
  }

  showMainMenu() {
    if (this.battleMatch) {
      this.battleMatch.destroy();
      this.battleMatch = null;
    }
    this.hideAllScreens();
    this.mainMenuEl.classList.remove('hidden');
    this.state = 'menu';
    this.settings.refreshLayoutScale();
  }

  startSinglePlayer() {
    this.hideAllScreens();
    this.gameContainerEl.classList.remove('hidden');
    this.settings.refreshLayoutScale();
    this.restart();
  }

  startTwoPlayer() {
    this.hideAllScreens();
    this.twoPlayerEl.classList.remove('hidden');
    this.settings.refreshLayoutScale();
    this.state = 'battle';

    this.battleMatch = new BattleMatch({
      sound: this.sound,
      sprites: this.sprites,
      p1Dom: {
        canvas: document.getElementById('p1-canvas'),
        nextCanvas: document.getElementById('p1-next-canvas'),
        overlay: document.getElementById('p1-overlay'),
        overlayTitle: document.getElementById('p1-overlay-title'),
        overlayMessage: document.getElementById('p1-overlay-message'),
        rematchBtn: document.getElementById('p1-rematch-btn'),
        scoreEl: document.getElementById('p1-score'),
        linesEl: document.getElementById('p1-lines'),
        incomingEl: document.getElementById('p1-incoming'),
      },
      p2Dom: {
        canvas: document.getElementById('p2-canvas'),
        nextCanvas: document.getElementById('p2-next-canvas'),
        overlay: document.getElementById('p2-overlay'),
        overlayTitle: document.getElementById('p2-overlay-title'),
        overlayMessage: document.getElementById('p2-overlay-message'),
        rematchBtn: document.getElementById('p2-rematch-btn'),
        scoreEl: document.getElementById('p2-score'),
        linesEl: document.getElementById('p2-lines'),
        incomingEl: document.getElementById('p2-incoming'),
      },
    });
  }

  restart() {
    this.board.reset();
    this.bag = [];
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.nextType = this.drawFromBag();
    this.hideOverlay();
    this.updateHUD();
    this.spawnPiece();
    this.state = 'playing';
  }

  drawFromBag() {
    if (this.bag.length === 0) this.bag = createBag();
    return this.bag.shift();
  }

  spawnPiece() {
    this.currentPiece = new Piece(this.nextType);
    this.nextType = this.drawFromBag();
    this.renderer.renderNext(new Piece(this.nextType));
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestRow = this.getPieceBottomRow();

    if (this.board.isGameOver(this.currentPiece)) {
      this.gameOver();
    }
  }

  moveLeft() {
    if (this.state !== 'playing') return;
    if (this.tryMove(-1, 0)) this.sound.move();
  }

  moveRight() {
    if (this.state !== 'playing') return;
    if (this.tryMove(1, 0)) this.sound.move();
  }

  // The lowest (largest-y) row actually occupied by the piece right now.
  // Deliberately NOT piece.y (the bounding-box reference corner) — that
  // jumps around independent of real depth when a piece like the I rotates
  // between orientations with very different cell offsets, which would
  // falsely look like downward progress on every spin.
  getPieceBottomRow() {
    const cells = this.currentPiece.getCells();
    return Math.max(...cells.map((c) => c.y));
  }

  // Re-arms the lock delay after a successful move/rotation. Reaching a new
  // lowest row (real downward progress) always gets a full fresh delay. A
  // move/rotation that doesn't progress any lower — e.g. spinning in place,
  // or a wall/floor kick that nudges the piece up a row before it re-settles
  // at the same depth — only re-arms the delay up to MAX_LOCK_RESETS times.
  // This deliberately does NOT check isGrounded(): a kick that briefly lifts
  // the piece off the floor for a single frame must still count against the
  // cap, otherwise updateGravity's per-frame grounded check simply pauses
  // (rather than resets) the countdown on every such blip, which stalls the
  // piece forever just as effectively as an uncapped reset would.
  armLockDelay() {
    const bottomRow = this.getPieceBottomRow();
    if (bottomRow > this.lowestRow) {
      this.lowestRow = bottomRow;
      this.lockTimer = 0;
      this.lockResets = 0;
    } else if (this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  tryMove(dx, dy) {
    if (!this.board.isValidPosition(this.currentPiece, dx, dy)) return false;
    this.currentPiece.x += dx;
    this.currentPiece.y += dy;
    this.armLockDelay();
    return true;
  }

  rotate(dir) {
    if (this.state !== 'playing') return;
    const piece = this.currentPiece;
    const newState = (piece.rotationState + dir + 4) % 4;
    for (const [kx, ky] of KICK_OFFSETS) {
      if (this.board.isValidPosition(piece, kx, ky, newState)) {
        piece.x += kx;
        piece.y += ky;
        piece.rotationState = newState;
        this.armLockDelay();
        this.sound.rotate();
        return true;
      }
    }
    return false;
  }

  hardDrop() {
    if (this.state !== 'playing') return;
    let distance = 0;
    while (this.board.isValidPosition(this.currentPiece, 0, 1)) {
      this.currentPiece.y++;
      distance++;
    }
    this.score += distance * HARD_DROP_POINT;
    this.animator.triggerHardDropImpact(this.currentPiece.getCells(), distance);
    this.sound.hardDrop();
    this.lockPiece();
  }

  isGrounded() {
    return !this.board.isValidPosition(this.currentPiece, 0, 1);
  }

  lockPiece() {
    this.board.lockPiece(this.currentPiece);
    const fullRows = this.board.getFullRows();

    if (fullRows.length > 0) {
      this.score += (LINE_SCORES[fullRows.length] || 0) * this.level;
      this.linesCleared += fullRows.length;
      const newLevel = Math.floor(this.linesCleared / LINES_PER_LEVEL) + 1;
      this.sound.lineClear(fullRows.length);
      if (newLevel !== this.level) this.sound.levelUp();
      this.level = newLevel;
      this.updateHUD();
      this.state = 'clearing';
      this.animator.start(fullRows, () => this.afterClear());
    } else {
      this.sound.lock();
      this.updateHUD();
      this.afterClear();
    }
  }

  afterClear() {
    if (this.state === 'gameover') return;
    this.state = 'playing';
    this.spawnPiece();
  }

  gameOver() {
    this.state = 'gameover';
    this.sound.gameOver();
    this.showOverlay('Game Over', `Score: ${this.score}`);
  }

  togglePause() {
    if (this.settingsOpen) return;
    if (this.state === 'playing') {
      this.state = 'paused';
      this.showOverlay('Paused', 'Press P to resume');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hideOverlay();
    }
  }

  openSettings() {
    this.wasPlayingBeforeSettings = this.state === 'playing';
    if (this.wasPlayingBeforeSettings) this.state = 'paused';
    this.settingsOpen = true;
  }

  closeSettings() {
    this.settingsOpen = false;
    if (this.wasPlayingBeforeSettings) {
      this.state = 'playing';
      this.hideOverlay();
    } else if (this.state === 'paused') {
      this.showOverlay('Paused', 'Press P to resume');
    }
  }

  showOverlay(title, message) {
    this.overlayTitleEl.textContent = title;
    this.overlayMessageEl.textContent = message;
    this.overlayEl.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }

  updateHUD() {
    this.scoreEl.textContent = this.score;
    this.levelEl.textContent = this.level;
    this.linesEl.textContent = this.linesCleared;
  }

  computeGhost() {
    if (!this.currentPiece) return null;
    const ghost = this.currentPiece.clone();
    while (this.board.isValidPosition(ghost, 0, 1)) ghost.y++;
    return ghost;
  }

  updateGravity(dt) {
    // lockTimer accumulates every frame regardless of grounded state (see
    // armLockDelay for why) -- only whether we're grounded *right now* at
    // expiry decides whether it actually locks.
    this.lockTimer += dt;

    if (this.isGrounded()) {
      if (this.lockTimer >= LOCK_DELAY) {
        this.lockPiece();
      }
    } else {
      this.fallTimer += dt;
      const interval = this.input.isSoftDropping() ? getSoftDropInterval(this.level) : getFallInterval(this.level);
      if (this.fallTimer >= interval) {
        this.fallTimer -= interval;
        const moved = this.tryMove(0, 1);
        if (moved && this.input.isSoftDropping()) {
          this.score += SOFT_DROP_POINT;
          this.sound.softDrop();
        }
      }
    }
  }

  loop(timestamp) {
    const dt = this.lastTime ? timestamp - this.lastTime : 16.67;
    this.lastTime = timestamp;

    this.input.update(dt);

    if (this.state === 'playing') {
      this.updateGravity(dt);
    }
    if (this.state === 'playing' || this.state === 'clearing') {
      this.animator.update(dt);
    }

    if (this.state !== 'menu' && this.state !== 'battle') {
      const ghost = this.state === 'playing' ? this.computeGhost() : null;
      const active = this.state === 'playing' ? this.currentPiece : null;
      this.renderer.render(this.board, active, ghost, this.animator);
    }

    requestAnimationFrame(this.loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init();
});
