"use client"

import { useEffect, useState } from "react"
import { loadDepartmentAllocationRelease } from "@/lib/services/department-allocation"

export function useDepartmentAllocationRelease() {
  const [release, setRelease] = useState<{ loading: boolean; cutoff: string | null; failed: boolean }>({
    loading: true, cutoff: null, failed: false,
  })
  useEffect(() => {
    let active = true
    loadDepartmentAllocationRelease().then(
      cutoff => { if (active) setRelease({ loading: false, cutoff, failed: false }) },
      () => { if (active) setRelease({ loading: false, cutoff: null, failed: true }) },
    )
    return () => { active = false }
  }, [])
  return release
}
