(() => {
  if (window.__codeflowEngine) return;
  let state = { status: "idle", progress: 0 },
    adapter,
    characters,
    expected,
    from,
    to,
    timer,
    lastReport = 0;
  const active = () => ["typing", "paused"].includes(state.status);
  const report = (force = false) => {
    if (!force && performance.now() - lastReport < 180) return;
    lastReport = performance.now();
    window.postMessage(
      { channel: "codeflow:state:v1", state: { ...state } },
      location.origin,
    );
  };
  const finish = (status, message) => {
    clearTimeout(timer);
    state.status = status;
    state.message = message;
    state.revision++;
    report(true);
    adapter = null;
    characters = null;
    return { ...state };
  };
  function tick() {
    if (state.status !== "typing") return;
    try {
      if (adapter.read() !== expected)
        throw new Error("Текст изменился. Печать остановлена.");
      const text = state.delay === 0
        ? characters.slice(state.typed).join("")
        : characters[state.typed];
      const next = expected.slice(0, from) + text + expected.slice(to);
      adapter.insert(from, to, text);
      if (adapter.read() !== next)
        throw new Error("Редактор изменил ввод. Печать остановлена.");
      expected = next;
      from += text.length;
      to = from;
      state.typed += state.delay === 0 ? characters.length - state.typed : 1;
      state.revision++;
      state.progress = Math.floor((state.typed / state.total) * 100);
      if (state.typed === state.total) {
        finish("completed", "Код успешно напечатан");
        return;
      }
      report();
      timer = setTimeout(tick, state.delay);
    } catch (error) {
      finish("error", error.message || "Ошибка ввода кода.");
    }
  }
  window.__codeflowEngine = {
    getState: () => ({ ...state }),
    start(payload) {
      if (active()) throw new Error("Печать уже запущена.");
      if (!payload.code?.trim()) throw new Error("Решение пока отсутствует.");
      if (![0, 10, 50, 100].includes(payload.delay))
        throw new Error("Неверная скорость печати.");
      adapter = window.__codeflowAdapters.find();
      expected = adapter.read();
      adapter.selection();
      from = 0;
      to = expected.length;
      characters = Array.from(payload.code.replace(/\r\n?/g, "\n"));
      state = {
        runId: payload.runId,
        revision: 1,
        labId: payload.labId,
        taskId: payload.taskId,
        status: "typing",
        progress: 0,
        typed: 0,
        total: characters.length,
        delay: payload.delay,
        editor: adapter.kind,
        message: "",
      };
      report(true);
      timer = setTimeout(tick, state.delay);
      return { ...state };
    },
    pause() {
      if (state.status !== "typing") throw new Error("Нет активной печати.");
      clearTimeout(timer);
      state.status = "paused";
      state.message = "Печать на паузе";
      state.revision++;
      report(true);
      return { ...state };
    },
    resume() {
      if (state.status !== "paused") throw new Error("Печать не на паузе.");
      state.status = "typing";
      state.message = "";
      state.revision++;
      report(true);
      timer = setTimeout(tick, state.delay);
      return { ...state };
    },
    stop() {
      if (!active()) return { ...state };
      return finish("stopped", "Вы остановили печать");
    },
  };
})();
