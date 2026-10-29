import { sleep } from './util'

export class Lane {
  private nextAt = 0
  private pausedUntil = 0
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(
    readonly name: string,
    private readonly rpm: number,
    private readonly maxConcurrent: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      await this.waitForTurn()
      return await fn()
    } finally {
      this.release()
    }
  }

  pauseUntil(timestampMs: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, timestampMs)
  }

  private async waitForTurn(): Promise<void> {
    const now = Date.now()
    const at = Math.max(now, this.nextAt, this.pausedUntil)
    this.nextAt = at + 60_000 / this.rpm
    if (at > now) await sleep(at - now)
    while (Date.now() < this.pausedUntil) await sleep(this.pausedUntil - Date.now())
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return
    }
    await new Promise<void>(resolve => this.waiting.push(resolve))
  }

  private release(): void {
    const next = this.waiting.shift()
    if (next) next()
    else this.active--
  }
}

export class Lanes {
  private readonly lanes = new Map<string, Lane>()

  constructor(private readonly defaults: { rpm: number; maxConcurrent: number }) {}

  get(name: string, overrides?: { rpm?: number; maxConcurrent?: number }): Lane {
    let lane = this.lanes.get(name)
    if (!lane) {
      lane = new Lane(name, overrides?.rpm ?? this.defaults.rpm, overrides?.maxConcurrent ?? this.defaults.maxConcurrent)
      this.lanes.set(name, lane)
    }
    return lane
  }
}
