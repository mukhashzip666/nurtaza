import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LABS, parseImport, validateTask } from "../lib/library.js";
const demo = {
  labId: 1,
  taskId: 1,
  title: "Демонстрация",
  description: "",
  code: 'Console.WriteLine("test");',
  status: "available",
};
test("Библиотека содержит ровно 71 уникальную пустую запись без выдуманных решений", async () => {
  const groups = await Promise.all(
    LABS.map((lab) =>
      readFile(
        new URL(`../data/lab${lab.id}.json`, import.meta.url),
        "utf8",
      ).then(JSON.parse),
    ),
  );
  assert.deepEqual(
    groups.map((group) => group.length),
    [10, 11, 20, 20, 10],
  );
  const tasks = groups.flat();
  assert.equal(Object.keys(parseImport(tasks)).length, 71);
  assert.ok(
    tasks.every(
      (task) =>
        task.status === "missing" &&
        task.code === "" &&
        task.description === "",
    ),
  );
});
test("Служебные записи проверяются по номеру задания", () => {
  assert.deepEqual(parseImport([demo])["1:1"], demo);
  assert.deepEqual(parseImport({ tasks: [demo] })["1:1"], demo);
});
test("Служебные записи отклоняют дубликаты и неверные поля", () => {
  for (const value of [
    [demo, demo],
    [{ ...demo, labId: 6 }],
    [{ ...demo, taskId: 11 }],
    [{ ...demo, code: "" }],
    [{ ...demo, status: "missing" }],
    [{ ...demo, code: 4 }],
    [],
    { labs: [] },
  ])
    assert.throws(() => parseImport(value));
});
test("Windows-переносы нормализуются, Unicode и пробелы сохраняются", () => {
  assert.equal(
    validateTask({ ...demo, code: "  // Привет 👋\r\n\treturn;\r" }).code,
    "  // Привет 👋\n\treturn;\n",
  );
});
test("Исходные данные синхронизированы с runtime-библиотекой", async () => {
  for (const lab of LABS)
    assert.equal(
      await readFile(
        new URL(`../src/data/lab${lab.id}.json`, import.meta.url),
        "utf8",
      ),
      await readFile(
        new URL(`../data/lab${lab.id}.json`, import.meta.url),
        "utf8",
      ),
    );
});
test("Для каждого задания есть TXT файл для прямого редактирования", async () => {
  const files = await Promise.all(
    LABS.flatMap((lab) =>
      Array.from({ length: lab.count }, (_, index) =>
        readFile(
          new URL(
            `../solutions/lab${lab.id}/task${index + 1}.txt`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ),
  );
  assert.equal(files.length, 71);
  assert.ok(files.every((code) => typeof code === "string"));
});
