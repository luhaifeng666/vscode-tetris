// 手写的 `vscode` 模块桩，让打包产物能在纯 Node 下跑一遍 activate()。
//
// 故意不用 Proxy 兜底：兜底会让拼错的 API 名静默通过，而这个桩存在的
// 全部意义就是抓住拼错的 API 名和空引用。缺什么就补什么。
const { EventEmitter } = require("node:events");

class Disposable {
  constructor(fn) {
    this._fn = fn;
  }
  dispose() {
    if (this._fn) {
      this._fn();
      this._fn = undefined;
    }
  }
}

const created = {
  outputChannels: [],
  commands: [],
  messages: [],
  webviewProviders: new Map(),
  executedCommands: [],
  quickPicks: [],
  quickPickResult: undefined,
  inputBox: undefined,
  inputBoxResult: undefined,
};

class Uri {
  constructor(scheme, path) {
    this.scheme = scheme;
    this.path = path;
  }
  static file(path) {
    return new Uri("file", path);
  }
  static parse(value) {
    const text = String(value);
    const index = text.indexOf(":");
    return index === -1
      ? new Uri("file", text)
      : new Uri(text.slice(0, index), text.slice(index + 1));
  }
  static joinPath(base, ...parts) {
    const path = [base.path.replace(/\/+$/, ""), ...parts].join("/");
    return new Uri(base.scheme, path);
  }
  toString() {
    return `${this.scheme}://${this.path.replace(/^\/+/, "")}`;
  }
}

function createWebview() {
  let messageListener;
  const posted = [];
  return {
    options: undefined,
    html: "",
    cspSource: "vscode-webview://test",
    posted,
    asWebviewUri(uri) {
      return new Uri("vscode-webview-resource", uri.path);
    },
    postMessage(message) {
      posted.push(message);
      return Promise.resolve(true);
    },
    onDidReceiveMessage(listener) {
      messageListener = listener;
      return new Disposable(() => {
        messageListener = undefined;
      });
    },
    __receive(message) {
      if (messageListener) messageListener(message);
    },
  };
}

function createWebviewView(viewType) {
  const webview = createWebview();
  const disposeEmitter = new EventEmitter();
  const visibilityEmitter = new EventEmitter();
  const view = {
    viewType,
    webview,
    visible: true,
    title: "Scratch",
    shownWith: undefined,
    show(preserveFocus) {
      view.shownWith = preserveFocus;
      const wasVisible = view.visible;
      view.visible = true;
      if (!wasVisible) visibilityEmitter.emit("change");
    },
    onDidDispose(listener) {
      disposeEmitter.on("dispose", listener);
      return new Disposable(() => disposeEmitter.off("dispose", listener));
    },
    onDidChangeVisibility(listener) {
      visibilityEmitter.on("change", listener);
      return new Disposable(() => visibilityEmitter.off("change", listener));
    },
    __hide() {
      view.visible = false;
      visibilityEmitter.emit("change");
    },
    __dispose() {
      disposeEmitter.emit("dispose");
    },
  };
  return view;
}

function createSecrets() {
  const store = new Map();
  const emitter = new EventEmitter();
  return {
    store,
    async get(key) {
      return store.get(key);
    },
    async store(key, value) {
      store.set(key, value);
      emitter.emit("change");
    },
    async delete(key) {
      store.delete(key);
      emitter.emit("change");
    },
    onDidChange(listener) {
      emitter.on("change", listener);
      return new Disposable(() => emitter.off("change", listener));
    },
  };
}

function createMemento() {
  const store = new Map();
  return {
    store,
    get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async update(key, value) {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
    },
    keys() {
      return [...store.keys()];
    },
    setKeysForSync() {},
  };
}

// 三层配置，模拟 VS Code 的 global / workspace / workspaceFolder。
const configScopes = { global: {}, workspace: {}, workspaceFolder: {} };
const configStore = configScopes.global;
const configListeners = new EventEmitter();
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

function configLayer(target) {
  if (target === ConfigurationTarget.Workspace) return configScopes.workspace;
  if (target === ConfigurationTarget.WorkspaceFolder) return configScopes.workspaceFolder;
  return configScopes.global;
}

const workspace = {
  getConfiguration(section) {
    const prefix = section ? `${section}.` : "";
    const full = (key) => `${prefix}${key}`;
    const effective = (key) => {
      for (const layer of [
        configScopes.workspaceFolder,
        configScopes.workspace,
        configScopes.global,
      ]) {
        if (full(key) in layer) return layer[full(key)];
      }
      return undefined;
    };
    return {
      get(key, fallback) {
        const value = effective(key);
        return value !== undefined ? value : fallback;
      },
      async update(key, value, target) {
        const layer = configLayer(target);
        const name = full(key);
        if (value === undefined) delete layer[name];
        else layer[name] = value;
        configListeners.emit("change", {
          affectsConfiguration: (s) => s === undefined || s === section,
        });
      },
      inspect(key) {
        const name = full(key);
        return {
          key: name,
          defaultValue: undefined,
          globalValue: configScopes.global[name],
          workspaceValue: configScopes.workspace[name],
          workspaceFolderValue: configScopes.workspaceFolder[name],
        };
      },
    };
  },
  onDidChangeConfiguration(listener) {
    configListeners.on("change", listener);
    return new Disposable(() => configListeners.off("change", listener));
  },
};

const window = {
  registerWebviewViewProvider(viewId, provider, options) {
    created.webviewProviders.set(viewId, { provider, options });
    return new Disposable(() => created.webviewProviders.delete(viewId));
  },
  createOutputChannel(name) {
    const channel = {
      name,
      lines: [],
      debug(m) {
        this.lines.push(["debug", m]);
      },
      info(m) {
        this.lines.push(["info", m]);
      },
      warn(m) {
        this.lines.push(["warn", m]);
      },
      error(m) {
        this.lines.push(["error", m]);
      },
      trace(m) {
        this.lines.push(["trace", m]);
      },
      append() {},
      appendLine() {},
      replace() {},
      clear() {},
      show() {},
      hide() {},
      dispose() {},
    };
    created.outputChannels.push(channel);
    return channel;
  },
  onDidChangeWindowState(listener) {
    window.__windowStateListener = listener;
    return new Disposable(() => {
      window.__windowStateListener = undefined;
    });
  },
  onDidChangeActiveTextEditor(listener) {
    window.__activeEditorListener = listener;
    return new Disposable(() => {
      window.__activeEditorListener = undefined;
    });
  },
  showQuickPick: async (items, options) => {
    created.quickPicks.push({ items, options });
    return created.quickPickResult;
  },
  showInputBox: async (options) => {
    created.inputBox = options;
    return created.inputBoxResult;
  },
  showInformationMessage: async (message, ...rest) => {
    created.messages.push(["info", message, rest]);
    return undefined;
  },
  showWarningMessage: async (message, ...rest) => {
    created.messages.push(["warn", message, rest]);
    const buttons = rest.filter((item) => typeof item === "string");
    return buttons.length ? buttons[0] : undefined;
  },
  showErrorMessage: async (message, ...rest) => {
    created.messages.push(["error", message, rest]);
    return undefined;
  },
};

const commands = {
  registered: new Map(),
  registerCommand(id, handler) {
    commands.registered.set(id, handler);
    created.commands.push(id);
    return new Disposable(() => commands.registered.delete(id));
  },
  async executeCommand(command, ...args) {
    created.executedCommands.push({ command, args });
    const handler = commands.registered.get(command);
    if (handler) return handler(...args);
    return undefined;
  },
};

const CancellationTokenSource = class {
  constructor() {
    this.token = { isCancellationRequested: false, onCancellationRequested: () => new Disposable() };
  }
  dispose() {}
  cancel() {}
};

module.exports = {
  Disposable,
  Uri,
  ConfigurationTarget,
  workspace,
  window,
  commands,
  CancellationTokenSource,
  __created: created,
  __configStore: configStore,
  __configScopes: configScopes,
  __createWebviewView: createWebviewView,
  __createMemento: createMemento,
  __createSecrets: createSecrets,
};
