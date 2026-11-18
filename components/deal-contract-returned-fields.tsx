export function DealContractReturnedFields({ title, fields, status }: {
  title: string
  fields: ReadonlyArray<readonly [label: string, value: string | undefined]>
  status?: string
}) {
  return (
    <section className="space-y-3 border-t pt-4" aria-label={title}>
      <h3 className="font-semibold">{title}</h3>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      <dl className="grid gap-4 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0 space-y-1">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="min-h-5 whitespace-pre-wrap break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
