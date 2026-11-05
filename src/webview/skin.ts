import type { Skin } from "../game/types";

export interface Shades {
  readonly fill: string;
  readonly light: string;
  readonly dark: string;
}

export interface Palette {
  /** null 表示不填充画布，直接透出侧边栏背景。 */
  readonly screen: string | null;
  readonly locked: Shades;
  readonly active: Shades;
  readonly flash: string;
  readonly muted: string;
}

const GAMEBOY: Palette = {
  screen: "#8bac0f",
  locked: { fill: "#306230", light: "#9bbc0f", dark: "#0f380f" },
  active: { fill: "#0f380f", light: "#306230", dark: "#0f380f" },
  flash: "#e8ffd0",
  muted: "#0f380f",
};

const LIGHT: Palette = {
  screen: "#f6f6ee",
  locked: { fill: "#5c5c5c", light: "#8c8c8c", dark: "#2a2a2a" },
  active: { fill: "#191919", light: "#4a4a4a", dark: "#000000" },
  flash: "#c8c8b8",
  muted: "#5c5c5c",
};

function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

/** 把 #rgb / #rrggbb / rgb() 统一转成带 alpha 的 rgba。 */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const digits = hex[1] ?? "";
    const full =
      digits.length === 3
        ? [...digits].map((digit) => digit + digit).join("")
        : digits;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  }
  return color;
}

export function paletteFor(skin: Skin): Palette {
  if (skin === "light") return LIGHT;

  if (skin === "transparent") {
    // 直接跟随当前主题的前景色；屏幕不填底色，侧边栏背景会透出来。
    const foreground = readVar("--vscode-foreground", "#cccccc");
    const muted = readVar("--vscode-descriptionForeground", "#8a8a8a");
    return {
      screen: null,
      locked: {
        fill: withAlpha(foreground, 0.5),
        light: withAlpha(foreground, 0.72),
        dark: withAlpha(foreground, 0.3),
      },
      active: {
        fill: withAlpha(foreground, 0.95),
        light: withAlpha(foreground, 0.65),
        dark: withAlpha(foreground, 0.8),
      },
      flash: withAlpha(foreground, 0.35),
      muted,
    };
  }

  return GAMEBOY;
}

export function applySkinToDom(skin: Skin): void {
  document.body.dataset.skin = skin;
}

/** 主题切换时重新取 CSS 变量（透明皮肤需要）。 */
export function watchTheme(callback: () => void): void {
  const observer = new MutationObserver(callback);
  for (const target of [document.documentElement, document.body]) {
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["class", "style", "data-vscode-theme-kind"],
    });
  }
}
