-- 024_leads_grade_and_source_settings.sql
-- Seed configurable defaults for customer grade definitions (S/A/B/C)
-- and lead source channel tree (level1/level2) via public.settings.

-- 1) Seed customer grade definitions (only if not already present)
insert into public.settings(key, value)
values (
  'leads.grade_definitions',
  '{
    "grades": [
      {
        "key": "S",
        "label": "S级（强成交 / 立即跟进）",
        "description": "项目需求明确，有清晰上线时间和预算，已接触关键决策人，近期有成交可能。"
      },
      {
        "key": "A",
        "label": "A级（重点培育 / 近期可成交）",
        "description": "业务痛点明确，对方案认可，有初步预算意向，预计 1-3 个月内有项目机会。"
      },
      {
        "key": "B",
        "label": "B级（普通意向 / 需持续教育）",
        "description": "有兴趣但需求和预算模糊，决策链较长，项目时间在 3 个月以后或未定。"
      },
      {
        "key": "C",
        "label": "C级（低优先级 / 长期培育）",
        "description": "短期无法成交或仅了解阶段，可纳入长期培育与自动化触达。"
      }
    ]
  }'::jsonb
)
on conflict (key) do nothing;


-- 2) Seed lead source channel tree (level1 / level2)
insert into public.settings(key, value)
values (
  'leads.source_tree',
  '{
    "channels": [
      {
        "key": "ads",
        "label": "广告投放",
        "children": [
          { "key": "ads_douyin", "label": "抖音广告" },
          { "key": "ads_wechat_video", "label": "视频号广告" },
          { "key": "ads_feed", "label": "信息流广告" },
          { "key": "ads_search", "label": "搜索广告" }
        ]
      },
      {
        "key": "content_privacy",
        "label": "内容与私域",
        "children": [
          { "key": "content_douyin_live", "label": "抖音直播间" },
          { "key": "content_wechat_live", "label": "视频号直播" },
          { "key": "content_wechat_article", "label": "公众号/内容文章" },
          { "key": "content_other", "label": "其他内容平台" }
        ]
      },
      {
        "key": "offline",
        "label": "线下活动",
        "children": [
          { "key": "offline_expo", "label": "展会" },
          { "key": "offline_salon", "label": "沙龙/培训" },
          { "key": "offline_promotion", "label": "地推活动" }
        ]
      },
      {
        "key": "website_forms",
        "label": "官网与表单",
        "children": [
          { "key": "website_form", "label": "官网表单" },
          { "key": "landing_page", "label": "着陆页" },
          { "key": "miniapp_form", "label": "小程序表单" }
        ]
      },
      {
        "key": "partners",
        "label": "渠道合作/代理商",
        "children": [
          { "key": "partner_referral", "label": "渠道商推荐" },
          { "key": "partner_joint_campaign", "label": "联合活动/联合运营" }
        ]
      },
      {
        "key": "referrals",
        "label": "老客与转介绍",
        "children": [
          { "key": "existing_customer", "label": "老客续费/增购引导" },
          { "key": "customer_referral", "label": "客户转介绍" }
        ]
      },
      {
        "key": "internal",
        "label": "内部线索",
        "children": [
          { "key": "internal_manual", "label": "手工录入" },
          { "key": "internal_transfer", "label": "内部转移/共享" }
        ]
      }
    ]
  }'::jsonb
)
on conflict (key) do nothing;
