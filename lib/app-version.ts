// 全局应用版本号，用于在前端检测“是否有新版本已发布”。
// 约定：每次准备发布时，更新此常量和 crm-release-notes.ts 中的对应说明。
// 旧 Tab 会继续运行旧版 bundle，而通过 /api/version 获取到的新版本号将发生变化，
// 触发前端弹出“有新版本，请刷新”的提示。

export const APP_VERSION = "2026-11-27-01";
