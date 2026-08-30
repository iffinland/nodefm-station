/* ============================================================
 * NodeFM Station — Bounded Concurrent Mapping
 *
 * Small shared helper for parallelizing independent async work without
 * firing every request at once. Preserves input order and stops short of
 * Promise.allSettled so callers can still keep structured error handling.
 * ============================================================ */

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker()),
  );

  return results;
}
