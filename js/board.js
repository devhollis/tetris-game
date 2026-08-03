class Board {
  constructor(cols = COLS, rows = ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
  }

  // Checks whether the given cells (or a piece's cells shifted by dx/dy) are
  // all within bounds and not overlapping locked cells. Cells above the
  // visible board (y < 0) are allowed, to support spawning/rotating near the top.
  isValidPosition(piece, dx = 0, dy = 0, rotationState = piece.rotationState) {
    const cells = piece.getCells(rotationState, piece.x + dx, piece.y + dy);
    for (const { x, y } of cells) {
      if (x < 0 || x >= this.cols || y >= this.rows) return false;
      if (y >= 0 && this.grid[y][x] !== null) return false;
    }
    return true;
  }

  lockPiece(piece) {
    for (const { x, y } of piece.getCells()) {
      if (y >= 0 && y < this.rows && x >= 0 && x < this.cols) {
        this.grid[y][x] = piece.type;
      }
    }
  }

  getFullRows() {
    const full = [];
    for (let y = 0; y < this.rows; y++) {
      if (this.grid[y].every((cell) => cell !== null)) full.push(y);
    }
    return full;
  }

  clearRows(rowIndices) {
    if (!rowIndices.length) return;
    const rowsToClear = new Set(rowIndices);
    const remaining = this.grid.filter((_, y) => !rowsToClear.has(y));
    const newRows = Array.from({ length: rowIndices.length }, () => Array(this.cols).fill(null));
    this.grid = newRows.concat(remaining);
  }

  isGameOver(piece) {
    return !this.isValidPosition(piece, 0, 0);
  }

  // Battle mode: pushes `count` solid rows (each with one random gap) in from
  // the bottom, shifting the existing stack up. Rows shifted off the top are
  // simply lost — the caller is responsible for checking whether that just
  // buried the active piece (i.e. a top-out).
  addGarbageRows(count) {
    const rowsToAdd = Math.min(count, this.rows);
    if (rowsToAdd <= 0) return;
    const newRows = [];
    for (let i = 0; i < rowsToAdd; i++) {
      const gapCol = Math.floor(Math.random() * this.cols);
      const row = Array(this.cols).fill('garbage');
      row[gapCol] = null;
      newRows.push(row);
    }
    this.grid = this.grid.slice(rowsToAdd).concat(newRows);
  }
}
