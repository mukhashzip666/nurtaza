import { test, expect, chromium } from "@playwright/test";
import { readFile, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

for (const nested of [false, true]) {
  test(`Значок открывает стандартный popup: ${nested ? "родительская папка" : "codeflow"}`, async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "codeflow-toolbar-profile-"));
    const extension = await mkdtemp(path.join(tmpdir(), "codeflow-toolbar-ext-"));
    let context;
    try {
      const files = nested ? path.join(extension, "codeflow") : extension;
      const manifestPath = path.join(root, nested ? "../manifest.json" : "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const popupPath = nested ? "codeflow/popup/popup.html" : "popup/popup.html";
      const miniPath = nested ? "codeflow/content/mini.js" : "content/mini.js";
      expect(manifest.action.default_popup).toBe(popupPath);
      expect(manifest.content_scripts[0].js).toContain(miniPath);
      await cp(manifestPath, path.join(extension, "manifest.json"));
      for (const item of ["popup", "content", "background", "lib", "data", "solutions", "assets"])
        await cp(path.join(root, item), path.join(files, item), { recursive: true });
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
      const expectedUrl = `chrome-extension://${new URL(worker.url()).host}/${popupPath}`;
      const actualUrl = await worker.evaluate(() => chrome.action.getPopup({}));
      expect(actualUrl).toBe(expectedUrl);
      const popup = await context.newPage();
      await popup.goto(actualUrl);
      await expect(popup.locator("#start")).toBeEnabled();
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
      await rm(extension, { recursive: true, force: true });
    }
  });
}
