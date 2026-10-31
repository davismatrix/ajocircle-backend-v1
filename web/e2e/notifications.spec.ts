import { expect, test, type Page } from "@playwright/test";
import type { InboxNotification } from "@/lib/notifications";

const groupId = "08c3544a-673c-4b10-a832-3296e57817f2";
const firstId = "da26bcbc-121e-4556-a462-814cdd131e4a";
const secondId = "da26bcbc-121e-4556-a462-814cdd131e4b";
const first = { id: firstId, ajo_group_id: groupId, event_type: "INVITATION_ACCEPTED", channel: "IN_APP", status: "DELIVERED", title: "Invitation accepted", body: "You joined a group.", read_at: null as string | null, created_at: "2026-01-01T12:00:00Z" };
const second = { ...first, id: secondId, event_type: "CONTRIBUTION_VERIFIED", title: "Contribution verified", body: "Your payment was verified." };
async function setup(page: Page, items: InboxNotification[] = [first, second]) {
  const state = { items: items.map((item) => ({ ...item })), available: true };
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: { id: "user", first_name: "Mina", last_name: "Saver", email: "mina@example.com", phone_number: null, role: "USER" } }));
  await page.route("**/api/backend/notifications/unread-count", (route) => state.available
    ? route.fulfill({ json: { count: state.items.filter((item) => !item.read_at).length } })
    : route.fulfill({ status: 503, json: { detail: "Count unavailable" } }));
  await page.route("**/api/backend/notifications?*", (route) => {
    if (!state.available) return route.fulfill({ status: 503, json: { detail: "Inbox unavailable" } });
    const query = new URL(route.request().url()).searchParams;
    const records = query.get("unread_only") === "true" ? state.items.filter((item) => !item.read_at) : state.items;
    const offset = Number(query.get("offset"));
    return route.fulfill({ json: records.slice(offset, offset + Number(query.get("limit"))) });
  });
  await page.route("**/api/backend/notifications/*/read", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    const item = state.items.find((item) => item.id === id)!;
    item.read_at = "2026-02-01T12:00:00Z";
    return route.fulfill({ json: item });
  });
  return state;
}

test("inbox links events to records and marks read once while updating the badge", async ({ page }) => {
  const state = await setup(page);
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/backend/notifications/${firstId}/read`, async (route) => {
    requests++; await gate;
    state.items[0].read_at = "2026-02-01T12:00:00Z";
    await route.fulfill({ json: state.items[0] });
  });
  await page.goto("/dashboard/notifications");
  await expect(page.getByRole("link", { name: "Notifications, 2 unread", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View group" })).toHaveAttribute("href", `/dashboard/ajos/${groupId}`);
  await expect(page.getByRole("link", { name: "View contribution history" })).toHaveAttribute("href", `/dashboard/ajos/${groupId}/contributions`);
  const mark = page.getByRole("button", { name: "Mark Invitation accepted as read", exact: true });
  try {
    await mark.click();
    await expect(mark).toBeDisabled();
    await expect(page.getByRole("button", { name: "Mark Contribution verified as read" })).toBeDisabled();
    await mark.evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await expect.poll(() => requests).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("article", { name: "Invitation accepted", exact: true }).getByText("Read", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications, 1 unread", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Mark Invitation accepted as read", exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
});

test("unread filtering removes read notifications and reaches an empty state", async ({ page }) => {
  await setup(page, [first]);
  await page.goto("/dashboard/notifications?unread_only=true");
  await page.getByRole("button", { name: "Mark Invitation accepted as read" }).click();
  await expect(page.getByText("You have no unread notifications.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications, 0 unread", exact: true })).toBeVisible();
  await page.getByLabel("Show notifications").selectOption("false");
  await expect(page).toHaveURL(/unread_only=false&page=1/);
  await expect(page.getByRole("article", { name: "Invitation accepted", exact: true }).getByText("Read", { exact: true })).toBeVisible();
});

test("inbox pagination and unread filtering survive reload and browser back", async ({ page }) => {
  await setup(page, Array.from({ length: 26 }, (_, index) => ({ ...first, id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, title: `Update ${index + 1}` })));
  await page.goto("/dashboard/notifications?unread_only=true");
  await expect(page.getByRole("article")).toHaveCount(25);
  await page.getByRole("link", { name: "Next notifications" }).click();
  await expect(page).toHaveURL(/unread_only=true&page=2/);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Update 26", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Show notifications")).toHaveValue("true");
  await expect(page.getByRole("heading", { name: "Update 26", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("article")).toHaveCount(25);
});

test("inbox and count failures remain actionable and can be refreshed", async ({ page }) => {
  const state = await setup(page);
  state.available = false;
  await page.goto("/dashboard/notifications");
  await expect(page.getByRole("link", { name: "Notifications, unread count unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Inbox unavailable" })).toBeVisible();
  state.available = true;
  await page.getByRole("button", { name: "Retry notifications" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Notifications, 2 unread", exact: true })).toBeVisible();
  state.items.push({ ...first, id: "third", title: "New update" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Notifications, 3 unread", exact: true })).toBeVisible();
});

test("a lost mark-read response reconciles through the refreshed inbox", async ({ page }) => {
  const state = await setup(page);
  await page.route(`**/api/backend/notifications/${firstId}/read`, async (route) => {
    state.items[0].read_at = "2026-02-01T12:00:00Z";
    await route.abort("failed");
  });
  await page.goto("/dashboard/notifications");
  await page.getByRole("button", { name: "Mark Invitation accepted as read" }).click();
  await expect(page.getByRole("article", { name: "Invitation accepted", exact: true }).getByText("Read", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark Invitation accepted as read" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Notifications, 1 unread", exact: true })).toBeVisible();
});

test("payout events link to cycle history and events without a group have no action", async ({ page }) => {
  await setup(page, [{ ...first, event_type: "PAYOUT_RECORDED", title: "Payout recorded" }, { ...second, ajo_group_id: null, title: "Account update" }]);
  await page.goto("/dashboard/notifications");
  await expect(page.getByRole("link", { name: "View cycle history" })).toHaveAttribute("href", `/dashboard/ajos/${groupId}/cycles`);
  await expect(page.getByRole("article", { name: "Account update", exact: true }).getByRole("link")).toHaveCount(0);
});

test("invalid inbox URLs offer recovery without fetching items", async ({ page }) => {
  await setup(page, []);
  await page.goto("/dashboard/notifications?page=0");
  await expect(page.getByRole("alert").filter({ hasText: "invalid page or filter" })).toBeVisible();
  await page.getByRole("link", { name: "Reset inbox filters" }).click();
  await expect(page.getByText("No notifications yet.")).toBeVisible();
});

test("expired sessions preserve the inbox destination during sign-in", async ({ page }) => {
  await setup(page);
  let authenticated = false;
  await page.route("**/api/backend/auth/me", (route) => authenticated
    ? route.fulfill({ json: { id: "user", first_name: "Mina", last_name: "Saver", email: "mina@example.com", phone_number: null, role: "USER" } })
    : route.fulfill({ status: 401, json: { detail: "Not authenticated" } }));
  await page.route("**/api/backend/auth/login", (route) => { authenticated = true; return route.fulfill({ json: { authenticated: true } }); });
  await page.goto("/dashboard/notifications?unread_only=true");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill("mina@example.com");
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/notifications?unread_only=true");
  await expect(page.getByRole("article")).toHaveCount(2);
});
