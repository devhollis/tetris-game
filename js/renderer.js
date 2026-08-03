const FRAME = { LOCKED: 0, ACTIVE: 1, BREAKING: 2 };
// The source art has a thin baked-in border/bevel per tile; trim it off so
// each block visually fills its whole grid cell instead of looking inset.
const SPRITE_INSET = 0.15;

const SPRITE_FILES = {
  i: 'i block sqr-Sheet.png',
  j: 'j block sqr-Sheet.png',
  l: 'l block sqr-Sheet.png',
  o: 'o block sqr-Sheet.png',
  s: 's block sqr-Sheet.png',
  t: 't block sqr-Sheet.png',
  z: 'z block sqr-Sheet.png',
};

function loadSprites(basePath = 'assets/') {
  const entries = Object.entries(SPRITE_FILES).map(([type, file]) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve([type, img]);
      img.onerror = () => {
        console.warn(`Failed to load sprite for "${type}" (${file})`);
        resolve([type, null]);
      };
      img.src = basePath + file;
    });
  });
  return Promise.all(entries).then((pairs) => Object.fromEntries(pairs));
}

class Renderer {
  constructor(canvas, nextCanvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.nextCtx = nextCanvas.getContext('2d');
    this.sprites = sprites;
    this.cellSize = CELL_SIZE;
  }

  drawSprite(ctx, type, frame, px, py, size, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (type === 'garbage') {
      ctx.fillStyle = '#4a4f5e';
      ctx.fillRect(px, py, size, size);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
      ctx.restore();
      return;
    }
    const img = this.sprites[type];
    if (img) {
      const frameWidth = img.naturalWidth / 3;
      const frameHeight = img.naturalHeight;
      const insetX = frameWidth * SPRITE_INSET;
      const insetY = frameHeight * SPRITE_INSET;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        frame * frameWidth + insetX, insetY, frameWidth - insetX * 2, frameHeight - insetY * 2,
        px, py, size, size
      );
    } else {
      ctx.fillStyle = TETROMINOES[type].color;
      ctx.fillRect(px, py, size, size);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
    }
    ctx.restore();
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * this.cellSize + 0.5, 0);
      ctx.lineTo(x * this.cellSize + 0.5, ROWS * this.cellSize);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * this.cellSize + 0.5);
      ctx.lineTo(COLS * this.cellSize, y * this.cellSize + 0.5);
      ctx.stroke();
    }
  }

  render(board, activePiece, ghostPiece, animator) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const shake = animator.getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    this.drawGrid();

    // Hard-drop woosh trail (drawn beneath the piece, along its fall path)
    const trail = animator.getTrail();
    if (trail) {
      ctx.save();
      for (const { x, y } of trail.cells) {
        const bottomY = y * this.cellSize;
        const topY = bottomY - trail.rows * this.cellSize;
        const gradient = ctx.createLinearGradient(0, topY, 0, bottomY);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(1, `rgba(255,255,255,${0.35 * trail.alpha})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x * this.cellSize, Math.max(0, topY), this.cellSize, bottomY - Math.max(0, topY));
      }
      ctx.restore();
    }

    // Locked board cells
    for (let y = 0; y < ROWS; y++) {
      if (animator.shouldSkipRow(y)) continue;
      const offsetY = animator.getDropOffset(y);
      for (let x = 0; x < COLS; x++) {
        const type = board.grid[y][x];
        if (!type) continue;
        const flashing = animator.isRowClearing(y) && animator.isFlashOn();
        const frame = flashing ? FRAME.BREAKING : FRAME.LOCKED;
        this.drawSprite(ctx, type, frame, x * this.cellSize, y * this.cellSize + offsetY, this.cellSize);
      }
    }

    // Ghost piece (landing preview)
    if (ghostPiece && !animator.isActive()) {
      for (const { x, y } of ghostPiece.getCells()) {
        if (y < 0) continue;
        this.drawSprite(ctx, ghostPiece.type, FRAME.ACTIVE, x * this.cellSize, y * this.cellSize, this.cellSize, 0.25);
      }
    }

    // Active falling piece
    if (activePiece && !animator.isActive()) {
      for (const { x, y } of activePiece.getCells()) {
        if (y < 0) continue;
        this.drawSprite(ctx, activePiece.type, FRAME.ACTIVE, x * this.cellSize, y * this.cellSize, this.cellSize);
      }
    }

    // Hard-drop landing flash
    const flash = animator.getImpactFlash();
    if (flash) {
      ctx.save();
      ctx.globalAlpha = flash.alpha;
      ctx.fillStyle = '#ffffff';
      for (const { x, y } of flash.cells) {
        if (y < 0) continue;
        ctx.fillRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  renderNext(piece) {
    const ctx = this.nextCtx;
    const size = this.nextCanvas.width;
    ctx.clearRect(0, 0, size, size);
    if (!piece) return;

    const def = TETROMINOES[piece.type];
    // Scale to the canvas's actual size (single-player's 128px preview and
    // battle mode's smaller 72px ones both need the biggest piece, the I,
    // to fit with a little margin) instead of a size assuming 128px only.
    const cellPx = Math.floor(size / 5);
    const boxPx = def.size * cellPx;
    const offsetX = (size - boxPx) / 2;
    const offsetY = (size - boxPx) / 2;

    for (const [ox, oy] of def.states[0]) {
      this.drawSprite(ctx, piece.type, FRAME.ACTIVE, offsetX + ox * cellPx, offsetY + oy * cellPx, cellPx);
    }
  }
}
