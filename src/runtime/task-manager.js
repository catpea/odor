import os from 'node:os';

export class TaskManager {
  constructor() {
    this.queues = new Map();
  }

  createQueue(name, options) {
    const queue = new TaskQueue(name, options);
    this.queues.set(name, queue);
    return queue;
  }

  getQueue(name) {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }

  submit(queueName, job) {
    return this.getQueue(queueName).submit(job);
  }
}

export class TaskQueue {
  constructor(name, { concurrency = 1, retries = 0 } = {}) {
    this.name = name;
    this.concurrency = normalizeConcurrency(concurrency);
    this.retries = retries;
    this.active = 0;
    this.pending = [];
  }

  submit(job) {
    return new Promise((resolve, reject) => {
      this.pending.push({ job, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      this.active++;
      this.runWithRetries(task.job)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  async runWithRetries(job) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await job({ attempt, queue: this.name });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

function normalizeConcurrency(value) {
  if (value === 'cpu') return Math.max(1, os.cpus().length);
  return Number(value || 1);
}
