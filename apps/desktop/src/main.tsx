import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BlockingProvider } from "@/components/blocking";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // App desktop, dữ liệu chỉ đổi khi chính app quét / dọn → không tự tải lại khi focus cửa sổ
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BlockingProvider>
          <App />
        </BlockingProvider>
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
