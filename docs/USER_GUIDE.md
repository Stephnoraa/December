# User guide

How to run a venue on QR Ordering: guests order and pay from their phones, orders go straight
to the kitchen and bar screens, and the owner sees the money live.

- [1. Who uses what](#1-who-uses-what)
- [2. Before your first service (owner)](#2-before-your-first-service-owner)
- [3. During service: waiters](#3-during-service-waiters)
- [4. During service: kitchen and bar screens](#4-during-service-kitchen-and-bar-screens)
- [5. What the guest sees](#5-what-the-guest-sees)
- [6. Managers and owners](#6-managers-and-owners)
- [7. Paying before or after (PREPAY vs POSTPAY)](#7-paying-before-or-after-prepay-vs-postpay)
- [8. Common questions](#8-common-questions)
- [9. Practise with the demo venue](#9-practise-with-the-demo-venue)

---

## 1. Who uses what

There are two apps:

- **Customer app.** Opens when a guest scans the QR code on a table. Nothing to install and no
  account needed.
- **Staff app.** Runs on the venue's tablets and phones, and on the owner's laptop.

| Person            | Signs in with               | Uses it to                                                                   |
| ----------------- | --------------------------- | ---------------------------------------------------------------------------- |
| **Owner**         | Email and password (or PIN) | Set up the venue, see the dashboard, approve voids/discounts, payout account |
| **Manager**       | Email and password (or PIN) | Everything the owner does except changing the payout bank account            |
| **Waiter**        | PIN on a venue device       | Open and close tables, answer calls, serve food, take cash/POS               |
| **Kitchen / Bar** | PIN on the station screen   | See incoming orders, mark them accepted, ready or unavailable                |
| **Guest**         | Nothing (scans the QR code) | Browse, order, call the waiter, ask for the bill, pay, get a receipt         |

**PINs only work on devices the owner or a manager has enabled** (see step 2.7). A stranger
who learns a PIN can't use it from their own phone.

---

## 2. Before your first service (owner)

It takes under an hour. The **Set up** checklist on your dashboard shows what is left; ordering
starts once the required steps are ticked.

### 2.1 Create your account

Open the staff app, tap **Create an account**, and enter:

- your name, email and password (at least 8 characters);
- the venue name;
- a 4–6 digit **manager PIN**. You'll use it to approve voids and discounts.

### 2.2 Settings (Settings → Venue & charges)

- **Venue name, address** (printed on receipts) and **logo**.
- **When do customers pay?**
  - **After** (POSTPAY): guests run a tab and settle at the end.
  - **Before** (PREPAY): each order reaches the kitchen and bar only after it is paid.
  - See [section 7](#7-paying-before-or-after-prepay-vs-postpay).
- **VAT %** and **Service charge %**.
- **Menu prices include VAT**: on means the menu price is what the guest pays.

Changes apply to tables opened from then on. Tables already open keep the charges they started
with.

### 2.3 Payout account (Settings → Payouts, owner only)

Online payments (card, bank transfer, USSD) go through Paystack into this bank account.

1. Pick the bank and enter the account number.
2. Tap **Check account name**.
3. If the name is right, tap **Yes, use this account**.

You need this before taking online payments. It is a required step for PREPAY venues. POSTPAY
venues can start with cash and POS only.

### 2.4 Stations (Stations)

A station is a screen that receives orders, usually **Kitchen** and **Bar**. Every menu item is
sent to exactly one station.

### 2.5 Menu (Menu)

1. **Add category** (e.g. Rice dishes, Drinks).
2. Add items. Each item has:
   - a name, description and price;
   - the **station** it goes to;
   - an optional photo;
   - optional add-ons with their own prices (e.g. "Extra plantain +₦500").
3. The availability switch on each item turns it off when it runs out. Guests see the change
   instantly.
4. **Remove item from menu** hides an item for good. Past orders keep its name and price.

### 2.6 Tables and QR codes (Tables)

1. **Add table**, or **Add many tables** (e.g. M1–M6 in "Main Hall").
2. **Download QR sheet (PDF)**, print it, and stick each code on its table.
3. **Open menu link** shows exactly what a guest will see at that table. Use it to check.

### 2.7 Staff and devices (Staff)

1. **Add staff**: give each person a name, a role (Manager, Waiter, Station) and a PIN.
   - A _Station_ login is for the kitchen or bar screen itself. One is enough; it can be
     shared.
2. **Enable each venue device** (waiter phones, kitchen tablet, bar tablet). On _that_ device:
   1. Sign in with your email.
   2. Go to **Staff** and tap **Enable PIN login on this device**.
   3. Sign out. The device now shows a PIN pad with your staff list.
3. Lost or stolen device? Revoke it from the same page.

When the checklist says _"Required steps are complete: you can take orders"_, you're ready.

---

## 3. During service: waiters

Open **Floor**. Every table shows its state:

- **closed**
- **open**
- **waiter called**
- **bill requested**
- **awaiting payment**
- **paid**

The top of the screen has two lists that update live:

- **Customers asking**: someone tapped _Call waiter_ or _Request bill_. Tap **On my way** so the
  others know you've got it.
- **Ready to serve**: the kitchen or bar marked something ready. Take it to the table, then tap
  **Served**.

### Open a table

Guests can browse the menu as soon as they scan, but **they can't order until a waiter opens
the table**. This stops people ordering from home with a photo of the QR code.

Tap the closed table, then **Open table**. Every phone at that table unlocks immediately.

### The table's tab

Tap an open table to see:

- every order and the status of each item;
- payments made (and pending online payments);
- the subtotal, discounts, service charge, VAT, total, **Paid** and **Balance**.

### Take cash or POS

Tap **Record cash / POS payment**, choose **💵 Cash** or **💳 POS terminal**, and enter the
amount received.

- You can't record more than the balance. If a guest hands over ₦10,000 for a ₦8,500 bill,
  record ₦8,500 and give change.
- Several partial payments are fine (e.g. two guests paying half each).

### Void an item or give a discount

- **Void**: removes an item from the bill (e.g. spilled before serving).
- **Discount…**: a % or ₦ amount off one item or the whole bill.

Both need a **reason**. A manager or owner must then pick their name and enter their PIN on
your device. The reason and the approver go into the audit log and onto the owner's dashboard.

### Close the table

Once the balance is ₦0, tap **Close table**. The QR code then shows "This table has been
closed", and the next guests start a fresh tab once you reopen it.

### Switch user

On a shared device, tap **Switch user** so the next person signs in with their own PIN.

---

## 4. During service: kitchen and bar screens

1. Sign in with the Station PIN.
2. Choose this screen's station and tap **Start Kitchen** (or **Start Bar**). Starting also turns
   on the **sound alert** for new orders.
   - Keep the tablet's volume up and the screen awake.

Each order line shows the table, order number, item, add-ons, quantity, the guest's note, and
how long ago it was ordered (oldest first).

| Tap             | Meaning                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| **Accept**      | "We're making it." The guest sees _Accepted_.                                                              |
| **Ready**       | It's done. It moves to the waiters' _Ready to serve_ list.                                                 |
| **Unavailable** | Can't make it. It comes off the guest's bill and is **switched off on the menu** so nobody else orders it. |
| **Undo**        | Tapped _Unavailable_ by mistake? Undo within 10 minutes puts the order back and turns the item on again.   |

If two people tap the same item at once, only the first tap counts. The other gets "Someone
else just updated this item".

---

## 5. What the guest sees

1. **Scan the QR code** on the table with the phone camera. The venue's menu opens with its name
   and logo.
2. **Table not open yet?** The guest can browse and tap **🙋 Call waiter**. Ordering unlocks
   by itself when the waiter opens the table.
3. **Order.** Pick items, choose add-ons, and add a note (e.g. "no onions"). Then open the cart
   and tap **Send order** (or **Place order** at a PREPAY venue).
   - Everyone at the table can order from their own phone onto the same tab.
4. **Track it** on **Your table**: each item goes _Sent → Accepted → Ready → Served_. Anything
   the kitchen couldn't make shows _Unavailable_ and is _Not charged_.
5. **Get help:**
   - **🙋 Call waiter**
   - **🧾 Request bill**
6. **Pay** with **💳 Pay**:
   - **Pay the full balance**, or
   - **Pay part of the bill**. To split, each person pays their share from their own phone.

   Paystack then takes card, bank transfer or USSD. Paystack asks for an email, which is used
   only for that payment.

7. **Receipt.** After paying, **View receipt** shows an on-screen receipt with a **Share receipt
   link**.

Things guests might run into:

- _"Waiting for Paystack to confirm your payment"_: bank transfers can take a minute. The table
  updates by itself once Paystack confirms.
- _"Payment not completed"_: nothing was charged. They can try again or pay the waiter.
- _"This QR code has expired"_: the venue replaced that table's code. They should ask the
  waiter for the current one.
- _"Ordering is unavailable right now"_: the venue has been paused (see 6.4).

---

## 6. Managers and owners

### 6.1 Dashboard

The dashboard updates live during service:

- **Sales today (collected)**: money actually received since 06:00 Lagos time, split by card,
  bank transfer, USSD, cash and POS. Late-night sales count towards that evening.
- **Open tabs**: each table's total, amount paid and balance.
- **Voids & discounts today**: what, why, who asked, who approved.
- **Refunds due**: more was collected than owed (e.g. two guests paid the same balance at the
  same moment, or a prepaid item ran out). See 6.3.

### 6.2 Audit log

A permanent record of every money- and permission-sensitive action. Entries can't be edited or
deleted. It covers:

- tables opened and closed;
- payments;
- voids and discounts;
- menu availability changes;
- staff and device changes;
- settings and payout changes.

Filter by action to find something specific.

### 6.3 Refunds

The app flags overpayments but doesn't send money back by itself. Refund the guest in cash or
from your Paystack dashboard, as the venue prefers.

### 6.4 Replacing QR codes

If a code is photographed and shared, or a sticker is damaged, go to **Tables** and tap **New
QR** (one table) or **Replace all QR codes…**, then reprint. The old code stops working
immediately.

### 6.5 Platform operator (for the company running the platform, not venues)

The operator signs in at `/platform` in the staff app. They see every venue and its setup
progress, and can **Suspend** or **Activate** a venue.

- A suspended venue's guests see "Ordering is unavailable right now".
- Staff can still sign in and settle tabs that are already open.

---

## 7. Paying before or after (PREPAY vs POSTPAY)

|                                    | **POSTPAY** (pay at the end)            | **PREPAY** (pay per order)                                     |
| ---------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| When the order reaches the kitchen | Immediately                             | Once that order is paid                                        |
| Guest sees                         | "Your tab is settled at the end"        | "You pay for this order before it goes to the kitchen and bar" |
| Unpaid orders                      | Stay on the tab                         | Cancelled automatically after 30 minutes                       |
| Cash/POS                           | Against the tab balance                 | The waiter can take cash for a held order, which releases it   |
| Best for                           | Restaurants, lounges with table service | Busy bars, clubs, quick service                                |

---

## 8. Common questions

**When does a payment count?**
Only when it's confirmed: Paystack confirms an online payment, or a staff member records cash
or POS. A guest's screenshot doesn't count. Check the table's tab.

**Can two people at the same table pay at the same time?**
Yes. While one person is in Paystack checkout, their amount is held for 15 minutes so the
other's "full balance" doesn't double-charge. If an overpayment still happens, it shows under
**Refunds due**.

**A staff member entered the wrong PIN too many times.**
After 5 wrong tries the account locks for 5 minutes. Each further lockout doubles the wait, up
to 60 minutes. Wait, or have a manager set a new PIN on **Staff**.

**I forgot my owner password.**
There's no reset email in this version. Ask the platform operator to reset it; they'll give
you a temporary password.

**Can I change prices or VAT during service?**
Yes. Prices already ordered stay as they were. New VAT or service charge settings apply to
tables opened afterwards.

**Something ran out halfway through the night.**
Two ways to turn it off:

- the station taps **Unavailable** on the order;
- anyone with menu access switches it off on **Menu**.

Guests' menus update instantly. If an item is already in someone's cart, they're told to review
their order.

**The screen says "Reconnecting".**
The Wi-Fi or data dropped. Nothing is lost: the screen catches up by itself when the
connection returns.

---

## 9. Practise with the demo venue

The demo venue, **Demo Lounge**, has:

- 12 tables: M1–M6 in Main Hall, T1–T4 on the Terrace, VIP1–VIP2;
- a Kitchen and a Bar station;
- a Nigerian menu;
- test payments (no real money).

| Who                   | Email / PIN                                                |
| --------------------- | ---------------------------------------------------------- |
| Owner – Ada Okafor    | `owner@demo.test` / `demo-owner-pass`, PIN `1111`          |
| Manager – Musa Bello  | `manager@demo.test` / `demo-manager-pass`, PIN `2222`      |
| Waiter – Chidi Waiter | PIN `3333`                                                 |
| Kitchen & Bar Screen  | PIN `4444`                                                 |
| Platform operator     | `/platform`: `admin@platform.test` / `platform-admin-pass` |

PIN logins need an enabled device first (step 2.7).

On the test payment page, choose one of:

- **Pay with card (test)**
- **Pay by bank transfer (test)**
- **Decline (test)**

**A full rehearsal (about 10 minutes):**

1. **Owner:** sign in, then **Staff → Enable PIN login on this device**. Do this on every
   device you'll use.
2. **Kitchen screen:** PIN `4444`, then **Start Kitchen**.
3. **Guest:** **Tables → M1 → Open menu link** (or scan M1's code on the QR sheet). You'll see
   "Ask your waiter to open this table". Tap **Call waiter**.
4. **Waiter:** PIN `3333`. M1 shows _waiter called_: tap **On my way**, then open M1.
5. **Guest:** add **Jollof Rice** with _Extra plantain_ and a **Chapman**, then **Send order**.
6. **Kitchen:** the order chimes in. **Accept**, then **Ready**.
7. **Waiter:** it appears in _Ready to serve_. Tap **Served**.
8. **Waiter:** void the Chapman. Manager Musa approves with PIN `2222`.
9. **Guest:** **Pay → Pay the full balance**, then **Pay with card (test)**, then **View
   receipt**.
10. **Waiter:** the balance is ₦0. Tap **Close table**.
11. **Owner:** the dashboard shows the sale and the void. The **Audit log** lists every step.
