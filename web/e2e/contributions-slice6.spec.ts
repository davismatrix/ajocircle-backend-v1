import { expect, test, type Page } from "@playwright/test";

const id = "da26bcbc-121e-4556-a462-814cdd131e4a";
const group = { id, name: "Circle", currency: "CAD", contribution_amount: "100.00", frequency: "MONTHLY", payout_type: "ROTATIONAL", start_date: "2026-01-01", status: "ACTIVE", description: null, grace_period_days: 0, late_fee: "0.00", created_by: "owner" };
async function setup(page: Page, role = "MEMBER") {
  let dashboardUnavailable = false;
  let scheduleId = "schedule";
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: { id: "user", first_name: "Ada", last_name: "Saver", email: "ada@example.com", phone_number: null, role: "USER" } }));
  await page.route(`**/api/backend/ajo-groups/${id}/dashboard`, (route) => dashboardUnavailable
    ? route.fulfill({ status: 503, json: { detail: "Dashboard unavailable" } })
    : route.fulfill({ json: { group, membership: { id: "member", user_id: "user", role, payout_position: 1, status: "ACTIVE" }, next_contribution: { schedule_id: scheduleId, expected_amount: "100.00", due_date: "2026-01-01", status: "EXPECTED" }, current_cycle: null, recent_activity: [] } }));
  return { failDashboard() { dashboardUnavailable = true; }, advanceSchedule() { scheduleId = "next-schedule"; } };
}

test("review, edit and confirm a contribution once; retain confirmation when dashboard refresh fails", async ({ page }) => {
  const mock = await setup(page);
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/backend/contributions/schedule/submit", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ amount: "100.00", payment_method: "Bank transfer", payment_reference: "REF-EDITED" });
    await gate;
    mock.failDashboard();
    await route.fulfill({ status: 201, json: { status: "SUBMITTED" } });
  });
  await page.goto(`/dashboard/ajos/${id}`);
  await page.locator("summary").filter({ hasText: "Submit contribution" }).click();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("CAD 100.00");
  await page.getByLabel("Payment method").fill("Bank transfer");
  await page.getByLabel("Payment reference").fill("REF-ORIGINAL");
  await page.getByRole("button", { name: "Submit contribution", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review contribution" })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Edit payment details" }).click();
  await expect(page.getByLabel("Payment reference")).toHaveValue("REF-ORIGINAL");
  await page.getByLabel("Payment reference").fill(" REF-EDITED ");
  await page.getByRole("button", { name: "Submit contribution", exact: true }).click();
  try {
    await page.getByRole("button", { name: "Confirm submission" }).click();
    await expect(page.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Edit payment details" })).toBeDisabled();
    await page.getByRole("form", { name: "Review contribution" }).evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    await expect.poll(() => requests).toBe(1);
  } finally { release(); }
  await expect(page.getByText("Your contribution was submitted and is awaiting verification.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unable to load this group" })).toBeVisible();
  expect(requests).toBe(1);
});

test("whitespace-only payment details cannot reach confirmation", async ({ page }) => {
  await setup(page);
  await page.goto(`/dashboard/ajos/${id}`);
  await page.locator("summary").filter({ hasText: "Submit contribution" }).click();
  await page.getByLabel("Payment method").fill("  ");
  await page.getByLabel("Payment reference").fill("  ");
  await page.getByRole("button", { name: "Submit contribution", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "blank spaces are not sufficient" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm submission" })).toHaveCount(0);
});

test("uncertain verification blocks other payments until its status is checked", async ({ page }) => {
  await setup(page, "TREASURER");
  let available = false;
  let verified = false;
  const items = ["Mina", "Tunde"].map((name) => ({ contribution_id: name, member_id: name, first_name: name, last_name: "Saver", cycle_number: 1, due_date: "2026-01-01", paid_amount: "100.00", payment_method: "Bank", payment_reference: "REF" }));
  await page.route(`**/api/backend/ajo-groups/${id}/contributions/pending?*`, (route) => route.fulfill({ json: { items: verified ? items.slice(1) : items, total: verified ? 1 : 2, page: 1, page_size: 25 } }));
  await page.route("**/api/backend/contributions/Mina/verify", (route) => route.abort("failed"));
  await page.route("**/api/backend/contributions/Mina/status", (route) => available
    ? route.fulfill({ json: { contribution_status: "VERIFIED" } })
    : route.fulfill({ status: 503, json: { detail: "Unavailable" } }));
  await page.goto(`/dashboard/ajos/${id}`);
  await page.getByText("Review submitted contributions", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Verify Mina Saver’s contribution" }).click();
  await expect(page.getByText("Unable to check verification status. Check again before retrying.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify Tunde Saver’s contribution" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  available = true; verified = true;
  await page.getByRole("button", { name: "Check verification status for Mina Saver" }).click();
  await expect(page.getByText("Contribution verified.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify Tunde Saver’s contribution" })).toBeEnabled();
});


test("a verified replay leaves the next schedule with a fresh submission form", async ({ page }) => {
  const mock = await setup(page);
  await page.route("**/api/backend/contributions/schedule/submit", (route) => {
    mock.advanceSchedule();
    return route.fulfill({ status: 200, json: { status: "VERIFIED" } });
  });
  await page.goto(`/dashboard/ajos/${id}`);
  await page.locator("summary").filter({ hasText: "Submit contribution" }).click();
  await page.getByLabel("Payment method").fill("Bank transfer");
  await page.getByLabel("Payment reference").fill("OLD-REF");
  await page.getByRole("button", { name: "Submit contribution", exact: true }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByText("Your contribution has been verified.").first()).toBeVisible();
  await expect(page.getByLabel("Payment method")).toHaveValue("");
  await expect(page.getByLabel("Payment reference")).toHaveValue("");
  await page.locator("summary").filter({ hasText: "Submit contribution" }).click();
  await expect(page.getByLabel("Payment method")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit contribution", exact: true })).toBeEnabled();
});
