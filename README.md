# nacre-playground

**A browser playground for the [nacre](https://github.com/elgar328/nacre) CAD kernel.** Write a short TypeScript script, run it, and see the exact solid it builds.

**[Open the playground](https://elgar328.github.io/nacre-playground/)** · [Example gallery](https://elgar328.github.io/nacre-playground/gallery/)

[![Three example parts built in the playground](https://github.com/elgar328/nacre-playground/releases/download/assets/showcase.png)](https://elgar328.github.io/nacre-playground/gallery/)

- **Nothing runs on a server.** The kernel and [nacre-kit](https://github.com/elgar328/nacre-kit) are compiled to WebAssembly, so every model is built right in the page.
- **Code-CAD in a few lines.** Start from boxes, cylinders or pen sketches, then extrude, transform, combine with booleans, and pad or pocket faces.
- **Pick by appearance, keep the exact reference.** A selector such as `faces().filter(...)` chooses by coordinates, but the script records which face or vertex it chose, not where it was.
- **Take the part with you.** The export button in the top-right corner of the view writes what is shown as STEP or OBJ, or opens it in [step-loupe](https://github.com/elgar328/step-loupe) to inspect the STEP file. The kernel writes both files; the OBJ carries each face's exact normal, so cylinders shade round and edges stay sharp.

## Status

Experimental. The playground was built to exercise the kernel, so what it can model follows the kernel's coverage.

## Building

The playground builds the kernel and the kit from source, so clone all three repositories side by side. You also need [wasm-pack](https://rustwasm.github.io/wasm-pack/) to build the WebAssembly.

```sh
git clone https://github.com/elgar328/nacre
git clone https://github.com/elgar328/nacre-kit
git clone https://github.com/elgar328/nacre-playground
cd nacre-playground/web
npm install
npm run wasm:all
npm run dev
```

`npm test` runs the tests and `npm run check` type-checks the app. The browser and the tests each load their own WebAssembly build, so rerun `npm run wasm:all` whenever the kernel or the kit changes.

Adding an example, previewing the site and publishing it are described in [docs/RELEASING.md](docs/RELEASING.md).

## License

Licensed under either MIT or Apache-2.0, at your option.
