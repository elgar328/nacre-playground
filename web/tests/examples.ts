// The repository's example scripts (`examples/NNN.ts`), for the suites that check that
// everything the app ships compiles, marks and runs.

const files = import.meta.glob("../../examples/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** `[label, source]` per example, in number order. */
export const EXAMPLES: [string, string][] = Object.entries(files)
  .map(([path, src]) => [Number(/\/(\d+)\.ts$/.exec(path)![1]), src] as const)
  .sort((a, b) => a[0] - b[0])
  .map(([n, src]) => [`example ${n}`, src]);
