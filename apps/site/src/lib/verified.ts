// Verified Version (CONTEXT.md) lấy thẳng từ lõi Rust lúc build, để landing luôn khớp với app.
import layoutRs from "../../../../crates/core/src/layout.rs?raw";

export function verifiedVersion(): string {
  const m = layoutRs.match(/VERIFIED_VERSION:\s*ZaloVersion\s*=\s*ZaloVersion\(\[(\d+),\s*(\d+),\s*(\d+)\]\)/);
  if (!m) throw new Error("Không tìm thấy VERIFIED_VERSION trong crates/core/src/layout.rs");
  return `${m[1]}.${m[2]}.${m[3]}`;
}
