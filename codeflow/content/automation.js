(() => {
  if (globalThis.__codeflowAutoPage) return;
  const visible = (node) => !!node?.isConnected && node.getClientRects().length > 0;
  const text = (selector) => document.querySelector(selector)?.textContent.trim() || '';
  const find = (selector) => [...document.querySelectorAll(selector)].find(visible);
  function inspect() {
    const match = location.pathname.match(/^\/labs\/(\d+)\/CS(\d+)-(\d+)\/?$/);
    const marker = text('.cs-task-head p');
    const labId = match && Number(match[1]), taskId = match && Number(match[3]);
    const expected = match && `CS${labId}-${String(taskId).padStart(2, '0')}`;
    const output = document.querySelector('.cs-output');
    const badge = output?.querySelector('.cs-card-heading .cs-badge');
    const runtime = text('.cs-output .cs-runtime b');
    const submit = find('.cs-run-actions .cs-submit-button');
    const input = find('.cs-console-input textarea');
    const grade = text('.cs-output .cs-ai-grade-head b');
    return {
      url: location.href, labId, taskId,
      ready: !!(expected && match[1] === match[2] && marker.startsWith(expected + ' ') && find('.cs-code-area') && find('.cs-run-actions .cs-primary')),
      acceptedPage: visible(document.querySelector('.cs-task-head .cs-complete')),
      runEnabled: !!find('.cs-run-actions .cs-primary:not(:disabled)'),
      runDone: !!output?.querySelector('.cs-terminal.success') || /^(Завершено|Аяқталды|done|AC)$/i.test(runtime),
      runBusy: /Компиляция|Компиляциялануда|Программа работает|Бағдарлама жұмыс істеп тұр|В очереди|Кезекте/i.test(runtime),
      runError: !!output?.querySelector('.cs-terminal.error') || /ошибка|қатесі|Превышено|Уақыт шегі|^(CE|RE|TLE|MLE)$/i.test(runtime),
      runSignature: text('.cs-output .cs-runtime') + '\n' + text('.cs-output .cs-terminal'),
      inputVisible: !!input,
      inputValue: input?.value || '',
      inputEnabled: !!find('.cs-console-actions .cs-primary:not(:disabled)'),
      inputHistory: text('.cs-console-history pre'),
      submitEnabled: !!submit && !submit.disabled,
      used: /Попытка использована|Бір мүмкіндік пайдаланылды/i.test(submit?.textContent || ''),
      reviewPending: !!badge?.classList.contains('amber') || /На проверке|Тексерілуде/i.test(submit?.textContent || ''),
      reviewAccepted: !!badge?.classList.contains('green'),
      reviewRejected: !!badge?.classList.contains('red'),
      grade: /^\d+\s*\/\s*100$/.test(grade) ? Number(grade.split('/')[0]) : null,
      error: text('.cs-error'),
    };
  }
  function action({ name, labId, taskId, value }) {
    const state = inspect();
    if (!state.ready || state.labId !== labId || state.taskId !== taskId)
      throw new Error('Страница задания изменилась. Авто остановлено.');
    const selectors = { run: '.cs-run-actions .cs-primary', submit: '.cs-run-actions .cs-submit-button', input: '.cs-console-actions .cs-primary' };
    if (name === 'fill') {
      const input = find('.cs-console-input textarea');
      if (!input) throw new Error('Поле ввода программы не найдено.');
      if (input.value) throw new Error('В поле уже есть введённый вручную ответ.');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const button = find(selectors[name] || ':not(*)');
    if (!button || button.disabled) throw new Error('Кнопка сайта пока недоступна: ' + name);
    if (name === 'input' && state.inputValue !== value)
      throw new Error('Входные данные изменены. Авто остановлено.');
    button.click();
    return true;
  }
  globalThis.__codeflowAutoPage = { inspect, action };
  // Content messages keep the MV3 controller responsive across worker restarts
  // and full page navigations. Only the owning tab can advance its run.
  let pending = false;
  const timer = setInterval(async () => {
    if (pending) return;
    pending = true;
    try { await chrome.runtime.sendMessage({ type: 'AUTO_TICK' }); }
    catch (error) {
      if (/Extension context invalidated/i.test(error.message)) clearInterval(timer);
    } finally { pending = false; }
  }, 1000);
})();
