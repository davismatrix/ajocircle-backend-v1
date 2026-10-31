import { expect, test, type Page } from "@playwright/test";

const token = "da26bcbc-121e-4556-a462-814cdd131e4a";
const groupId = "08c3544a-673c-4b10-a832-3296e57817f2";
const user = { id: "user-id", first_name: "Ada", last_name: "Saver", email: "ada@example.com", phone_number: "+14165550101", phone_verified: true, role: "USER" };

async function authRoutes(page: Page, initiallyAuthenticated = false) {
  let signedIn = initiallyAuthenticated;
  await page.route("**/api/backend/auth/me", (route) => signedIn ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: { detail: "Not authenticated" } }));
  await page.route("**/api/backend/auth/login", (route) => { signedIn = true; return route.fulfill({ json: { authenticated: true } }); });
  await page.route("**/api/backend/auth/register", (route) => { signedIn = true; return route.fulfill({ status: 201, json: { authenticated: true } }); });
  await page.route("**/api/backend/auth/logout", (route) => { signedIn = false; return route.fulfill({ json: { authenticated: false } }); });
}

test("invitation link survives sign-in and joins the group", async ({ page }) => {
  await authRoutes(page);
  await page.route("**/api/backend/ajo-groups/invitations/accept", (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    return route.fulfill({ json: { id: "member-id", ajo_group_id: groupId, role: "MEMBER", status: "ACTIVE" } });
  });
  await page.goto(`/invitations/accept#token=${token}`);
  await expect(page.getByLabel("Invitation token")).toHaveValue(token);
  await expect(page).toHaveURL("/invitations/accept");
  await page.getByRole("link", { name: "Sign in to continue" }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/invitations/accept");
  await expect(page.getByLabel("Invitation token")).toHaveValue(token);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText("You joined the group as member.")).toBeVisible();
  await expect(page.getByRole("link", { name: "View group" })).toHaveAttribute("href", `/dashboard/ajos/${groupId}`);
  expect(await page.evaluate(() => sessionStorage.getItem("ajocircle.invitation-token"))).toBeNull();
});

test("registration preserves a pasted token across login and registration links", async ({ page }) => {
  await authRoutes(page);
  await page.goto("/invitations/accept");
  await page.getByLabel("Invitation token").fill(token);
  await page.getByRole("link", { name: "Sign in to continue" }).click();
  await page.getByRole("link", { name: "Create one" }).click();
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Saver");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Phone number").fill(user.phone_number!);
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/invitations/accept");
  await expect(page.getByLabel("Invitation token")).toHaveValue(token);
});

test("lost acceptance response can be retried after reload", async ({ page }) => {
  await authRoutes(page, true);
  let attempts = 0;
  await page.route("**/api/backend/ajo-groups/invitations/accept", (route) => {
    attempts += 1;
    return attempts === 1 ? route.abort("failed") : route.fulfill({ json: { id: "member-id", ajo_group_id: groupId, role: "MEMBER", status: "ACTIVE" } });
  });
  await page.goto(`/invitations/accept#token=${token}`);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Unable to confirm acceptance" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Invitation token")).toHaveValue(token);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText("You joined the group as member.")).toBeVisible();
  expect(attempts).toBe(2);
});

test("invalid and rejected invitations show actionable errors; account switching retains token", async ({ page }) => {
  await authRoutes(page, true);
  await page.route("**/api/backend/ajo-groups/invitations/accept", (route) => route.fulfill({ status: 403, json: { detail: "Your phone number does not match this invitation" } }));
  await page.goto("/invitations/accept");
  await page.getByLabel("Invitation token").fill("invalid");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid invitation token" })).toBeVisible();
  await page.getByLabel("Invitation token").fill(token);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your phone number does not match" })).toBeVisible();
  await page.getByRole("button", { name: "Use another account" }).click();
  await expect(page.getByRole("link", { name: "Sign in to continue" })).toBeVisible();
  await expect(page.getByLabel("Invitation token")).toHaveValue(token);
});

test("untrusted return paths cannot redirect login to another site", async ({ page }) => {
  await authRoutes(page);
  await page.goto("/login?next=https%3A%2F%2Fevil.example");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
});

test("ordinary members can view the roster but cannot manage roles", async ({ page }) => {
  await authRoutes(page, true);
  const group = { id: groupId, name: "Circle", currency: "NGN", contribution_amount: "100.00", frequency: "MONTHLY", payout_type: "ROTATIONAL", start_date: "2099-01-01", status: "DRAFT", description: null, grace_period_days: 0, late_fee: "0.00", created_by: "owner-id" };
  await page.route(`**/api/backend/ajo-groups/${groupId}/dashboard`, (route) => route.fulfill({ json: { group, membership: { id: "member-id", user_id: "user-id", role: "MEMBER", payout_position: null, status: "ACTIVE" }, next_contribution: null, current_cycle: null, recent_activity: [] } }));
  await page.route(`**/api/backend/ajo-groups/${groupId}/members`, (route) => route.fulfill({ json: [
    { id: "owner", user_id: "owner-id", role: "OWNER", payout_position: 1, status: "ACTIVE", first_name: "Tunde", last_name: "Owner", email: "owner@example.com", phone_number: null },
    { id: "member-id", user_id: "user-id", role: "MEMBER", payout_position: null, status: "ACTIVE", first_name: "Ada", last_name: "Saver", email: "ada@example.com", phone_number: null },
  ] }));
  await page.goto(`/dashboard/ajos/${groupId}`);
  await expect(page.getByRole("button", { name: "Review activation" })).toHaveCount(0);
  await expect(page.getByText("Invite a member", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Manage member roles", { exact: true })).toHaveCount(0);
  await page.getByText("View members", { exact: true }).click();
  await expect(page.getByText("Tunde Owner")).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText("owner@example.com")).toHaveCount(0);
});

for (const detail of ["Invitation has expired", "Invitation is no longer pending"]) {
  test(`shows ${detail.toLowerCase()} without discarding the token`, async ({ page }) => {
    await authRoutes(page, true);
    await page.route("**/api/backend/ajo-groups/invitations/accept", (route) => route.fulfill({ status: 409, json: { detail } }));
    await page.goto(`/invitations/accept#token=${token}`);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("alert").filter({ hasText: detail })).toBeVisible();
    await expect(page.getByLabel("Invitation token")).toHaveValue(token);
  });
}
