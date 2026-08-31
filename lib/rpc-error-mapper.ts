export type RpcErrorLike = {
  message?: string | null
}

export type RpcErrorKind =
  | "no_permission"
  | "out_of_scope"
  | "field_forbidden"
  | "validation"
  | "not_found"
  | "invalid_status"
  | "unknown"

export type RpcErrorFriendly = {
  kind: RpcErrorKind
  title: string
  description: string
  canRetry: boolean
  permissionKey?: string
  rawMessage: string
}

function normalizeMessage(error: RpcErrorLike | null | undefined): string {
  if (!error) return ""
  const msg = error.message
  return typeof msg === "string" ? msg : ""
}

export function mapRpcError(
  error: RpcErrorLike | null | undefined,
  fallback: { title?: string; description?: string } = {},
): RpcErrorFriendly {
  const rawMessage = normalizeMessage(error)
  const title = fallback.title ?? "操作失败"
  const description = fallback.description ?? "请稍后重试"

  const noPerm = rawMessage.match(/ERR_NO_PERMISSION:([a-zA-Z0-9_.-]+)/)
  if (noPerm) {
    const permissionKey = noPerm[1]
    return {
      kind: "no_permission",
      title: "权限不足",
      description: `当前账号缺少必要权限：${permissionKey}。如需调整权限配置，请联系系统管理员后重试。`,

      canRetry: false,
      permissionKey,
      rawMessage,
    }
  }

  const outOfScope = rawMessage.match(/ERR_OUT_OF_SCOPE:([a-zA-Z0-9_.-]+)/)
  if (outOfScope) {
    return {
      kind: "out_of_scope",
      title: "超出数据范围",
      description: "当前账号的数据范围不足以执行该操作，请切换到有权限的账号或联系管理员。",
      canRetry: false,
      rawMessage,
    }
  }

  const fieldForbidden = rawMessage.match(/ERR_FIELD_FORBIDDEN:([a-zA-Z0-9_.-]+)/)
  if (fieldForbidden) {
    const permissionKey = fieldForbidden[1]
    let descriptionText = "当前账号不允许修改该字段或该字段需要更高权限，请联系管理员。"

    if (permissionKey === "leads.fields.write_sensitive") {
      descriptionText =
        "当前账号没有编辑敏感字段（电话 / 邮箱 / 预算等）的权限。请在「系统设置 - 角色权限」中为对应角色开启 leads.fields.write_sensitive，或联系系统管理员。"
    } else if (permissionKey === "leads.fields.write_internal") {
      descriptionText =
        "当前账号没有编辑内部字段（内部评分 / 黑名单原因等）的权限，请联系系统管理员调整权限配置。"
    }

    return {
      kind: "field_forbidden",
      title: "字段权限不足",
      description: descriptionText,
      canRetry: false,
      permissionKey,
      rawMessage,
    }
  }


  const validation = rawMessage.match(/ERR_VALIDATION:([a-zA-Z0-9_.-]+)/)
  if (validation) {
    const code = validation[1]

    if (code === "assign_cross_team_use_transfer") {
      return {
        kind: "validation",
        title: "请使用“跨团队转移”",
        description:
          "当前操作会把线索从一个团队分配到另一个团队，请改用“跨团队转移”功能，确保团队归属和权限范围正确。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "assign_requires_team") {
      return {
        kind: "validation",
        title: "目标成员未配置团队",
        description:
          "被分配的成员还没有关联到任何团队，请先在「系统设置 - 组织与成员」中为其设置团队后再尝试分配。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "transfer_requires_team") {
      return {
        kind: "validation",
        title: "新团队信息不完整",
        description:
          "跨团队转移线索时需要为新负责人选择所在团队，请在操作面板中补全团队信息后再试。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "new_owner_team_mismatch") {
      return {
        kind: "validation",
        title: "新负责人不属于目标团队",
        description:
          "你选择的新负责人所在团队与目标团队不一致，请重新选择团队或负责人，保证两者属于同一团队。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "owner_requires_team") {
      return {
        kind: "validation",
        title: "负责人未配置团队",
        description:
          "线索负责人还没有关联到任何团队，请先在「系统设置 - 组织与成员」中为其设置团队后再创建或更新线索。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "team_mismatch_on_create") {
      return {
        kind: "validation",
        title: "创建线索超出团队范围",
        description:
          "在“本人/本团队数据”范围下，只能为本团队创建线索，请确认负责人归属团队或调整数据范围后再试。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "responsibility_type_required") {
      return {
        kind: "validation",
        title: "请选择一级来源",
        description: "一级来源（责任归因）为必填项，未填写时无法保存。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "secondary_source_required_for_company_resource") {
      return {
        kind: "validation",
        title: "请选择二级来源",
        description: "当一级来源为公司分配资源时，必须选择二级来源。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "dev_method_required_for_sales_self") {
      return {
        kind: "validation",
        title: "请选择开发方式",
        description: "当一级来源为销售自主开发时，必须填写开发方式。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "referral_info_required_for_customer_referral") {
      return {
        kind: "validation",
        title: "请补全转介绍信息",
        description: "当一级来源为客户转介绍时，必须填写来源客户和转介绍类型。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "allocation_required_fields") {
      return {
        kind: "validation",
        title: "分配信息不完整",
        description: "请选择部门/项目组和项目负责人后再保存。",
        canRetry: false,
        rawMessage,
      }
    }

    if (code === "allocation_requires_won_deal") {
      return {
        kind: "validation",
        title: "仅成交客户可分配",
        description: "只有成交中心中的成交客户才能进入项目组分配。",
        canRetry: false,
        rawMessage,
      }
    }

    return {

      kind: "validation",
      title: "参数校验失败",
      description: "提交的参数不符合要求，请检查输入后重试。",
      canRetry: false,
      rawMessage,
    }
  }


  const invalidStatus = rawMessage.match(/ERR_INVALID_STATUS:([a-zA-Z0-9_.-]+)/)
  if (invalidStatus) {
    const code = invalidStatus[1]

    if (code === "cannot_change_source_when_closed") {
      return {
        kind: "invalid_status",
        title: "当前线索已锁定来源",
        description: "成交或关闭后的线索不允许再修改一级来源、二级来源或相关归因字段。",
        canRetry: false,
        rawMessage,
      }
    }

    return {
      kind: "invalid_status",
      title: "状态不允许",
      description: "当前状态不允许执行该操作，请刷新页面后重试。",
      canRetry: true,
      rawMessage,
    }
  }


  const notFound = rawMessage.match(/ERR_NOT_FOUND:([a-zA-Z0-9_.-]+)/)
  if (notFound) {
    return {
      kind: "not_found",
      title: "资源不存在",
      description: "目标数据不存在或已被删除，请刷新后重试。",
      canRetry: true,
      rawMessage,
    }
  }

  if (/(Failed to fetch|NetworkError|fetch failed)/i.test(rawMessage)) {
    return {
      kind: "unknown",
      title: "网络异常",
      description: "网络连接异常，请检查网络后重试。",
      canRetry: true,
      rawMessage,
    }
  }

  return {
    kind: "unknown",
    title,
    description,
    canRetry: true,
    rawMessage,
  }
}
