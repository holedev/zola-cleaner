/** Sinh ảnh JPEG XL mẫu cho test Rust (một lần): node scripts/make-jxl-fixture.ts <out.jxl> */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebAssembly: WA } = globalThis as unknown as { WebAssembly: { Module: new (b: Uint8Array) => object } };
const enc = (await import("@jsquash/jxl/encode.js")) as unknown as {
  init: (m: object) => Promise<unknown>;
  default: (img: unknown, opts?: object) => Promise<ArrayBuffer>;
};
(globalThis as { ImageData?: unknown }).ImageData ??= class {};
await enc.init(new WA.Module(readFileSync(require.resolve("@jsquash/jxl/codec/enc/jxl_enc.wasm"))));
const width = 640;
const height = 400;
const data = new Uint8ClampedArray(width * height * 4).fill(200);
writeFileSync(process.argv[2]!, new Uint8Array(await enc.default({ data, width, height, colorSpace: "srgb" })));
