import { expect, test, type Page } from "@playwright/test";

const groupId = "08c3544a-673c-4b10-a832-3296e57817f2";
const token = "da26bcbc-121e-4556-a462-814cdd131e4a";
const phone = "+14165550101";
const user = { id: "owner-id", first_name: "Ada", last_name: "Owner", email: "ada@example.com", phone_number: phone, phone_verified: true, role: "USER" };
const group = { id: groupId, name: "Circle", currency: "NGN", contribution_amount: "100.00", frequency: "MONTHLY", payout_type: "ROTATIONAL", start_date: "2099-01-01", status: "DRAFT", description: null, grace_period_days: 0, late_fee: "0.00", created_by: user.id };
async function ownerRoutes(page: Page) {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: user }));
  await page.route(`**/api/backend/ajo-groups/${groupId}/dashboard`, (route) => route.fulfill({ json: { group, membership: { id: "owner-member", user_id: user.id, role: "OWNER", payout_position: 1, status: "ACTIVE" }, next_contribution: null, current_cycle: null, recent_activity: [] } }));
}

for (const available of [true, false]) {
  test(`invitation copying ${available ? "copies the link" : "selects text when clipboard is unavailable"}`, async ({ page }) => {
    await ownerRoutes(page);
    await page.addInitScript((works) => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => {
        if (!works) throw new Error("Clipboard denied");
        document.documentElement.dataset.copied = value;
      } } });
    }, available);
    await page.route(`**/api/backend/ajo-groups/${groupId}/invitations?*`, (route) => route.fulfill({ json: { items: [{ id: "invitation", phone_number: phone, role: "MEMBER", token, expires_at: "2099-01-01T00:00:00Z" }], page: 1, page_size: 25, total: 1 } }));
    await page.goto(`/dashboard/ajos/${groupId}`);
    await page.getByText("Invite a member", { exact: true }).click();
    await page.getByRole("button", { name: `Copy invitation link for ${phone}`, exact: true }).click();
    if (available) {
      await expect(page.getByText("Copied.", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset.copied)).toBe(`http://127.0.0.1:3100/invitations/accept#token=${token}`);
    } else {
      await expect(page.getByText(/Automatic copying is unavailable/)).toBeVisible();
      const input = page.getByLabel(`Invitation link for ${phone}`);
      await expect(input).toBeFocused();
      expect(await input.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe((await input.inputValue()).length);
    }
  });
}

for (const initiallyAvailable of [true, false]) {
  test(`a lost role response is reconciled ${initiallyAvailable ? "immediately" : "after checking the roster"}`, async ({ page }) => {
    await ownerRoutes(page);
    let role = "MEMBER";
    let available = initiallyAvailable;
    let changed = false;
    let mutations = 0;
    await page.route(`**/api/backend/ajo-groups/${groupId}/members`, (route) => changed && !available
      ? route.fulfill({ status: 503, json: { detail: "Unavailable" } })
      : route.fulfill({ json: [{ id: "other", user_id: "other-user", role, payout_position: null, status: "ACTIVE", first_name: "Mina", last_name: "Member", email: "mina@example.com", phone_number: null }] }));
    await page.route(`**/api/backend/ajo-groups/${groupId}/members/other/role`, async (route) => {
      mutations++; role = route.request().postDataJSON().role; changed = true;
      await route.abort("failed");
    });
    await page.goto(`/dashboard/ajos/${groupId}`);
    await page.getByText("Manage member roles", { exact: true }).click();
    const selector = page.getByRole("combobox", { name: "Role for Mina Member" });
    await selector.selectOption("TREASURER");
    if (!initiallyAvailable) {
      await expect(page.getByText(/Unable to confirm the role change/)).toBeVisible();
      await expect(selector).toBeDisabled();
      available = true;
      await page.getByRole("button", { name: "Check member roles" }).click();
    }
    await expect(page.getByText("Role for Mina Member saved as treasurer.")).toBeVisible();
    await expect(selector).toHaveValue("TREASURER");
    expect(mutations).toBe(1);
  });
}

test("a second invitation link on the same page replaces the previous token", async ({ page }) => {
  await ownerRoutes(page);
  await page.route("**/api/backend/ajo-groups/invitations/accept", (route) => route.fulfill({ json: { id: "membership", ajo_group_id: groupId, role: "MEMBER" } }));
  await page.goto(`/invitations/accept#token=${token}`);
  await expect(page.getByLabel("Invitation token")).toHaveValue(token);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText("You joined the group as member.")).toBeVisible();
  await page.evaluate((next) => { window.location.hash = `token=${next}`; }, groupId);
  await expect(page.getByLabel("Invitation token")).toHaveValue(groupId);
  await expect(page).toHaveURL("/invitations/accept");
  expect(await page.evaluate(() => sessionStorage.getItem("ajocircle.invitation-token"))).toBe(groupId);
});


test("signed-in invitees see a warning when token storage is unavailable", async ({ page }) => {
  await ownerRoutes(page);
  await page.addInitScript((oldToken) => {
    const storage = window.sessionStorage;
    storage.setItem("ajocircle.invitation-token", oldToken);
    Object.defineProperty(window, "sessionStorage", { value: {
      getItem: storage.getItem.bind(storage), removeItem: storage.removeItem.bind(storage),
      setItem: () => { throw new Error("Storage unavailable"); },
    } });
  }, groupId);
  await page.goto(`/invitations/accept#token=${token}`);
  await expect(page.getByLabel("Invitation token")).toHaveValue(token);
  await expect(page.getByText(/Keep this token handy/)).toBeVisible();
});
