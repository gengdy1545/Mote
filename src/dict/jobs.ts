type Job = {
  key: string;
  spelling: string;
  run: () => Promise<void>;
  done: Array<() => void>;
};

export function createJobQueue(limit = 2) {
  let active = 0;
  const waiting: Job[] = [];
  const running = new Map<string, Job>();

  const pump = () => {
    while (active < limit && waiting.length > 0) {
      const job = waiting.shift();
      if (!job || running.has(job.key)) continue;
      running.set(job.key, job);
      active += 1;
      job.run().catch(() => undefined).finally(() => {
        running.delete(job.key);
        active -= 1;
        for (const notify of job.done) notify();
        pump();
      });
    }
  };

  return {
    add(key: string, spelling: string, run: () => Promise<void>, notify: () => void) {
      const current = running.get(key);
      if (current) {
        current.done.push(notify);
        return;
      }
      const queued = waiting.find((job) => job.key === key);
      if (queued) {
        queued.done.push(notify);
        return;
      }
      waiting.unshift({ key, spelling, run, done: [notify] });
      pump();
    },
    keep(spelling: string) {
      for (let index = waiting.length - 1; index >= 0; index -= 1) {
        if (waiting[index]?.spelling !== spelling) waiting.splice(index, 1);
      }
    },
  };
}
