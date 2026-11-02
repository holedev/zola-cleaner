// Landing page Zola Cleaner — HTML tĩnh, deploy lên GitHub Pages (.github/workflows/pages.yml).
import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  // Đổi sang tên miền riêng: sửa `site`, đặt `base` thành "/" và thêm public/CNAME.
  site: "https://holedev.github.io",
  base: "/zola-cleaner",
  trailingSlash: "always",
  integrations: [sitemap({ filter: (page) => !page.includes("/og/") })],
  vite: {
    plugins: [tailwindcss()],
    // Ảnh chụp nằm ở docs/screenshots và VERIFIED_VERSION ở crates/core — ngoài thư mục app
    server: { fs: { allow: [repoRoot] } },
  },
});
