/**
 * Cài đặt: mọi đường dẫn ở một chỗ.
 * - Từng tài khoản: tên, thư mục dữ liệu Zalo, thùng rác.
 * - Chung: thư mục lưu bản sao lưu ZIP, thêm thư mục dữ liệu, nhật ký.
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CircleCheck,
  FileSearch,
  FileArchive,
  FileDown,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderX,
  HardDrive,
  RotateCcw,
  RefreshCw,
  ScrollText,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { AutoDownloadSteps } from "@/components/auto-download-tip";
import { useBlocking } from "@/components/blocking";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { accountName, api, errorMessage, formatBytes, type RootInfo, shortUid, type TrashSetting } from "@/lib/api";
import { keys, useHealth, useRoots } from "@/lib/queries";
import { checkForUpdate } from "@/lib/updater";

/** Gợi ý chung khi chọn thư mục dữ liệu Zalo. */
const DATA_PICK_HINT = '(ZaloData, "Zalo Data", media hoặc ZaloDownloads)';

export function SettingsPage() {
  const qc = useQueryClient();
  const blocking = useBlocking();
  const roots = useRoots();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  /** Tài khoản đã đăng nhập trên máy nhưng Zalo chưa tạo thư mục media (chưa có gì để dọn). */
  const noMedia = (accounts.data ?? []).filter((a) => !a.store);
  const s = settings.data;

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ["settings"] });
    await qc.invalidateQueries({ queryKey: keys.roots });
    await qc.invalidateQueries({ queryKey: ["index"] });
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      await refreshAll();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const addRoot = async () => {
    const dir = await open({ directory: true, title: `Chọn thư mục dữ liệu Zalo ${DATA_PICK_HINT}` });
    if (typeof dir === "string") await run(() => api.addRoot(dir), "Đã thêm thư mục dữ liệu Zalo");
  };

  const pickBackup = async () => {
    const dir = await open({ directory: true, title: "Chọn thư mục lưu bản sao lưu ZIP", defaultPath: s?.backupDir });
    if (typeof dir === "string") await run(() => api.setBackupDir(dir), "Đã đổi thư mục sao lưu");
  };

  const savedDirs = s?.savedDirs ?? [];
  const setSaved = (dirs: string[] | null, ok: string) => run(() => api.setSavedDirs(dirs), ok);
  const addSaved = async () => {
    const dir = await open({ directory: true, title: "Chọn thư mục bạn hay lưu file từ Zalo" });
    if (typeof dir === "string" && !savedDirs.includes(dir)) await setSaved([...savedDirs, dir], "Đã thêm thư mục. Đang tìm lại tên tài liệu…");
  };
  const refreshNames = () =>
    run(async () => {
      for (const r of roots.data ?? []) await api.refreshDocNames(r.id);
    }, "Đang tìm lại tên tài liệu ở chế độ nền…");

  const health = useHealth();
  const [checking, setChecking] = useState(false);
  const checkUpdate = async () => {
    setChecking(true);
    await checkForUpdate(false);
    setChecking(false);
  };
  const exportLog = async () => {
    const path = await save({ title: "Lưu nhật ký", defaultPath: "zola-cleaner-nhat-ky.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    try {
      await api.exportLog(path);
      toast.success("Đã lưu nhật ký (đã lược đường dẫn và ID).");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const exportReport = async (r: RootInfo) => {
    const path = await save({ title: "Lưu báo cáo cấu trúc", defaultPath: "zola-cleaner-bao-cao.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    try {
      await blocking.run("Đang lập báo cáo cấu trúc…", () => api.exportReport(r.id, path));
      toast.success("Đã lưu báo cáo. Báo cáo không chứa tên file, ID hay nội dung — bạn có thể gửi cho nhà phát triển.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid max-w-5xl gap-8">
      <section className="grid gap-3">
        <SectionTitle
          title={`Tài khoản Zalo trên máy (${(accounts.data?.length ?? roots.data?.length ?? 0).toLocaleString("vi-VN")})`}
          hint="App tự tìm dữ liệu Zalo ở vị trí mặc định và trên mọi ổ đĩa. Nếu bạn tự di chuyển thư mục bằng tay, bấm Đổi đường dẫn ở tài khoản đó."
        />
        {!roots.data || !s
          ? <Skeleton className="h-48 rounded-xl" />
          : roots.data.map((r) => (
              <AccountCard
                key={r.id}
                root={r}
                trash={s.trash.find((t) => t.rootId === r.id)}
                onChangePath={async () => {
                  const dir = await open({ directory: true, title: `Chọn vị trí mới cho ${accountName(r)} ${DATA_PICK_HINT}` });
                  if (typeof dir !== "string") return;
                  await run(async () => {
                    await api.setRootPath(r.id, dir);
                    await api.startScan(r.id);
                  }, `Đã đổi đường dẫn của ${accountName(r)}. Đang quét lại…`);
                }}
                onPickTrash={async (t) => {
                  const dir = await open({ directory: true, title: "Chọn thư mục làm thùng rác", defaultPath: t.dir });
                  if (typeof dir === "string") await run(() => api.setTrashDir(r.id, dir), "Đã đổi nơi lưu thùng rác");
                }}
                onDefaultTrash={() => run(() => api.setTrashDir(r.id, null), "Đã dùng lại thùng rác mặc định")}
                onReport={() => exportReport(r)}
              />
            ))}
        {noMedia.map((a) => (
          <div key={a.uid} className="text-muted-foreground flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm">
            <Badge variant="outline">Chưa có media</Badge>
            <span className="text-foreground font-medium">Tài khoản {shortUid(a.uid)}</span>
            <span>Đã đăng nhập trên máy nhưng chưa tải ảnh / file nào — không có gì để dọn.</span>
          </div>
        ))}
        <div>
          <Button variant="outline" onClick={addRoot}>
            <FolderPlus /> Thêm thư mục dữ liệu Zalo…
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <SectionTitle
          title="Tìm tên tài liệu"
          hint='Zalo lưu tài liệu dưới tên mã. App lấy lại tên thật bằng cách so với file bạn đã "Lưu về máy" trong các thư mục dưới đây; không có thì dùng tiêu đề ghi bên trong file PDF / Word / Excel.'
        />
        <Card className="py-4">
          <CardContent className="grid gap-3">
            {!s ? (
              <Skeleton className="h-10" />
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileSearch className="text-muted-foreground size-4" /> Thư mục bạn hay lưu file từ Zalo
                  <Badge variant={s.savedDirsDefault ? "secondary" : "outline"}>{s.savedDirsDefault ? "Mặc định" : "Tự chọn"}</Badge>
                </div>
                {savedDirs.length === 0 && <p className="text-muted-foreground text-sm">Chưa có thư mục nào.</p>}
                <ul className="grid gap-1">
                  {savedDirs.map((d) => (
                    <li key={d} className="flex items-center gap-2">
                      <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs" title={d}>
                        {d}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Bỏ thư mục này"
                        onClick={() => setSaved(savedDirs.filter((x) => x !== d), "Đã bỏ thư mục. Đang tìm lại tên tài liệu…")}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={addSaved}>
                    <FolderPlus /> Thêm thư mục…
                  </Button>
                  {!s.savedDirsDefault && (
                    <Button variant="ghost" size="sm" onClick={() => setSaved(null, "Đã dùng lại thư mục mặc định")}>
                      <RotateCcw /> Mặc định
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={refreshNames}>
                    <FileSearch /> Tìm lại tên
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <SectionTitle
          title="Bản sao lưu ZIP"
          hint='Nơi hộp thoại "Nén ZIP để sao lưu" mở sẵn. Bạn vẫn chọn được nơi khác mỗi lần nén (USB, ổ D, thư mục Google Drive / OneDrive…).'
        />
        <Card className="py-4">
          <CardContent>
            {!s ? (
              <Skeleton className="h-10" />
            ) : (
              <PathRow
                icon={<FileArchive />}
                label="Thư mục lưu ZIP"
                path={s.backupDir}
                badge={<Badge variant={s.backupIsDefault ? "secondary" : "outline"}>{s.backupIsDefault ? "Mặc định" : "Tự chọn"}</Badge>}
                actions={
                  <>
                    <Button variant="outline" size="sm" onClick={pickBackup}>
                      <FolderOpen /> Chọn thư mục…
                    </Button>
                    {!s.backupIsDefault && (
                      <Button variant="ghost" size="sm" onClick={() => run(() => api.setBackupDir(null), "Đã dùng lại thư mục mặc định")}>
                        <RotateCcw /> Mặc định
                      </Button>
                    )}
                  </>
                }
              />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <SectionTitle
          title="Giữ file Zalo không bị hết hạn"
          hint="Một tuỳ chọn có sẵn trong Zalo PC. Zola Cleaner không tự tải file thay Zalo được."
        />
        <Card>
          <CardContent>
            <AutoDownloadSteps />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <SectionTitle
          title="Hỗ trợ"
          hint="App không gửi dữ liệu nào của bạn ra ngoài; chỉ hỏi GitHub xem có bản mới không. Nhật ký chỉ được lưu vào file bạn chọn để gửi cho nhà phát triển khi gặp lỗi."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportLog}>
            <ScrollText /> Xuất nhật ký
          </Button>
          <Button variant="outline" disabled={checking} onClick={checkUpdate}>
            {checking ? <Spinner /> : <RefreshCw />} Kiểm tra bản mới
          </Button>
          {health.data && <span className="text-muted-foreground text-sm">Phiên bản {health.data.version}</span>}
        </div>
        <p className="text-muted-foreground text-xs">Zola Cleaner là phần mềm mã nguồn mở độc lập, không liên kết với Zalo hay VNG.</p>
      </section>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">{hint}</p>
    </div>
  );
}

/** Một dòng đường dẫn: nhãn, đường dẫn, ghi chú, nút. */
function PathRow({
  icon,
  label,
  path,
  badge,
  note,
  actions,
}: {
  icon: ReactNode;
  label: string;
  path: string;
  badge?: ReactNode;
  note?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
      <span className="text-muted-foreground mt-0.5 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {label} {badge}
        </div>
        <div className="text-muted-foreground truncate font-mono text-xs" title={path}>
          {path}
        </div>
        {note && <div className="mt-1 text-xs">{note}</div>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">{actions}</div>
    </div>
  );
}

function AccountCard({
  root: r,
  trash: t,
  onChangePath,
  onPickTrash,
  onDefaultTrash,
  onReport,
}: {
  root: RootInfo;
  trash?: TrashSetting;
  onChangePath: () => void;
  onPickTrash: (t: TrashSetting) => void;
  onDefaultTrash: () => void;
  onReport: () => void;
}) {
  const status = !r.exists ? (
    <Badge variant="outline" className="text-muted-foreground">
      <FolderX /> Không còn ở đây
    </Badge>
  ) : r.compatibility.status === "verified" ? (
    <Badge variant="secondary">
      <CircleCheck /> Dọn được
    </Badge>
  ) : r.compatibility.status === "untested" ? (
    <Badge variant="outline" className="border-amber-400 text-amber-700" title="Cấu trúc khớp, nhưng phiên bản Zalo PC chưa được kiểm chứng">
      <CircleCheck /> Dọn được · chưa kiểm chứng
    </Badge>
  ) : (
    <Badge variant="outline" className="border-amber-400 text-amber-700">
      <TriangleAlert /> Chỉ xem
    </Badge>
  );

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <AccountLabel root={r} />
        {status}
        <CardDescription className="font-mono text-xs">uid {shortUid(r.uid)}</CardDescription>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" disabled={!r.exists} onClick={onReport} title="Gửi cho nhà phát triển khi app báo Chỉ xem">
          <FileDown /> Xuất báo cáo cấu trúc
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <PathRow
          icon={<HardDrive />}
          label="Thư mục dữ liệu Zalo"
          path={r.path}
          note={
            !r.exists ? (
              <span className="text-amber-700">
                Thư mục này không còn — có thể bạn đã đổi "Vị trí lưu trữ" của Zalo hoặc tự di chuyển. Bấm Chọn vị trí mới.
              </span>
            ) : (
              <span className="text-muted-foreground">
                {[
                  `Zalo PC ${r.zaloVersion ?? "?"}`,
                  r.dbVersions.length ? `CSDL ${r.dbVersions.map((d) => `${d.name} ${d.version}`).join(", ")}` : null,
                  ...(r.layout.status === "unsupported" ? r.layout.reasons : []),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )
          }
          actions={
            <Button variant={r.exists ? "outline" : "default"} size="sm" onClick={onChangePath}>
              <FolderInput /> {r.exists ? "Đổi đường dẫn…" : "Chọn vị trí mới…"}
            </Button>
          }
        />
        {t && (
          <PathRow
            icon={<Archive />}
            label="Thùng rác"
            path={t.dir}
            badge={<Badge variant={t.isDefault ? "secondary" : "outline"}>{t.isDefault ? "Mặc định" : "Tự chọn"}</Badge>}
            note={
              <span className="text-muted-foreground flex flex-wrap items-center gap-x-2">
                {t.sameDrive ? (
                  <span className="flex items-center gap-1">
                    <Zap className="size-3" /> Cùng ổ với dữ liệu Zalo — chuyển tức thì
                  </span>
                ) : (
                  <span className="text-trash">Khác ổ — chép sang (chậm hơn), ổ Zalo trống ngay</span>
                )}
                {t.free != null && <span>· ổ này còn trống {formatBytes(t.free)}</span>}
                <span>· chỉ áp dụng cho lần dọn sau</span>
              </span>
            }
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => onPickTrash(t)}>
                  <FolderOpen /> Chọn thư mục…
                </Button>
                {!t.isDefault && (
                  <Button variant="ghost" size="sm" onClick={onDefaultTrash}>
                    <RotateCcw /> Mặc định
                  </Button>
                )}
              </>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Ô đặt tên dễ nhớ cho tài khoản (lưu khi rời ô hoặc nhấn Enter). */
function AccountLabel({ root }: { root: RootInfo }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(root.label ?? "");
  useEffect(() => setValue(root.label ?? ""), [root.label]);
  const saveLabel = async () => {
    if ((root.label ?? "") === value.trim()) return;
    try {
      await api.setRootLabel(root.id, value.trim() || null);
      await qc.invalidateQueries({ queryKey: keys.roots });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Input
      className="h-9 w-64 text-base font-semibold"
      value={value}
      placeholder={`Đặt tên (vd. "Zalo công việc")`}
      title="Tên dễ nhớ cho tài khoản này, chỉ lưu trong Zola Cleaner"
      onChange={(e) => setValue(e.target.value)}
      onBlur={saveLabel}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
