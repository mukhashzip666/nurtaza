// One string per Console.ReadLine() in the supplied variant 2 solutions.
const numbers = ['5', '2', '9', '1', '7', '3', '8', '4', '6', '10'];
const matrix = ['8', '1', '6', '3', '5', '7', '4', '9', '2'];
const groups = [
  [[], ['Muhammed'], ['Muhammed', '18'], ['12', '4'], ['12.5', '2.5'], ['7'], ['3', '6', '9'], ['25'], ['5', '3'], ['12', '4', '+']],
  [[], [], ['7', '3.14', 'A'], ['12', '4'], ['1', '2', '3', '4', '5'], ['17'], ['9'], ['1', '0'], [], [], []],
  [['18'], ['8'], ['-5'], ['10'], ['5'], ['1'], ['3'], ['green'], ['10'], ['150'], ['95'], ['12345'], ['admin', '12345'], ['1234'], ['70', '1.75'], ['12', '4', '+'], ['120'], ['20', '18'], ['standard'], ['5', '100']],
  [[], [], ['10'], ['7'], ['5'], ['5'], ['12345'], ['12345'], ['1', '2', '3', '4', '5'], ['-3', '0', '5', '-1', '8', '0', '2', '-7', '4', '0'], ['10'], ['17'], [], matrix, matrix, ['5'], ['5'], ['5'], matrix, matrix],
  [numbers, numbers, [], numbers, numbers, numbers, numbers, [...numbers, '7'], numbers, numbers],
];
export const RUN_INPUTS = Object.fromEntries(groups.flatMap((tasks, lab) =>
  tasks.map((lines, task) => [`${lab + 1}:${task + 1}`, lines])));
export function taskFromUrl(url) {
  const match = new URL(url).pathname.match(/^\/labs\/(\d+)\/CS(\d+)-(\d+)\/?$/);
  if (!match || match[1] !== match[2]) return null;
  const labId = Number(match[1]), taskId = Number(match[3]);
  return Object.hasOwn(RUN_INPUTS, `${labId}:${taskId}`) ? { labId, taskId } : null;
}
export function followingTask({ labId, taskId }) {
  const counts = [10, 11, 20, 20, 10];
  if (taskId < counts[labId - 1]) return { labId, taskId: taskId + 1 };
  return labId < counts.length ? { labId: labId + 1, taskId: 1 } : null;
}
export const taskPath = ({ labId, taskId }) => `/labs/${labId}/CS${labId}-${String(taskId).padStart(2, '0')}`;
