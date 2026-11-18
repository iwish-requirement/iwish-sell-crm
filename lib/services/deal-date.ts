const shanghaiDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" })

export function dealDateInputValue(value: string | null | undefined): string {
  if (!value) return ""
  const match = value.trim().match(/^(\d{4})([-/.年])(\d{1,2})([-/.月])(\d{1,2})日?(?:[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/)
  if (!match) return ""
  const [, year, separator, month, daySeparator, day, time, zone] = match
  if ((separator === "年") !== (daySeparator === "月")) return ""
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return ""
  if (!time) return date
  const clock = time.indexOf(":") === 1 ? `0${time}` : time
  const timestamp = new Date(`${date}T${clock}${zone ?? "+08:00"}`)
  return Number.isFinite(timestamp.getTime()) ? shanghaiDate.format(timestamp) : ""
}

export function formatDealDate(value: string | null | undefined): string {
  const date = dealDateInputValue(value)
  if (!date) return value ?? ""
  return date.split("-").map(Number).join("/")
}
