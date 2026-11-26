"use client"

import { ChevronRight, History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { APP_VERSION } from "@/lib/app-version"
import { crmReleaseNotes } from "@/lib/crm-release-notes"

export function CrmUpdates() {
  const releases = crmReleaseNotes.filter(({ version }) => version <= APP_VERSION)

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm"
          className="size-9 border-transparent bg-transparent p-0 shadow-none lg:h-8 lg:w-auto lg:border-border lg:bg-background lg:px-2.5 lg:shadow-xs">
          <History aria-hidden="true" className="size-5 lg:size-4" />
          <span className="sr-only lg:not-sr-only">更新内容</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6">
          <SheetTitle className="text-lg">更新内容</SheetTitle>
          <SheetDescription>当前版本 {APP_VERSION}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          {releases.length === 0 && <p className="text-sm text-muted-foreground">暂无版本更新说明。</p>}
          {releases.map((release, index) => (
            <details key={release.version} open={index === 0} className="group rounded-lg border bg-card">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground group-open:rotate-90" />
                <span className="space-y-1">
                  <span className="block text-sm font-semibold">{release.title}</span>
                  <Badge variant="outline" className="font-mono text-xs">{release.version}</Badge>
                </span>
              </summary>
              <div className="divide-y border-t px-4">
                {release.changes.map((change) => (
                  <section key={change.title} className="space-y-2 py-4">
                    <h3 className="text-sm font-semibold">{change.title}</h3>
                    <dl className="space-y-2 text-sm leading-relaxed">
                      <div className="flex items-start gap-3">
                        <dt className="shrink-0 text-muted-foreground">原来</dt>
                        <dd>{change.before}</dd>
                      </div>
                      <div className="flex items-start gap-3">
                        <dt className="shrink-0 font-medium">现在</dt>
                        <dd>{change.after}</dd>
                      </div>
                      <div className="flex items-start gap-3 rounded-md bg-muted px-3 py-2">
                        <dt className="shrink-0 text-muted-foreground">举例</dt>
                        <dd>{change.example}</dd>
                      </div>
                    </dl>
                  </section>
                ))}
              </div>
            </details>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
