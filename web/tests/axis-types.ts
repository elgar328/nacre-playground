// A type-level lock — nothing here runs. `npx tsc --noEmit` is the assertion.
//
// The script world declares `X`/`Y`/`Z` as `Axis`, a *narrowing* of `Dir`: a call that
// **states** an axis takes only the three named tokens, while **selection** goes on
// reading them as ordinary directions. Both halves have to hold at once, and the first
// one is not free — an `Axis` that adds no members of its own is *structurally* a `Dir`,
// so `cylinder({ axis: face.normal })` typechecks until the marker on `Axis` says
// otherwise. (Measured: without the marker the second line below reports no error, and
// `@ts-expect-error` then turns this file red.)
//
// The editor does not run the script through these declarations yet, so today this is
// a lock on what the *documentation* says, not on what a user's script is refused for.
// The refusal a script actually meets is the runtime door in `recorder.ts`, locked in
// `recorder.test.ts`.

declare const face: FacePick;

// Selection: an axis token is a direction, and comparing a normal to one still reads.
export const readsLikeADirection: boolean = face.normal!.isClose(Z);

// Statement: an arbitrary direction is not an axis. A tilted cylinder is not something
// the kernel can carry through a boolean, so the API must not be able to say one.
// @ts-expect-error — `cylinder`'s `axis` takes X, Y or Z, never `face.normal`.
export const statesAnArbitraryDirection = cylinder({ axis: face.normal! });
