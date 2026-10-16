import { test, expect, chromium } from "@playwright/test";
import { readFile, mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const ORIGIN = "https://ai-institute.tailcb3c56.ts.net";
const sample =
  'using System;\n\n// Привет 👋\nclass Program\n{\n    static void Main()\n    {\n        Console.WriteLine("CodeFlow");\n    }\n}\n';
let context, extensionId, profile, copy, cm6;
test.beforeAll(async () => {
  profile = await mkdtemp(path.join(tmpdir(), "codeflow-profile-"));
  copy = await mkdtemp(path.join(tmpdir(), "codeflow-extension-"));
  for (const item of [
    "manifest.json",
    "popup",
    "content",
    "background",
    "lib",
    "data",
    "solutions",
    "assets",
  ])
    await cp(path.join(root, item), path.join(copy, item), { recursive: true });
  // Fixtures stay empty even after the project owner fills local C# files.
  for (const [index, count] of [10, 11, 20, 20, 10].entries())
    for (let task = 1; task <= count; task++)
      await writeFile(
        path.join(copy, "solutions", `lab${index + 1}`, `task${task}.txt`),
        "",
      );
  await writeFile(path.join(copy, "solutions", "lab1", "task1.txt"), sample);
  await writeFile(
    path.join(copy, "solutions", "lab1", "task2.txt"),
    "abcdefghijklmnopqrstuvwxyz",
  );
  const manifest = JSON.parse(await readFile(path.join(copy, "manifest.json")));
  // Headless automation cannot click the toolbar to grant activeTab. Test-only grant.
  manifest.host_permissions = [`${ORIGIN}/*`];
  await writeFile(path.join(copy, "manifest.json"), JSON.stringify(manifest));
  const bundle = await build({
    stdin: {
      contents: `import {EditorView} from '@codemirror/view'; import {EditorState} from '@codemirror/state'; window.CM6={EditorView,EditorState};`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "iife",
  });
  cm6 = bundle.outputFiles[0].text;
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`],
    viewport: { width: 800, height: 700 },
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
  await context.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/cm6.js")
      return route.fulfill({ contentType: "text/javascript", body: cm6 });
    if (url.pathname.startsWith("/node_modules/")) {
      const filename = path.resolve(root, "." + url.pathname);
      if (!filename.startsWith(root + path.sep)) return route.abort();
      try {
        return await route.fulfill({
          body: await readFile(filename),
          contentType: filename.endsWith(".css")
            ? "text/css"
            : "text/javascript",
        });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    }
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><head><style>body{background:#fff}textarea,#editor{width:650px;height:360px} [contenteditable]{white-space:pre-wrap;min-height:120px}</style></head><body></body></html>",
    });
  });
});
test.afterAll(async () => {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(copy, { recursive: true, force: true });
});
async function pageFor(kind) {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/${kind}`);
  await page.evaluate((kind) => {
    document.body.innerHTML =
      kind === "textarea"
        ? '<textarea id="editor"></textarea>'
        : kind === "contenteditable"
          ? '<div id="editor" contenteditable="true"></div>'
          : '<div id="editor"></div>';
  }, kind);
  if (kind === "cm5") {
    await page.addStyleTag({
      url: `${ORIGIN}/node_modules/codemirror/lib/codemirror.css`,
    });
    await page.addScriptTag({
      url: `${ORIGIN}/node_modules/codemirror/lib/codemirror.js`,
    });
    await page.evaluate(() => {
      window.editor = CodeMirror(document.querySelector("#editor"), {
        value: "",
        lineNumbers: true,
      });
      editor.focus();
    });
  } else if (kind === "cm6") {
    await page.addScriptTag({ url: `${ORIGIN}/cm6.js` });
    await page.evaluate(() => {
      window.editor = new CM6.EditorView({
        state: CM6.EditorState.create({ doc: "" }),
        parent: document.querySelector("#editor"),
      });
      editor.focus();
    });
  } else if (kind === "ace") {
    await page.addScriptTag({
      url: `${ORIGIN}/node_modules/ace-builds/src-min-noconflict/ace.js`,
    });
    await page.evaluate(() => {
      window.editor = ace.edit("editor");
      editor.setOptions({ useWorker: false });
      editor.focus();
    });
  } else if (kind === "monaco") {
    await page.addScriptTag({
      url: `${ORIGIN}/node_modules/monaco-editor/min/vs/loader.js`,
    });
    await page.evaluate(async (origin) => {
      require.config({
        paths: { vs: origin + "/node_modules/monaco-editor/min/vs" },
      });
      await new Promise((resolve) =>
        require(["vs/editor/editor.main"], resolve),
      );
      window.editor = monaco.editor.create(document.querySelector("#editor"), {
        value: "",
        language: "plaintext",
        automaticLayout: true,
      });
      editor.focus();
    }, ORIGIN);
  } else await page.locator("#editor").focus();
  await page.addScriptTag({ path: path.join(root, "content/adapters.js") });
  await page.addScriptTag({ path: path.join(root, "content/typing.js") });
  if (kind === "cm6")
    await page.evaluate(() => {
      __codeflowAdapters.config.getCodeMirror6Views = () => [editor];
      __codeflowAdapters.config.isCodeMirror6ReadOnly = (view) =>
        view.state.facet(CM6.EditorState.readOnly);
    });
  return page;
}
async function start(page, code = sample, delay = 10) {
  return page.evaluate(
    ({ code, delay }) =>
      __codeflowEngine.start({
        runId: crypto.randomUUID(),
        code,
        delay,
        labId: 1,
        taskId: 1,
      }),
    { code, delay },
  );
}
async function completed(page) {
  await expect
    .poll(() => page.evaluate(() => __codeflowEngine.getState().status), {
      timeout: 15000,
    })
    .toBe("completed");
}
async function value(page, kind) {
  return page.evaluate(
    (kind) =>
      kind === "textarea"
        ? document.querySelector("#editor").value
        : kind === "contenteditable"
          ? document.querySelector("#editor").textContent
          : kind === "cm6"
            ? editor.state.doc.toString()
            : editor.getValue(),
    kind,
  );
}
for (const kind of [
  "textarea",
  "contenteditable",
  "cm5",
  "cm6",
  "ace",
  "monaco",
]) {
  test(`${kind}: точный C# текст, переносы, отступы и Unicode`, async () => {
    const page = await pageFor(kind);
    await start(page, sample.replaceAll("\n", "\r\n"));
    await completed(page);
    expect((await value(page, kind)).replace(/\r\n/g, "\n")).toBe(sample);
    await page.close();
  });
  test(`${kind}: старый код полностью заменяется`, async () => {
    const page = await pageFor(kind);
    await page.evaluate((kind) => {
      const old = "prefix OLD\nsuffix";
      if (kind === "textarea") {
        const element = document.querySelector("#editor");
        element.value = old;
        element.setSelectionRange(7, 10);
      } else if (kind === "contenteditable") {
        document.querySelector("#editor").textContent = old;
      } else if (kind === "cm6") {
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: old },
          selection: { anchor: 7, head: 10 },
        });
      } else {
        editor.setValue(old);
      }
    }, kind);
    await start(page);
    await completed(page);
    expect((await value(page, kind)).replace(/\r\n/g, "\n")).toBe(sample);
    await page.close();
  });
}
test("Мгновенный режим заменяет старый код одним вводом", async () => {
  const page = await pageFor("textarea");
  await page.evaluate(() => {
    const element = document.querySelector("#editor");
    element.value = "старый код";
    window.inputCount = 0;
    element.addEventListener("input", () => window.inputCount++);
  });
  const code = sample.repeat(20);
  await start(page, code, 0);
  await completed(page);
  expect(await value(page, "textarea")).toBe(code);
  expect(await page.evaluate(() => window.inputCount)).toBe(1);
  await page.close();
});
test("Пауза, продолжение, запрет дубликата и остановка", async () => {
  const page = await pageFor("textarea");
  await start(page, "abcdefghijklmnop", 100);
  await expect
    .poll(() => page.evaluate(() => __codeflowEngine.getState().typed))
    .toBeGreaterThan(1);
  expect(
    await page.evaluate(() => {
      try {
        __codeflowEngine.start({ code: "x", delay: 10 });
      } catch (error) {
        return error.message;
      }
    }),
  ).toContain("уже");
  await page.evaluate(() => __codeflowEngine.pause());
  const before = await value(page, "textarea");
  await page.waitForTimeout(250);
  expect(await value(page, "textarea")).toBe(before);
  await page.evaluate(() => __codeflowEngine.resume());
  await expect.poll(() => value(page, "textarea")).not.toBe(before);
  await page.evaluate(() => __codeflowEngine.stop());
  const stopped = await value(page, "textarea");
  await page.waitForTimeout(200);
  expect(await value(page, "textarea")).toBe(stopped);
  await page.close();
});
test("Частичное выделение не мешает заменить весь старый код", async () => {
  const page = await pageFor("textarea");
  await page.evaluate(() => {
    editor.value = "prefix OLD suffix";
    editor.setSelectionRange(7, 10);
  });
  await start(page, "NEW\n");
  await completed(page);
  expect(await value(page, "textarea")).toBe("NEW\n");
  await page.close();
});
test("Read-only, отменённый beforeinput и ручное изменение текста останавливают ввод", async () => {
  const page = await pageFor("textarea");
  await page.evaluate(() => {
    editor.readOnly = true;
  });
  await start(page, "abc");
  await expect
    .poll(() => page.evaluate(() => __codeflowEngine.getState().status))
    .toBe("error");
  expect(await value(page, "textarea")).toBe("");
  await page.evaluate(() => {
    editor.readOnly = false;
    editor.addEventListener("beforeinput", (event) => event.preventDefault(), {
      once: true,
    });
  });
  await start(page, "abc");
  await expect
    .poll(() => page.evaluate(() => __codeflowEngine.getState().status))
    .toBe("error");
  expect(await value(page, "textarea")).toBe("");
  await start(page, "abcdefghij", 100);
  await expect.poll(() => value(page, "textarea")).not.toBe("");
  await page.evaluate(() => {
    editor.value = "ручной ввод";
  });
  await expect
    .poll(() => page.evaluate(() => __codeflowEngine.getState().status))
    .toBe("error");
  expect(await value(page, "textarea")).toBe("ручной ввод");
  await page.close();
});
test("Неоднозначный редактор и отсутствие редактора дают понятную ошибку", async () => {
  const page = await pageFor("textarea");
  await page.evaluate(() => {
    document.body.innerHTML = "<textarea></textarea><textarea></textarea>";
  });
  await expect(start(page, "abc")).rejects.toThrow(/несколько/);
  await page.evaluate(() => {
    document.body.innerHTML =
      '<div class="cm-editor"><div id="private-editor" contenteditable="true"></div></div><textarea id="comment"></textarea>';
    document.querySelector("#private-editor").focus();
  });
  await expect(start(page, "abc")).rejects.toThrow(/настроить адаптер/);
  expect(await page.locator("#comment").inputValue()).toBe("");
  await page.evaluate(() => {
    document.body.innerHTML = "";
  });
  await expect(start(page, "abc")).rejects.toThrow(/не найден/);
  await page.close();
});
test("Старое сообщение об импорте JSON исчезает после обновления", async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.evaluate(async () => {
    await chrome.storage.local.set({
      settings: { labId: 1, taskId: 1, delay: 10 },
      typingSession: {
        status: "error",
        progress: 0,
        message: "Решение пока отсутствует. Импортируйте JSON.",
      },
    });
  });
  await popup.reload();
  await expect(popup.locator("#availability-text")).toHaveText("Решение доступно");
  await expect(popup.locator("#notice")).toHaveText(
    "Нажмите на редактор перед запуском.",
  );
  await expect(popup.locator("#start")).toBeEnabled();
  await expect(popup.locator('input[name="speed"][value="10"]')).toBeChecked();
  expect(
    await popup.evaluate(async () =>
      (await chrome.storage.local.get("typingSession")).typingSession.status,
    ),
  ).toBe("idle");
  await popup.close();
});

test("Мини-панель на сайте выбирает задание, печатает и останавливает", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/mini`);
  await page.evaluate(() => {
    const editor = document.createElement("textarea");
    editor.id = "editor";
    document.body.prepend(editor);
  });
  const mini = page.locator("#codeflow-mini-host");
  await expect(mini.locator(".run")).toBeVisible();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("#lab")).toBeEnabled();
  await mini.locator(".lab").selectOption("1");
  await mini.locator(".task").selectOption("2");
  await expect.poll(() =>
    popup.evaluate(async () => (await chrome.storage.local.get("settings")).settings.taskId),
  ).toBe(2);
  await popup.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, delay: 100 } });
  });
  await expect.poll(() =>
    popup.evaluate(async () => (await chrome.storage.local.get("settings")).settings.delay),
  ).toBe(100);
  await page.bringToFront();
  await page.locator("#editor").focus();
  await mini.locator(".run").click();
  await expect.poll(() => page.locator("#editor").inputValue()).not.toBe("");
  await mini.locator(".stop").click();
  await expect.poll(() =>
    popup.evaluate(async () => (await chrome.storage.local.get("typingSession")).typingSession.status),
  ).toBe("stopped");
  await popup.close();
  await page.close();
});

test("Открытие расширения восстанавливает мини-панель без перезагрузки сайта", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/already-open`);
  const mini = page.locator("#codeflow-mini-host");
  await expect(mini.locator(".run")).toBeVisible();
  await page.evaluate(() => {
    const editor = document.createElement("textarea");
    editor.id = "editor";
    editor.value = "Мой несохранённый код";
    document.body.prepend(editor);
    document.querySelector("#codeflow-mini-host").remove();
  });
  await expect(mini).toHaveCount(0);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("#lab")).toBeEnabled();
  await expect(mini.locator(".run")).toBeVisible();
  await expect(page.locator("#editor")).toHaveValue("Мой несохранённый код");
  await popup.close();
  await page.close();
});

test("Повторное внедрение после обновления расширения оставляет одну мини-панель", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/extension-reload`);
  await expect(page.locator("#codeflow-mini-host")).toHaveCount(1);
  await page.evaluate(() => {
    const editor = document.createElement("textarea");
    editor.id = "editor";
    editor.value = "Несохранённый код";
    document.body.prepend(editor);
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: () => { delete globalThis.__codeflowMini; },
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      files: ["content/mini.js"],
    });
  }, `${ORIGIN}/extension-reload`);
  await expect(page.locator("#codeflow-mini-host")).toHaveCount(1);
  await expect(page.locator("#codeflow-mini-host .run")).toBeVisible();
  await expect(page.locator("#editor")).toHaveValue("Несохранённый код");
  await popup.close();
  await page.close();
});

test("Мини-панель переносится мышью и сохраняет положение после обновления страницы", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/draggable-mini`);
  const mini = page.locator("#codeflow-mini-host");
  const head = mini.locator(".head");
  await expect(head).toBeVisible();
  const before = await mini.boundingBox();
  const handle = await head.boundingBox();
  await page.mouse.move(handle.x + 75, handle.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle.x - 225, handle.y + 190, { steps: 8 });
  await page.mouse.up();
  const moved = await mini.boundingBox();
  expect(moved.x).toBeLessThan(before.x - 250);
  expect(moved.y).toBeGreaterThan(before.y + 140);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect.poll(async () => popup.evaluate(async () =>
    (await chrome.storage.local.get("miniPosition")).miniPosition?.x,
  )).toBe(Math.round(moved.x));
  await page.reload();
  await expect(mini).toBeVisible();
  const restored = await mini.boundingBox();
  expect(restored.x).toBeCloseTo(moved.x, 0);
  expect(restored.y).toBeCloseTo(moved.y, 0);
  await page.setViewportSize({ width: 350, height: 300 });
  await expect.poll(async () => {
    const box = await mini.boundingBox();
    return box.x + box.width;
  }).toBeLessThanOrEqual(350);
  const clamped = await mini.boundingBox();
  expect(clamped.x).toBeGreaterThanOrEqual(0);
  expect(clamped.x + clamped.width).toBeLessThanOrEqual(350);
  expect(clamped.y).toBeGreaterThanOrEqual(0);
  expect(clamped.y + clamped.height).toBeLessThanOrEqual(300);
  await popup.evaluate(() => chrome.storage.local.remove("miniPosition"));
  await popup.close();
  await page.close();
});

test("Режим «Очень быстро» вводит код с интервалом 10 мс", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/very-fast`);
  await page.evaluate(() => {
    const editor = document.createElement("textarea");
    editor.id = "editor";
    document.body.prepend(editor);
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("#lab")).toBeEnabled();
  const mini = page.locator("#codeflow-mini-host");
  await mini.locator(".lab").selectOption("1");
  await mini.locator(".task").selectOption("2");
  await mini.locator(".speed").selectOption("10");
  await expect(popup.locator('input[name="speed"][value="10"]')).toBeChecked();
  await page.bringToFront();
  await page.locator("#editor").focus();
  await mini.locator(".run").click();
  await expect(page.locator("#editor")).toHaveValue("abcdefghijklmnopqrstuvwxyz");
  expect(await popup.evaluate(async () =>
    (await chrome.storage.local.get("typingSession")).typingSession.delay,
  )).toBe(10);
  await popup.close();
  await page.close();
});

test("После печати мини-панель выбирает следующее задание без перехода по сайту", async () => {
  const page = await context.newPage();
  await page.route(`${ORIGIN}/autonext/**`, (route) => {
    const taskId = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    const link = taskId === 1 ? '<a href="/autonext/2">Задание 2</a>' : "";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><h1>Задание ${taskId}</h1><p>CS1-0${taskId}</p><textarea id="editor"></textarea>${link}</body></html>`,
    });
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("#lab")).toBeEnabled();
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ settings: { labId: 1, taskId: 1, delay: 0 } });
  });
  await page.goto(`${ORIGIN}/autonext/1`);
  const mini = page.locator("#codeflow-mini-host");
  await expect(mini.locator(".task")).toHaveValue("1");
  await page.locator("#editor").focus();
  await mini.locator(".run").click();
  await expect(page.locator("#editor")).toHaveValue(sample);
  await expect(page).toHaveURL(`${ORIGIN}/autonext/1`);
  await expect(mini.locator(".task")).toHaveValue("2");
  await expect(popup.locator("#task")).toHaveValue("2");
  await expect(mini.locator(".status")).toContainText("Откройте его на сайте");
  await page.goto(`${ORIGIN}/autonext/2`);
  await expect(mini.locator(".task")).toHaveValue("2");
  await page.locator("#editor").focus();
  await mini.locator(".run").click();
  await expect(page.locator("#editor")).toHaveValue("abcdefghijklmnopqrstuvwxyz");
  await popup.close();
  await page.close();
});

test("Без ссылки на следующее задание код не печатается в старое", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/no-next-link`);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("afterbegin", '<h1>Задание 1</h1><p>CS1-01</p><textarea id="editor"></textarea>');
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("#lab")).toBeEnabled();
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ settings: { labId: 1, taskId: 1, delay: 0 } });
  });
  const mini = page.locator("#codeflow-mini-host");
  await expect(mini.locator(".task")).toHaveValue("1");
  await page.locator("#editor").focus();
  await mini.locator(".run").click();
  await expect(mini.locator(".task")).toHaveValue("2");
  await expect(mini.locator(".status")).toContainText("Откройте его на сайте");
  const printed = await page.locator("#editor").inputValue();
  await mini.locator(".run").click();
  await expect(mini.locator(".status")).toContainText("На сайте открыто задание №1");
  await expect(page.locator("#editor")).toHaveValue(printed);
  await page.bringToFront();
  const popupResult = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "START" }));
  expect(popupResult.error).toContain("На сайте открыто задание №1");
  await popup.close();
  await page.close();
});

test("Настоящее расширение: TXT → popup → worker → вкладка, печать после закрытия popup", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/integration`);
  await page.evaluate(() => {
    document.body.innerHTML = '<textarea id="editor"></textarea>';
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("#lab")).toBeEnabled();
  await expect(popup.locator("#start")).toBeEnabled();
  await popup.locator("#lab").selectOption("3");
  await expect(popup.locator("#task option")).toHaveCount(20);
  await popup.locator("#lab").selectOption("1");
  await expect(popup.locator("#import")).toHaveCount(0);
  await expect(popup.locator("#start")).toBeEnabled();
  await popup.locator('input[name="speed"][value="50"]').check();
  await expect
    .poll(() =>
      popup.evaluate(
        async () => (await chrome.storage.local.get("settings")).settings.delay,
      ),
    )
    .toBe(50);
  expect(
    await popup.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  ).toBe(true);
  await popup
    .locator("body")
    .screenshot({ path: path.join(root, "tests/popup-preview.png") });
  await popup.locator("#help").click();
  await expect(popup.locator("#help-dialog")).toBeVisible();
  await popup.keyboard.press("Escape");
  await expect(popup.locator("#help-dialog")).not.toBeVisible();
  await page.bringToFront();
  await page.locator("#editor").focus();
  await popup.evaluate(async () => chrome.storage.session.set({ targetTabId: -1 }));
  await popup.evaluate(() => document.querySelector("#start").click());
  await expect
    .poll(() =>
      popup.evaluate(
        async () =>
          (await chrome.storage.local.get("typingSession")).typingSession
            ?.status,
      ),
    )
    .toBe("typing");
  await popup.close();
  await completed(page);
  expect(await value(page, "textarea")).toBe(sample);
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(reopened.locator("#notice")).toHaveText("Код успешно напечатан");
  await expect(reopened.locator("#progress-percent")).toHaveText("100%");
  await expect(
    reopened.locator('input[name="speed"][value="50"]'),
  ).toBeChecked();
  await reopened.close();
  await page.close();
});

test("Worker: управление, повторный запуск, перезагрузка и закрытие вкладки", async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/controls`);
  await page.evaluate(() => {
    document.body.innerHTML = '<textarea id="editor"></textarea>';
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator("#lab")).toBeEnabled();
  await popup.evaluate(async () => {
    await chrome.storage.local.set({
      settings: { labId: 1, taskId: 2, delay: 100 },
    });
  });
  await page.bringToFront();
  await page.locator("#editor").focus();
  const request = (type) =>
    popup.evaluate((type) => chrome.runtime.sendMessage({ type }), type);
  expect((await request("START")).ok).toBe(true);
  expect((await request("START")).error).toContain("уже");
  expect((await request("PAUSE")).value.status).toBe("paused");
  const paused = await page.locator("#editor").inputValue();
  await page.waitForTimeout(220);
  expect(await page.locator("#editor").inputValue()).toBe(paused);
  expect((await request("RESUME")).value.status).toBe("typing");
  await expect
    .poll(() => page.locator("#editor").inputValue())
    .not.toBe(paused);
  expect((await request("STOP")).value.status).toBe("stopped");
  const stopped = await page.locator("#editor").inputValue();
  await page.waitForTimeout(180);
  expect(await page.locator("#editor").inputValue()).toBe(stopped);
  expect((await request("START")).ok).toBe(true);
  await page.reload();
  await expect
    .poll(async () => (await request("STATUS")).value.status)
    .toBe("error");
  await page.evaluate(() => {
    document.body.innerHTML = '<textarea id="editor"></textarea>';
  });
  await page.locator("#editor").focus();
  expect((await request("START")).ok).toBe(true);
  await page.close();
  await expect
    .poll(async () => (await request("STATUS")).value.message)
    .toContain("закрыта");
  const wrongPage = await context.newPage();
  await wrongPage.goto("about:blank");
  await wrongPage.bringToFront();
  expect((await request("START")).error).toMatch(/AI Institute|Нет доступа/);
  await wrongPage.close();
  await popup.close();
});

for (const kind of ["monaco", "cm5", "cm6", "ace"]) {
  test(`${kind}: запрет записи соблюдается`, async () => {
    const page = await pageFor(kind);
    await page.evaluate((kind) => {
      if (kind === "monaco") editor.updateOptions({ readOnly: true });
      if (kind === "cm5") editor.setOption("readOnly", true);
      if (kind === "ace") editor.setReadOnly(true);
      if (kind === "cm6")
        editor.setState(
          CM6.EditorState.create({
            doc: "",
            extensions: [CM6.EditorState.readOnly.of(true)],
          }),
        );
    }, kind);
    await start(page, "never inserted");
    await expect
      .poll(() => page.evaluate(() => __codeflowEngine.getState().status))
      .toBe("error");
    expect(await value(page, kind)).toBe("");
    await page.close();
  });
}
