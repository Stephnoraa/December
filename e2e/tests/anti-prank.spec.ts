import { expect, test } from '@playwright/test';
import { API_BASE, URLS } from '../playwright.config';

test('nobody can order to a table a waiter has not opened', async ({ page, request }) => {
  await page.goto(`${URLS.staff}/login`);
  await page.getByLabel('Email').fill('owner@demo.test');
  await page.getByLabel('Password').fill('demo-owner-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const tables = (await page.evaluate(
    (base) => fetch(`${base}/v1/admin/tables`, { credentials: 'include' }).then((r) => r.json()),
    API_BASE,
  )) as { label: string; qrUrl: string }[];
  const url = new URL(tables.find((t) => t.label === 'VIP2')!.qrUrl);
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
