import { expect, test, type Page } from "@playwright/test";

async function register(page: Page, email: string, phone: string) {
  await page.goto("/register");
  await page.getByLabel("First name").fill("Test");
  await page.getByLabel("Last name").fill("Saver");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone number").fill(phone);
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("owner invites and activates; member submits and owner verifies", async ({ page, browser }) => {
  const suffix = crypto.randomUUID();
  const digits = Date.now().toString().slice(-9) + Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  const phone = `+1${digits}`;
  await register(page, `owner-${suffix}@example.com`, `+2${digits}`);
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  try {
    await register(member, `member-${suffix}@example.com`, phone);
    await page.getByRole("link", { name: "Create your first group" }).click();
    await page.getByLabel("Group name").fill(`Dashboard ${suffix}`);
    await page.getByLabel("Contribution per member").fill("100.00");
    await page.getByLabel("Start date").fill(new Date().toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Create draft group" }).click();
    await expect(page.getByRole("heading", { name: `Dashboard ${suffix}` })).toBeVisible();
    const groupPath = new URL(page.url()).pathname;
    await page.getByText("Invite a member", { exact: true }).click();
    await page.getByLabel("Phone number").fill(phone);
    // The API commits the invitation, but the successful response is lost.
    let invitationDropped = false;
    await page.route(`**/api/backend/ajo-groups/*/invitations`, async (route) => {
      if (route.request().method() === "POST" && !invitationDropped) {
        invitationDropped = true;
        const result = await route.fetch();
        expect(result.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Create invitation" }).click();
    await expect(page.getByLabel(`Invitation token for ${phone}`)).toBeVisible();
    await page.reload();
    await page.getByText("Invite a member", { exact: true }).click();
    const tokenInput = page.getByLabel(`Invitation token for ${phone}`);
    await expect(tokenInput).toBeVisible();
    const token = await tokenInput.inputValue();
    await page.getByRole("button", { name: "Review activation" }).click();
    await expect(page.getByText("1 pending invitation(s) must be accepted or cancelled before activation.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm activation" })).toBeDisabled();
    const accept = await member.evaluate(async (invitationToken) => {
      const response = await fetch("/api/backend/ajo-groups/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: invitationToken }) });
      return response.status;
    }, token);
    expect(accept).toBe(200);
    await page.getByRole("button", { name: "Refresh review" }).click();
    await expect(page.getByRole("button", { name: "Confirm activation" })).toBeEnabled();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Confirm activation" }).click();
    await expect(page.getByText("Review submitted contributions")).toBeVisible();
    await member.goto(groupPath);
    await expect(member.getByText("Awaiting your contribution.")).toBeVisible();
    await expect(member.getByText("Cycle 1", { exact: true })).toBeVisible();
    await member.locator("summary").filter({ hasText: "Submit contribution" }).click();
    await member.getByLabel("Payment method").fill("Bank transfer");
    await member.getByLabel("Payment reference").fill(`REF-${suffix}`);
    let submissionDropped = false;
    await member.route("**/api/backend/contributions/*/submit", async (route) => {
      if (!submissionDropped) { submissionDropped = true; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort("failed"); }
      else await route.continue();
    });
    await member.getByRole("button", { name: "Submit contribution" }).click();
    await expect(member.getByText("Submitted — awaiting verification.")).toBeVisible();
    await page.getByText("Review submitted contributions").click();
    await expect(page.getByText(`Method: Bank transfer · Reference: REF-${suffix}`)).toBeVisible();
    let verificationDropped = false;
    await page.route("**/api/backend/contributions/*/verify", async (route) => {
      if (!verificationDropped) { verificationDropped = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); }
      else await route.continue();
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Verify Test Saver’s contribution" }).click();
    await expect(page.getByText("Contribution verified.", { exact: true })).toBeVisible();
    await expect(page.getByText("No submitted contributions on this page.")).toBeVisible();
    await member.reload();
    await expect(member.getByText("Contribution verified", { exact: true })).toBeVisible();
  } finally { await memberContext.close(); }
});
