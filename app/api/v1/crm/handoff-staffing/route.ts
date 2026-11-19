import { NextResponse } from "next/server"

export function POST() {
  return NextResponse.json({ error: "OPS_INTEGRATION_DISABLED" }, { status: 503 })
}
