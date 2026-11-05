import { shapeAt } from "../game/tetromino";
import { COLS, ROWS, type GameState, type PieceKind } from "../game/types";
import type { Palette, Shades } from "./skin";

/**
 * 格子始终取整数像素，保证像素边缘清晰。
 * 上限 12px：侧边栏再宽也不会变成巨型砖块；窄于 120px 时按宽度等比缩小。
 */
const MAX_CELL = 12;
const MIN_CELL = 6;

function prepareCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

interface BoardLayout {
  readonly cell: number;
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

function boardLayout(width: number, height: number): BoardLayout | null {
  const cell = Math.min(MAX_CELL, Math.floor(Math.min(width / COLS, height / ROWS)));
  if (cell < MIN_CELL) return null;
  return {
    cell,
    boardWidth: cell * COLS,
    boardHeight: cell * ROWS,
    offsetX: Math.floor((width - cell * COLS) / 2),
    offsetY: Math.floor((height - cell * ROWS) / 2),
  };
}

/** 一个方块 = 实心色块 + 1px 外描边 + 左上高光 + 右下阴影。 */
function paintBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  shades: Shades,
): void {
  ctx.fillStyle = shades.fill;
  ctx.fillRect(x, y, cell, cell);

  if (cell >= 4) {
    ctx.fillStyle = shades.light;
    ctx.fillRect(x + 1, y + 1, cell - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, cell - 2);

    ctx.fillStyle = shades.dark;
    ctx.fillRect(x + 1, y + cell - 2, cell - 2, 1);
    ctx.fillRect(x + cell - 2, y + 1, 1, cell - 2);
  }

  ctx.fillStyle = shades.dark;
  ctx.fillRect(x, y, cell, 1);
  ctx.fillRect(x, y + cell - 1, cell, 1);
  ctx.fillRect(x, y, 1, cell);
  ctx.fillRect(x + cell - 1, y, 1, cell);
}

function fillScreen(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
): void {
  if (palette.screen === null) return;
  ctx.fillStyle = palette.screen;
  ctx.fillRect(0, 0, width, height);
}

export function drawBoard(
  canvas: HTMLCanvasElement,
  state: GameState,
  palette: Palette,
): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;

  fillScreen(ctx, width, height, palette);

  const layout = boardLayout(width, height);
  if (!layout) {
    ctx.fillStyle = palette.muted;
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("面板太窄", width / 2, height / 2);
    return;
  }
  const { cell, offsetX, offsetY } = layout;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if ((state.board[y * COLS + x] ?? 0) === 0) continue;
      paintBlock(ctx, offsetX + x * cell, offsetY + y * cell, cell, palette.locked);
    }
  }

  if (state.active) {
    const shape = shapeAt(state.active.kind, state.active.rotation);
    for (const [cellX, cellY] of shape.cells) {
      const y = state.active.y + cellY;
      if (y < 0) continue;
      paintBlock(
        ctx,
        offsetX + (state.active.x + cellX) * cell,
        offsetY + y * cell,
        cell,
        palette.active,
      );
    }
  }
}

/**
 * 消行动画：被消的行闪一下并纵向收缩，上方的行按进度下落。
 * progress 从 0 到 1 走完时，棋盘正好落到消行后的形状。
 */
export function drawClearAnimation(
  canvas: HTMLCanvasElement,
  board: Uint8Array,
  rows: readonly number[],
  progress: number,
  palette: Palette,
): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;

  fillScreen(ctx, width, height, palette);

  const layout = boardLayout(width, height);
  if (!layout) return;
  const { cell, offsetX, offsetY } = layout;

  const cleared = new Set(rows);
  const clamped = Math.min(1, Math.max(0, progress));

  const clearedBelow = new Array<number>(ROWS).fill(0);
  let seen = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    clearedBelow[y] = seen;
    if (cleared.has(y)) seen++;
  }

  for (let y = ROWS - 1; y >= 0; y--) {
    if (cleared.has(y)) {
      const flash = 1 - clamped;
      if (flash <= 0) continue;
      const barHeight = Math.max(0, Math.round(cell * (1 - clamped)));
      ctx.globalAlpha = flash;
      ctx.fillStyle = palette.flash;
      ctx.fillRect(offsetX, offsetY + y * cell, cell * COLS, barHeight);
      ctx.globalAlpha = 1;
      continue;
    }

    const shift = Math.round((clearedBelow[y] ?? 0) * cell * clamped);
    for (let x = 0; x < COLS; x++) {
      if ((board[y * COLS + x] ?? 0) === 0) continue;
      paintBlock(ctx, offsetX + x * cell, offsetY + y * cell + shift, cell, palette.locked);
    }
  }
}

/** NEXT 小屏：与主棋盘同一套皮肤。 */
export function drawNext(
  canvas: HTMLCanvasElement,
  kind: PieceKind,
  palette: Palette,
): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;

  fillScreen(ctx, width, height, palette);

  const shape = shapeAt(kind, 0);
  const cell = Math.max(4, Math.floor(Math.min(width / 5, height / 3, 10)));
  const shapeWidth = shape.width * cell;
  const shapeHeight = shape.height * cell;
  const offsetX = Math.floor((width - shapeWidth) / 2);
  const offsetY = Math.floor((height - shapeHeight) / 2);

  for (const [cellX, cellY] of shape.cells) {
    paintBlock(ctx, offsetX + cellX * cell, offsetY + cellY * cell, cell, palette.active);
  }
}
