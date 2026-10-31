import { expect, test, type Page } from "@playwright/test";

const groupId = "08c3544a-673c-4b10-a832-3296e57817f2";
const memberId = "da26bcbc-121e-4556-a462-814cdd131e4a";
const group = { id: groupId, name: "History Circle", currency: "CAD", contribution_amount: "100.00", frequency: "MONTHLY", payout_type: "ROTATIONAL", start_date: "2026-01-01", status: "ACTIVE", description: null, grace_period_days: 0, late_fee: "0.00", created_by: "owner" };
const contribution = { schedule_id: "schedule", cycle_id: "cycle", cycle_number: 1, member_id: memberId, first_name: "Mina", last_name: "Saver", due_date: "2026-01-01", expected_amount: "100.00", schedule_status: "PAID", contribution_id: "payment", paid_amount: "100.00", contribution_status: "VERIFIED", payment_method: "Bank transfer", payment_reference: "REF-HISTORY", submitted_at: "2026-01-01T12:00:00Z", verified_at: "2026-01-02T12:00:00Z" };
async function setup(page: Page, role = "MEMBER", status = "ACTIVE") {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: { id: "user", first_name: "Mina", last_name: "Saver", email: "mina@example.com", phone_number: null, role: "USER" } }));
  await page.route(`**/api/backend/ajo-groups/${groupId}/dashboard`, (route) => route.fulfill({ json: { group: { ...group, status }, membership: { id: memberId, user_id: "user", role, status: "ACTIVE", payout_position: 1 }, next_contribution: null, current_cycle: null, recent_activity: [] } }));
  await page.route(`**/api/backend/ajo-groups/${groupId}/members`, (route) => route.fulfill({ json: [{ id: memberId, user_id: "user", first_name: "Mina", last_name: "Saver", role: "MEMBER", status: "ACTIVE", payout_position: 1, email: "mina@example.com", phone_number: null }] }));
}

for (const role of ["OWNER", "ADMIN", "TREASURER"]) {
  test(`${role.toLowerCase()} history filters and pagination survive reload and browser back`, async ({ page }) => {
    await setup(page, role);
    await page.route(`**/api/backend/ajo-groups/${groupId}/contributions/history?*`, (route) => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get("member_id")).toBe(memberId);
      return route.fulfill({ json: { items: [{ ...contribution, contribution_status: query.get("status") }], page: Number(query.get("page")), page_size: 10, total: 11 } });
    });
    await page.goto(`/dashboard/ajos/${groupId}/contributions?page=2&page_size=10&status=VERIFIED&member_id=${memberId}`);
    await expect(page.getByRole("combobox", { name: "Member", exact: true })).toHaveValue(memberId);
    await expect(page.getByLabel("Contribution status")).toHaveValue("VERIFIED");
    await expect(page.getByText("11 records · Page 2 of 2 · Newest first")).toBeVisible();
    await expect(page.getByText("REF-HISTORY")).toBeVisible();
    await expect(page.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", /page=1.*status=VERIFIED/);
    await page.reload();
    await expect(page.getByLabel("Records per page")).toHaveValue("10");
    await page.getByLabel("Contribution status").selectOption("SUBMITTED");
    await expect(page).toHaveURL(/page=1.*status=SUBMITTED/);
    await expect(page.getByText("11 records · Page 1 of 2 · Newest first")).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel("Contribution status")).toHaveValue("VERIFIED");
    await expect(page.getByText("11 records · Page 2 of 2 · Newest first")).toBeVisible();
  });
}

test("ordinary members see their own history without a member selector", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/backend/ajo-groups/${groupId}/contributions/history?*`, (route) => route.fulfill({ json: { items: [contribution], total: 1, page: 1, page_size: 25 } }));
  await page.goto(`/dashboard/ajos/${groupId}`);
  await page.getByRole("link", { name: "Contribution history", exact: true }).click();
  await expect(page.getByText("You can view only your own contributions.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Member", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Cycle 1 contribution for Mina Saver" })).toBeVisible();
  await expect(page.getByText("Bank transfer")).toBeVisible();
});

test("cycle history shows recipients, exact amounts and payout filtering", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/backend/ajo-groups/${groupId}/cycles/history?*`, (route) => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { items: [{ cycle_id: "cycle", cycle_number: 1, period_start: "2026-01-01", period_end: "2026-01-31", recipient_member_id: memberId, recipient_first_name: "Mina", recipient_last_name: "Saver", expected_amount: "9007199254740991.99", actual_amount: "0.00", status: "PAID", payout_id: "payout", payout_status: query.get("payout_status") ?? "PAID", paid_at: "2026-02-01T12:00:00Z" }], page: 1, page_size: 25, total: 1 } });
  });
  await page.goto(`/dashboard/ajos/${groupId}/cycles`);
  await expect(page.getByText("CAD 9,007,199,254,740,991.99", { exact: true })).toBeVisible();
  await expect(page.getByText("CAD 0.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Mina Saver", { exact: true })).toBeVisible();
  await page.getByLabel("Payout status").selectOption("PAID");
  await expect(page).toHaveURL(/payout_status=PAID.*page=1/);
  await page.reload();
  await expect(page.getByLabel("Payout status")).toHaveValue("PAID");
});

test("history errors can be retried without losing filters", async ({ page }) => {
  await setup(page);
  let available = false;
  await page.route(`**/api/backend/ajo-groups/${groupId}/contributions/history?*`, (route) => {
    expect(new URL(route.request().url()).searchParams.get("status")).toBe("SUBMITTED");
    return available ? route.fulfill({ json: { items: [{ ...contribution, contribution_status: "SUBMITTED" }], page: 1, page_size: 25, total: 1 } }) : route.fulfill({ status: 503, json: { detail: "History unavailable" } });
  });
  await page.goto(`/dashboard/ajos/${groupId}/contributions?status=SUBMITTED`);
  await expect(page.getByRole("alert").filter({ hasText: "History unavailable" })).toHaveText("History unavailable");
  available = true;
  await page.getByRole("button", { name: "Retry history" }).click();
  await expect(page.getByText("REF-HISTORY")).toBeVisible();
  await expect(page.getByLabel("Contribution status")).toHaveValue("SUBMITTED");
});

test("invalid URL filters are actionable and do not fetch history", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route(`**/api/backend/ajo-groups/${groupId}/contributions/history?*`, (route) => { calls++; return route.fulfill({ json: { items: [], page: 1, page_size: 25, total: 0 } }); });
  await page.goto(`/dashboard/ajos/${groupId}/contributions?page=0&status=INVALID`);
  await expect(page.getByRole("alert").filter({ hasText: "The history URL contains" })).toHaveText("The history URL contains an invalid page or filter.");
  expect(calls).toBe(0);
  await page.getByRole("link", { name: "Reset history filters" }).click();
  await expect(page.getByText("No records match these filters.")).toBeVisible();
});

test("an out-of-range page offers a return to the first filtered page", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/backend/ajo-groups/${groupId}/cycles/history?*`, (route) => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { items: [], total: 2, page: Number(query.get("page")), page_size: 25 } });
  });
  await page.goto(`/dashboard/ajos/${groupId}/cycles?payout_status=PAID&page=9`);
  await expect(page.getByText("No records on this page.")).toBeVisible();
  await page.getByRole("link", { name: "Return to first page" }).click();
  await expect(page).toHaveURL(/payout_status=PAID&page=1/);
});

test("draft groups have a clear history empty state", async ({ page }) => {
  await setup(page, "MEMBER", "DRAFT");
  await page.route(`**/api/backend/ajo-groups/${groupId}/cycles/history?*`, (route) => route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 25 } }));
  await page.goto(`/dashboard/ajos/${groupId}/cycles`);
  await expect(page.getByText("No history yet. Schedules and cycles are created when the group is activated.")).toBeVisible();
});


test("a shared filtered history URL survives signing in", async ({ page }) => {
  await setup(page);
  let authenticated = false;
  await page.route("**/api/backend/auth/me", (route) => authenticated
    ? route.fulfill({ json: { id: "user", first_name: "Mina", last_name: "Saver", email: "mina@example.com", phone_number: null, role: "USER" } })
    : route.fulfill({ status: 401, json: { detail: "Not authenticated" } }));
  await page.route("**/api/backend/auth/login", (route) => { authenticated = true; return route.fulfill({ json: { authenticated: true } }); });
  await page.route(`**/api/backend/ajo-groups/${groupId}/contributions/history?*`, (route) => route.fulfill({ json: { items: [contribution], total: 1, page: 1, page_size: 10 } }));
  const target = `/dashboard/ajos/${groupId}/contributions?status=VERIFIED&page_size=10`;
  await page.goto(target);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill("mina@example.com");
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(target);
  await expect(page.getByLabel("Contribution status")).toHaveValue("VERIFIED");
  await expect(page.getByText("REF-HISTORY")).toBeVisible();
});
