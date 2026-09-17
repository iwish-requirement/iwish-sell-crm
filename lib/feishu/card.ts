// 分配确认卡片的构建：发送给项目负责人的选人卡片 + 确认后的结果卡片。
// 卡片回调通过 feishu_card_messages(message_id -> assignment_id) 定位分配单，
// 卡片内只承载人员选择，不承载路由信息。

export const ROLE_FIELDS: [string, string][] = [
  ["google_optimizer_ids", "Google 优化师"],
  ["meta_optimizer_ids", "Meta 优化师"],
  ["criteo_optimizer_ids", "Criteo 优化师"],
  ["bing_optimizer_ids", "Bing 优化师"],
  ["edm_optimizer_ids", "EDM 营销/优化师"],
  ["influencer_marketing_ids", "红人/联盟营销"],
]

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google",
  meta: "Meta",
  criteo: "Criteo",
  bing: "Bing",
  edm: "EDM",
  influencer: "红人/联盟营销",
}

export function platformLabel(key: string): string {
  return PLATFORM_LABELS[key] ?? key
}

export type AllocationCardPayload = {
  companyName: string
  customerName?: string | null
  departmentName?: string | null
  salesOwnerName?: string | null
  platforms: string[]
  note?: string | null
}

export function buildAllocationConfirmCard(payload: AllocationCardPayload): unknown {
  const lines = [
    `**部门/项目组**：${payload.departmentName || "-"}`,
    `**成交销售**：${payload.salesOwnerName || "-"}`,
  ]
  if (payload.platforms.length) {
    lines.push(`**投放平台**：${payload.platforms.map(platformLabel).join("、")}`)
  }
  if (payload.note) {
    lines.push(`**备注**：${payload.note}`)
  }

  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: `项目组分配确认 · ${payload.companyName}` },
      subtitle: { tag: "plain_text", content: "请选择各角色执行成员并提交，CRM 将自动记录" },
      template: "blue",
    },
    body: {
      elements: [
        { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } },
        { tag: "hr" },
        { tag: "div", text: { tag: "lark_md", content: "请在下方各角色中选择执行成员，选完点击「提交团队名单」。" } },
        {
          tag: "form",
          name: "team_form",
          elements: [
            ...ROLE_FIELDS.flatMap(([key, label]) => [
              { tag: "div", text: { tag: "lark_md", content: `**${label}**` } },
              {
                tag: "multi_select_person",
                name: key,
                placeholder: { tag: "plain_text", content: `选择${label}` },
              },
            ]),
            {
              tag: "button",
              text: { tag: "plain_text", content: "提交团队名单" },
              type: "primary",
              form_action_type: "submit",
              behaviors: [{ type: "callback" }],
              name: "submit_team",
            },
          ],
        },
      ],
    },
  }
}

export function buildAllocationConfirmedCard(payload: {
  companyName: string
  roleNames: Record<string, string[]>
  confirmedBy?: string | null
}): unknown {
  const sections = ROLE_FIELDS.map(([key, label]) => {
    const names = payload.roleNames[key] ?? []
    return `${label}：${names.length ? names.join("、") : "未指定"}`
  })

  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: `✅ 团队名单已确认 · ${payload.companyName}` },
      subtitle: { tag: "plain_text", content: "名单已写入 CRM 分配中心" },
      template: "green",
    },
    body: {
      elements: [
        { tag: "div", text: { tag: "lark_md", content: sections.join("\n") } },
      ],
    },
  }
}
