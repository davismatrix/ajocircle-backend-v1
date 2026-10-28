import { test, expect, type Page, type Route } from "@playwright/test";

const group = {
  id: "da26bcbc-121e-4556-a462-814cdd131e4a", name: "Family savings",
  currency: "NGN", contribution_amount: "10000.00", frequency: "MONTHLY",
  payout_type: "ROTATIONAL", start_date: "2026-11-01", status: "DRAFT",
  created_by: "owner-id", membership_role: "OWNER", payout_position: 1,
};

async function mockAccount(page: Page) {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: {
    id: "owner-id", first_name: "Ada", last_name: "Owner", email: "ada@example.com", phone_number: null, role: "USER",
  } }));
}

async function fillGroup(page: Page) {
  await page.getByLabel("Group name").fill("Family savings");
  await page.getByLabel("Description").fill("Our monthly family circle");
  await page.getByLabel("Contribution per member").fill("10000.00");
  await page.getByLabel("Start date").fill("2026-11-01");
}

test("create a draft from the empty list, view it, and find it in My Ajos", async ({ page }, testInfo) => {
  await mockAccount(page);
  let created = false;
  let pendingCreation: Route | undefined;
  await page.route("**/api/backend/ajo-groups", async (route) => {
    if (route.request().method() === "POST") { pendingCreation = route; return; }
    await route.fulfill({ json: created ? [group] : [] });
  });
  await page.route(`**/api/backend/ajo-groups/${group.id}`, (route) => route.fulfill({ json: group }));
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your first circle starts here" })).toBeVisible();
  await page.getByRole("link", { name: "Create your first group" }).click();
  await fillGroup(page);
  await page.getByLabel("Grace period (days)").fill("2");
  await expect(page.getByLabel("Late fee", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Create draft group" }).click();
  await expect(page.getByRole("button", { name: "Creating group…" })).toBeDisabled();
  await expect.poll(() => Boolean(pendingCreation)).toBe(true);
  expect(pendingCreation!.request().postDataJSON()).toEqual({
    name: "Family savings", description: "Our monthly family circle", currency: "NGN",
    contribution_amount: "10000.00", frequency: "MONTHLY", payout_type: "ROTATIONAL",
    start_date: "2026-11-01", grace_period_days: 2, late_fee: "0",
  });
  created = true;
  await pendingCreation!.fulfill({ status: 201, json: group });
  await expect(page).toHaveURL(`/dashboard/ajos/${group.id}`);
  await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
  await expect(page.getByText("NGN 10,000.00", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← My Ajos" }).click();
  await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
  await expect(page.getByText("owner", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /View draft group/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("my-ajos.png"), fullPage: true });
});

test("group list errors can be retried", async ({ page }) => {
  await mockAccount(page);
  let failing = true;
  await page.route("**/api/backend/ajo-groups", (route) => {
    return failing
      ? route.fulfill({ status: 503, json: { detail: "Groups are temporarily unavailable." } })
      : route.fulfill({ json: [group] });
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("alert").filter({ hasText: "Groups are temporarily unavailable." })).toHaveText("Groups are temporarily unavailable.");
  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
});

test("creation errors preserve fields and allow resubmission", async ({ page }) => {
  await mockAccount(page);
  await page.route("**/api/backend/ajo-groups", (route) => route.fulfill({
    status: 422, json: { detail: [{ loc: ["body", "name"], msg: "Please choose another name." }] },
  }));
  await page.goto("/dashboard/ajos/new");
  await fillGroup(page);
  await page.getByRole("button", { name: "Create draft group" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Please choose another name." })).toHaveText("Please choose another name.");
  await expect(page.getByLabel("Group name")).toHaveValue("Family savings");
  await expect(page.getByLabel("Contribution per member")).toHaveValue("10000.00");
  await expect(page.getByRole("button", { name: "Create draft group" })).toBeEnabled();
});

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ status: 401, json: { detail: "Not authenticated" } }));
  await page.goto("/dashboard/ajos/new");
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("inaccessible groups show an error and a route back to My Ajos", async ({ page }) => {
  await mockAccount(page);
  await page.route(`**/api/backend/ajo-groups/${group.id}`, (route) => route.fulfill({ status: 403, json: { detail: "Not a member" } }));
  await page.goto(`/dashboard/ajos/${group.id}`);
  await expect(page.getByRole("alert").filter({ hasText: "Not a member" })).toHaveText("Not a member");
  await expect(page.getByRole("link", { name: "← My Ajos" })).toBeVisible();
});
