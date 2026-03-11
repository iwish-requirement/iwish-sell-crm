import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";

export const runtime = "edge";

// 简单版本查询接口：返回当前部署的应用版本号。
// 供前端轮询使用，用于判断是否有新版本已发布。
export async function GET() {

  return new NextResponse(
    JSON.stringify({ version: APP_VERSION }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // 禁止中间层缓存，确保每次请求都命中当前部署版本
        "Cache-Control": "no-store",
      },
    },
  );
}
