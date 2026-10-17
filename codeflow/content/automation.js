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
    const next = find('.cs-task-head .cs-next-task');
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
      nextEnabled: !!next && !next.disabled,
      nextTaskButton: !!next && /Следующее задание|Келесі тапсырма/i.test(next.textContent),
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
    const selectors = { run: '.cs-run-actions .cs-primary', submit: '.cs-run-actions .cs-submit-button', input: '.cs-console-actions .cs-primary', next: '.cs-task-head .cs-next-task' };
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
    if (name === 'next' && !state.nextTaskButton)
      throw new Error('Кнопка следующего задания изменилась.');
    button.click();
    return true;
  }
  globalThis.__codeflowAutoPage = { inspect, action };
  // Wake on actual site changes and completed steps instead of waiting for a
  // polling interval. Keep one request in flight so a button is never clicked twice.
  let active = false, pending = false, dirty = false, timer = null, invalid = false, stateChanged = false;
  function schedule() {
    if (!active || invalid) return;
    dirty = true;
    if (!pending && timer === null) timer = setTimeout(pump, 30);
  }
  async function pump() {
    timer = null;
    if (!active || invalid || pending) return;
    pending = true;
    dirty = false;
    try { await chrome.runtime.sendMessage({ type: 'AUTO_TICK' }); }
    catch (error) {
      if (/Extension context invalidated/i.test(error.message)) {
        invalid = true;
        observer.disconnect();
        clearInterval(fallback);
      }
    } finally {
      pending = false;
      if (dirty) schedule();
    }
  }
  const observer = new MutationObserver((records) => {
    if (records.some(({ target }) => {
      const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
      return !element?.closest('#codeflow-mini-host, .cs-code-area');
    })) schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'class', 'style', 'hidden'],
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.autoSession) {
      stateChanged = true;
      active = changes.autoSession.newValue?.status === 'active';
      schedule();
    }
    if (changes.typingSession && changes.typingSession.newValue?.status !== 'typing') schedule();
  });
  chrome.storage.local.get('autoSession').then(({ autoSession }) => {
    if (!stateChanged) active = autoSession?.status === 'active';
    schedule();
  }).catch(() => {});
  const fallback = setInterval(schedule, 1000);
})();
