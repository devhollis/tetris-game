// Shared constants (loaded first so later scripts can use them as globals)
const COLS = 10;
const ROWS = 20;
const CELL_SIZE = 40;

// Shared scoring/timing rules used by both single-player (game.js) and
// battle mode (battle.js).
const LINE_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };
const SOFT_DROP_POINT = 1;
const HARD_DROP_POINT = 2;
const LINES_PER_LEVEL = 10;
const LOCK_DELAY = 500; // ms a grounded piece waits before locking
const MAX_LOCK_RESETS = 15; // cap on how many times moving/rotating can re-arm the lock delay
                             // (standard Tetris Guideline value — stops infinite spin-stalling
                             // while still allowing normal last-moment adjustments)

const SOFT_DROP_SPEED_MULTIPLIER = 6; // soft drop falls this many times faster than normal gravity
const SOFT_DROP_MIN_INTERVAL = 60; // ms floor, so it stays controllable even at high levels

function getFallInterval(level) {
  return Math.max(100, 1000 - (level - 1) * 75);
}

function getSoftDropInterval(level) {
  return Math.max(SOFT_DROP_MIN_INTERVAL, Math.round(getFallInterval(level) / SOFT_DROP_SPEED_MULTIPLIER));
}

// Piece shapes per rotation state (0, R, 2, L), given as [x, y] offsets
// within a bounding box. Coordinates follow the standard SRS layout.
const TETROMINOES = {
  i: {
    size: 4,
    color: '#4dd8ff',
    states: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
  },
  o: {
    size: 2,
    color: '#ffe14d',
    states: [
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],
  },
  t: {
    size: 3,
    color: '#c04dff',
    states: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  s: {
    size: 3,
    color: '#5bff6e',
    states: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  z: {
    size: 3,
    color: '#ff5b5b',
    states: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
  },
  j: {
    size: 3,
    color: '#4d6bff',
    states: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
  },
  l: {
    size: 3,
    color: '#ff9d4d',
    states: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
  },
};

const PIECE_TYPES = Object.keys(TETROMINOES);

// Generous wall/floor kick offsets tried in order after a rotation collides.
const KICK_OFFSETS = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1],
];

class Piece {
  constructor(type) {
    this.type = type;
    this.rotationState = 0;
    const def = TETROMINOES[type];
    this.x = Math.floor((COLS - def.size) / 2);
    this.y = type === 'i' ? -1 : 0;
  }

  get def() {
    return TETROMINOES[this.type];
  }

  getCells(rotationState = this.rotationState, x = this.x, y = this.y) {
    return this.def.states[rotationState].map(([ox, oy]) => ({ x: x + ox, y: y + oy }));
  }

  clone() {
    const p = new Piece(this.type);
    p.rotationState = this.rotationState;
    p.x = this.x;
    p.y = this.y;
    return p;
  }
}

// Fisher-Yates shuffled 7-bag randomizer
function createBag() {
  const bag = [...PIECE_TYPES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
