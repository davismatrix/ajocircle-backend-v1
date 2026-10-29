import { expect, test, type Page } from "@playwright/test";

const id = "da26bcbc-121e-4556-a462-814cdd131e4a";
const today = new Date().toISOString().slice(0, 10);
const group = { id, name: "Family savings", currency: "NGN", contribution_amount: "100.00", frequency: "MONTHLY", payout_type: "ROTATIONAL", start_date: today, status: "ACTIVE", description: null, grace_period_days: 0, late_fee: "0.00", created_by: "owner-id" };
const cycle = { cycle_id: "cycle-id", cycle_number: 1, period_start: today, period_end: today, status: "UPCOMING", expected_amount: "200.00" };
const next = { schedule_id: "schedule-id", due_date: today, expected_amount: "100.00", status: "EXPECTED" };

async function setup(page: Page, role = "MEMBER", status = "ACTIVE") {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: { id: "user-id", first_name: "Ada", last_name: "Owner", email: "ada@example.com", phone_number: null, role: "USER" } }));
  let state = { group: { ...group, status }, membership: { id: "member-id", user_id: "user-id", role, payout_position: 2, status: "ACTIVE" }, next_contribution: status === "ACTIVE" ? next : null, current_cycle: status === "ACTIVE" ? cycle : null, recent_activity: [{ action: "ACTIVATE_AJO", entity_type: "AjoGroup", entity_id: id, created_at: "2026-01-01T12:00:00Z" }] };
  await page.route(`**/api/backend/ajo-groups/${id}/dashboard`, (route) => route.fulfill({ json: state }));
  await page.route(`**/api/backend/ajo-groups/${id}/activation-preview`, (route) => route.fulfill({ json: { group: state.group, members: [{ member_id: "member-id", first_name: "Ada", last_name: "Owner", role, payout_position: 1 }], pending_invitations: 0, preview_hash: "a".repeat(64) } }));
  await page.route(`**/api/backend/ajo-groups/${id}/invitations*`, (route) => route.fulfill({ json: { items: [], page: 1, page_size: 25, total: 0 } }));
  return { get state() { return state; }, set state(value) { state = value; } };
}

test("member sees cycle, payout position and submits a contribution", async ({ page }) => {
  const mock = await setup(page);
  await page.route("**/api/backend/contributions/schedule-id/submit", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ amount: "100.00", payment_method: "Bank transfer", payment_reference: "REF-1" });
    mock.state = { ...mock.state, next_contribution: { ...next, status: "SUBMITTED" } };
    await route.fulfill({ status: 201, json: { id: "contribution-id", status: "SUBMITTED" } });
  });
  await page.goto(`/dashboard/ajos/${id}`);
  await expect(page.getByText("Cycle 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Expected payout: NGN 200.00")).toBeVisible();
  await expect(page.getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByText("Group activated", { exact: true })).toBeVisible();
  await expect(page.getByText("Review submitted contributions")).toHaveCount(0);
  await page.locator("summary").filter({ hasText: "Submit contribution" }).click();
  await page.getByLabel("Payment method").fill("Bank transfer");
  await page.getByLabel("Payment reference").fill("REF-1");
  await page.getByRole("button", { name: "Submit contribution" }).click();
  await expect(page.getByText("Submitted — awaiting verification.")).toBeVisible();
});

test("draft owner activates and sees new schedule", async ({ page }) => {
  const mock = await setup(page, "OWNER", "DRAFT");
  await page.route(`**/api/backend/ajo-groups/${id}/activate`, async (route) => {
    mock.state = { ...mock.state, group: { ...group, status: "ACTIVE" }, next_contribution: next, current_cycle: cycle };
    await route.fulfill({ json: { status: "ACTIVE", ajo_id: id } });
  });
  await page.goto(`/dashboard/ajos/${id}`);
  await expect(page.getByText("A schedule will be created when the group is activated.")).toBeVisible();
  await expect(page.getByText("Invite a member", { exact: true })).toBeVisible();
  await expect(page.getByText("Manage member roles", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review activation" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Confirm activation" }).click();
  await expect(page.getByText("Awaiting your contribution.")).toBeVisible();
  await expect(page.getByText("Cycle 1", { exact: true })).toBeVisible();
});

test("treasurer reviews verified payment details and pagination", async ({ page }) => {
  await setup(page, "TREASURER");
  let verified = false;
  await page.route(`**/api/backend/ajo-groups/${id}/contributions/pending*`, (route) => route.fulfill({ json: { items: verified ? [] : [{ contribution_id: "pay-id", member_id: "m-id", first_name: "Tunde", last_name: "Member", cycle_number: 1, due_date: today, paid_amount: "100.00", payment_method: "Bank transfer", payment_reference: "REF-99" }], page: 1, page_size: 25, total: verified ? 0 : 1 } }));
  await page.route("**/api/backend/contributions/pay-id/verify", (route) => { verified = true; return route.fulfill({ json: { id: "pay-id", status: "VERIFIED" } }); });
  await page.goto(`/dashboard/ajos/${id}`);
  await expect(page.getByRole("button", { name: "Review activation" })).toHaveCount(0);
  await page.getByText("Review submitted contributions").click();
  await expect(page.getByText("Method: Bank transfer · Reference: REF-99")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Verify Tunde Member’s contribution" }).click();
  await expect(page.getByText("No submitted contributions on this page.")).toBeVisible();
});

test("admin cannot manage roles and cancelled groups expose no actions", async ({ page }) => {
  const mock = await setup(page, "ADMIN", "DRAFT");
  await page.goto(`/dashboard/ajos/${id}`);
  await expect(page.getByRole("button", { name: "Review activation" })).toBeVisible();
  await expect(page.getByText("Invite a member", { exact: true })).toBeVisible();
  await expect(page.getByText("Manage member roles", { exact: true })).toHaveCount(0);
  mock.state = { ...mock.state, group: { ...group, status: "CANCELLED" } };
  await page.reload();
  await expect(page.getByText("This group has no contribution schedule.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review activation" })).toHaveCount(0);
  await expect(page.getByText("Invite a member", { exact: true })).toHaveCount(0);
});

test("owner changes a member role and sees the saved value", async ({ page }) => {
  await setup(page, "OWNER", "DRAFT");
  let memberRole = "MEMBER";
  await page.route(`**/api/backend/ajo-groups/${id}/members`, (route) => route.fulfill({ json: [
    { id: "owner", user_id: "user-id", role: "OWNER", payout_position: 1, status: "ACTIVE", first_name: "Ada", last_name: "Owner", email: "ada@example.com", phone_number: null },
    { id: "member", user_id: "other", role: memberRole, payout_position: null, status: "ACTIVE", first_name: "Tunde", last_name: "Member", email: "tunde@example.com", phone_number: null },
  ] }));
  await page.route(`**/api/backend/ajo-groups/${id}/members/member/role`, (route) => {
    memberRole = route.request().postDataJSON().role;
    return route.fulfill({ json: { id: "member", role: memberRole } });
  });
  await page.goto(`/dashboard/ajos/${id}`);
  await page.getByText("Manage member roles", { exact: true }).click();
  await page.getByRole("combobox", { name: "Role for Tunde Member" }).selectOption("TREASURER");
  await expect(page.getByRole("combobox", { name: "Role for Tunde Member" })).toHaveValue("TREASURER");
  expect(memberRole).toBe("TREASURER");
});
