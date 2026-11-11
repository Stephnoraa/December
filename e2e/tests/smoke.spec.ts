import { expect, test } from '@playwright/test';
import { URLS } from '../playwright.config';

test('staff app shows the sign-in page', async ({ page }) => {
  await page.goto(URLS.staff);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
