/**
 * Release a run's resources after both the worker and its follow-up work finish.
 *
 * Sending SIGTERM does not mean the worker has stopped writing. Its `close`
 * event also waits for stdio to close, so it is the point at which a canceled
 * run can release the tracker-delete guard. The returned function can be called
 * earlier on cancellation, or later after PDF rendering and marking complete.
 *
 * @param {{ once: (event: string, listener: () => void) => unknown }} child
 * @param {() => void} release
 * @returns {(() => void) & { setActiveChild?: (c: any) => void }}
 */
export function createRunFinalizer(child, release) {
  let activeChild = child;
  let workerClosed = false;
  let runFinished = false;
  let released = false;

  const releaseIfFinished = () => {
    if (workerClosed && runFinished && !released) {
      released = true;
      release();
    }
  };

  const hookChild = (c) => {
    workerClosed = false;
    c.once("close", () => {
      if (c === activeChild) {
        workerClosed = true;
        releaseIfFinished();
      }
    });
  };

  hookChild(child);

  const finalizer = () => {
    runFinished = true;
    releaseIfFinished();
  };

  finalizer.setActiveChild = (nextChild) => {
    activeChild = nextChild;
    hookChild(nextChild);
  };

  return finalizer;
}
