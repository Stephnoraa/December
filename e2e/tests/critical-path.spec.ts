import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { API_BASE, URLS } from '../playwright.config';

/**
 * Critical path (MVP brief §7): waiter opens table → two customer browsers order → station
 * accepts one item and marks one unavailable → items ready and served → one customer pays part
 * via mocked Paystack, waiter records the rest as cash → tab paid → owner dashboard shows the
 * correct totals and the audit trail.
 */

const OWNER = { email: 'owner@demo.test', password: 'demo-owner-pass' };

async function ownerLogin(page: Page) {
  await page.goto(`${URLS.staff}/login`);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** Owner enables PIN login on this browser, signs out, and the staff member signs in with their PIN. */
async function pinDevice(
  browser: Browser,
  deviceName: string,
  staffName: string,
  pin: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await ownerLogin(page);
  await page.getByRole('link', { name: 'Staff' }).click();
  await page.getByLabel('Device name').fill(deviceName);
  await page.getByRole('button', { name: 'Enable PIN login on this device' }).click();
  await expect(page.getByText('This device is enabled')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: new RegExp(staffName) }).click();
  for (const d of pin) await page.getByRole('button', { name: `Digit ${d}`, exact: true }).click();
  await page.getByRole('button', { name: 'Enter PIN' }).click();
  return { ctx, page };
}

async function customer(browser: Browser, qrUrl: string) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(qrUrl);
  return { ctx, page };
}

async function addToOrder(page: Page, item: string) {
  await page.getByRole('button', { name: item, exact: true }).click();
  await page.getByRole('button', { name: /^Add/ }).click();
}

test('critical path: open → order → station → serve → split payment → paid → dashboard', async ({
  browser,
}) => {
  // --- Owner finds the table's QR link -------------------------------------------------------
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await ownerLogin(owner);
  const tables = (await owner.evaluate(
    (base) => fetch(`${base}/v1/admin/tables`, { credentials: 'include' }).then((r) => r.json()),
    API_BASE,
  )) as { label: string; qrUrl: string }[];
  const qrUrl = tables.find((t) => t.label === 'M1')!.qrUrl;

  // --- Waiter and station screens sign in with PINs on enabled devices ----------------------
  const waiter = await pinDevice(browser, 'Floor tablet', 'Chidi Waiter', '3333');
  await expect(waiter.page.getByRole('heading', { name: 'Floor' })).toBeVisible();
  const kitchen = await pinDevice(browser, 'Kitchen tablet', 'Kitchen & Bar Screen', '4444');
  await kitchen.page.getByRole('button', { name: 'Start Kitchen' }).click();
  const bar = await pinDevice(browser, 'Bar tablet', 'Kitchen & Bar Screen', '4444');
  await bar.page.getByRole('button', { name: 'Start Bar' }).click();

  // --- A customer scans before the table is open: read-only -------------------------------------
  const ada = await customer(browser, qrUrl);
  await expect(ada.page.getByText('Ask your waiter to open this table')).toBeVisible();

  // --- Waiter opens the table; ordering unlocks live ------------------------------------------
  await waiter.page.getByRole('button', { name: 'Table M1, closed' }).click();
  await waiter.page.getByRole('button', { name: 'Open table' }).click();
  await expect(waiter.page.getByRole('heading', { name: 'Table M1' })).toBeVisible();
  await expect(ada.page.getByRole('tab', { name: /Menu/ })).toBeVisible();

  // --- Two customers order from two browsers ----------------------------------------------------
  await addToOrder(ada.page, 'Jollof Rice');
  await ada.page.getByRole('button', { name: /View order/ }).click();
  await ada.page.getByRole('button', { name: /Send order/ }).click();
  await expect(ada.page.getByText('Order #1 sent')).toBeVisible();

  const bola = await customer(browser, qrUrl);
  await expect(bola.page.getByRole('tab', { name: /Menu/ })).toBeVisible();
  await addToOrder(bola.page, 'Chapman');
  await addToOrder(bola.page, 'Zobo');
  await bola.page.getByRole('button', { name: /View order/ }).click();
  await bola.page.getByRole('button', { name: /Send order/ }).click();
  await expect(bola.page.getByText('Order #2 sent')).toBeVisible();

  // --- Stations: kitchen accepts Jollof; bar accepts Chapman and marks Zobo unavailable ---------
  const jollofCard = kitchen.page.getByRole('listitem').filter({ hasText: 'Jollof Rice' });
  await jollofCard.getByRole('button', { name: 'Accept' }).click();
  await jollofCard.getByRole('button', { name: 'Ready' }).click();

  const chapmanCard = bar.page.getByRole('listitem').filter({ hasText: 'Chapman' });
  await chapmanCard.getByRole('button', { name: 'Accept' }).click();
  await bar.page
    .getByRole('listitem')
    .filter({ hasText: 'Zobo' })
    .getByRole('button', { name: 'Unavailable' })
    .click();
  await expect(bar.page.getByText('Marked unavailable')).toBeVisible();
  await chapmanCard.getByRole('button', { name: 'Ready' }).click();

  // Customers see live statuses; the unavailable item is not charged.
  await expect(bola.page.getByRole('tab', { name: /Your table/ })).toContainText('₦6,000.00');
  await bola.page.getByRole('tab', { name: /Your table/ }).click();
  await expect(bola.page.getByText('Unavailable')).toBeVisible();
  await expect(bola.page.getByText('Not charged')).toBeVisible();

  // --- Waiter serves the ready items -------------------------------------------------------------
  await waiter.page.goto(`${URLS.staff}/floor`);
  const ready = waiter.page.locator('li').filter({ hasText: 'Table M1' });
  await expect(ready).toHaveCount(2);
  await ready.first().getByRole('button', { name: 'Served' }).click();
  await expect(ready).toHaveCount(1);
  await ready.first().getByRole('button', { name: 'Served' }).click();
  await expect(waiter.page.getByText('Ready to serve')).toHaveCount(0);
  await ada.page.getByRole('tab', { name: /Your table/ }).click();
  await expect(ada.page.getByText('Served').first()).toBeVisible();

  // --- Ada pays ₦2,000 online (mocked Paystack) ------------------------------------------------
  await ada.page.getByRole('button', { name: /Pay$/ }).click();
  await ada.page.getByLabel(/Pay part of the bill/).check();
  await ada.page.getByPlaceholder(/Up to/).fill('2000');
  await ada.page.getByLabel(/Email for your Paystack receipt/).fill('ada@example.com');
  await ada.page.getByRole('button', { name: /Pay with card, transfer or USSD/ }).click();
  await expect(ada.page.getByText('Test checkout')).toBeVisible();
  await ada.page.getByRole('button', { name: 'Pay with card (test)' }).click();
  await expect(ada.page.getByText('Payment received')).toBeVisible();
  await expect(ada.page.getByText('Remaining on the table: ₦4,000.00')).toBeVisible();
  await ada.page.getByRole('button', { name: 'Back to my table' }).click();

  // --- Waiter records the rest as cash; tab paid; table closed ----------------------------------
  await waiter.page.getByRole('button', { name: /Table M1, open/ }).click();
  await expect(waiter.page.getByText('₦4,000.00').first()).toBeVisible();
  await waiter.page.getByRole('button', { name: 'Record cash / POS payment' }).click();
  await waiter.page.getByRole('button', { name: /Record cash ₦4,000.00/ }).click();
  await expect(waiter.page.getByRole('button', { name: 'Close table' })).toBeEnabled();
  await expect(ada.page.getByText('All paid')).toBeVisible();
  await waiter.page.getByRole('button', { name: 'Close table' }).click();
  await waiter.page.getByRole('dialog').getByRole('button', { name: 'Close table' }).click();
  await expect(waiter.page.getByRole('heading', { name: 'Floor' })).toBeVisible();
  await expect(bola.page.getByText('This table has been closed.')).toBeVisible();

  // --- Owner dashboard: totals and audit trail --------------------------------------------------
  await owner.goto(`${URLS.staff}/dashboard`);
  const sales = owner
    .locator('div')
    .filter({ hasText: /^Sales today \(collected\)/ })
    .last();
  await expect(sales).toContainText('₦6,000.00');
  await expect(sales).toContainText('2 payments');
  const methods = owner
    .locator('div')
    .filter({ has: owner.getByRole('heading', { name: 'Payments by method' }) })
    .last();
  await expect(methods.locator('div').filter({ hasText: /^Card/ })).toContainText('₦2,000.00');
  await expect(methods.locator('div').filter({ hasText: /^Cash/ })).toContainText('₦4,000.00');
  await expect(methods.locator('div').filter({ hasText: /^POS terminal/ })).toContainText('₦0.00');

  await owner.getByRole('link', { name: 'Audit log' }).click();
  for (const label of [
    'Table opened',
    'Table closed',
    'Cash/POS recorded',
    'Online payment confirmed',
    'Menu availability',
  ]) {
    await expect(
      owner.getByText(label, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
  }
  await expect(
    owner
      .locator('div')
      .filter({ hasText: /Cash\/POS recorded/ })
      .filter({ hasText: 'Chidi Waiter' })
      .first(),
  ).toBeVisible();

  for (const c of [ownerCtx, waiter.ctx, kitchen.ctx, bar.ctx, ada.ctx, bola.ctx]) await c.close();
});
