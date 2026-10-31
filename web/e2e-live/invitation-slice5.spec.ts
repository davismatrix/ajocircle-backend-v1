import { expect, test, type Page } from "@playwright/test";

async function fillRegistration(page: Page, first: string, last: string, email: string, phone: string) {
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone number").fill(phone);
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
}

// The isolated API uses its test-only provider; Firebase itself is exercised separately.
async function verifyWithTestProvider(page: Page, phone: string) {
  const statuses = await page.evaluate(async (number) => {
    const start = await fetch("/api/backend/auth/phone-verification/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone_number: number }) });
    if (!start.ok) return [start.status];
    const attempt = await start.json();
    const check = await fetch("/api/backend/auth/phone-verification/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attempt_id: attempt.attempt_id, code: "123456" }) });
    return [start.status, check.status];
  }, phone);
  expect(statuses).toEqual([200, 200]);
  await page.reload();
}

test("share an invitation, register, retry acceptance, and manage member roles", async ({ page, browser }) => {
  const suffix = crypto.randomUUID();
  const digits = Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  const phone = `+1${digits}`;
  await page.goto("/register");
  await fillRegistration(page, "Olivia", "Owner", `owner-${suffix}@example.com`, `+2${digits}`);
  await expect(page).toHaveURL("/dashboard");
  await page.getByRole("link", { name: "Create your first group" }).click();
  await page.getByLabel("Group name").fill(`Invitation ${suffix}`);
  await page.getByLabel("Contribution per member").fill("100.00");
  await page.getByLabel("Start date").fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create draft group" }).click();
  await expect(page.getByRole("heading", { name: `Invitation ${suffix}` })).toBeVisible();
  const groupPath = new URL(page.url()).pathname;
  await page.getByText("Invite a member", { exact: true }).click();
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Create invitation" }).click();
  const inviteLink = page.getByLabel(`Invitation link for ${phone}`);
  await expect(inviteLink).toBeVisible();
  const invitationUrl = await inviteLink.inputValue();
  expect(invitationUrl).toContain("/invitations/accept#token=");

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(invitationUrl);
    await expect(guest).toHaveURL(/\/invitations\/accept$/);
    await expect(guest.getByRole("link", { name: "Sign in to continue" })).toBeVisible();
    await guest.getByRole("link", { name: "Create an account" }).click();
    await fillRegistration(guest, "Mina", "Member", `member-${suffix}@example.com`, phone);
    await expect(guest).toHaveURL(/\/invitations\/accept$/);
    await verifyWithTestProvider(guest, phone);
    await expect(guest.getByLabel("Invitation token")).not.toHaveValue("");
    let dropped = false;
    await guest.route("**/api/backend/ajo-groups/invitations/accept", async (route) => {
      if (!dropped) { dropped = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); }
      else await route.continue();
    });
    await guest.getByRole("button", { name: "Accept invitation" }).click();
    await expect(guest.getByRole("alert").filter({ hasText: "Unable to confirm acceptance" })).toBeVisible();
    await guest.reload();
    await guest.getByRole("button", { name: "Accept invitation" }).click();
    await expect(guest.getByText("You joined the group as member.")).toBeVisible();
    await expect(guest.getByRole("link", { name: "View group" })).toHaveAttribute("href", groupPath);
    await guest.getByRole("link", { name: "View group" }).click();
    await expect(guest).toHaveURL(new RegExp(`${groupPath}$`));
    await expect(guest.getByRole("button", { name: "Review activation" })).toHaveCount(0);
    await expect(guest.getByText("Invite a member", { exact: true })).toHaveCount(0);
    await expect(guest.getByText("Manage member roles", { exact: true })).toHaveCount(0);
    await guest.getByText("View members", { exact: true }).click();
    await expect(guest.getByText("Olivia Owner", { exact: false })).toBeVisible();
    await expect(guest.getByRole("combobox")).toHaveCount(0);

    await page.getByText("Manage member roles", { exact: true }).click();
    const role = page.getByRole("combobox", { name: "Role for Mina Member" });
    await role.selectOption("TREASURER");
    await expect(role).toHaveValue("TREASURER");
    await guest.reload();
    await expect(guest.getByText("treasurer", { exact: true })).toBeVisible();
    await expect(guest.getByText("Manage member roles", { exact: true })).toHaveCount(0);
  } finally { await guestContext.close(); }
});
