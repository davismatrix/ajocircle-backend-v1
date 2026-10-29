import { test, expect, type Page, type Route } from "@playwright/test";

const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const group = {
  id: "da26bcbc-121e-4556-a462-814cdd131e4a", name: "Family savings",
  currency: "NGN", contribution_amount: "10000.00", frequency: "MONTHLY",
  payout_type: "ROTATIONAL", start_date: futureDate, status: "DRAFT",
  description: "Our monthly family circle", grace_period_days: 2, late_fee: "0.00",
  created_by: "owner-id", membership_role: "OWNER", payout_position: 1,
};

async function mockAccount(page: Page) {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: {
    id: "owner-id", first_name: "Ada", last_name: "Owner", email: "ada@example.com", phone_number: null, role: "USER",
  } }));
}

async function mockDashboard(page: Page, getGroup: () => typeof group) {
  await page.route(`**/api/backend/ajo-groups/${group.id}/dashboard`, (route) => {
    const current = getGroup();
    return route.fulfill({ json: { group: current, membership: { id: "member-id", user_id: "owner-id", role: current.created_by === "owner-id" ? "OWNER" : "MEMBER", payout_position: 1, status: "ACTIVE" }, next_contribution: null, current_cycle: null, recent_activity: [] } });
  });
}

async function fillGroup(page: Page) {
  await page.getByLabel("Group name").fill("Family savings");
  await page.getByLabel("Description").fill("Our monthly family circle");
  await page.getByLabel("Contribution per member").fill("10000.00");
  await page.getByLabel("Start date").fill(futureDate);
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
  await mockDashboard(page, () => group);
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
    start_date: futureDate, grace_period_days: 2, late_fee: "0",
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
  await page.route(`**/api/backend/ajo-groups/${group.id}/dashboard`, (route) => route.fulfill({ status: 403, json: { detail: "Not a member" } }));
  await page.goto(`/dashboard/ajos/${group.id}`);
  await expect(page.getByRole("alert").filter({ hasText: "Not a member" })).toHaveText("Not a member");
  await expect(page.getByRole("link", { name: "← My Ajos" })).toBeVisible();
});

test("a lost creation response can be recovered after reload with the same key", async ({ page }) => {
  await mockAccount(page);
  const keys: string[] = [];
  await page.route("**/api/backend/ajo-groups", async (route) => {
    if (route.request().method() !== "POST") { await route.fulfill({ json: [group] }); return; }
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1) await route.abort("failed");
    else await route.fulfill({ json: group });
  });
  await page.route(`**/api/backend/ajo-groups/${group.id}`, (route) => route.fulfill({ json: group }));
  await mockDashboard(page, () => group);
  await page.goto("/dashboard/ajos/new");
  await fillGroup(page);
  await page.getByRole("button", { name: "Create draft group" }).click();
  await expect(page.getByRole("button", { name: "Retry group creation" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Group name")).toBeDisabled();
  await expect(page.getByLabel("Group name")).toHaveValue(group.name);
  await page.getByRole("button", { name: "Retry group creation" }).click();
  await expect(page).toHaveURL(`/dashboard/ajos/${group.id}`);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
});

test("owners can edit and cancel a draft", async ({ page }) => {
  await mockAccount(page);
  let current = { ...group };
  await mockDashboard(page, () => current);
  await page.route(`**/api/backend/ajo-groups/${group.id}`, async (route) => {
    if (route.request().method() === "PATCH") current = { ...current, ...route.request().postDataJSON() };
    await route.fulfill({ json: current });
  });
  await page.route(`**/api/backend/ajo-groups/${group.id}/cancel`, async (route) => {
    current.status = "CANCELLED";
    await route.fulfill({ json: current });
  });
  await page.goto(`/dashboard/ajos/${group.id}`);
  await page.getByRole("link", { name: "Edit draft", exact: true }).click();
  await expect(page.getByLabel("Group name")).toHaveValue(group.name);
  await page.getByLabel("Group name").fill("Updated circle");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Updated circle" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel group", exact: true }).click();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit draft", exact: true })).toHaveCount(0);
});

test("members cannot see draft management actions", async ({ page }) => {
  await mockAccount(page);
  await mockDashboard(page, () => ({ ...group, created_by: "another-owner" }));
  await page.goto(`/dashboard/ajos/${group.id}`);
  await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit draft", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel group", exact: true })).toHaveCount(0);
});
