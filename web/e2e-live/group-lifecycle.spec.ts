import { test, expect } from "@playwright/test";

// All requests reach Next.js, FastAPI, and the isolated PostgreSQL database.
// Only the first successful creation response is dropped to exercise safe recovery.
test("register, recover creation, review, edit, discover, and cancel a draft", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const name = `Live circle ${suffix}`;
  const startDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await page.goto("/register");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Owner");
  await page.getByLabel("Email").fill(`live-${suffix}@example.com`);
  await page.getByLabel("Password").fill("safe-test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.getByRole("link", { name: "Create your first group" }).click();
  await page.getByLabel("Group name").fill(name);
  await page.getByLabel("Description").fill("Live database group description");
  await page.getByLabel("Contribution per member").fill("125.50");
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("CAD");
  await page.getByRole("combobox", { name: "Frequency", exact: true }).selectOption("WEEKLY");
  await page.getByLabel("Grace period (days)").fill("2");
  await page.getByLabel("Start date").fill(startDate);

  let dropped = false;
  let createdId = "";
  await page.route("**/api/backend/ajo-groups", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      createdId = (await response.json()).id;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Create draft group" }).click();
  await expect(page.getByRole("button", { name: "Retry group creation" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Retry group creation" }).click();
  await expect(page).toHaveURL(`/dashboard/ajos/${createdId}`);
  await expect(page.getByText("Live database group description", { exact: true })).toBeVisible();
  await expect(page.getByText("CAD 125.50", { exact: true })).toBeVisible();
  await expect(page.getByText("2 days after cycle start", { exact: true })).toBeVisible();
  await expect(page.getByText("CAD 0.00", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Edit draft", exact: true }).click();
  await expect(page.getByLabel("Group name")).toHaveValue(name);
  await page.getByLabel("Group name").fill(`${name} updated`);
  await page.getByLabel("Description").fill("Updated description persisted in PostgreSQL");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: `${name} updated`, exact: true })).toBeVisible();
  await expect(page.getByText("Updated description persisted in PostgreSQL", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← My Ajos" }).click();
  await expect(page.getByRole("heading", { name: `${name} updated`, exact: true })).toHaveCount(1);
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("link", { name: /View draft group/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel group", exact: true }).click();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit draft", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
});
