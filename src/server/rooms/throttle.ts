/** Leading + trailing throttle: fires immediately if idle, otherwise schedules one trailing call so the final value always lands. */
export class Throttler {
  private lastRun = 0;
  private timer?: NodeJS.Timeout;

  constructor(private readonly ms: number) {}

  run(fn: () => void): void {
    const now = Date.now();
    const elapsed = now - this.lastRun;
    if (elapsed >= this.ms) {
      this.lastRun = now;
      clearTimeout(this.timer);
      fn();
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.lastRun = Date.now();
      fn();
    }, this.ms - elapsed);
  }

  clear(): void {
    clearTimeout(this.timer);
  }
}
