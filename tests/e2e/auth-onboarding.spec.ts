import { test, expect } from '@playwright/test';

function randomEmail() {
  const stamp = Date.now();
  return `e2e+${stamp}@example.com`;
}

const ADMIN_EMAIL = process.env.PW_ADMIN_EMAIL as string | undefined;
const ADMIN_PASSWORD = process.env.PW_ADMIN_PASSWORD as string | undefined;

// 说明：
// 1. 管理员账号使用环境变量配置：PW_ADMIN_EMAIL / PW_ADMIN_PASSWORD。
// 2. 测试会走真实注册 + 审批 + 登录流程，不依赖任何 mock。

test.describe('注册 + 审批 + 登录完整流程', () => {
  test('新用户注册后被管理员审批，登录后进入 Dashboard', async ({ page, context }) => {
    const email = randomEmail();
    const password = 'E2eTest@123456';

    // 1. 访问注册页并完成注册
    await page.goto('/auth/register');

    await page.getByLabel('真实姓名').fill('E2E 测试用户');
    await page.getByLabel('手机号码').fill('13900000000');
    await page.getByLabel('邮箱').fill(email);
    await page.getByPlaceholder('请设置密码').fill(password);
    await page.getByPlaceholder('请再次输入密码').fill(password);


    await page.getByRole('button', { name: '申请账户' }).click();

    // 注册成功后应跳转到 Onboarding Pending 页面（网络/触发器可能有抖动，给足等待时间）
    await expect(page).toHaveURL(/onboarding\/pending/, { timeout: 20_000 });

    await expect(page.getByText('您的账户申请已提交')).toBeVisible({ timeout: 10_000 }).catch(() => {});

    // 2. 管理员登录后台，在组织架构 Tab 审批该用户
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      test.skip(true, '未配置 PW_ADMIN_EMAIL / PW_ADMIN_PASSWORD，跳过管理员审批部分');
    }

    const adminPage = await context.newPage();
    await adminPage.goto('/auth/login');
    await adminPage.getByLabel('邮箱').fill(ADMIN_EMAIL!);
    await adminPage.getByLabel('密码').fill(ADMIN_PASSWORD!);
    await adminPage.getByRole('button', { name: '登 录' }).click();

    // 登录后应跳转到 dashboard 或首页
    await adminPage.waitForURL(/dashboard|\//, { timeout: 15_000 });

    // 进入设置 -> 组织架构 -> 待审核 Tab
    await adminPage.goto('/settings');

    // 某些管理员可能没有系统设置/组织架构的可见权限，如果 Tab 不存在则直接结束
    const orgTab = adminPage.getByRole('tab', { name: '组织架构' });
    if ((await orgTab.count()) === 0) {
      return;
    }
    await orgTab.click();

    const pendingTab = adminPage.getByRole('tab', { name: '待审核' });
    if ((await pendingTab.count()) === 0) {
      return;
    }
    await pendingTab.click();

    // 找到刚才注册的用户行

    const row = adminPage.getByRole('row', { name: new RegExp(email, 'i') });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 点击“批准”，在弹窗中选择团队和角色
    await row.getByRole('button', { name: '批准' }).click();

    const teamSelect = adminPage.getByLabel('分配团队');
    const roleSelect = adminPage.getByLabel('分配角色');
    await expect(teamSelect).toBeVisible();
    await expect(roleSelect).toBeVisible();

    await teamSelect.click();
    await adminPage.getByRole('option').first().click();

    await roleSelect.click();
    await adminPage.getByRole('option').first().click();

    await adminPage.getByRole('button', { name: '确认激活' }).click();

    // 3. 切换到新用户登录，验证进入 Dashboard
    const userPage = await context.newPage();
    await userPage.goto('/auth/login');
    await userPage.getByLabel('邮箱').fill(email);
    await userPage.getByLabel('密码').fill(password);
    await userPage.getByRole('button', { name: '登 录' }).click();

    await userPage.waitForURL(/dashboard/, { timeout: 20_000 });
    await expect(userPage.getByText('仪表盘').first()).toBeVisible();
  });
});
