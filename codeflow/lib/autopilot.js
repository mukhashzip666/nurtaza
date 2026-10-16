import { RUN_INPUTS, taskFromUrl, followingTask, taskPath } from './run-inputs.js';
const ORIGIN = 'https://ai-institute.tailcb3c56.ts.net';
export function createAutopilot({ store, inspect, action, type, typing, stopTyping, navigate, now = Date.now }) {
  const get = async () => (await store.get('autoSession')).autoSession || { status: 'idle' };
  const save = async (state) => { await store.set({ autoSession: state }); return state; };
  const stage = (state, phase, message, extra = {}) => save({ ...state, phase, message, since: now(), ...extra });
  async function stop(message = 'Авто остановлено.', status = 'stopped') {
    const state = await get();
    if (state.status !== 'active') return state;
    await save({ ...state, status, message });
    if (state.phase === 'typing') await stopTyping(state.tabId).catch(() => {});
    return get();
  }
  async function start(tab) {
    if ((await get()).status === 'active') throw new Error('Автоматический режим уже запущен.');
    if (!tab?.url || new URL(tab.url).origin !== ORIGIN) throw new Error('Откройте задание AI Institute.');
    const task = taskFromUrl(tab.url), page = await inspect(tab.id);
    if (!task || !page.ready || page.labId !== task.labId || page.taskId !== task.taskId)
      throw new Error('Дождитесь загрузки страницы задания.');
    if (['typing', 'paused'].includes((await typing()).status)) throw new Error('Дождитесь окончания печати.');
    return save({ status: 'active', phase: 'prepare', ...task, tabId: tab.id, since: now(), completed: 0, message: 'Авто: подготовка задания' });
  }
  async function advance(state) {
    const completed = state.completed + 1, next = followingTask(state);
    if (!next) return save({ ...state, status: 'completed', completed, message: 'Авто завершено: все доступные задания пройдены.' });
    const { settings = {} } = await store.get('settings');
    await store.set({ settings: { ...settings, ...next } });
    await stage(state, 'navigate', 'Авто: открываю следующее задание', { ...next, completed });
    await navigate(state.tabId, ORIGIN + taskPath(next));
  }
  async function tick(tabId) {
    let state = await get();
    if (state.status !== 'active' || state.tabId !== tabId) return;
    try {
      const page = await inspect(tabId), task = taskFromUrl(page.url);
      const matches = task?.labId === state.labId && task?.taskId === state.taskId;
      const elapsed = now() - state.since;
      if (state.phase === 'navigate') {
        if (elapsed > 45000) throw new Error('Следующее задание не загрузилось или недоступно.');
        if (matches && page.ready && elapsed >= 2000) await stage(state, 'prepare', 'Авто: подготовка задания');
        return;
      }
      if (!matches) throw new Error('Открыта другая страница. Авто остановлено.');
      if (elapsed > (state.phase === 'grading' ? 15 * 60000 : 5 * 60000))
        throw new Error(state.phase === 'grading' ? 'Проверка ИИ не завершилась за 15 минут. Отправка уже сохранена на сайте.' : 'Сайт долго не отвечает. Проверьте задание и запустите «Авто» снова.');
      if (!page.ready) return;
      const doAction = (name, value) => action(tabId, { name, labId: state.labId, taskId: state.taskId, value });
      if (page.error) throw new Error(page.error);
      switch (state.phase) {
        case 'prepare': {
          if (page.acceptedPage) return advance(state);
          if (page.reviewPending || page.used) return stage(state, 'grading', 'Авто: ожидаю уже отправленную проверку ИИ', { reviewSeen: true });
          if (!page.runEnabled) return;
          const started = await type(tabId, { labId: state.labId, taskId: state.taskId });
          await stage(state, 'typing', `Авто: печать · лаб. ${state.labId}, задание ${state.taskId}`, { runId: started.runId });
          break;
        }
        case 'typing': {
          const session = await typing();
          if (session.runId !== state.runId) throw new Error('Сеанс печати изменился.');
          if (session.status === 'completed') await stage(state, 'run', 'Авто: запускаю RUN');
          else if (!['typing', 'paused'].includes(session.status)) throw new Error(session.message || 'Печать не завершена.');
          break;
        }
        case 'run':
          if (!page.runEnabled) return;
          // Persist before clicking: a restarted worker must never repeat RUN or submission.
          await stage(state, 'waitRun', 'Авто: ожидаю RUN', { inputsSent: false, runSeen: false, baseline: page.runSignature });
          await doAction('run');
          break;
        case 'waitRun': {
          const observed = state.runSeen || page.runBusy || page.inputVisible || page.runSignature !== state.baseline;
          if (observed && !state.runSeen) state = await save({ ...state, runSeen: true });
          if (!observed || elapsed < 1000) return;
          if (page.runError) throw new Error('Ошибка RUN. Решение не отправлено на проверку ИИ.');
          const lines = RUN_INPUTS[`${state.labId}:${state.taskId}`];
          if (page.inputVisible && !state.inputsSent && lines.length) {
            await doAction('fill', lines.join('\n'));
            await stage(state, 'sendInput', `Авто: ввожу ${lines.length} значений для программы`);
          } else if (page.runDone) {
            if (lines.length && !state.inputsSent) throw new Error('RUN завершился без подготовленных входных данных.');
            await stage(state, 'submit', 'Авто: отправляю на проверку ИИ');
          }
          break;
        }
        case 'sendInput': {
          if (!page.inputVisible) throw new Error('Поле ввода исчезло до отправки данных.');
          if (!page.inputEnabled) return;
          await stage(state, 'waitRun', 'Авто: ожидаю результат RUN', { inputsSent: true });
          await doAction('input', RUN_INPUTS[`${state.labId}:${state.taskId}`].join('\n'));
          break;
        }
        case 'submit':
          if (page.reviewPending || page.used) return stage(state, 'grading', 'Авто: ожидаю проверку ИИ', { reviewSeen: true });
          if (!page.submitEnabled) return;
          await stage(state, 'grading', 'Авто: проверка ИИ', { reviewSeen: false });
          await doAction('submit');
          break;
        case 'grading':
          if (page.reviewPending && !state.reviewSeen) state = await save({ ...state, reviewSeen: true });
          if (page.reviewRejected) throw new Error(`ИИ отклонил решение${page.grade !== null ? `: ${page.grade}/100` : ''}. Проверьте отзыв на сайте.`);
          if (!page.reviewPending && (page.acceptedPage || (page.reviewAccepted && page.grade !== null)) && (state.reviewSeen || elapsed >= 2000))
            await advance(state);
          break;
      }
    } catch (error) { await stop(error.message || 'Ошибка автоматического режима.', 'error'); }
  }
  return { get, start, stop, tick };
}
