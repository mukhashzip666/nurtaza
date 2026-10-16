import { cp, readFile } from "node:fs/promises";
import { LABS, parseImport, MAX_CODE_LENGTH } from "../lib/library.js";
const tasks = [];
for (const lab of LABS) {
  const source = new URL(`../src/data/lab${lab.id}.json`, import.meta.url);
  const group = JSON.parse(await readFile(source, "utf8"));
  if (group.length !== lab.count || group.some((task) => task.labId !== lab.id))
    throw new Error(`Неверное содержимое lab${lab.id}.json`);
  parseImport(group);
  for (let taskId = 1; taskId <= lab.count; taskId++) {
    const code = await readFile(
      new URL(`../solutions/lab${lab.id}/task${taskId}.txt`, import.meta.url),
      "utf8",
    );
    if (code.length > MAX_CODE_LENGTH)
      throw new Error(`Код задания ${lab.id}:${taskId} слишком длинный.`);
  }
  tasks.push(...group);
  await cp(source, new URL(`../data/lab${lab.id}.json`, import.meta.url));
}
if (Object.keys(parseImport(tasks)).length !== 71)
  throw new Error("Требуется 71 задание.");
console.log("CodeFlow готов: 5 лабораторных, 71 задание.");
