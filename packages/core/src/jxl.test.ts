import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { detect } from "./detect.ts";
import { jxlToJpeg } from "./jxl.ts";

const require = createRequire(import.meta.url);

/** Tạo một ảnh JPEG XL nhỏ bằng encoder của jSquash (không đưa ảnh thật của người dùng vào repo). */
async function makeJxl(width: number, height: number): Promise<Uint8Array> {
  const { WebAssembly: WA } = globalThis as unknown as { WebAssembly: { Module: new (b: Uint8Array) => object } };
  const enc = (await import("@jsquash/jxl/encode.js")) as unknown as {
    init: (m: object) => Promise<unknown>;
    default: (img: unknown, opts?: object) => Promise<ArrayBuffer>;
  };
  await enc.init(new WA.Module(readFileSync(require.resolve("@jsquash/jxl/codec/enc/jxl_enc.wasm"))));
  const data = new Uint8ClampedArray(width * height * 4).fill(200);
  return new Uint8Array(await enc.default({ data, width, height, colorSpace: "srgb" }));
}

test("JPEG XL → thumbnail JPEG, thu nhỏ về cạnh dài 320px", async () => {
  const jxl = await makeJxl(640, 400);
  assert.equal(detect(jxl).kind, "jxl");
  const jpg = await jxlToJpeg(jxl);
  assert.equal(detect(jpg).kind, "jpg");
  // SOF0 chứa kích thước: tìm marker FF C0 rồi đọc chiều cao/rộng
  const sof = jpg.findIndex((b, i) => b === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2));
  const h = (jpg[sof + 5]! << 8) | jpg[sof + 6]!;
  const w = (jpg[sof + 7]! << 8) | jpg[sof + 8]!;
  assert.deepEqual({ w, h }, { w: 320, h: 200 });
});
