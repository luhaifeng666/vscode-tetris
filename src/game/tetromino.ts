import { COLS, ROWS, PIECE_KINDS, type ActivePiece, type PieceKind, type Rotation } from "./types";

/** [x, y]，相对包围盒左上角。 */
export type Cell = readonly [number, number];

export interface Shape {
  readonly cells: readonly Cell[];
  readonly width: number;
  readonly height: number;
}

/**
 * 出生朝向。刻意用「紧包围盒」而不是 4×4 矩阵：
 * 紧包围盒旋转后仍然贴边，方块不会在墙边凭空平移一格。
 */
const BASE: Readonly<Record<PieceKind, readonly string[]>> = {
  I: ["XXXX"],
  O: ["XX", "XX"],
  T: ["XXX", ".X."],
  S: [".XX", "XX."],
  Z: ["XX.", ".XX"],
  J: ["X..", "XXX"],
  L: ["..X", "XXX"],
};

function cellsOf(matrix: readonly string[]): Cell[] {
  const cells: Cell[] = [];
  matrix.forEach((row, y) => {
    [...row].forEach((char, x) => {
      if (char === "X") cells.push([x, y]);
    });
  });
  return cells;
}

/** 顺时针旋转；(x, y) → (height - 1 - y, x)。 */
function rotateCells(cells: readonly Cell[], height: number): Cell[] {
  return cells.map(([x, y]) => [height - 1 - y, x] as const);
}

function buildShapes(): Record<PieceKind, readonly Shape[]> {
  const result = {} as Record<PieceKind, readonly Shape[]>;
  for (const kind of PIECE_KINDS) {
    const matrix = BASE[kind];
    let width = matrix[0]?.length ?? 0;
    let height = matrix.length;
    let cells = cellsOf(matrix);
    const rotations: Shape[] = [];

    for (let rotation = 0; rotation < 4; rotation++) {
      rotations.push({ cells, width, height });
      const next = rotateCells(cells, height);
      [width, height] = [height, width];
      cells = next;
    }
    result[kind] = rotations;
  }
  return result;
}

export const SHAPES: Readonly<Record<PieceKind, readonly Shape[]>> = buildShapes();

export function shapeAt(kind: PieceKind, rotation: Rotation): Shape {
  return SHAPES[kind][rotation]!;
}

export function spawnPiece(kind: PieceKind): ActivePiece {
  const shape = shapeAt(kind, 0);
  return {
    kind,
    rotation: 0,
    // 紧贴顶部出生，整块可见，避免玩家看不见刚落下的方块。
    x: Math.floor((COLS - shape.width) / 2),
    y: 0,
  };
}

export function collides(
  board: Uint8Array,
  piece: ActivePiece,
  shape: Shape = shapeAt(piece.kind, piece.rotation),
  offsetX = 0,
  offsetY = 0,
): boolean {
  for (const [cellX, cellY] of shape.cells) {
    const x = piece.x + cellX + offsetX;
    const y = piece.y + cellY + offsetY;
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    // y < 0 的部分还在顶部之外，不算碰撞。
    if (y >= 0 && board[y * COLS + x] !== 0) return true;
  }
  return false;
}

/**
 * 经典墙踢：只做水平 ±1/±2 与向上 1 格。
 * 这套规则足以让贴墙旋转不至于卡住，又不引入 SRS 的复杂度。
 */
const KICKS: readonly Cell[] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
];

export function tryRotate(
  board: Uint8Array,
  piece: ActivePiece,
  direction: 1 | -1,
): ActivePiece | null {
  const rotation = ((piece.rotation + (direction === 1 ? 1 : 3)) % 4) as Rotation;
  const candidate: ActivePiece = { ...piece, rotation };

  for (const [offsetX, offsetY] of KICKS) {
    const moved: ActivePiece = {
      ...candidate,
      x: candidate.x + offsetX,
      y: candidate.y + offsetY,
    };
    if (!collides(board, moved)) return moved;
  }
  return null;
}
