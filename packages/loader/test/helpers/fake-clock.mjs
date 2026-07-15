export function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  function setTimeout(callback, delay) {
    const id = nextId++;
    tasks.set(id, { callback, at: now + delay });
    return id;
  }

  function clearTimeout(id) {
    tasks.delete(id);
  }

  function advance(milliseconds) {
    const target = now + milliseconds;

    while (true) {
      const due = [...tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];

      if (!due) break;

      now = due[1].at;
      tasks.delete(due[0]);
      due[1].callback();
    }

    now = target;
  }

  return {
    advance,
    clearTimeout,
    get now() { return now; },
    get pendingCount() { return tasks.size; },
    setTimeout,
  };
}
