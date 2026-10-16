import { LABS, loadLibrary, keyOf } from "../lib/library.js";

const $ = (id) => document.getElementById(id);
let library = {},
  settings = { labId: 1, taskId: 1, delay: 10 },
  session = { status: "idle", progress: 0 },
  automatic = { status: "idle" },
  busy = true,
  ready = false,
  saveQueue = Promise.resolve();
const autoActive = () => automatic.status === "active";
const active = () => ["typing", "paused"].includes(session.status) || autoActive();
const selected = () => library[keyOf(settings.labId, settings.taskId)];
async function request(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok)
    throw new Error(
      response?.error || "Расширение недоступно. Откройте его снова.",
    );
  return response.value;
}
function notice(message, kind = "") {
  $("notice").textContent = message;
  $("notice").className = `notice ${kind}`;
}
function persist() {
  const snapshot = { ...settings };
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => chrome.storage.local.set({ settings: snapshot }));
  saveQueue.catch((error) =>
    notice(error.message || "Не удалось сохранить настройки.", "error"),
  );
  return saveQueue;
}
function taskOptions() {
  const lab = LABS.find((lab) => lab.id === settings.labId);
  $("lab").value = settings.labId;
  $("lab-title").textContent = lab.title;
  $("task").replaceChildren(
    ...Array.from(
      { length: lab.count },
      (_, index) => new Option(`Задание №${index + 1}`, index + 1),
    ),
  );
  if (settings.taskId > lab.count) settings.taskId = 1;
  $("task").value = settings.taskId;
}
function render() {
  const task = selected(),
    available = task?.status === "available";
  $("task-number").textContent = `Задание №${settings.taskId}`;
  $("task-title").textContent = task?.title || "Загрузка библиотеки…";
  $("task-title").title = task?.title || "";
  $("task-description").textContent = task?.description || "";
  $("task-description").hidden = !task?.description;
  $("availability").classList.toggle("available", available);
  $("availability-text").textContent = available
    ? "Решение доступно"
    : "Решение пока отсутствует";
  $("lab").disabled = $("task").disabled = !ready || busy || active();
  $("start").disabled = !ready || busy || active() || !available;
  $("auto-start").disabled = !ready || busy || active();
  $("stop").disabled = busy || !active();
  $("pause").disabled = busy || autoActive() || !["typing", "paused"].includes(session.status);
  $("pause-label").textContent =
    session.status === "paused" ? "Продолжить" : "Пауза";
  document.querySelectorAll('input[name="speed"]').forEach((input) => {
    input.disabled = busy || active();
    input.checked = Number(input.value) === settings.delay;
  });
  $("library-count").textContent =
    `${Object.values(library).filter((task) => task.status === "available").length} / 71 решений`;
  $("progress-panel").hidden = !session.runId;
  $("notice").hidden = active() && !autoActive();
  if (autoActive()) notice(automatic.message);
  $("progress").value = session.progress || 0;
  $("progress-percent").textContent = `${session.progress || 0}%`;
  $("progress-label").textContent =
    session.status === "paused" ? "Печать на паузе" : "Печать кода";
  $("session-task").textContent = session.runId
    ? `Лаб. №${session.labId} · Задание №${session.taskId}${session.editor ? ` · ${session.editor}` : ""}`
    : "";
}
function applySession(value, announce = true) {
  const changed =
    session.status !== value.status || session.runId !== value.runId;
  session = value;
  if (active() && library[keyOf(session.labId, session.taskId)]) {
    settings.labId = session.labId;
    settings.taskId = session.taskId;
    settings.delay = session.delay;
    taskOptions();
  }
  render();
  if (!announce || !changed) return;
  if (session.status === "typing")
    notice("Окно можно оставить открытым или свернуть. Печать продолжится.");
  else if (session.status === "paused")
    notice("Печать на паузе. Можно продолжить или остановить.");
  else if (session.message)
    notice(
      session.message,
      session.status === "error"
        ? "error"
        : session.status === "completed"
          ? "success"
          : "",
    );
}
async function act(type) {
  if (busy) return;
  const automaticAction = type === "AUTO_START" || (type === "STOP" && autoActive());
  busy = true;
  render();
  try {
    await saveQueue;
    const value = await request(type);
    if (automaticAction) {
      automatic = value;
      notice(value.message || "Авто остановлено.");
    } else applySession(value);
  } catch (error) {
    notice(error.message, "error");
  } finally {
    busy = false;
    render();
  }
}
$("lab").addEventListener("change", () => {
  settings.labId = Number($("lab").value);
  settings.taskId = 1;
  taskOptions();
  render();
  notice(
    selected()?.status === "available"
      ? "Нажмите на редактор перед запуском."
      : "Решение пока отсутствует. Добавьте C# в файл задания.",
  );
  persist();
});
$("task").addEventListener("change", () => {
  settings.taskId = Number($("task").value);
  render();
  notice(
    selected()?.status === "available"
      ? "Нажмите на редактор перед запуском."
      : "Решение пока отсутствует. Добавьте C# в файл задания.",
  );
  persist();
});
document.querySelectorAll('input[name="speed"]').forEach((input) =>
  input.addEventListener("change", () => {
    settings.delay = Number(input.value);
    persist();
  }),
);
$("auto-start").addEventListener("click", () => act("AUTO_START"));
$("start").addEventListener("click", () => act("START"));
$("pause").addEventListener("click", () =>
  act(session.status === "paused" ? "RESUME" : "PAUSE"),
);
$("stop").addEventListener("click", () => act("STOP"));
function openDialog(id) {
  $(id).showModal();
}
$("help").addEventListener("click", () => openDialog("help-dialog"));
for (const id of ["close-help", "understood"])
  $(id).addEventListener("click", () => $("help-dialog").close());
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  }),
);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.autoSession?.newValue) {
    automatic = changes.autoSession.newValue;
    if (autoActive() && ready && library[keyOf(automatic.labId, automatic.taskId)]) {
      settings = { ...settings, labId: automatic.labId, taskId: automatic.taskId };
      taskOptions();
    }
    notice(automatic.message || "");
    render();
  }
  if (changes.typingSession?.newValue)
    applySession(changes.typingSession.newValue);
  if (changes.settings?.newValue && ready && !active()) {
    settings = changes.settings.newValue;
    taskOptions();
    render();
  }
});
async function init() {
  try {
    const [loaded, saved, status] = await Promise.all([
      loadLibrary(),
      chrome.storage.local.get(["settings", "autoSession"]),
      request("STATUS"),
    ]);
    library = loaded;
    const current = await chrome.storage.local.get(["settings", "autoSession"]);
    automatic = current.autoSession || automatic;
    const raw = current.settings || {};
    settings = {
      labId: LABS.some((lab) => lab.id === raw.labId) ? raw.labId : 1,
      taskId: Number.isInteger(raw.taskId) && raw.taskId > 0 ? raw.taskId : 1,
      delay: [0, 10, 50, 100].includes(raw.delay) ? raw.delay : 10,
    };
    $("lab").replaceChildren(
      ...LABS.map((lab) => new Option(`Лабораторная №${lab.id}`, lab.id)),
    );
    taskOptions();
    ready = true;
    applySession(status);
    if (status.status === "idle")
      notice(
        selected()?.status === "available"
          ? "Нажмите на редактор перед запуском."
          : "Добавьте код в TXT файл задания.",
      );
  } catch (error) {
    notice(error.message, "error");
  } finally {
    busy = false;
    render();
  }
}
init();
