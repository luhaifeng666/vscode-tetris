/** 棋盘尺寸与规则常量。全部使用「棋盘格」为单位。 */
export const COLS = 10;
export const ROWS = 22;
export const MAX_LEVEL = 15;

/** 单个格子的最大像素尺寸（webview 布局与渲染共用）。 */
export const MAX_CELL_PX = 12;

export type PieceKind = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

/** 顺序固定，随机数取模后按这个表选方块。 */
export const PIECE_KINDS: readonly PieceKind[] = ["I", "O", "T", "S", "Z", "J", "L"];

/** 棋盘里存的是色号，0 表示空。 */
export const PIECE_INDEX: Readonly<Record<PieceKind, number>> = {
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
};

export type Rotation = 0 | 1 | 2 | 3;

export interface ActivePiece {
  readonly kind: PieceKind;
  /** 经典的四旋转态，不做 SRS。 */
  readonly rotation: Rotation;
  /** 包围盒左上角在棋盘中的坐标；y 允许为负（旋转/贴顶时短暂出现）。 */
  readonly x: number;
  readonly y: number;
}

export type GameStatus = "idle" | "running" | "paused" | "gameOver";

export type Input =
  | "left"
  | "right"
  | "rotateCW"
  | "rotateCCW"
  | "hardDrop"
  | "softDropOn"
  | "softDropOff"
  | "start"
  | "pause"
  | "resume"
  | "restart";

export interface GameState {
  /** 行优先的 COLS × ROWS 网格。 */
  readonly board: Uint8Array;
  readonly active: ActivePiece | null;
  readonly next: PieceKind;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  /** 重开时回到的等级。 */
  readonly startLevel: number;
  readonly status: GameStatus;
  /** 距离下一次重力下落累计的毫秒数。 */
  readonly dropAccumulator: number;
  readonly softDropping: boolean;
  /** 确定性随机源，存在状态里，重放时结果一致。 */
  readonly rngState: number;
  readonly highScore: number;
}

export type GameEvent =
  | { readonly type: "lock" }
  | {
      readonly type: "lineClear";
      readonly count: number;
      readonly gained: number;
      /** 被消掉的行号，供界面做动画。 */
      readonly rows: readonly number[];
      /** 写入当前方块、但尚未消行时的棋盘快照。 */
      readonly board: Uint8Array;
    }
  | { readonly type: "levelUp"; readonly level: number }
  | { readonly type: "gameOver"; readonly score: number }
  | { readonly type: "statusChanged"; readonly status: GameStatus };

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** 皮肤：经典绿屏 / 白色 LCD / 透明贴合当前主题。 */
export type Skin = "gameboy" | "light" | "transparent";

/** 宿主设置，webview 只读。 */
export interface Settings {
  readonly autoPause: boolean;
  readonly disguise: boolean;
  readonly autoStart: boolean;
  readonly startLevel: number;
  readonly music: boolean;
  readonly soundEffects: boolean;
  readonly hideSidebarOnPause: boolean;
  readonly skin: Skin;
}
