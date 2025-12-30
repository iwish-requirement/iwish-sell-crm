import type { RpcErrorFriendly } from "@/lib/rpc-error-mapper"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AlertTriangle } from "lucide-react"

export function RpcErrorBanner({
  error,
  onRetry,
  onDismiss,
  retryLabel = "重试",
  className,
}: {
  error: RpcErrorFriendly
  onRetry?: () => void
  onDismiss?: () => void
  retryLabel?: string
  className?: string
}) {
  return (
    <Alert variant="destructive" className={cn("w-full", className)}>
      <AlertTriangle />
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>
        <p>{error.description}</p>
        {(onRetry || onDismiss) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
            {onDismiss && (
              <Button size="sm" variant="outline" onClick={onDismiss}>
                关闭
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
