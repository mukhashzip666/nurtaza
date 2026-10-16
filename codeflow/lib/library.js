export const LABS = Object.freeze([
  { id: 1, title: "Введение в C#", count: 10 },
  { id: 2, title: "Переменные, типы данных и операторы", count: 11 },
  { id: 3, title: "Условные операторы", count: 20 },
  { id: 4, title: "Циклы и повторение", count: 20 },
  { id: 5, title: "Операции с массивами", count: 10 },
]);
export const MAX_CODE_LENGTH = 100000;
export const keyOf = (labId, taskId) => `${labId}:${taskId}`;
export function validateTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task))
    throw new Error("Каждое задание должно быть объектом.");
  const lab = LABS.find((item) => item.id === task.labId);
  if (
    !lab ||
    !Number.isInteger(task.taskId) ||
    task.taskId < 1 ||
    task.taskId > lab.count
  )
    throw new Error("Неверный номер лабораторной или задания.");
  for (const field of ["title", "description", "code", "status"]) {
    if (typeof task[field] !== "string")
      throw new Error(`Поле «${field}» должно быть строкой.`);
  }
  if (
    task.title.length > 200 ||
    task.description.length > 4000 ||
    task.code.length > MAX_CODE_LENGTH
  )
    throw new Error("Слишком длинное название, описание или код.");
  if (!["available", "missing"].includes(task.status))
    throw new Error("Статус должен быть available или missing.");
  const code = task.code.replace(/\r\n?/g, "\n");
  if (task.status === "available" && !code.trim())
    throw new Error("Для статуса available нужен код.");
  if (task.status === "missing" && code.trim())
    throw new Error("У задания с кодом должен быть статус available.");
  return {
    labId: task.labId,
    taskId: task.taskId,
    title: task.title.trim() || `Задание №${task.taskId}`,
    description: task.description,
    code,
    status: task.status,
  };
}
export function parseImport(value) {
  const tasks = Array.isArray(value) ? value : value?.tasks;
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 71)
    throw new Error("Нужен массив из 1–71 заданий или объект с полем tasks.");
  const entries = {};
  for (const raw of tasks) {
    const task = validateTask(raw);
    const key = keyOf(task.labId, task.taskId);
    if (entries[key]) throw new Error(`Задание ${key} встречается дважды.`);
    entries[key] = task;
  }
  return entries;
}
export async function loadLibrary() {
  const [groups, solutionFiles] = await Promise.all([
    Promise.all(
      LABS.map(async (lab) => {
        const response = await fetch(
          new URL(`../data/lab${lab.id}.json`, import.meta.url),
        );
        if (!response.ok) throw new Error("Не удалось загрузить библиотеку.");
        return response.json();
      }),
    ),
    Promise.all(
      LABS.flatMap((lab) =>
        Array.from({ length: lab.count }, async (_, index) => {
          const taskId = index + 1;
          const response = await fetch(
            new URL(
              `../solutions/lab${lab.id}/task${taskId}.txt`,
              import.meta.url,
            ),
          );
          if (!response.ok)
            throw new Error(
              `Не удалось загрузить файл кода: лабораторная №${lab.id}, задание №${taskId}.`,
            );
          const code = (await response.text()).replace(/\r\n?/g, "\n");
          if (code.length > MAX_CODE_LENGTH)
            throw new Error(`Код задания ${lab.id}:${taskId} слишком длинный.`);
          return { labId: lab.id, taskId, code };
        }),
      ),
    ),
  ]);
  const library = parseImport(groups.flat());
  for (const { labId, taskId, code } of solutionFiles) {
    if (!code.trim()) continue;
    const task = library[keyOf(labId, taskId)];
    library[keyOf(labId, taskId)] = { ...task, code, status: "available" };
  }
  return library;
}
