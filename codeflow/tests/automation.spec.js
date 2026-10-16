import { test, expect, chromium } from '@playwright/test';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RUN_INPUTS } from '../lib/run-inputs.js';
const root = path.resolve(import.meta.dirname, '..');
const origin = 'https://ai-institute.tailcb3c56.ts.net';
let context, profile, extension, popup;
test.setTimeout(90000);
test.beforeAll(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'codeflow-auto-profile-'));
  extension = await mkdtemp(path.join(tmpdir(), 'codeflow-auto-extension-'));
  for (const item of ['manifest.json', 'popup', 'content', 'background', 'lib', 'data', 'solutions', 'assets'])
    await cp(path.join(root, item), path.join(extension, item), { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
  await expect(popup.locator('#start')).toBeEnabled();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus)
    await info.attach('automation-state', { body: JSON.stringify(await saved(), null, 2), contentType: 'application/json' });
});
test.afterAll(async () => {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(extension, { recursive: true, force: true });
});
const saved = () => popup.evaluate(async () => (await chrome.storage.local.get('autoSession')).autoSession);
const records = site => site.evaluate(() => JSON.parse(sessionStorage.getItem('records') || '[]'));
function fixture(labId, taskId, { reject = false, slow = false } = {}) {
  const lines = RUN_INPUTS[`${labId}:${taskId}`];
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div class="cs-task-head"><h1>Задание ${taskId}</h1><p>CS${labId}-${String(taskId).padStart(2,'0')} · Программирование на C#</p></div>
    <div class="cs-code-area"><textarea id="editor" style="width:600px;height:250px"></textarea></div>
    <div class="cs-run-actions"><button class="cs-primary">RUN</button><button class="cs-submit-button" disabled>Отправить на проверку ИИ · 1/1</button></div>
    <div class="cs-output"><div class="cs-card-heading"><h2>Результат терминала</h2><span class="cs-badge gray">Не отправлено</span></div><div class="cs-runtime"><b></b></div><pre class="cs-terminal"></pre><div id="console"></div><div id="grade"></div></div>
    <script>
    const key = '${labId}:${taskId}', lines = ${JSON.stringify(lines)};
    const run = document.querySelector('.cs-run-actions .cs-primary');
    const submit = document.querySelector('.cs-submit-button');
    const status = document.querySelector('.cs-runtime b'), terminal = document.querySelector('.cs-terminal');
    const badge = document.querySelector('.cs-badge'), output = document.querySelector('#console');
    function log(name, value) {
      const records = JSON.parse(sessionStorage.getItem('records') || '[]');
      records.push({key, name, value}); sessionStorage.setItem('records', JSON.stringify(records));
    }
    function done() { status.textContent = 'Завершено'; terminal.className = 'cs-terminal success'; terminal.textContent = 'OK'; submit.disabled = false; }
    run.onclick = () => {
      log('run', document.querySelector('#editor').value); submit.disabled = true;
      status.textContent = 'В очереди'; terminal.textContent = ''; badge.className='cs-badge gray';
      setTimeout(() => {
        if (!lines.length) return done();
        status.textContent = 'Программа работает';
        output.innerHTML = '<div class="cs-console-input"><label>Введите значение для программы<textarea></textarea></label><div class="cs-console-actions"><button class="cs-primary" disabled>Ввести ↵</button></div></div>';
        const field = output.querySelector('textarea'), send = output.querySelector('button');
        field.addEventListener('input', () => { send.disabled = !field.value; });
        send.onclick = () => {
          log('input', field.value);
          if (field.value !== lines.join('\\n')) { terminal.className='cs-terminal error'; terminal.textContent='bad input'; return; }
          output.innerHTML = '<div class="cs-console-history"><pre></pre></div>';
          output.querySelector('pre').textContent = lines.map(x=>'> '+x).join('\\n');
          setTimeout(done, 200);
        };
      }, 200);
    };
    submit.onclick = () => {
      log('submit', null); submit.disabled = true; submit.textContent='На проверке'; badge.className='cs-badge amber'; badge.textContent='Проверяется ИИ';
      setTimeout(() => {
        submit.textContent='Попытка использована';
        badge.className='cs-badge ${reject ? 'red' : 'green'}'; badge.textContent='${reject ? 'Отклонено' : 'Принято'}';
        document.querySelector('#grade').innerHTML = '<div class="cs-ai-grade"><div class="cs-ai-grade-head"><b>${reject ? '40' : '100'}/100</b></div></div>';
        ${reject ? '' : "document.querySelector('.cs-task-head').insertAdjacentHTML('beforeend','<span class=\"cs-complete\">Принято</span>');"}
      }, ${slow ? 60000 : 300});
    };
    </script></body></html>`;
}
async function openTask(lab, task, options = {}) {
  await popup.evaluate(async () => chrome.storage.local.remove(['autoSession', 'typingSession']));
  await popup.evaluate(async () => chrome.storage.local.set({ settings: { labId: 1, taskId: 1, delay: 0 } }));
  await context.unroute(`${origin}/**`);
  await context.route(`${origin}/**`, route => {
    const match = new URL(route.request().url()).pathname.match(/labs\/(\d+)\/CS\d+-(\d+)/);
    return route.fulfill({ contentType:'text/html', body: match ? fixture(Number(match[1]), Number(match[2]), options) : '<h1>Страница недоступна</h1>' });
  });
  const site = await context.newPage();
  await site.goto(`${origin}/labs/${lab}/CS${lab}-${String(task).padStart(2,'0')}`);
  await site.locator('#editor').focus();
  await expect(site.locator('#codeflow-mini-host .auto')).toBeVisible();
  await site.locator('#codeflow-mini-host .auto').click();
  await expect.poll(async () => (await saved())?.status).toBe('active');
  return site;
}
test('Авто: два задания с вводом, RUN, ИИ, переходом и завершением библиотеки', async () => {
  const site = await openTask(5, 9);
  await expect.poll(async () => {
    const state = await saved();
    if (state.status === 'error') throw new Error(JSON.stringify(state));
    return state.status;
  }, { timeout: 60000 }).toBe('completed');
  await expect(site).toHaveURL(`${origin}/labs/5/CS5-10`);
  const log = await records(site);
  for (const task of [9, 10]) {
    const group = log.filter(x => x.key === `5:${task}`);
    expect(group.map(x => x.name)).toEqual(['run','input','submit']);
    expect(group[0].value).toBe(await readFile(path.join(root, `solutions/lab5/task${task}.txt`),'utf8'));
    expect(group[1].value).toBe(RUN_INPUTS[`5:${task}`].join('\n'));
  }
  expect((await saved()).completed).toBe(2);
  await site.close();
});
test('Без ввода нет лишних данных; Стоп прекращает ожидание ИИ и переходы', async () => {
  const site = await openTask(4, 13, { slow: true });
  await expect.poll(async () => (await records(site)).map(x=>x.name), { timeout: 25000 }).toEqual(['run','submit']);
  await site.locator('#codeflow-mini-host .stop').click();
  await expect.poll(async () => (await saved())?.status).toBe('stopped');
  await expect(site).toHaveURL(`${origin}/labs/4/CS4-13`);
  expect((await records(site)).some(x=>x.name==='input')).toBe(false);
  await site.close();
});
test('Отказ ИИ останавливает процесс без повторной отправки и перехода', async () => {
  const site = await openTask(5, 10, { reject: true });
  await expect.poll(async () => (await saved())?.status, { timeout: 25000 }).toBe('error');
  expect((await saved()).message).toContain('40/100');
  expect((await records(site)).filter(x=>x.name==='submit')).toHaveLength(1);
  await expect(site).toHaveURL(`${origin}/labs/5/CS5-10`);
  await site.close();
});
test('Ручная смена страницы останавливает автоматический режим', async () => {
  const site = await openTask(3, 1);
  await site.goto(`${origin}/labs/3/CS3-02`);
  await expect.poll(async () => (await saved())?.status).toBe('error');
  expect((await records(site)).filter(x=>x.name==='submit')).toHaveLength(0);
  await site.close();
});
