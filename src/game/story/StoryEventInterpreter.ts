export type StoryEventStepResult = "continue" | "complete";
export type StoryEventHandler<E, C> = (
  event: E,
  context: C,
  elapsed: number,
) => StoryEventStepResult;

export class StoryEventInterpreter<E, C> {
  index = 0;
  elapsed = 0;
  /** The index the active event came from; a branch command moves `index` away from it. */
  runningIndex = -1;
  /**
   * Every event that finished, in the order it finished. Side effects read this instead of walking
   * `events`: a branch command can visit a record twice or skip one, so the program order and the
   * execution order are not the same thing.
   */
  readonly completed: E[] = [];
  private active: E | null = null;
  constructor(
    private readonly events: readonly E[],
    private readonly handler: StoryEventHandler<E, C>,
  ) {}
  get event(): E | null {
    return this.active;
  }
  tick(context: C): void {
    if (this.active === null && this.index >= this.events.length) return;
    if (this.active === null) {
      this.runningIndex = this.index;
      this.active = this.events[this.index++];
      this.elapsed = 0;
    }
    // Read the event before the handler runs: a branch command moves `active` away from underneath it.
    const running = this.active;
    const result = this.handler(running, context, ++this.elapsed);
    if (result === "complete") {
      this.completed.push(running);
      this.active = null;
      this.elapsed = 0;
    }
  }
  /** Continue at another event: what the source's jump and branch commands do. */
  jumpTo(index: number): void {
    this.index = index;
    this.active = null;
    this.elapsed = 0;
  }
  reset(index = 0): void {
    this.index = index;
    this.elapsed = 0;
    this.runningIndex = -1;
    this.active = null;
    this.completed.length = 0;
  }
}
