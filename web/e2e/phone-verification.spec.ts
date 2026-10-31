import { expect, test } from "@playwright/test";

const invitation = "da26bcbc-121e-4556-a462-814cdd131e4a";
const user = { id: "user-id", first_name: "Ada", last_name: "Saver", email: "ada@example.com", phone_number: "+14165550101", phone_verified: false, role: "USER" };

test("invitation remains disabled when Firebase is not configured", async ({ page }) => {
  await page.route("**/api/backend/auth/me", (route) => route.fulfill({ json: user }));
  await page.goto(`/invitations/accept#token=${invitation}`);
  await expect(page.getByText(/Google will send an SMS/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept invitation" })).toBeDisabled();
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Phone verification is not configured" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept invitation" })).toBeDisabled();
});
