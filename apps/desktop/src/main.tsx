import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BlockingProvider } from "@/components/blocking";
import { ImageViewerProvider } from "@/components/image-viewer";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // App desktop, dữ liệu chỉ đổi khi chính app quét / dọn → không tự tải lại khi focus cửa sổ
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
  },
});

// Chế độ demo (chụp ảnh README): giả lập lõi Rust bằng dữ liệu bịa. Bản build thường không chứa đoạn này.
const ready = import.meta.env.MODE === "demo" ? import("./demo/mock").then((m) => m.installDemo()) : Promise.resolve();

void ready.then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BlockingProvider>
            <ImageViewerProvider>
              <App />
            </ImageViewerProvider>
          </BlockingProvider>
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  ),
);
