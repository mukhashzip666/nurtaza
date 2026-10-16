import { LABS, loadLibrary, keyOf } from "../lib/library.js";

const ORIGIN = "https://ai-institute.tailcb3c56.ts.net";
const extensionFile = (path) =>
  new URL(`../${path}`, import.meta.url).pathname.slice(1);
const POPUP_URL = new URL("../popup/popup.html", import.meta.url).href;
const isActive = (session) => ["typing", "paused"].includes(session?.status);
async function showMiniOnOpenTabs() {
  const tabs = await chrome.tabs.query({ url: `${ORIGIN}/*` });
  await Promise.allSettled(tabs.filter((tab) => tab.id && tab.status === "complete")
    .map((tab) => chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: "ISOLATED",
      files: [extensionFile("content/mini.js")],
    })));
}
chrome.runtime.onInstalled.addListener(() => {
  showMiniOnOpenTabs().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  showMiniOnOpenTabs().catch(() => {});
});
const nextTask = (labId, taskId) => {
  const lab = LABS.find((item) => item.id === labId);
  if (!lab) return null;
  if (taskId < lab.count) return { labId, taskId: taskId + 1 };
  const following = LABS.find((item) => item.id === labId + 1);
  return following ? { labId: following.id, taskId: 1 } : null;
};
const store = chrome.storage.local;
let queue = Promise.resolve();
const serial = (work) => {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
};
async function getSession() {
  return (
    (await store.get("typingSession")).typingSession || {
      status: "idle",
      progress: 0,
    }
  );
}
async function saveSession(session) {
  await store.set({ typingSession: session });
  return session;
}
async function engine(tabId, command, payload) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    func: (command, payload) => {
      const runner = window.__codeflowEngine;
      if (!runner) return null;
      try {
        return {
          ok: true,
          state:
            command === "getState"
              ? runner.getState()
              : runner[command](payload),
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    args: [command, payload || null],
  });
  const result = results[0]?.result;
  if (result && !result.ok) throw new Error(result.error);
  return result?.state || null;
}
async function pageTask(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => {
      const heading = [...document.querySelectorAll("h1, h2")]
        .map((element) => element.textContent.trim())
        .find((value) => /^(?:Задание|Тапсырма|Task)\s*№?\s*\d+\s*$/i.test(value));
      if (!heading) return null;
      const taskId = Number(heading.match(/\d+/)[0]);
      const marker = document.body.innerText.match(/\bCS\s*(\d+)\s*[-–]\s*(\d+)\b/i);
      return { labId: marker ? Number(marker[1]) : null, taskId };
    },
  });
  return results[0]?.result || null;
}
async function reconcile() {
  const saved = await getSession();
  if (!isActive(saved)) {
    // Earlier versions kept the JSON import hint in the persisted session.
    // That hint is obsolete now that solutions are read from TXT files.
    if (/импортируйте JSON/i.test(saved.message || ""))
      return saveSession({ status: "idle", progress: 0 });
    return saved;
  }
  try {
    const current = await engine(saved.tabId, "getState");
    if (current?.runId === saved.runId)
      return saveSession({ ...current, tabId: saved.tabId });
  } catch {
    /* The tab was closed, navigated, or access was revoked. */
  }
  return saveSession({
    ...saved,
    status: "error",
    message: "Страница закрыта или перезагружена. Откройте задание снова.",
  });
}
async function start(targetTab = null) {
  const previous = await reconcile();
  if (isActive(previous))
    throw new Error("Печать уже запущена. Сначала остановите её.");
  const [activeTab] = targetTab
    ? [targetTab]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = activeTab;
  if (!tab?.id || !tab.url)
    throw new Error("Нет доступа к вкладке. Откройте расширение на сайте.");
  if (new URL(tab.url).origin !== ORIGIN)
    throw new Error("Откройте сайт AI Institute и нужное задание.");
  if (tab.status === "loading") throw new Error("Дождитесь загрузки страницы.");
  const { settings = {} } = await store.get("settings");
  const opened = await pageTask(tab.id);
  if (opened && (opened.taskId !== (settings.taskId || 1) ||
      (opened.labId !== null && opened.labId !== (settings.labId || 1))))
    throw new Error(
      `На сайте открыто задание №${opened.taskId}. Выбрано №${settings.taskId || 1}; откройте его на сайте.`,
    );
  const library = await loadLibrary();
  const task = library[keyOf(settings.labId || 1, settings.taskId || 1)];
  if (!task || task.status !== "available" || !task.code.trim())
    throw new Error(
      "Решение пока отсутствует. Добавьте код в TXT файл задания.",
    );
  const delay = [0, 10, 50, 100].includes(settings.delay)
    ? settings.delay
    : 10;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: "ISOLATED",
      files: [extensionFile("content/content.js")],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: "MAIN",
      files: [
        extensionFile("content/adapters.js"),
        extensionFile("content/typing.js"),
      ],
    });
    const runId = crypto.randomUUID();
    await chrome.tabs.sendMessage(
      tab.id,
      { type: "CF_BIND", runId },
      { frameId: 0 },
    );
    const state = await engine(tab.id, "start", {
      runId,
      code: task.code,
      labId: task.labId,
      taskId: task.taskId,
      delay,
    });
    if (!state) throw new Error("Не удалось запустить печать.");
    return saveSession({ ...state, tabId: tab.id });
  } catch (error) {
    if (
      /Cannot access|No tab|Receiving end|permission|frame.*removed/i.test(
        error.message,
      )
    )
      throw new Error(
        "Нет доступа к странице. Обновите её и откройте расширение снова.",
      );
    throw error;
  }
}
async function command(type) {
  const session = await reconcile();
  if (!isActive(session))
    throw new Error(session.message || "Нет активной печати.");
  const state = await engine(session.tabId, type.toLowerCase());
  if (!state) throw new Error("Редактор больше недоступен.");
  return saveSession({ ...state, tabId: session.tabId });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === "CF_PROGRESS") {
    if (
      !sender.tab ||
      sender.frameId !== 0 ||
      !sender.url?.startsWith(`${ORIGIN}/`)
    )
      return;
    serial(async () => {
      const saved = await getSession(),
        state = message.state;
      if (
        !isActive(saved) ||
        saved.tabId !== sender.tab.id ||
        saved.runId !== state?.runId
      )
        return;
      if (
        !["typing", "paused", "completed", "stopped", "error"].includes(
          state.status,
        ) ||
        !Number.isInteger(state.revision) ||
        state.revision <= saved.revision ||
        !Number.isInteger(state.typed) ||
        state.typed < saved.typed ||
        state.total !== saved.total ||
        state.typed > saved.total
      )
        return;
      await saveSession({
        ...saved,
        revision: state.revision,
        status: state.status,
        typed: state.typed,
        progress: Math.floor((state.typed / saved.total) * 100),
        message:
          typeof state.message === "string" ? state.message.slice(0, 300) : "",
      });
      if (state.status === "completed") {
        const next = nextTask(saved.labId, saved.taskId);
        if (next) {
          const { settings = {} } = await store.get("settings");
          await store.set({ settings: { ...settings, ...next } });
        }
      }
    }).catch(() => {});
    return;
  }
  if (
    sender.tab?.id &&
    sender.frameId === 0 &&
    sender.url?.startsWith(`${ORIGIN}/`) &&
    ["MINI_STATUS", "MINI_SELECT", "MINI_SPEED", "MINI_START", "MINI_STOP"].includes(
      message?.type,
    )
  ) {
    serial(async () => {
      switch (message.type) {
        case "MINI_STATUS":
          return reconcile();
        case "MINI_SELECT": {
          const lab = LABS.find((item) => item.id === message.labId);
          if (!lab || !Number.isInteger(message.taskId) ||
              message.taskId < 1 || message.taskId > lab.count)
            throw new Error("Неверный номер задания.");
          if (isActive(await reconcile()))
            throw new Error("Сначала остановите текущую печать.");
          const { settings = {} } = await store.get("settings");
          const selected = { ...settings, labId: lab.id, taskId: message.taskId };
          await store.set({ settings: selected });
          return selected;
        }
        case "MINI_SPEED": {
          if (![0, 10, 50, 100].includes(message.delay))
            throw new Error("Неверная скорость печати.");
          if (isActive(await reconcile()))
            throw new Error("Сначала остановите текущую печать.");
          const { settings = {} } = await store.get("settings");
          const selected = { ...settings, delay: message.delay };
          await store.set({ settings: selected });
          return selected;
        }
        case "MINI_START":
          return start(sender.tab);
        case "MINI_STOP": {
          const session = await reconcile();
          if (session.tabId !== sender.tab.id)
            throw new Error("Печать запущена на другой вкладке.");
          return command("STOP");
        }
      }
    }).then(
      (value) => respond({ ok: true, value }),
      (error) => respond({ ok: false, error: error.message || "Ошибка CodeFlow." }),
    );
    return true;
  }
  if (sender.url !== POPUP_URL) return;
  serial(async () => {
    switch (message?.type) {
      case "STATUS":
        await showMiniOnOpenTabs();
        return reconcile();
      case "START":
        return start();
      case "PAUSE":
      case "RESUME":
      case "STOP":
        return command(message.type);
      default:
        throw new Error("Неизвестная команда.");
    }
  }).then(
    (value) => respond({ ok: true, value }),
    (error) =>
      respond({
        ok: false,
        error: error.message || "Не удалось выполнить действие.",
      }),
  );
  return true;
});
async function interrupted(tabId, message) {
  const session = await getSession();
  if (isActive(session) && session.tabId === tabId)
    await saveSession({ ...session, status: "error", message });
}
chrome.tabs.onRemoved.addListener((tabId) => {
  serial(() =>
    interrupted(tabId, "Страница закрыта. Печать остановлена."),
  ).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading")
    serial(() =>
      interrupted(tabId, "Страница перезагружена. Печать остановлена."),
    ).catch(() => {});
});
