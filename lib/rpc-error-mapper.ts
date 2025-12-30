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
      title: "没有权限",
      description: `缺少权限：${permissionKey}。请联系管理员开通后重试。`,
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
