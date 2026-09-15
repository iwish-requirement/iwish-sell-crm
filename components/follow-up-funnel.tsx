"use client"

// 漏斗按当前跟进阶段的真实存量数据绘制：层宽按数量比例、设最小可见宽度，
// 数据有起伏（如成交多于审合同）时如实呈现，数据真实优先于形状漂亮。
const BAND_COLORS = [
  "#94a3b8",
  "#60a5fa",
  "#38bdf8",
  "#818cf8",
  "#f59e0b",
  "#fb923c",
  "#f87171",
  "#22c55e",
  "#15803d",
]

export interface FunnelBand {
  stageId: string
  label: string
  count: number
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN")
}

export function FollowUpFunnel({ bands, total }: { bands: FunnelBand[]; total: number }) {
  const max = Math.max(...bands.map((band) => band.count), 1)

  if (bands.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        暂无漏斗数据
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {bands.map((band, index) => {
        const prevCount = index > 0 ? bands[index - 1].count : null
        const conversionRate =
          prevCount !== null && prevCount > 0 ? `${((band.count / prevCount) * 100).toFixed(1)}%` : null
        const widthPct = Math.max((band.count / max) * 100, band.count > 0 ? 4 : 1.5)
        const share = total > 0 ? `${((band.count / total) * 100).toFixed(1)}%` : "0.0%"

        return (
          <div key={band.stageId}>
            {index > 0 && (
              <div className="pl-1 text-[11px] leading-4 text-muted-foreground">
                <span className="inline-block w-28 text-right">↓ 环节转化 {conversionRate ?? "—"}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-right text-sm font-medium text-foreground">{band.label}</span>
              <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted/50">
                <div
                  className="h-7 rounded-md"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: BAND_COLORS[index % BAND_COLORS.length],
                    opacity: band.count > 0 ? 1 : 0.4,
                  }}
                  title={`${band.label}：${formatCount(band.count)} 条（占 ${share}）`}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                {formatCount(band.count)}
              </span>
              <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{share}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
