import { expect, test, type Page } from '@playwright/test';
import { API_BASE, URLS } from '../playwright.config';

/** Reads a table's QR link from the owner's Tables page (a reload: the session must survive it). */
async function tableQrUrl(page: Page, label: string): Promise<string> {
  await page.goto(`${URLS.staff}/setup/tables`);
  const row = page
    .getByText(`Table ${label}`, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]');
  const href = await row.getByRole('link', { name: 'Open menu link' }).getAttribute('href');
  expect(href).toBeTruthy();
  return href!;
}

test('nobody can order to a table a waiter has not opened', async ({ page, request }) => {
  await page.goto(`${URLS.staff}/login`);
  await page.getByLabel('Email').fill('owner@demo.test');
  await page.getByLabel('Password').fill('demo-owner-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const url = new URL(await tableQrUrl(page, 'VIP2'));
  const apiRoot = API_BASE || URLS.customer;
  const api = `${apiRoot}/v1/public${url.pathname}`;
  // Joining an unopened table is refused, and without a joined session there is no way to order.
  const join = await request.post(`${api}/join`, {
    headers: { 'Content-Type': 'application/json' },
    data: {},
  });
  expect(join.status()).toBe(409);
  const order = await request.post(`${apiRoot}/v1/public/session/orders`, {
    headers: { 'Content-Type': 'application/json' },
    data: { items: [] },
  });
  expect(order.status()).toBe(401);
});
