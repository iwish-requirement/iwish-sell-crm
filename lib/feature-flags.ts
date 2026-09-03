/**
 * Runtime feature gates for changes that need a staged rollout.
 *
 * These values are intentionally public build-time variables. They control
 * navigation and UI exposure only; Supabase permissions remain authoritative
 * for all allocation reads and writes.
 */

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/** Keep the allocation navigation hidden in production until the flow is closed. */
export const allocationCenterNavigationEnabled =
  process.env.NEXT_PUBLIC_ALLOCATION_CENTER_NAV_ENABLED === "true"

const betaEmails = parseList(
  process.env.NEXT_PUBLIC_ALLOCATION_CENTER_BETA_EMAILS || "lin88@iwishweb.com",
)
const betaUserIds = parseList(process.env.NEXT_PUBLIC_ALLOCATION_CENTER_BETA_USER_IDS)

// Names are optional and intended only for environments where the account
// email is not available to the client. Matching is case-insensitive.
const betaNames = parseList(process.env.NEXT_PUBLIC_ALLOCATION_CENTER_BETA_NAMES)

export type AllocationBetaIdentity = {
  id?: string | null
  email?: string | null
  fullName?: string | null
}

export function isAllocationCenterBetaUser(identity: AllocationBetaIdentity | null | undefined): boolean {
  if (!identity) return false

  const id = identity.id?.trim().toLowerCase()
  const email = identity.email?.trim().toLowerCase()
  const fullName = identity.fullName?.trim().toLowerCase()

  return Boolean(
    (id && betaUserIds.includes(id)) ||
      (email && betaEmails.includes(email)) ||
      (fullName && betaNames.includes(fullName)),
  )
}
