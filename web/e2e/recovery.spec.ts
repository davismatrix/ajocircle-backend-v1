import { expect, test } from "@playwright/test";

const id = "da26bcbc-121e-4556-a462-814cdd131e4a";
const today = new Date().toISOString().slice(0, 10);
const group = { id, name: "Circle", currency: "NGN", contribution_amount: "100.00", frequency: "MONTHLY", payout_type: "ROTATIONAL", start_date: today, status: "ACTIVE", description: null, grace_period_days: 0, late_fee: "0.00", created_by: "owner-id" };
const schedule = { schedule_id: "schedule-id", due_date: today, expected_amount: "100.00", status: "EXPECTED" };

async function setup(page: import("@playwright/test").Page, role: string) {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: { id: "user-id", first_name: "Ada", last_name: "Owner", email: "ada@example.com", phone_number: null, role: "USER" } }));
  let current = schedule;
  await page.route(`**/api/backend/ajo-groups/${id}/dashboard`, (route) => route.fulfill({ json: {
    group, membership: { id: "member-id", user_id: "user-id", role, payout_position: 1, status: "ACTIVE" }, next_contribution: current, current_cycle: null, recent_activity: [],
  } }));
  return { submitted() { current = { ...schedule, status: "SUBMITTED" }; } };
}

test("lost submission and unavailable status keep original payment details across reload", async ({ page }) => {
  const mock = await setup(page, "MEMBER");
  const attempts: unknown[] = [];
  await page.route("**/api/backend/contributions/schedules/schedule-id/status", (route) => route.fulfill({ status: 503, json: { detail: "Unavailable" } }));
  await page.route("**/api/backend/contributions/schedule-id/submit", async (route) => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) await route.abort("failed");
    else { mock.submitted(); await route.fulfill({ status: 201, json: { id: "contribution", status: "SUBMITTED" } }); }
  });
  await page.goto(`/dashboard/ajos/${id}`);
  await page.locator("summary").filter({ hasText: "Submit contribution" }).click();
  await page.getByLabel("Payment method").fill("Bank transfer");
  await page.getByLabel("Payment reference").fill("REF-1");
  await page.getByRole("button", { name: "Submit contribution" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByText("Unable to check submission status. Check again before changing payment details.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Payment reference")).toBeDisabled();
  await expect(page.getByLabel("Payment reference")).toHaveValue("REF-1");
  await page.getByRole("button", { name: "Retry submission" }).click();
  await expect(page.getByText("Submitted — awaiting verification.")).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
});

test("lost verification with unavailable status disables retries until checked", async ({ page }) => {
  await setup(page, "TREASURER");
  let verified = false;
  let statusAvailable = false;
  await page.route(`**/api/backend/ajo-groups/${id}/contributions/pending*`, (route) => route.fulfill({ json: {
    items: verified ? [] : [{ contribution_id: "pay-id", member_id: "m-id", first_name: "Tunde", last_name: "Member", cycle_number: 1, due_date: today, paid_amount: "100.00", payment_method: "Bank", payment_reference: "REF" }], page: 1, page_size: 25, total: verified ? 0 : 1,
  } }));
  await page.route("**/api/backend/contributions/pay-id/verify", async (route) => { verified = true; await route.abort("failed"); });
  await page.route("**/api/backend/contributions/pay-id/status", (route) => statusAvailable
    ? route.fulfill({ json: { schedule_id: "schedule-id", schedule_status: "PAID", contribution_id: "pay-id", contribution_status: "VERIFIED", payment_method: "Bank", payment_reference: "REF" } })
    : route.fulfill({ status: 503, json: { detail: "Unavailable" } }));
  await page.goto(`/dashboard/ajos/${id}`);
  await page.getByText("Review submitted contributions").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Verify Tunde Member’s contribution" }).click();
  await expect(page.getByRole("button", { name: "Verify Tunde Member’s contribution" })).toBeDisabled();
  await expect(page.getByText("Unable to check verification status. Check again before retrying.")).toBeVisible();
  statusAvailable = true;
  await page.getByRole("button", { name: "Check verification status for Tunde Member" }).click();
  await expect(page.getByText("Contribution verified.", { exact: true })).toBeVisible();
  await expect(page.getByText("No submitted contributions on this page.")).toBeVisible();
});

test("pending invitations block activation until an admin cancels them", async ({ page }) => {
  const draft = { ...group, status: "DRAFT" };
  let pending = true;
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: { id: "owner-id", first_name: "Ada", last_name: "Owner", email: "ada@example.com", phone_number: null, role: "USER" } }));
  await page.route(`**/api/backend/ajo-groups/${id}/dashboard`, (route) => route.fulfill({ json: {
    group: draft, membership: { id: "owner-member", user_id: "owner-id", role: "OWNER", payout_position: 1, status: "ACTIVE" }, next_contribution: null, current_cycle: null, recent_activity: [],
  } }));
  await page.route(`**/api/backend/ajo-groups/${id}/activation-preview`, (route) => route.fulfill({ json: {
    group: draft, members: [{ member_id: "owner-member", first_name: "Ada", last_name: "Owner", role: "OWNER", payout_position: 1 }], pending_invitations: pending ? 1 : 0, preview_hash: "a".repeat(64),
  } }));
  await page.route(`**/api/backend/ajo-groups/${id}/invitations?page=1`, (route) => route.fulfill({ json: {
    items: pending ? [{ id: "invite-id", phone_number: "+14165550101", role: "MEMBER", token: "invitation-token", expires_at: "2099-01-01T00:00:00Z" }] : [], page: 1, page_size: 25, total: pending ? 1 : 0,
  } }));
  await page.route(`**/api/backend/ajo-groups/${id}/invitations/invite-id/cancel`, (route) => { pending = false; return route.fulfill({ json: { id: "invite-id", status: "CANCELLED" } }); });
  await page.goto(`/dashboard/ajos/${id}`);
  await page.getByRole("button", { name: "Review activation" }).click();
  await expect(page.getByRole("button", { name: "Confirm activation" })).toBeDisabled();
  await page.getByText("Invite a member", { exact: true }).click();
  await expect(page.getByLabel("Invitation token for +14165550101")).toHaveValue("invitation-token");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel invitation for +14165550101" }).click();
  await expect(page.getByText("No pending invitations on this page.")).toBeVisible();
  await page.getByRole("button", { name: "Review activation" }).click();
  await expect(page.getByRole("button", { name: "Confirm activation" })).toBeEnabled();
});

test("safe replay reports an already verified contribution accurately", async ({ page }) => {
  await setup(page, "MEMBER");
  let attempts = 0;
  await page.route("**/api/backend/contributions/schedules/schedule-id/status", (route) => route.fulfill({ status: 503, json: { detail: "Unavailable" } }));
  await page.route("**/api/backend/contributions/schedule-id/submit", (route) => {
    attempts += 1;
    return attempts === 1 ? route.abort("failed") : route.fulfill({ json: { id: "contribution", status: "VERIFIED" } });
  });
  await page.goto(`/dashboard/ajos/${id}`);
  await page.locator("summary").filter({ hasText: "Submit contribution" }).click();
  await page.getByLabel("Payment method").fill("Bank transfer");
  await page.getByLabel("Payment reference").fill("REF-1");
  await page.getByRole("button", { name: "Submit contribution" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByRole("button", { name: "Retry submission" })).toBeVisible();
  await page.getByRole("button", { name: "Retry submission" }).click();
  await expect(page.getByText("Your contribution has been verified.").first()).toBeVisible();
  expect(attempts).toBe(2);
});
