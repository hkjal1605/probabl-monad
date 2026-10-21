import type { ResourceStore } from "@/stores/createResourceStore";

/** Deduplicate shared reads; reset or SSE writes invalidate any older HTTP response. A forced
 * refresh asked for while a read runs reads again once it is done (the running read may predate
 * the change that forced it). */
export async function fetchResource<T>(
  resource: ResourceStore<T>,
  key: string,
  read: (signal: AbortSignal) => Promise<T>,
  force = false,
): Promise<void> {
  const previous = resource.pending.get(key);
  if (previous) {
    if (force) previous.rerun = read;
    return previous.promise;
  }
  const entry = resource.get(key);
  if (!force && entry.data !== undefined && !entry.error && Date.now() - entry.updatedAt < 10_000)
    return;
  const controller = new AbortController(),
    generation = resource.generation(),
    revision = entry.revision;
  resource.patch(key, { loading: true });
  const run = async () => {
    try {
      const data = await read(controller.signal);
      if (
        !controller.signal.aborted &&
        generation === resource.generation() &&
        resource.get(key).revision === revision
      )
        resource.setData(key, data);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        generation === resource.generation() &&
        resource.get(key).revision === revision
      )
        resource.patch(key, {
          error: error instanceof Error ? error : new Error("Data unavailable"),
          loading: false,
          errorAt: Date.now(),
        });
    } finally {
      const work = resource.pending.get(key);
      if (work?.controller === controller) {
        resource.pending.delete(key);
        if (work.rerun && generation === resource.generation())
          await fetchResource(resource, key, work.rerun, true);
      }
    }
  };
  const promise = run();
  resource.pending.set(key, { controller, promise });
  await promise;
}
