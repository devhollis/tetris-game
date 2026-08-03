// Two-player local battle mode. Reuses Board/Piece/Animator/Renderer/Input —
// each BattlePlayer is a self-contained game-logic instance (mirrors what
// Game does for single-player, minus menu/settings concerns, plus sending
// and receiving garbage rows).

const P1_KEYMAP = {
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  rotateCW: 'KeyW',
  rotateCCW: 'KeyQ',
  softDrop: 'KeyS',
  hardDrop: 'Space',
  pause: null,
  restart: null,
};

const P2_KEYMAP = {
  moveLeft: 'ArrowLeft',
  moveRight: 'ArrowRight',
  rotateCW: 'ArrowUp',
  rotateCCW: 'ShiftRight',
  softDrop: 'ArrowDown',
  hardDrop: 'Enter',
  pause: null,
  restart: null,
};

// Lines cleared at once -> garbage rows sent to the opponent.
const GARBAGE_SEND_TABLE = { 1: 0, 2: 1, 3: 2, 4: 4 };
const GARBAGE_DELAY = 1000; // ms of warning before incoming garbage actually lands

class BattlePlayer {
  constructor({ label, keymap, sound, sprites, dom }) {
    this.label = label;
    this.sound = sound;
    this.dom = dom;
    this.opponent = null;
    this.onGameOver = null;

    this.board = new Board();
    this.animator = new Animator(this.board);
    this.renderer = new Renderer(dom.canvas, dom.nextCanvas, sprites);

    this.state = 'playing'; // playing | clearing | gameover | won
    this.bag = [];
    this.currentPiece = null;
    this.nextType = null;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.pendingGarbage = []; // [{ amount, timer }] -- queued attacks waiting to land

    this.input = new Input(
      {
        moveLeft: () => this.moveLeft(),
        moveRight: () => this.moveRight(),
        rotateCW: () => this.rotate(1),
        rotateCCW: () => this.rotate(-1),
        hardDrop: () => this.hardDrop(),
        softDropStart: () => {},
        softDropEnd: () => {},
        pause: () => {},
        restart: () => {},
      },
      keymap
    );

    this.dom.rematchBtn.addEventListener('click', () => {
      if (this.onRematch) this.onRematch();
    });

    this.reset();
  }

  reset() {
    this.board.reset();
    this.bag = [];
    this.score = 0;
    this.level = 1;
    this.linesCleared = 0;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.pendingGarbage = [];
    this.updateIncomingIndicator();
    this.nextType = this.drawFromBag();
    this.updateHUD();
    this.hideOverlay();
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

      const garbage = GARBAGE_SEND_TABLE[fullRows.length] || 0;
      if (garbage > 0 && this.opponent) this.opponent.receiveGarbage(garbage);

      this.updateHUD();
      this.state = 'clearing';
      this.animator.start(fullRows, () => this.afterClear());
    } else {
      this.sound.lock();
      this.updateHUD();
      this.afterClear();
    }
  }

  // Queues an incoming attack rather than applying it instantly, so the
  // receiving player gets a brief warning (and a moment to react) before
  // the rows actually land. Applied later in processPendingGarbage().
  receiveGarbage(count) {
    if (this.state === 'gameover' || this.state === 'won') return;
    this.pendingGarbage.push({ amount: count, timer: GARBAGE_DELAY });
    this.updateIncomingIndicator();
  }

  processPendingGarbage(dt) {
    if (this.pendingGarbage.length === 0) return;
    let landed = 0;
    this.pendingGarbage = this.pendingGarbage.filter((entry) => {
      entry.timer -= dt;
      if (entry.timer > 0) return true;
      landed += entry.amount;
      return false;
    });
    if (landed > 0) {
      this.board.addGarbageRows(landed);
      this.updateIncomingIndicator();
      if (this.currentPiece && !this.board.isValidPosition(this.currentPiece, 0, 0)) {
        this.gameOver();
      }
    }
  }

  updateIncomingIndicator() {
    if (!this.dom.incomingEl) return;
    const total = this.pendingGarbage.reduce((sum, entry) => sum + entry.amount, 0);
    this.dom.incomingEl.textContent = total;
    this.dom.incomingEl.classList.toggle('warning', total > 0);
  }

  afterClear() {
    if (this.state === 'gameover' || this.state === 'won') return;
    this.state = 'playing';
    this.spawnPiece();
  }

  gameOver() {
    if (this.state === 'gameover' || this.state === 'won') return;
    this.state = 'gameover';
    this.sound.gameOver();
    this.showOverlay('Game Over', 'Waiting for rematch…');
    if (this.onGameOver) this.onGameOver(this);
  }

  declareWinner() {
    this.state = 'won';
    this.showOverlay(`${this.label} Wins!`, 'Press Rematch to play again');
  }

  showOverlay(title, message) {
    this.dom.overlayTitle.textContent = title;
    this.dom.overlayMessage.textContent = message;
    this.dom.overlay.classList.remove('hidden');
  }

  hideOverlay() {
    this.dom.overlay.classList.add('hidden');
  }

  updateHUD() {
    this.dom.scoreEl.textContent = this.score;
    this.dom.linesEl.textContent = this.linesCleared;
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

  update(dt) {
    this.input.update(dt);
    if (this.state !== 'gameover' && this.state !== 'won') this.processPendingGarbage(dt);
    if (this.state === 'playing') this.updateGravity(dt);
    if (this.state === 'playing' || this.state === 'clearing') this.animator.update(dt);
  }

  render() {
    const ghost = this.state === 'playing' ? this.computeGhost() : null;
    const active = this.state === 'playing' ? this.currentPiece : null;
    this.renderer.render(this.board, active, ghost, this.animator);
  }

  destroy() {
    this.input.destroy();
  }
}

class BattleMatch {
  constructor({ p1Dom, p2Dom, sound, sprites }) {
    this.sound = sound;
    this.active = true;
    this.lastTime = 0;

    this.p1 = new BattlePlayer({ label: 'Player 1', keymap: P1_KEYMAP, sound, sprites, dom: p1Dom });
    this.p2 = new BattlePlayer({ label: 'Player 2', keymap: P2_KEYMAP, sound, sprites, dom: p2Dom });
    this.p1.opponent = this.p2;
    this.p2.opponent = this.p1;
    this.p1.onGameOver = () => this.endMatch(this.p1);
    this.p2.onGameOver = () => this.endMatch(this.p2);
    this.p1.onRematch = () => this.rematch();
    this.p2.onRematch = () => this.rematch();

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  endMatch(loser) {
    const winner = loser === this.p1 ? this.p2 : this.p1;
    winner.declareWinner();
  }

  rematch() {
    this.p1.reset();
    this.p2.reset();
  }

  loop(timestamp) {
    if (!this.active) return;
    const dt = this.lastTime ? timestamp - this.lastTime : 16.67;
    this.lastTime = timestamp;

    this.p1.update(dt);
    this.p2.update(dt);
    this.p1.render();
    this.p2.render();

    requestAnimationFrame(this.loop);
  }

  destroy() {
    this.active = false;
    this.p1.destroy();
    this.p2.destroy();
  }
}
