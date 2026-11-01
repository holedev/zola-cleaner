/**
 * Giải mã JPEG XL → thumbnail JPEG bằng các codec WASM của jSquash (không cần build native trên Windows).
 * Zalo lưu phần lớn ảnh dạng .jxl, trình duyệt chưa hiển thị được.
 * Việc giải mã chạy trong worker thread (jxl-worker.ts) để không chặn server.
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { JxlRequest, JxlResponse } from "./jxl-worker.ts";

/** Cạnh dài nhất của thumbnail, px. */
export const THUMB_SIZE = 320;

/** Số worker: tối đa 2, chừa ít nhất một nhân cho server. Mỗi worker giữ một bộ codec WASM (~vài chục MB). */
const POOL_SIZE = Math.max(1, Math.min(2, availableParallelism() - 1));

interface Task {
  req: JxlRequest;
  resolve: (jpg: Uint8Array) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  task?: Task;
}

const slots: Slot[] = [];
const waiting: Task[] = [];
let nextId = 1;

function spawn(): Slot {
  const slot: Slot = { worker: new Worker(new URL("./jxl-worker.ts", import.meta.url)) };
  slot.worker.on("message", (res: JxlResponse) => {
    const task = slot.task;
    slot.task = undefined;
    if (task) {
      if ("jpg" in res) task.resolve(res.jpg);
      else task.reject(new Error(res.error));
    }
    pump();
  });
  slot.worker.on("error", (err) => {
    // Worker chết (hết bộ nhớ…) → bỏ slot, việc đang làm báo lỗi, slot mới sẽ được tạo khi cần
    slots.splice(slots.indexOf(slot), 1);
    slot.task?.reject(err);
    pump();
  });
  slots.push(slot);
  return slot;
}

function pump() {
  while (waiting.length > 0) {
    const slot = slots.find((s) => !s.task) ?? (slots.length < POOL_SIZE ? spawn() : undefined);
    if (!slot) break;
    const task = waiting.shift()!;
    slot.task = task;
    slot.worker.ref();
    slot.worker.postMessage(task.req);
  }
  // Worker rảnh không giữ tiến trình sống (test, CLI thoát được)
  for (const s of slots) if (!s.task) s.worker.unref();
}

export function jxlToJpeg(data: Uint8Array, size = THUMB_SIZE): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    waiting.push({ req: { id: nextId++, data, size }, resolve, reject });
    pump();
  });
}
