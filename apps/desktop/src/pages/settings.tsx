/** Cài đặt: nơi lưu thùng rác (từng tài khoản) và thư mục mặc định cho bản sao lưu ZIP. */
import { open } from "@tauri-apps/plugin-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileArchive, FolderOpen, RotateCcw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { accountName, api, errorMessage, formatBytes, type TrashSetting } from "@/lib/api";
import { useRoots } from "@/lib/queries";

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const roots = useRoots();
  const refresh = () => qc.invalidateQueries({ queryKey: ["settings"] });

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      await refresh();
      await qc.invalidateQueries({ queryKey: ["index"] });
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const pickTrash = async (t: TrashSetting) => {
    const dir = await open({ directory: true, title: "Chọn thư mục làm thùng rác", defaultPath: t.dir });
    if (typeof dir === "string") await run(() => api.setTrashDir(t.rootId, dir), "Đã đổi nơi lưu thùng rác");
  };

  const pickBackup = async () => {
    const dir = await open({ directory: true, title: "Chọn thư mục lưu bản sao lưu ZIP", defaultPath: settings.data?.backupDir });
    if (typeof dir === "string") await run(() => api.setBackupDir(dir), "Đã đổi thư mục sao lưu");
  };

  const s = settings.data;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="size-5" /> Nơi lưu thùng rác
          </CardTitle>
          <CardDescription>
            Mặc định thùng rác nằm cùng ổ với dữ liệu Zalo nên chuyển vào thùng rác là tức thì. Chọn thư mục ở ổ khác thì app sẽ
            chép file sang rồi xoá bản gốc: chậm hơn với nhiều GB, nhưng ổ chứa Zalo trống ra ngay. Thay đổi chỉ áp dụng cho lần
            dọn sau — file đang trong thùng rác vẫn ở chỗ cũ và khôi phục bình thường.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!s
            ? Array.from({ length: 1 }, (_, i) => <Skeleton key={i} className="h-16" />)
            : s.trash.map((t) => {
                const root = roots.data?.find((r) => r.id === t.rootId);
                return (
                  <div key={t.rootId} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <span className="w-44 font-medium">{root ? accountName(root) : `Tài khoản #${t.rootId}`}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs" title={t.dir}>
                        {t.dir}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={t.isDefault ? "secondary" : "outline"}>{t.isDefault ? "Mặc định" : "Tự chọn"}</Badge>
                        {t.sameDrive ? (
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Zap className="size-3" /> Cùng ổ với dữ liệu Zalo — chuyển tức thì
                          </span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">
                            Khác ổ với dữ liệu Zalo — chép sang (chậm hơn), ổ Zalo trống ngay
                          </span>
                        )}
                        {t.free != null && <span className="text-muted-foreground">· Ổ này còn trống {formatBytes(t.free)}</span>}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => pickTrash(t)}>
                      <FolderOpen /> Chọn thư mục…
                    </Button>
                    {!t.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => run(() => api.setTrashDir(t.rootId, null), "Đã dùng lại thùng rác mặc định")}
                      >
                        <RotateCcw /> Dùng mặc định
                      </Button>
                    )}
                  </div>
                );
              })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="size-5" /> Thư mục lưu bản sao lưu ZIP
          </CardTitle>
          <CardDescription>
            Nơi hộp thoại "Nén ZIP để sao lưu" mở sẵn. Bạn vẫn có thể chọn nơi khác mỗi lần nén (USB, ổ D, thư mục Google Drive /
            OneDrive…).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!s ? (
            <Skeleton className="h-12" />
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs" title={s.backupDir}>
                  {s.backupDir}
                </div>
                <Badge className="mt-1" variant={s.backupIsDefault ? "secondary" : "outline"}>
                  {s.backupIsDefault ? "Mặc định" : "Tự chọn"}
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={pickBackup}>
                <FolderOpen /> Chọn thư mục…
              </Button>
              {!s.backupIsDefault && (
                <Button variant="ghost" size="sm" onClick={() => run(() => api.setBackupDir(null), "Đã dùng lại thư mục mặc định")}>
                  <RotateCcw /> Dùng mặc định
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
