const timestamp = () => new Date().toISOString();

export const logger = {
  info: (msg: string, ...args: unknown[]) => {
    console.log(`[${timestamp()}] INFO  ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    console.warn(`[${timestamp()}] WARN  ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(`[${timestamp()}] ERROR ${msg}`, ...args);
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) {
      console.debug(`[${timestamp()}] DEBUG ${msg}`, ...args);
    }
  },
  progress: (current: number, total: number, msg: string) => {
    const pct = ((current / total) * 100).toFixed(1);
    console.log(`[${timestamp()}] PROGRESS [${current}/${total}] (${pct}%) ${msg}`);
  },
};
