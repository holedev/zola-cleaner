/**
 * Worker thread giải mã JPEG XL → JPEG. Codec WASM chạy đồng bộ, nếu chạy trên luồng chính thì
 * mỗi ảnh chặn server hàng trăm ms (mọi request khác phải chờ).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

const require = createRequire(import.meta.url);

/** Tương đương ImageData của trình duyệt (lib DOM không bật trong core). */
type Img = { data: Uint8ClampedArray; width: number; height: number };

type Codecs = {
  decode: (buf: ArrayBuffer) => Promise<Img>;
  resize: (img: Img, opts: { width: number; height: number }) => Promise<Img>;
  encode: (img: Img, opts: { quality: number }) => Promise<ArrayBuffer>;
};

export interface JxlRequest {
  id: number;
  data: Uint8Array;
  size: number;
}

export type JxlResponse = { id: number; jpg: Uint8Array } | { id: number; error: string };

let codecs: Promise<Codecs> | undefined;

function loadCodecs(): Promise<Codecs> {
  codecs ??= (async () => {
    // Emscripten của jSquash cần ImageData — Node không có sẵn
    (globalThis as { ImageData?: unknown }).ImageData ??= class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    };
    // Nạp .wasm từ đĩa (mặc định jSquash dùng fetch, không chạy được trên Node). lib DOM không bật → tự khai báo kiểu.
    const { WebAssembly: WA } = globalThis as unknown as { WebAssembly: { Module: new (bytes: Uint8Array) => object } };
    const wasm = (spec: string) => new WA.Module(readFileSync(require.resolve(spec)));
    type Init = { init: (module: object) => Promise<unknown> };
    const jxl = await import("@jsquash/jxl/decode.js");
    const jpeg = await import("@jsquash/jpeg/encode.js");
    const resize = await import("@jsquash/resize");
    await (jxl as unknown as Init).init(wasm("@jsquash/jxl/codec/dec/jxl_dec.wasm"));
    await (jpeg as unknown as Init).init(wasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
    await resize.initResize(readFileSync(require.resolve("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm")));
    return { decode: jxl.default, resize: resize.default, encode: jpeg.default } as unknown as Codecs;
  })();
  return codecs;
}

async function convert(data: Uint8Array, size: number): Promise<Uint8Array> {
  const { decode, resize, encode } = await loadCodecs();
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const img = await decode(buf);
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  const small =
    scale < 1 ? await resize(img, { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }) : img;
  return new Uint8Array(await encode(small, { quality: 75 }));
}

// Mỗi worker xử lý tuần tự từng ảnh; luồng chính chỉ gửi việc mới khi worker rảnh.
parentPort?.on("message", (req: JxlRequest) => {
  convert(req.data, req.size).then(
    (jpg) => parentPort!.postMessage({ id: req.id, jpg } satisfies JxlResponse, [jpg.buffer as ArrayBuffer]),
    (err: unknown) => parentPort!.postMessage({ id: req.id, error: String(err) } satisfies JxlResponse),
  );
});
