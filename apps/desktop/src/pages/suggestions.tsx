import { HardDrive, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CleanupRequest } from "@/components/cleanup-dialog";
import { DiskCard } from "@/components/disk-card";
import { CATEGORY_LABEL, formatBytes } from "@/lib/api";
import { useStats, useSuggestions } from "@/lib/queries";

interface Props {
  rootId: number;
  readOnly: boolean;
  onCleanup: (r: CleanupRequest) => void;
}

export function SuggestionsPage({ rootId, readOnly, onCleanup }: Props) {
  const stats = useStats(rootId);
  const suggestions = useSuggestions(rootId);
  const total = stats.data?.total;
  const kinds = stats.data?.byCategory.slice(0, 4) ?? [];

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardDescription className="flex items-center gap-2">
            <HardDrive className="size-4" /> Media Zalo đang chiếm trên ổ đĩa
          </CardDescription>
          {total ? (
            <CardTitle className="text-4xl font-semibold tabular-nums">{formatBytes(total.bytes)}</CardTitle>
          ) : (
            <Skeleton className="h-10 w-40" />
          )}
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {stats.isPending
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-4 w-28" />)
            : kinds.map((b) => (
                <span key={b.key}>
                  {CATEGORY_LABEL[b.key] ?? b.key}: <b className="text-foreground tabular-nums">{formatBytes(b.bytes)}</b>
                </span>
              ))}
        </CardContent>
      </Card>
      <DiskCard rootId={rootId} />
      </div>

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-5" /> Gợi ý dọn nhanh
        </h2>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {suggestions.isPending
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)
            : suggestions.data?.map((s) => (
                <Card key={s.id} className={s.caution ? "border-amber-300" : undefined}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {s.title}
                      {s.caution && (
                        <Badge variant="outline" className="border-amber-400 text-amber-700">
                          <TriangleAlert /> Cân nhắc
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>{s.description}</CardDescription>
                    <CardAction>
                      <Button
                        variant={s.caution ? "outline" : "default"}
                        disabled={readOnly || s.count === 0}
                        onClick={() => onCleanup({ filter: s.filter, title: s.title, caution: s.caution })}
                      >
                        Xem & dọn
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold tabular-nums">{formatBytes(s.bytes)}</div>
                    <div className="text-muted-foreground text-sm">{s.count.toLocaleString("vi-VN")} file</div>
                  </CardContent>
                </Card>
              ))}
        </div>
        <p className="text-muted-foreground mt-3 text-sm">
          Muốn chọn kỹ từng hội thoại? Dùng tab <b>Theo hội thoại</b>.
        </p>
      </div>
    </div>
  );
}
