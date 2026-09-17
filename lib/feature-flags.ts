/**
 * Runtime feature gates for changes that need a staged rollout.
 *
 * These values are intentionally public build-time variables. They control
 * navigation and UI exposure only; Supabase permissions remain authoritative
 * for all allocation reads and writes.
 */

/** Allocation center is GA. Set NEXT_PUBLIC_ALLOCATION_CENTER_NAV_ENABLED=false to hide it again. */
export const allocationCenterNavigationEnabled =
  process.env.NEXT_PUBLIC_ALLOCATION_CENTER_NAV_ENABLED !== "false"
