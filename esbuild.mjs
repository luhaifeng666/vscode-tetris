import esbuild from "esbuild";

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const minify = args.includes("--minify");
const tests = args.includes("--tests");

const common = {
  bundle: true,
  logLevel: "info",
};

/** 扩展宿主：运行在 Node 里，`vscode` 由宿主提供，绝不能打进产物。 */
const host = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["vscode"],
  minify,
  sourcemap: !minify,
};

/** 游戏界面：跑在 webview 的 iframe 里，是浏览器环境。 */
const webview = {
  ...common,
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify,
  sourcemap: !minify,
};

const style = {
  entryPoints: ["src/webview/style.css"],
  outfile: "dist/webview.css",
  ...common,
  minify,
  sourcemap: !minify,
};

if (tests) {
  await esbuild.build({
    ...common,
    // 用 glob 而不是逐个列文件：列文件时新增一个 *.test.ts 会被静默漏掉，
    // `node --test` 自然也不会跑它 —— 「测试全绿」就成了假象。
    entryPoints: ["src/test/*.test.ts"],
    outdir: "out-test",
    format: "cjs",
    platform: "node",
    target: "node22",
    external: ["vscode"],
    sourcemap: false,
  });
} else if (watch) {
  // 三个构建并行 watch。tasks.json 的 problem matcher 只认成对的
  // "build started" / "build finished"，所以这里把三路信号合并成一轮。
  let started = 0;
  let finished = 0;
  const notifier = {
    name: "watch-notifier",
    setup(build) {
      build.onStart(() => {
        if (started++ % 3 === 0) console.log("[watch] build started");
      });
      build.onEnd((result) => {
        if (++finished % 3 !== 0) return;
        started = 0;
        finished = 0;
        if (result.errors.length > 0) console.error("[watch] build failed");
        else console.log("[watch] build finished");
      });
    },
  };

  const contexts = await Promise.all(
    [host, webview, style].map((config) =>
      esbuild.context({ ...config, plugins: [notifier] }),
    ),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([host, webview, style].map((config) => esbuild.build(config)));
}
