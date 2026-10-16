(() => {
  if (globalThis.__codeflowMini) {
    for (const duplicate of document.querySelectorAll("#codeflow-mini-host"))
      if (duplicate !== globalThis.__codeflowMini.host) duplicate.remove();
    if (!globalThis.__codeflowMini.host?.isConnected && document.body)
      document.body.append(globalThis.__codeflowMini.host);
    return;
  }

  // Reloading an unpacked extension creates a new isolated world while its old
  // shadow host can remain in the page. Remove the orphan before mounting again.
  document.querySelectorAll("#codeflow-mini-host").forEach((old) => old.remove());

  const counts = [10, 11, 20, 20, 10];
  const host = document.createElement("div");
  globalThis.__codeflowMini = { host };
  host.id = "codeflow-mini-host";
  host.style.cssText = "position:fixed;right:22px;top:132px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .card { width: 272px; border: 1px solid #344763; border-radius: 15px; background: #111823; color: #f8fafc; box-shadow: 0 15px 42px #07101d80; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; }
      .head { display: flex; align-items: center; gap: 8px; padding: 11px 12px; background: #19263a; cursor: grab; user-select: none; touch-action: none; }
      .head.dragging { cursor: grabbing; }
      .mark { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; background: #2b4a76; color: #9ac6ff; font-weight: 800; }
      .title { flex: 1; font-size: 14px; font-weight: 700; }
      .grip { color: #8ca3c3; font-size: 17px; letter-spacing: -4px; margin-right: 5px; }
      .fold { border: 0; background: transparent; color: #a8bbd4; cursor: pointer; font-size: 19px; line-height: 1; padding: 2px 5px; }
      .body { padding: 12px; }
      .row { display: flex; gap: 8px; }
      label { flex: 1; min-width: 0; color: #aebbd0; font-size: 11px; }
      select { display: block; width: 100%; height: 34px; margin-top: 4px; padding: 0 7px; border: 1px solid #35445b; border-radius: 8px; background: #1c283a; color: #fff; font: inherit; }
      .speed-label { display: block; margin-top: 9px; }
      .status { min-height: 19px; margin: 10px 0; color: #aebbd0; font-size: 11px; overflow-wrap: anywhere; }
      .actions { display: flex; gap: 8px; }
      .actions button { flex: 1; height: 36px; border-radius: 8px; border: 1px solid transparent; color: #fff; cursor: pointer; font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .run { background: #3b82f6; }
      .stop { background: #273346; border-color: #40506a !important; }
      button:disabled, select:disabled { opacity: .48; cursor: default; }
      button:focus-visible, select:focus-visible { outline: 2px solid #9ac6ff; outline-offset: 2px; }
      .card.collapsed .body { display: none; }
    </style>
    <aside class="card" aria-label="CodeFlow — мини-панель">
      <div class="head" title="Перетащите панель"><span class="mark" aria-hidden="true">&lt;/&gt;</span><span class="title">CodeFlow</span><span class="grip" aria-hidden="true">⋮⋮</span><button class="fold" type="button" aria-label="Свернуть панель" aria-expanded="true">−</button></div>
      <div class="body">
        <div class="row">
          <label>Лабораторная<select class="lab" aria-label="Лабораторная"></select></label>
          <label>Задание<select class="task" aria-label="Задание"></select></label>
        </div>
        <label class="speed-label">Скорость<select class="speed" aria-label="Скорость печати"><option value="10">Очень быстро · 10 мс</option><option value="50">Обычно · 50 мс</option><option value="100">Медленно · 100 мс</option><option value="0">Мгновенно</option></select></label>
        <p class="status" role="status" aria-live="polite">Загрузка…</p>
        <div class="actions"><button class="run" type="button">▶ Печать</button><button class="stop" type="button">■ Стоп</button></div>
      </div>
    </aside>`;
  document.body.append(host);

  const $ = (selector) => root.querySelector(selector);
  const lab = $(".lab"), task = $(".task"), speed = $(".speed"), status = $(".status");
  const run = $(".run"), stop = $(".stop");
  let settings = { labId: 1, taskId: 1, delay: 10 };
  let session = { status: "idle" };
  let busy = false;
  let error = "";
  let lastFocused = null;
  let saveQueue = Promise.resolve();
  let drag = null;

  function place(x, y) {
    const bounds = host.getBoundingClientRect();
    const left = Math.max(0, Math.min(x, innerWidth - bounds.width));
    const top = Math.max(0, Math.min(y, innerHeight - bounds.height));
    host.style.right = "auto";
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  const head = $(".head");
  head.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".fold")) return;
    const bounds = host.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: bounds.left,
      top: bounds.top,
    };
    head.classList.add("dragging");
    head.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  head.addEventListener("pointermove", (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  function endDrag(event) {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    head.classList.remove("dragging");
    if (head.hasPointerCapture(event.pointerId)) head.releasePointerCapture(event.pointerId);
    const bounds = host.getBoundingClientRect();
    chrome.storage.local.set({ miniPosition: {
      x: Math.round(bounds.left),
      y: Math.round(bounds.top),
    } }).catch(() => {});
  }
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
  addEventListener("resize", () => {
    const bounds = host.getBoundingClientRect();
    place(bounds.left, bounds.top);
  });
  function pageTask() {
    const heading = [...document.querySelectorAll("h1, h2")]
      .map((element) => element.textContent.trim())
      .find((value) => /^(?:Задание|Тапсырма|Task)\s*№?\s*\d+\s*$/i.test(value));
    if (!heading) return null;
    const taskId = Number(heading.match(/\d+/)[0]);
    const marker = document.body.innerText.match(/\bCS\s*(\d+)\s*[-–]\s*(\d+)\b/i);
    return { labId: marker ? Number(marker[1]) : null, taskId };
  }

  for (let id = 1; id <= counts.length; id++)
    lab.add(new Option(`№${id}`, id));

  document.addEventListener("focusin", (event) => {
    if (!host.contains(event.target) && event.target !== document.body)
      lastFocused = event.target;
  }, true);

  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || "CodeFlow недоступен.");
    return response.value;
  }

  function render() {
    const active = ["typing", "paused"].includes(session.status);
    lab.value = String(settings.labId);
    const count = counts[settings.labId - 1] || 10;
    if (task.options.length !== count) {
      task.replaceChildren(...Array.from({ length: count }, (_, i) => new Option(`№${i + 1}`, i + 1)));
    }
    task.value = String(settings.taskId);
    speed.value = String([0, 10, 50, 100].includes(settings.delay) ? settings.delay : 10);
    lab.disabled = task.disabled = speed.disabled = busy || active;
    run.disabled = busy || active;
    stop.disabled = busy || !active;
    status.textContent = error || (session.status === "typing"
      ? `Печать: лаб. ${session.labId}, задание ${session.taskId} · ${session.progress || 0}%`
      : session.status === "paused"
        ? "Печать на паузе"
        : session.status === "completed"
          ? session.labId !== settings.labId || session.taskId !== settings.taskId
            ? `Готово. Выбрано: лаб. ${settings.labId}, задание ${settings.taskId}. Откройте его на сайте.`
            : `Готово: лаб. ${session.labId}, задание ${session.taskId}`
          : session.status === "error"
            ? session.message || "Ошибка печати"
            : `Выбрано: лаб. ${settings.labId}, задание ${settings.taskId}`);
  }

  function select(labId, taskId) {
    settings = { ...settings, labId, taskId };
    error = "";
    render();
    saveQueue = saveQueue.catch(() => {}).then(() => request("MINI_SELECT", { labId, taskId }));
    saveQueue.catch((failure) => { error = failure.message; render(); });
  }
  lab.addEventListener("change", () => select(Number(lab.value), 1));
  task.addEventListener("change", () => select(settings.labId, Number(task.value)));
  speed.addEventListener("change", () => {
    const delay = Number(speed.value);
    settings = { ...settings, delay };
    error = "";
    render();
    saveQueue = saveQueue.catch(() => {}).then(() => request("MINI_SPEED", { delay }));
    saveQueue.catch((failure) => { error = failure.message; render(); });
  });

  async function act(type) {
    if (busy) return;
    if (type === "MINI_START") {
      const current = pageTask();
      if (current && (current.taskId !== settings.taskId ||
          (current.labId !== null && current.labId !== settings.labId))) {
        error = `На сайте открыто задание №${current.taskId}. Выбрано №${settings.taskId}; откройте его на сайте.`;
        render();
        return;
      }
    }
    busy = true;
    error = "";
    render();
    try {
      await saveQueue;
      if (type === "MINI_START" && lastFocused?.isConnected && typeof lastFocused.focus === "function")
        lastFocused.focus();
      const response = await request(type);
      if (!session.runId || session.runId !== response.runId ||
          (response.revision || 0) >= (session.revision || 0))
        session = response;
    } catch (failure) {
      error = failure.message;
    } finally {
      busy = false;
      render();
    }
  }
  run.addEventListener("click", () => act("MINI_START"));
  stop.addEventListener("click", () => act("MINI_STOP"));
  $(".fold").addEventListener("click", () => {
    const collapsed = $(".card").classList.toggle("collapsed");
    $(".fold").textContent = collapsed ? "+" : "−";
    $(".fold").setAttribute("aria-expanded", String(!collapsed));
    $(".fold").setAttribute("aria-label", collapsed ? "Развернуть панель" : "Свернуть панель");
    const bounds = host.getBoundingClientRect();
    place(bounds.left, bounds.top);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings?.newValue) settings = changes.settings.newValue;
    if (changes.typingSession?.newValue) session = changes.typingSession.newValue;
    if (changes.miniPosition?.newValue && !drag) {
      const { x, y } = changes.miniPosition.newValue;
      if (Number.isFinite(x) && Number.isFinite(y)) place(x, y);
    }
    if (changes.settings || changes.typingSession) { error = ""; render(); }
  });

  Promise.all([chrome.storage.local.get(["settings", "typingSession", "miniPosition"]), request("MINI_STATUS")])
    .then(([saved, current]) => {
      settings = saved.settings || settings;
      session = current || saved.typingSession || session;
      render();
      if (saved.miniPosition && Number.isFinite(saved.miniPosition.x) &&
          Number.isFinite(saved.miniPosition.y))
        place(saved.miniPosition.x, saved.miniPosition.y);
    })
    .catch((failure) => { error = failure.message; render(); });
})();
