import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import Database from "better-sqlite3";
import type { AppApi } from "../../apps/web/src/lib/appApi";
import { ensureBuilt, launchApp, makeDataDir } from "./launch";

async function pending(page: Page, sourceId: string) {
  return page.evaluate(async (id) => {
    const api = window.appApi as AppApi;
    const [list, summary, briefing] = await Promise.all([
      api.sourcePending.list({ sourceId: id }),
      api.blockProcessing.summary({ sourceElementId: id }),
      api.sourceReturn.briefing({ sourceId: id, scheduledReturn: true }),
    ]);
    return { list: list.pending, summary: summary.summary, briefing: briefing.briefing };
  }, sourceId);
}

test("deferred passages resolve and undo through both readers with durable counts", async () => {
  test.setTimeout(120_000);
  ensureBuilt();
  const dir = makeDataDir();
  let app = await launchApp(dir);
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const url = new URL(page.url());
    const base = `${url.protocol}//${url.host}`;
    const fixture = await page.evaluate(async () => {
      const api = window.appApi as AppApi;
      const { id } = await api.sources.importManual({
        title: "T131 deferred passages",
        priority: "A",
        body: Array.from(
          { length: 8 },
          (_, i) => `Passage ${i + 1}. This reading decision must remain visible on return.`,
        ).join("\n\n"),
      });
      await api.inbox.triage({ id, action: { kind: "accept" } });
      const { blocks } = await api.blockProcessing.list({ sourceElementId: id });
      const ids = blocks.map((block) => block.stableBlockId);
      if (!ids[1] || !ids[3]) throw new Error("Missing fixture blocks");
      return { id, first: ids[1], second: ids[3] };
    });
    await page.goto(`${base}/source/${fixture.id}`);
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();
    for (const blockId of [fixture.first, fixture.second]) {
      await page.locator(`.reader .ProseMirror [data-block-id="${blockId}"]`).hover();
      await page.getByTestId(`processed-needs-later-${blockId}`).click();
    }
    await expect.poll(async () => (await pending(page, fixture.id)).list?.entries.length).toBe(2);
    await page.getByTestId("reader-mark-done").click();
    await expect(page.getByTestId("done-intent-pop")).toContainText("2 deferred");
    await page.keyboard.press("Escape");
    await page.evaluate(async (id) => {
      await (window.appApi as AppApi).queue.schedule({
        id,
        choice: { kind: "manual", date: new Date().toISOString() },
      });
    }, fixture.id);
    await page.goto(`${base}/queue`);
    await page
      .getByTestId("queue-item")
      .filter({ hasText: "T131 deferred passages" })
      .getByTestId("queue-open")
      .click();
    const rail = page.getByTestId("source-pending-rail");
    await expect(
      rail.getByRole("button", { name: "Pending passages (2)", exact: true }),
    ).toBeVisible();
    await rail.getByRole("button", { name: "Pending passages (2)", exact: true }).click();
    await expect(rail.locator("li")).toHaveCount(2);
    await expect(rail.locator("li").first()).toContainText("Passage 2");
    await expect(rail.locator("li").last()).toContainText("Passage 4");
    await page.locator(".ProseMirror").focus();
    await page.keyboard.press("Alt+]");
    await expect(rail.locator('li[data-active="true"]')).toContainText("Passage 2");
    await page.keyboard.press("Alt+]");
    await expect(rail.locator('li[data-active="true"]')).toContainText("Passage 4");
    await page.keyboard.press("Alt+[");
    await expect(rail.locator('li[data-active="true"]')).toContainText("Passage 2");

    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await page.screenshot({ path: test.info().outputPath(`pending-${theme}.png`) });
    }
    await page.setViewportSize({ width: 900, height: 750 });
    await expect(rail).toBeInViewport();
    expect(await rail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("pending-narrow.png") });
    const before = await pending(page, fixture.id);
    await rail
      .locator("li")
      .first()
      .getByRole("button", { name: "Mark read (still unresolved)", exact: true })
      .click();
    await expect
      .poll(async () => (await pending(page, fixture.id)).summary.stateCounts.needs_later)
      .toBe(1);
    await expect(rail.locator("li")).toHaveCount(1);
    const after = await pending(page, fixture.id);
    expect(after.summary.unresolvedBlocks).toBe(before.summary.unresolvedBlocks);
    expect(after.briefing?.stateCounts.needs_later).toBe(1);
    await rail.getByRole("button", { name: "Undo passage state change" }).click();
    await expect(rail.locator("li")).toHaveCount(2);
    await expect
      .poll(async () => (await pending(page, fixture.id)).summary.stateCounts.needs_later)
      .toBe(2);
    await rail
      .locator("li")
      .first()
      .getByRole("button", { name: "Resume as unread", exact: true })
      .click();
    await expect(rail.locator("li")).toHaveCount(1);
    await page.goto(`${base}/process`);
    await expect(page.getByTestId("process-source-workbench")).toBeVisible();
    await page
      .getByTestId("source-pending-rail")
      .getByRole("button", { name: "Pending passages (1)", exact: true })
      .click();
    await expect(page.getByTestId("source-pending-rail").locator("li")).toContainText("Passage 4");
    await page.screenshot({ path: test.info().outputPath("pending-process.png") });
    const persisted = await pending(page, fixture.id);
    await app.close();
    const db = new Database(path.join(dir, "app.sqlite"), { readonly: true });
    try {
      expect(db.pragma("foreign_key_check")).toEqual([]);
      const count = db
        .prepare("SELECT count(*) AS count FROM operation_log WHERE element_id = ?")
        .get(fixture.id) as { count: number };
      expect(count.count).toBeGreaterThan(4);
    } finally {
      db.close();
    }
    app = await launchApp(dir);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    expect((await pending(page, fixture.id)).summary).toEqual(persisted.summary);
    await page.goto(`${base}/source/${fixture.id}?entry=queue`);
    const restartedRail = page.getByTestId("source-pending-rail");
    await restartedRail.getByRole("button", { name: "Pending passages (1)", exact: true }).click();
    await expect(restartedRail.locator("li")).toContainText("Passage 4");
    await restartedRail
      .locator("li")
      .getByRole("button", { name: "Mark read (still unresolved)", exact: true })
      .click();
    await expect(
      restartedRail.getByRole("button", { name: "Pending passages (0)", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await pending(page, fixture.id)).summary.stateCounts.needs_later)
      .toBe(0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
