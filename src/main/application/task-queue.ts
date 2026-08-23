/**
 * Runs async tasks one at a time: a task submitted while another is still
 * running waits for that one to settle instead of interleaving at its `await`
 * points.
 *
 * Needed wherever overlapping runs of the same operation each read and then
 * write shared state across an `await`. The motivating case is
 * `workspace.switchTo`, whose handler swaps the entire workspace-scoped
 * service graph after awaiting the registry write: two overlapping switches
 * interleave, the workspace that ends up active is whichever await happened to
 * resolve last rather than the one requested last, and the on-disk active
 * pointer and the in-memory graph are only kept in agreement by the accident
 * of `switchTo` doing no work after its write. Serializing removes both
 * hazards.
 */
export type TaskQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createTaskQueue(): TaskQueue {
  // Always fulfilled — see the `tail` assignment below.
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    // `tail` must never reject, or a failed task would skip every task queued
    // behind it. The caller still sees its own rejection through `run`.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
