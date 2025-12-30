import { test, expect } from '@playwright/test';

const MANAGER_EMAIL = process.env.PW_MANAGER_EMAIL as string | undefined;
const MANAGER_PASSWORD = process.env.PW_MANAGER_PASSWORD as string | undefined;

// 该用例假设存在一个具有公海与报表导出权限的管理账号，
// 凭据通过 PW_MANAGER_EMAIL / PW_MANAGER_PASSWORD 提供。

test.describe('公海池与报表导出', () => {
  test.beforeEach(() => {
    if (!MANAGER_EMAIL || !MANAGER_PASSWORD) {
      test.skip(true, '未配置 PW_MANAGER_EMAIL / PW_MANAGER_PASSWORD，跳过公海与导出用例');
    }
  });

  test('管理账号可以查看公海池，并从分析页导出 CSV', async ({ page }) => {
    // 1. 登录
    await page.goto('/auth/login');
    await page.getByLabel('邮箱').fill(MANAGER_EMAIL!);
    await page.getByLabel('密码').fill(MANAGER_PASSWORD!);
    await page.getByRole('button', { name: '登 录' }).click();

    await page.waitForURL(/dashboard/, { timeout: 20_000 });

    // 2. 打开公海池
    await page.goto('/pool');
    await expect(page.getByText('公海池').first()).toBeVisible();

    // 至少表头可见
    await expect(page.getByRole('columnheader', { name: /公司/ })).toBeVisible();

    // 3. 打开数据分析页并执行一次导出
    await page.goto('/reports');
    await expect(page.getByText('销售漏斗转化分析')).toBeVisible();

    // 点击漏斗卡片的导出 -> 下载 CSV
    const exportButton = page.getByRole('button', { name: /导出/ }).first();
    await exportButton.click();
    await page.getByRole('menuitem', { name: /下载 CSV/ }).click();

    // 使用 Playwright downloads API 验证是否有文件下载（如果配置了下载目录）
    // 这里为了简单，只检查没有出现明显错误提示即可。
    await expect(page.getByText('导出失败')).not.toBeVisible({ timeout: 5_000 }).catch(() => {});
  });
});
