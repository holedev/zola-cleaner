/**
 * Nhận diện loại file dựa vào nội dung (magic bytes), không dựa vào tên.
 * Zalo đổi tên file thành chuỗi băm và thường bỏ đuôi file, nên đây là cách duy nhất đáng tin.
 */

export type Category =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "archive"
  | "database"
  | "other";

export interface Detection {
  category: Category;
  /** Định dạng cụ thể: jpg, png, mp4, heic, sqlite... ("" nếu không rõ) */
  kind: string;
}

/** Số byte đầu file cần đọc để nhận diện. */
export const HEADER_BYTES = 64;

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "mif1", "msf1", "avif", "avis"]);
const AUDIO_FTYP_BRANDS = new Set(["M4A ", "M4B ", "M4P "]);

function ascii(buf: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < Math.min(end, buf.length); i++) s += String.fromCharCode(buf[i]!);
  return s;
}

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * @param header  Các byte đầu file (nên có ít nhất HEADER_BYTES byte nếu file đủ dài)
 * @param ext     Đuôi file viết thường kèm dấu chấm (".bmp"), dùng làm gợi ý cho định dạng có chữ ký yếu
 */
export function detect(header: Uint8Array, ext = ""): Detection {
  const h = header;

  // Ảnh
  if (startsWith(h, [0xff, 0xd8, 0xff])) return { category: "image", kind: "jpg" };
  if (startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { category: "image", kind: "png" };
  if (ascii(h, 0, 4) === "GIF8") return { category: "image", kind: "gif" };
  if (ascii(h, 0, 4) === "RIFF" && ascii(h, 8, 12) === "WEBP") return { category: "image", kind: "webp" };
  // JPEG XL: codestream trần (FF 0A) hoặc container ISO BMFF có hộp "JXL "
  if (startsWith(h, [0xff, 0x0a]) || startsWith(h, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) {
    return { category: "image", kind: "jxl" };
  }
  // "BM" chỉ có 2 byte, rất dễ trùng → cần thêm 4 byte reserved = 0 hoặc đuôi .bmp
  if (ascii(h, 0, 2) === "BM" && (ext === ".bmp" || startsWith(h, [0, 0, 0, 0], 6))) {
    return { category: "image", kind: "bmp" };
  }

  // Họ ISO BMFF (MP4, MOV, HEIC, M4A...): byte 4–8 là "ftyp", byte 8–12 là brand
  if (ascii(h, 4, 8) === "ftyp") {
    const brand = ascii(h, 8, 12);
    if (HEIF_BRANDS.has(brand)) return { category: "image", kind: brand.startsWith("av") ? "avif" : "heic" };
    if (AUDIO_FTYP_BRANDS.has(brand)) return { category: "audio", kind: "m4a" };
    if (brand === "qt  ") return { category: "video", kind: "mov" };
    if (brand.startsWith("3g")) return { category: "video", kind: "3gp" };
    return { category: "video", kind: "mp4" };
  }

  // Video khác
  if (startsWith(h, [0x1a, 0x45, 0xdf, 0xa3])) return { category: "video", kind: "mkv" };
  if (ascii(h, 0, 4) === "RIFF" && ascii(h, 8, 12) === "AVI ") return { category: "video", kind: "avi" };
  if (ascii(h, 0, 3) === "FLV") return { category: "video", kind: "flv" };

  // Âm thanh (tin nhắn thoại...)
  if (ascii(h, 0, 6) === "#!AMR\n") return { category: "audio", kind: "amr" };
  if (ascii(h, 0, 4) === "OggS") return { category: "audio", kind: "ogg" };
  if (ascii(h, 0, 4) === "RIFF" && ascii(h, 8, 12) === "WAVE") return { category: "audio", kind: "wav" };
  if (ascii(h, 0, 3) === "ID3") return { category: "audio", kind: "mp3" };
  if (h.length >= 2 && h[0] === 0xff && (h[1]! & 0xf6) === 0xf0) return { category: "audio", kind: "aac" };
  if (h.length >= 2 && h[0] === 0xff && (h[1]! & 0xe0) === 0xe0) return { category: "audio", kind: "mp3" };

  // CSDL — KHÔNG BAO GIỜ được xoá
  if (ascii(h, 0, 16) === "SQLite format 3\0") return { category: "database", kind: "sqlite" };

  // Tài liệu & nén
  if (ascii(h, 0, 5) === "%PDF-") return { category: "document", kind: "pdf" };
  if (startsWith(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { category: "document", kind: "ole" };
  if (startsWith(h, [0x50, 0x4b, 0x03, 0x04])) {
    const officeExt: Record<string, string> = { ".docx": "docx", ".xlsx": "xlsx", ".pptx": "pptx" };
    const k = officeExt[ext];
    if (k) return { category: "document", kind: k };
    // Tên mục đầu tiên trong ZIP nằm ở byte 30 của local file header → nhận ra Office Open XML khi không có đuôi
    const first = ascii(h, 30, 30 + 19);
    if (first.startsWith("word/")) return { category: "document", kind: "docx" };
    if (first.startsWith("xl/")) return { category: "document", kind: "xlsx" };
    if (first.startsWith("ppt/")) return { category: "document", kind: "pptx" };
    if (first === "[Content_Types].xml") return { category: "document", kind: "office" };
    return { category: "archive", kind: "zip" };
  }
  if (ascii(h, 0, 4) === "Rar!") return { category: "archive", kind: "rar" };
  if (startsWith(h, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { category: "archive", kind: "7z" };

  return { category: "other", kind: ext.replace(/^\./, "") };
}

/** Khoá XOR Zalo dùng để "làm nhiễu" tài liệu trong thư mục fileNoise/. */
export const NOISE_KEY = 0x93;

/** Nhận diện file trong fileNoise/: giải XOR từng byte với NOISE_KEY rồi nhận diện như thường. */
export function detectNoise(header: Uint8Array, ext = ""): Detection {
  return detect(header.map((b) => b ^ NOISE_KEY), ext);
}
