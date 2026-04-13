function extractCode(message: string, prefix: string) {
  const match = message.match(new RegExp(`${prefix}:([a-zA-Z0-9_.-]+)`))
  return match?.[1] ?? null
}

export function mapLeadImportErrorMessage(raw: string) {
  const message = String(raw ?? "").trim()
  if (!message) {
    return "导入失败，请稍后重试"
  }

  const validationCode = extractCode(message, "ERR_VALIDATION")
  if (validationCode) {
    switch (validationCode) {
      case "empty_import_rows":
        return "没有可导入的数据行"
      case "invalid_stage":
        return "阶段字段不合法"
      case "invalid_status":
        return "状态字段不合法"
      case "team_mismatch_on_create":
        return "负责人不在当前可创建范围内，请检查团队归属和分配方式"
      case "business_type_required":
        return "业务类型不能为空"
      case "invalid_business_type":
        return "业务类型未匹配到系统中的有效选项，请使用“一级分类 / 业务类型”的完整名称"
      case "invalid_business_category":
        return "业务类型关联的业务分类无效，请检查系统设置"
      case "responsibility_type_required":
        return "责任归因不能为空"
      case "secondary_source_required_for_company_resource":
        return "责任归因为公司分配资源时，必须填写二级来源"
      case "dev_method_required_for_sales_self":
        return "责任归因为销售自主开发时，必须填写开发方式"
      case "referral_info_required_for_customer_referral":
        return "责任归因为客户转介绍时，必须填写转介绍客户名称和转介绍类型"
      default:
        return `导入校验未通过：${validationCode}`
    }
  }

  const noPermissionCode = extractCode(message, "ERR_NO_PERMISSION")
  if (noPermissionCode) {
    switch (noPermissionCode) {
      case "leads.create":
        return "当前账号没有线索创建权限"
      default:
        return `当前账号缺少权限：${noPermissionCode}`
    }
  }

  const fieldForbiddenCode = extractCode(message, "ERR_FIELD_FORBIDDEN")
  if (fieldForbiddenCode) {
    switch (fieldForbiddenCode) {
      case "write_sensitive_required":
      case "leads.fields.write_sensitive":
        return "当前账号没有敏感字段写入权限，不能导入电话、邮箱、地址或预算等敏感信息"
      case "leads.fields.write_internal":
        return "当前账号没有内部字段写入权限"
      default:
        return `当前账号没有字段写入权限：${fieldForbiddenCode}`
    }
  }

  const notFoundCode = extractCode(message, "ERR_NOT_FOUND")
  if (notFoundCode) {
    return `目标数据不存在：${notFoundCode}`
  }

  const outOfScopeCode = extractCode(message, "ERR_OUT_OF_SCOPE")
  if (outOfScopeCode) {
    return `当前账号超出数据范围：${outOfScopeCode}`
  }

  if (/duplicate/i.test(message)) {
    return "存在重复数据，请检查是否已导入过相同线索"
  }

  return message
}
