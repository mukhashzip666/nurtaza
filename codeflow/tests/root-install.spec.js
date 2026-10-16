import { test, expect, chromium } from "@playwright/test";
import { readFile, mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const workspace = path.resolve(import.meta.dirname, "../..");
const origin = "https://ai-institute.tailcb3c56.ts.net";

test("Выбор рабочей папки загружает manifest и печатает через вложенный codeflow", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "codeflow-root-profile-"));
  const extension = await mkdtemp(path.join(tmpdir(), "codeflow-root-ext-"));
  let context;
  try {
    await cp(
      path.join(workspace, "manifest.json"),
      path.join(extension, "manifest.json"),
    );
    for (const item of [
      "popup",
      "content",
      "background",
      "lib",
      "data",
      "solutions",
      "assets",
    ])
      await cp(
        path.join(workspace, "codeflow", item),
        path.join(extension, "codeflow", item),
        { recursive: true },
      );
    const code = 'Console.WriteLine("root works");\n';
    await writeFile(
      path.join(extension, "codeflow", "solutions", "lab1", "task1.txt"),
      code,
    );
    const manifest = JSON.parse(
      await readFile(path.join(extension, "manifest.json"), "utf8"),
    );
    // Automation cannot click the toolbar for activeTab; this applies only to the fixture copy.
    manifest.host_permissions = [`${origin}/*`];
    await writeFile(
      path.join(extension, "manifest.json"),
      JSON.stringify(manifest),
    );
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    expect(worker.url()).toContain("/codeflow/background/background.js");
    const extensionId = new URL(worker.url()).host;
    await context.route(`${origin}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><body><textarea id="editor"></textarea></body></html>',
      }),
    );
    const site = await context.newPage();
    await site.goto(`${origin}/test`);
    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${extensionId}/codeflow/popup/popup.html`,
    );
    await expect(popup.locator("#lab option")).toHaveCount(5);
    await expect(popup.locator("#task option")).toHaveCount(10);
    await expect(popup.locator("#availability-text")).toHaveText(
      "Решение доступно",
    );
    await expect(popup.locator("#start")).toBeEnabled();
    await popup.evaluate(async () => {
      await chrome.storage.local.set({
        settings: { labId: 1, taskId: 1, delay: 10 },
      });
    });
    await site.bringToFront();
    await site.locator("#editor").focus();
    const started = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: "START" }),
    );
    expect(started.ok, started.error).toBe(true);
    await expect.poll(() => site.locator("#editor").inputValue()).toBe(code);
    await expect
      .poll(() =>
        popup.evaluate(
          async () =>
            (await chrome.storage.local.get("typingSession")).typingSession
              .status,
        ),
      )
      .toBe("completed");
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    await rm(extension, { recursive: true, force: true });
  }
});
