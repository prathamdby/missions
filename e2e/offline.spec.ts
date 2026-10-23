import { expect, test } from "@playwright/test";

test("the app says when the daemon is unreachable and recovers", async ({
  page,
}) => {
  await page.route("**/api/daemon/**", (route) =>
    route.fulfill({
      body: JSON.stringify({
        error: { code: "daemon_unavailable", message: "Daemon is not running" },
      }),
      contentType: "application/json",
      status: 503,
    })
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({
    timeout: 20_000,
  });
  await page.unroute("**/api/daemon/**");
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByRole("button", { name: "Retry now" })).toBeHidden({
    timeout: 20_000,
  });
});
