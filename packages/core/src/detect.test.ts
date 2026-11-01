import { test } from "node:test";
import assert from "node:assert/strict";
import { detect } from "./detect.ts";

const bytes = (...xs: (number | string)[]) => {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === "number") out.push(x);
    else for (const ch of x) out.push(ch.charCodeAt(0));
  }
  return Uint8Array.from(out);
};

test("ảnh phổ biến", () => {
  assert.deepEqual(detect(bytes(0xff, 0xd8, 0xff, 0xe0)), { category: "image", kind: "jpg" });
  assert.deepEqual(detect(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)), { category: "image", kind: "png" });
  assert.deepEqual(detect(bytes("GIF89a")), { category: "image", kind: "gif" });
  assert.deepEqual(detect(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")), { category: "image", kind: "webp" });
  assert.deepEqual(detect(bytes(0, 0, 0, 0x18, "ftypheic")), { category: "image", kind: "heic" });
});

test("video & âm thanh", () => {
  assert.deepEqual(detect(bytes(0, 0, 0, 0x20, "ftypisom")), { category: "video", kind: "mp4" });
  assert.deepEqual(detect(bytes(0, 0, 0, 0x14, "ftypqt  ")), { category: "video", kind: "mov" });
  assert.deepEqual(detect(bytes(0, 0, 0, 0x20, "ftypM4A ")), { category: "audio", kind: "m4a" });
  assert.deepEqual(detect(bytes("#!AMR\n")), { category: "audio", kind: "amr" });
});

test("CSDL không bị nhầm thành media", () => {
  assert.deepEqual(detect(bytes("SQLite format 3", 0)), { category: "database", kind: "sqlite" });
});

test("BMP cần thêm bằng chứng", () => {
  assert.equal(detect(bytes("BMxx", 1, 1, 1, 1)).category, "other");
  assert.equal(detect(bytes("BMxxxx", 0, 0, 0, 0)).category, "image");
  assert.equal(detect(bytes("BMxx", 1, 1, 1, 1), ".bmp").category, "image");
});

test("không rõ → other, giữ đuôi file", () => {
  assert.deepEqual(detect(bytes("hello world"), ".txt"), { category: "other", kind: "txt" });
  assert.deepEqual(detect(new Uint8Array()), { category: "other", kind: "" });
});
