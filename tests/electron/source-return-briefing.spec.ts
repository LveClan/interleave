import path from "node:path";
import type { SourceReturnBriefing } from "@interleave/core";
import { expect, type Page, test } from "@playwright/test";
import Database from "better-sqlite3";
import { ensureBuilt, launchApp, makeDataDir } from "./launch";

interface Bridge {
  sources: {
    importManual(req: { title: string; body: string; priority: string }): Promise<{ id: string }>;
  };
  inbox: { triage(req: { id: string; action: { kind: string } }): Promise<unknown> };
  queue: {
    schedule(req: { id: string; choice: { kind: string; date: string } }): Promise<unknown>;
  };
  blockProcessing: {
    list(req: { sourceElementId: string }): Promise<{ blocks: { stableBlockId: string }[] }>;
    markProcessed(req: { sourceElementId: string; stableBlockId: string }): Promise<unknown>;
    markNeedsLater(req: { sourceElementId: string; stableBlockId: string }): Promise<unknown>;
  };
  readPoints: {
    set(req: {
      elementId: string;
      documentId: string;
      blockId: string;
      offset: number;
    }): Promise<unknown>;
  };
  sourceReturn: {
    briefing(req: {
      sourceId: string;
      scheduledReturn: boolean;
    }): Promise<{ briefing: SourceReturnBriefing | null }>;
  };
}

function opCount(dir: string) {
  const db = new Database(path.join(dir, "app.sqlite"), { readonly: true });
  try {
    return db.prepare("SELECT count(*) AS n FROM operation_log").get();
  } finally {
    db.close();
  }
}

async function assertCaret(page: Page, blockId: string) {
  // The reader sets the ProseMirror selection without stealing DOM focus.
  await page.locator(".ProseMirror").focus();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        return element?.closest("[data-block-id]")?.getAttribute("data-block-id");
      }),
    )
    .toBe(blockId);
}

test.setTimeout(240_000);
test("queue and process re-entry briefing is accurate, dismissible, navigable and restart-safe", async () => {
  const testInfo = test.info();
  ensureBuilt();
  const dir = makeDataDir();
  let app = await launchApp(dir);
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const url = new URL(page.url());
    const base = `${url.protocol}//${url.host}`;
    const fixture = await page.evaluate(async () => {
      const api = window.appApi as unknown as Bridge;
      const { id } = await api.sources.importManual({
        title: "T130 return fixture",
        priority: "A",
        body: Array.from(
          { length: 18 },
          (_, i) =>
            `Paragraph ${i + 1}. A source returns with its context intact. Reading work remains anchored to this passage.`,
        ).join("\n\n"),
      });
      await api.inbox.triage({ id, action: { kind: "accept" } });
      const { blocks } = await api.blockProcessing.list({ sourceElementId: id });
      const ids = blocks.map((b) => b.stableBlockId);
      await api.readPoints.set({ elementId: id, documentId: id, blockId: ids[4]!, offset: 0 });
      await api.blockProcessing.markProcessed({ sourceElementId: id, stableBlockId: ids[0]! });
      await api.blockProcessing.markNeedsLater({ sourceElementId: id, stableBlockId: ids[9]! });
      await api.queue.schedule({ id, choice: { kind: "manual", date: new Date().toISOString() } });
      return { id, ids };
    });
    const before = opCount(dir);
    const result = await page.evaluate(async (sourceId) => {
      const api = window.appApi as unknown as Bridge;
      const read = await api.sourceReturn.briefing({ sourceId, scheduledReturn: true });
      let rejected = false;
      try {
        await api.sourceReturn.briefing({ sourceId, scheduledReturn: "yes" } as never);
      } catch {
        rejected = true;
      }
      return { ...read, rejected };
    }, fixture.id);
    expect(result.rejected).toBe(true);
    expect(result.briefing).toMatchObject({
      show: true,
      readPctDelta: null,
      stateCounts: { unread: 12, read: 4, needs_later: 1, processed_without_output: 1 },
      nextUnresolvedBlockId: fixture.ids[1],
      firstDeferredBlockId: fixture.ids[9],
    });
    expect(result.briefing?.readPct).toBeCloseTo(5 / 18);
    expect(opCount(dir)).toEqual(before);

    await page.goto(`${base}/source/${fixture.id}`);
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();
    await assertCaret(page, fixture.ids[4]!);
    await expect(page.getByTestId("source-return-briefing")).toHaveCount(0);
    await page.goto(`${base}/queue`);
    await page
      .getByTestId("queue-item")
      .filter({ hasText: "T130 return fixture" })
      .getByTestId("queue-open")
      .click();
    await expect(page).toHaveURL(/entry=queue/);
    const briefing = page.getByTestId("source-return-briefing");
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText("12 unread");
    await expect(briefing).toContainText("1 deferred");
    await expect(briefing).toContainText("Change since last visit unknown");
    await expect(briefing).toBeInViewport();
    await expect(page.locator(`[data-block-id="${fixture.ids[4]}"]`).first()).toBeInViewport();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: testInfo.outputPath("briefing-light.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: testInfo.outputPath("briefing-dark.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.setViewportSize({ width: 900, height: 750 });
    await expect(briefing).toBeInViewport();
    expect(await briefing.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("briefing-narrow.png") });
    await briefing.getByRole("button", { name: "Next unresolved" }).click();
    await assertCaret(page, fixture.ids[1]!);
    await briefing.getByRole("button", { name: "First deferred" }).click();
    await assertCaret(page, fixture.ids[9]!);
    await briefing.getByRole("button", { name: "Dismiss briefing" }).click();
    await expect(briefing).toHaveCount(0);

    await page.goto(`${base}/process`);
    await expect(page.getByTestId("process-source-workbench")).toBeVisible();
    await expect(briefing).toBeVisible();
    await expect(briefing).toBeInViewport();
    await briefing.getByRole("button", { name: "First deferred" }).click();
    await assertCaret(page, fixture.ids[9]!);
    await page.screenshot({ path: testInfo.outputPath("briefing-process.png") });
    await app.close();
    app = await launchApp(dir);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const afterRestart = await page.evaluate(
      (sourceId) =>
        (window.appApi as unknown as Bridge).sourceReturn.briefing({
          sourceId,
          scheduledReturn: true,
        }),
      fixture.id,
    );
    expect(afterRestart.briefing?.stateCounts).toEqual(result.briefing?.stateCounts);
    expect(afterRestart.briefing?.readPctDelta).toBeNull();
    await page.goto(`${base}/source/${fixture.id}?entry=queue&block=${fixture.ids[12]}`);
    await expect(page.getByTestId("source-return-briefing")).toBeVisible();
    await assertCaret(page, fixture.ids[12]!);
    await page.getByRole("button", { name: "Next unresolved" }).click();
    await assertCaret(page, fixture.ids[1]!);
  } finally {
    await app.close();
  }
});
