import assert from "node:assert/strict"
import test from "node:test"
import {
  DEAL_CONTRACT_FIELDS,
  DEAL_FINANCE_FIELDS,
  DEAL_CONTRACT_SERVICES,
  dealContractSubmissionErrors,
  isDealContractFieldVisible,
  normalizeDealWebsite,
} from "../../lib/services/deal-contract-fields.ts"
import { dealDateInputValue, formatDealDate } from "../../lib/services/deal-date.ts"

const completed = Object.fromEntries(DEAL_CONTRACT_FIELDS.map(([key, , kind]) => [
  key, kind === "date" ? "2026-12-03" : kind === "amount" ? "0" : "已填写",
]))
Object.assign(completed, {
  actualPayment: "未到账，待财务确认",
  website: "https://shop.example.com",
  currency: "CNY",
  email: "customer@example.com",
  cooperation: "spend_ratio",
  spendRatio: "15",
  services: { performance: ["pinterest", "tiktok", "ctv"], brand: ["edm"], website: [] },
})

test("normalizes pasted URLs and retains subdomains and the no-website answer", () => {
  assert.equal(normalizeDealWebsite(" https://shop.EXAMPLE.com/orders?a=one "), "https://shop.example.com")
  assert.equal(normalizeDealWebsite("www.example.com"), "https://www.example.com")
  assert.equal(normalizeDealWebsite("暂无网站"), "暂无网站")
  assert.equal(normalizeDealWebsite("javascript://example.com"), null)
  assert.equal(normalizeDealWebsite("user@site.example.com"), null)
})

test("a complete submission can state it has not been paid and has no bonus", () => {
  assert.deepEqual(dealContractSubmissionErrors(completed, 1), [])
})

test("requires both company names and limits selectable contract currencies", () => {
  assert.deepEqual(dealContractSubmissionErrors({
    ...completed, mainlandCompanyName: " ", hongKongCompanyName: "", currency: "HKD",
  }, 1), ["大陆公司", "香港公司", "币种"])
  assert.deepEqual(dealContractSubmissionErrors({
    ...completed, mainlandCompanyName: "大陆 1#（演示）", hongKongCompanyName: "HK & Demo / 2", currency: "USD",
  }, 1), [])
})

test("only the applicable fee fields are visible and required", () => {
  const fixed = { ...completed, cooperation: "fixed_quarter", spendRatio: "", bonusAmount: "", bonusTerms: "" }
  assert.deepEqual(dealContractSubmissionErrors(fixed, 1), [])
  assert.equal(isDealContractFieldVisible("bonusAmount", fixed.cooperation), false)
  assert.equal(isDealContractFieldVisible("spendRatio", fixed.cooperation), false)

  const bonus = { ...fixed, cooperation: "base_bonus" }
  assert.deepEqual(dealContractSubmissionErrors(bonus, 1), ["激励奖金的金额", "激励奖金的条件"])
  assert.equal(isDealContractFieldVisible("bonusAmount", bonus.cooperation), true)
  assert.equal(isDealContractFieldVisible("bonusTerms", bonus.cooperation), true)
  assert.deepEqual(dealContractSubmissionErrors({ ...bonus, bonusAmount: "500", bonusTerms: "达到约定目标" }, 1), [])
})

test("spend-based cooperation requires a percentage above zero and at most one hundred", () => {
  for (const invalid of ["", "abc", "0", "-1", "100.01"]) {
    assert.deepEqual(dealContractSubmissionErrors({ ...completed, spendRatio: invalid }, 1), ["消耗比例"])
  }
  assert.deepEqual(dealContractSubmissionErrors({ ...completed, spendRatio: ".5", bonusAmount: "", bonusTerms: "" }, 1), [])
  assert.deepEqual(dealContractSubmissionErrors({ ...completed, spendRatio: "100" }, 1), [])
})

test("confirmation requires sales fields, applicable service options, and a file", () => {
  assert.deepEqual(dealContractSubmissionErrors({
    ...completed,
    phone: "",
    services: { performance: [], creative: [] },
  }, 0), ["客户联系人电话", "效果营销服务小类", "客户售前信息和售后目标附件"])
})

test("service options keep the agreed categories and omit affiliate marketing", () => {
  assert.deepEqual(DEAL_CONTRACT_SERVICES.map(({ options }) => options.map(([key]) => key)), [
    ["google", "meta", "criteo", "bing", "pinterest", "tiktok", "ctv"],
    ["influencer", "social", "edm", "pr", "full_service"], ["seo", "sem"], [], [],
  ])
})

test("financial confirmations are separate from sales required fields", () => {
  const salesKeys = DEAL_CONTRACT_FIELDS.map(([key]) => key)
  for (const [key] of DEAL_FINANCE_FIELDS) assert.equal(salesKeys.includes(key), false)
  assert.deepEqual(dealContractSubmissionErrors(completed, 1), [])
})

test("contract and historical dates use the same Shanghai calendar date", () => {
  for (const value of ["2026-11-08T00:00:00", "2026/11/8", "2026.11.8", "2026-11.8", "2026年11月8日", "2026-11-07T18:00:00Z"]) {
    assert.equal(dealDateInputValue(value), "2026-11-08")
    assert.equal(formatDealDate(value), "2026/11/8")
  }
  for (const value of ["未到账", "11月8日左右", "2026-02-30", "", null]) {
    assert.equal(dealDateInputValue(value), "")
    assert.equal(formatDealDate(value), value ?? "")
  }
})
