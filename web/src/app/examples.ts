// The example scripts in the repository's `examples/NNN.ts`, bundled so `?example=N` can
// open one. Each loads on demand; the number in the file name is the example's identity.

const files = import.meta.glob("../../../examples/*.ts", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** The source of example `n`, or `null` when there is no such example. */
export async function exampleSource(n: number): Promise<string | null> {
  for (const [path, load] of Object.entries(files)) {
    const m = /\/(\d+)\.ts$/.exec(path);
    if (m && Number(m[1]) === n) return load();
  }
  return null;
}

/** The example a URL asks for (`?example=3`), if any. */
export function requestedExample(search: string): number | null {
  const raw = new URLSearchParams(search).get("example");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}
