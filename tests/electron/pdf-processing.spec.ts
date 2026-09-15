import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import Database from "better-sqlite3";
import type { AppApi } from "../../apps/desktop/src/shared/contract";
import { ensureBuilt, launchApp, makeDataDir } from "./launch";
import { buildProcessingPdf } from "./pdf-processing-fixture";

const TEXT_PDF = path.resolve(
  __dirname,
  "../../packages/importers/src/__fixtures__/two-page-text.pdf",
);
const DUE = "2020-01-01T00:00:00.000Z";

test.beforeAll(() => ensureBuilt());
test.setTimeout(240_000);

function baseUrl(page: Page): string {
  const url = new URL(page.url());
  return `${url.protocol}//${url.host}`;
}

async function importPdf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = window.appApi as unknown as AppApi;
    const result = await api.sources.importPdf({});
    if (result.status !== "imported") throw new Error("PDF import was cancelled");
    await api.inbox.triage({ id: result.id, action: { kind: "accept" } });
    await api.queue.schedule({
      id: result.id,
      choice: { kind: "manual", date: "2020-01-01T00:00:00.000Z" },
    });
    return result.id;
  });
}

async function openPdf(page: Page, sourceId: string, search = ""): Promise<void> {
  await page.goto(`${baseUrl(page)}/source/${sourceId}${search}`);
  await expect(page.getByTestId("pdf-page-indicator")).toContainText("of", { timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Processing state", exact: true })).toBeVisible();
}

async function units(page: Page, sourceId: string) {
  return page.evaluate(
    (id) => (window.appApi as unknown as AppApi).processingUnits.open({ sourceId: id }),
    sourceId,
  );
}

async function goToPage(page: Page, number: number): Promise<void> {
  const geometry = await page.getByTestId(`pdf-page-${number}`).evaluate((element) => {
    const root = element.closest(".pdf-reader-scroll");
    return {
      pageHeight: element.getBoundingClientRect().height,
      expectedHeight: (element as HTMLElement).style.height,
      scrollHeight: root?.scrollHeight,
      clientHeight: root?.clientHeight,
    };
  });
  expect(geometry.pageHeight, JSON.stringify(geometry)).toBeCloseTo(
    Number.parseFloat(geometry.expectedHeight),
    0,
  );
  await page.getByTestId(`pdf-page-${number}`).evaluate((element) => {
    const root = element.closest(".pdf-reader-scroll");
    if (!root) throw new Error("PDF scroll container missing");
    root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByTestId("pdf-page-indicator")).toContainText(`Page ${number} of`);
}

async function selectPageText(page: Page, number: number): Promise<void> {
  await page.waitForFunction((n) => {
    return !!document.querySelector(`[data-pdf-page="${n}"] .textLayer span`)?.textContent?.trim();
  }, number);
  await page.evaluate((n) => {
    const span = document.querySelector(`[data-pdf-page="${n}"] .textLayer span`);
    if (!span) throw new Error("PDF text span missing");
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, number);
}

async function assertPainted(page: Page, number: number): Promise<void> {
  await expect
    .poll(() =>
      page.getByTestId(`pdf-page-${number}`).evaluate((element) => {
        const canvas = element.querySelector("canvas");
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !canvas.width || !canvas.height) return 0;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let darkPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (
            pixels[i + 3]! > 0 &&
            pixels[i]! < 180 &&
            pixels[i + 1]! < 180 &&
            pixels[i + 2]! < 180
          )
            darkPixels++;
        }
        return darkPixels;
      }),
    )
    .toBeGreaterThan(100);
}

function audit(dir: string, sourceId: string) {
  const db = new Database(path.join(dir, "app.sqlite"), { readonly: true });
  try {
    const logs = db
      .prepare("SELECT payload FROM operation_log WHERE element_id = ? ORDER BY rowid")
      .all(sourceId) as { payload: string }[];
    return {
      units: db
        .prepare(
          "SELECT stable_block_id, state FROM source_block_processing WHERE source_element_id = ? ORDER BY stable_block_id",
        )
        .all(sourceId),
      locations: db
        .prepare(
          "SELECT element_id, block_ids, page, region, selected_text FROM source_locations WHERE source_element_id = ? ORDER BY element_id",
        )
        .all(sourceId) as {
        element_id: string;
        block_ids: string;
        page: number;
        region: string | null;
        selected_text: string;
      }[],
      relations: db
        .prepare(
          "SELECT from_element_id, to_element_id, relation_type FROM element_relations WHERE to_element_id = ? AND relation_type = 'derived_from' ORDER BY from_element_id",
        )
        .all(sourceId),
      actions: logs.flatMap(({ payload }) => {
        const parsed = JSON.parse(payload) as {
          blockProcessing?: { stableBlockId: string; action: string; state: string };
        };
        return parsed.blockProcessing ? [parsed.blockProcessing] : [];
      }),
      foreignKeys: db.pragma("foreign_key_check"),
    };
  } finally {
    db.close();
  }
}

test("PDF page decisions and partial text/region outputs feed Done, yield and return flows across restart", async () => {
  const testInfo = test.info();
  const dir = makeDataDir();
  let app = await launchApp(dir, { pdfImportPath: TEXT_PDF });
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const id = await importPdf(page);
    await openPdf(page, id);
    await page.goto(`${baseUrl(page)}/process`);
    await expect(page.getByTestId("process-item")).toHaveAttribute("data-element-id", id);
    await page.getByTestId("process-action-open").click();
    await expect(page.getByTestId("pdf-reader")).toBeVisible();
    await assertPainted(page, 1);
    const controls = page.getByRole("region", { name: "Processing state", exact: true });
    expect((await units(page, id)).summary).toMatchObject({
      totalBlocks: 2,
      stateCounts: { unread: 2 },
      unresolvedBlocks: 2,
    });

    await controls
      .getByRole("button", { name: "Mark read (still unresolved)", exact: true })
      .click();
    await expect.poll(async () => (await units(page, id)).blocks[0]?.state).toBe("read");
    await goToPage(page, 2);
    await controls.getByRole("button", { name: "Defer remaining content", exact: true }).click();
    await expect.poll(async () => (await units(page, id)).blocks[1]?.state).toBe("needs_later");
    await controls.getByRole("button", { name: "Undo passage state change", exact: true }).click();
    await expect.poll(async () => (await units(page, id)).blocks[1]?.state).toBe("unread");
    await controls.getByRole("button", { name: "Defer remaining content", exact: true }).click();
    await expect.poll(async () => (await units(page, id)).blocks[1]?.state).toBe("needs_later");
    await selectPageText(page, 2);
    await page.getByTestId("pdf-set-readpoint").click();
    await expect(page.getByTestId("reader-flash")).toContainText("Read-point set on page 2");

    await goToPage(page, 1);
    await selectPageText(page, 1);
    await page.getByTestId("pdf-extract").click();
    await expect.poll(async () => (await units(page, id)).summary.extractedOutputCount).toBe(1);
    await page.getByTestId("pdf-region-mode").click();
    const overlay = page.getByTestId("pdf-region-overlay-1");
    const crop = await overlay.boundingBox();
    const viewport = await page.getByTestId("pdf-reader-scroll").boundingBox();
    if (!crop || !viewport) throw new Error("PDF crop target missing");
    const top = Math.max(crop.y, viewport.y) + 15;
    await page.mouse.move(crop.x + 90, top);
    await page.mouse.down();
    await page.mouse.move(crop.x + 300, top + 65, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("pdf-region-confirm")).toBeVisible();
    await page.getByTestId("pdf-region-caption").fill("T132 region provenance");
    await page.getByTestId("pdf-region-confirm-btn").click();
    await expect.poll(async () => (await units(page, id)).summary.extractedOutputCount).toBe(2);
    await page.getByTestId("pdf-region-mode").click();
    const partial = await units(page, id);
    expect(partial.blocks[0]).toMatchObject({
      state: "read",
      remainingState: "read",
      geometry: { kind: "pdf_page", page: 1 },
    });
    expect(partial.blocks[0]?.outputElementIds).toHaveLength(2);
    expect(partial.summary).toMatchObject({
      unresolvedBlocks: 2,
      terminalBlocks: 0,
      extractedBlockCount: 1,
      extractedOutputCount: 2,
      canMarkDoneWithoutConfirmation: false,
    });
    const consumers = await page.evaluate(async (sourceId) => {
      const api = window.appApi as unknown as AppApi;
      return {
        summary: (await api.blockProcessing.summary({ sourceElementId: sourceId })).summary,
        yield: (await api.sourceYield.list()).rows.find((row) => row.source.id === sourceId),
        briefing: (await api.sourceReturn.briefing({ sourceId, scheduledReturn: true })).briefing,
      };
    }, id);
    expect(consumers.summary).toEqual(partial.summary);
    expect(consumers.yield).toMatchObject({
      readPct: 0.5,
      unresolvedBlocks: 2,
      extractedOutputCount: 2,
    });
    expect(consumers.briefing).toMatchObject({
      readPct: 0.5,
      readPctDelta: null,
      firstDeferredBlockId: "pdf:page:2",
      lastExtraction: { blockId: "pdf:page:1" },
    });
    await page.getByTestId("reader-mark-done").click();
    await expect(page.getByTestId("done-intent-pop")).toContainText("2 blocks still open");
    await expect(page.getByTestId("done-intent-breakdown")).toContainText("1 read, not extracted");
    await expect(page.getByTestId("done-intent-breakdown")).toContainText("1 deferred");
    await page.keyboard.press("Escape");

    await controls.getByRole("button", { name: "Finish remaining content", exact: true }).click();
    await expect.poll(async () => (await units(page, id)).blocks[0]?.state).toBe("extracted");
    await expect(controls).toContainText("1 / 2 resolved");
    await page.evaluate(async (sourceId) => {
      await (window.appApi as AppApi).queue.schedule({
        id: sourceId,
        choice: { kind: "manual", date: new Date().toISOString() },
      });
    }, id);
    await page.goto(`${baseUrl(page)}/queue`);
    await page
      .locator(`[data-testid="queue-item"][data-element-id="${id}"]`)
      .getByTestId("queue-open")
      .click();
    await expect(page).toHaveURL(/entry=queue/);
    const briefing = page.getByTestId("source-return-briefing");
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText("50% read");
    await expect(briefing).toContainText("1 deferred");
    await briefing.getByRole("button", { name: "First deferred", exact: true }).click();
    await expect(page.getByTestId("pdf-page-indicator")).toContainText("Page 2 of 2");
    await expect(page.getByTestId("reader-pdf-progress")).toContainText("page 2 of 2");
    const pending = page.getByTestId("source-pending-rail");
    await pending.getByRole("button", { name: "Pending passages (1)", exact: true }).click();
    await expect(pending.locator("li")).toContainText("Page 2");
    await pending
      .locator("li")
      .getByRole("button", { name: "Mark read (still unresolved)", exact: true })
      .click();
    await expect.poll(async () => (await units(page, id)).blocks[1]?.state).toBe("read");
    await pending.getByRole("button", { name: "Undo passage state change", exact: true }).click();
    await expect.poll(async () => (await units(page, id)).blocks[1]?.state).toBe("needs_later");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await page.screenshot({ path: testInfo.outputPath(`pdf-processing-${theme}.png`) });
    }
    await page.setViewportSize({ width: 900, height: 750 });
    await expect(briefing).toBeInViewport();
    expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("pdf-processing-narrow.png") });
    await page.getByTestId("pdf-reader-scroll").scrollIntoViewIfNeeded();
    const scrollBox = await page.getByTestId("pdf-reader-scroll").boundingBox();
    expect(scrollBox?.height).toBeGreaterThanOrEqual(240);
    expect(
      await page.getByTestId("pdf-page-2").evaluate((element) => {
        const scroller = element.closest(".pdf-reader-scroll");
        if (!scroller) return false;
        scroller.scrollLeft = 0;
        return element.getBoundingClientRect().left >= scroller.getBoundingClientRect().left;
      }),
    ).toBe(true);
    await assertPainted(page, 2);
    await page.screenshot({ path: testInfo.outputPath("pdf-processing-narrow-page.png") });
    const beforeRestart = audit(dir, id);
    expect(beforeRestart.locations).toHaveLength(2);
    expect(
      beforeRestart.locations.every(
        (location) => location.page === 1 && JSON.parse(location.block_ids).length > 0,
      ),
    ).toBe(true);
    expect(beforeRestart.locations.filter((location) => location.region !== null)).toHaveLength(1);
    expect(beforeRestart.relations).toHaveLength(2);
    expect(beforeRestart.foreignKeys).toEqual([]);
    expect(beforeRestart.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stableBlockId: "pdf:page:1", state: "read" }),
        expect.objectContaining({ stableBlockId: "pdf:page:1", state: "processed_without_output" }),
        expect.objectContaining({ stableBlockId: "pdf:page:2", state: "needs_later" }),
        expect.objectContaining({ stableBlockId: "pdf:page:2", state: "unread" }),
      ]),
    );
    await app.close();
    app = await launchApp(dir);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await openPdf(page, id, "?entry=queue");
    await expect(page.getByTestId("source-return-briefing")).toBeVisible();
    await expect(page.getByTestId("pdf-page-indicator")).toContainText("Page 2 of 2");
    expect(audit(dir, id)).toEqual(beforeRestart);
    await page
      .getByRole("region", { name: "Processing state", exact: true })
      .getByRole("button", { name: "Ignore remaining content", exact: true })
      .click();
    await expect
      .poll(async () => (await units(page, id)).summary.canMarkDoneWithoutConfirmation)
      .toBe(true);
    await page.getByTestId("reader-mark-done").click();
    await expect
      .poll(() =>
        page.evaluate(
          async (sourceId) =>
            (await (window.appApi as unknown as AppApi).inspector.get({ id: sourceId })).data
              ?.element.status,
          id,
        ),
      )
      .toBe("done");
  } finally {
    await app.close();
  }
});

test("accepting real OCR reconciles page state and flags live output lineage after restart", async () => {
  const testInfo = test.info();
  const dir = makeDataDir();
  let app = await launchApp(dir, { pdfImportPath: TEXT_PDF });
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.context().setOffline(true);
    const id = await importPdf(page);
    await openPdf(page, id);
    await selectPageText(page, 1);
    await page.getByTestId("pdf-extract").click();
    await expect.poll(async () => (await units(page, id)).summary.extractedOutputCount).toBe(1);
    await page
      .getByRole("region", { name: "Processing state", exact: true })
      .getByRole("button", { name: "Finish remaining content", exact: true })
      .click();
    await expect.poll(async () => (await units(page, id)).blocks[0]?.state).toBe("extracted");
    const lineage = audit(dir, id).locations;
    const originalHash = (await units(page, id)).blocks[0]?.blockContentHash;

    // A crisp page bitmap uses the same PNG -> IPC -> local WASM worker path as Run OCR.
    await page.evaluate(async (sourceId) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1800;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "black";
      ctx.font = "100px Arial";
      ctx.fillText("Corrected Source Notes", 50, 180);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("PNG encoding failed"))),
          "image/png",
        ),
      );
      await (window.appApi as unknown as AppApi).sources.runOcr({
        elementId: sourceId,
        page: 1,
        imagePng: await blob.arrayBuffer(),
      });
    }, id);
    await expect(page.getByTestId("pdf-ocr-suggestion")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("pdf-ocr-text")).toContainText(/Corrected Source Notes/i);
    expect((await units(page, id)).blocks[0]?.state).toBe("extracted");
    await page.getByTestId("pdf-ocr-accept").click();
    await expect(page.getByTestId("pdf-ocr-accepted")).toBeVisible();
    await expect
      .poll(async () => (await units(page, id)).blocks[0]?.state)
      .toBe("stale_after_edit");
    const reconciled = await units(page, id);
    expect(reconciled.blocks[0]?.blockContentHash).not.toBe(originalHash);
    expect(reconciled.summary).toMatchObject({
      totalBlocks: 2,
      staleAfterEditBlocks: 1,
      needsReverifyOutputs: 1,
      extractedOutputCount: 1,
    });
    expect(reconciled.blocks[1]?.state).toBe("unread");
    expect(audit(dir, id).locations).toEqual(lineage);
    await page.getByTestId("reader-mark-done").click();
    await expect(page.getByTestId("done-intent-breakdown")).toContainText("1 stale after edit");
    await expect(page.getByTestId("done-intent-reverify")).toContainText(
      "1 output needs re-verify",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("region", { name: "Processing state", exact: true })
      .getByRole("button", { name: "Mark read (still unresolved)", exact: true })
      .click();
    await expect.poll(async () => (await units(page, id)).blocks[0]?.state).toBe("read");
    expect((await units(page, id)).summary.needsReverifyOutputs).toBe(1);
    await page
      .getByRole("region", { name: "Processing state", exact: true })
      .getByRole("button", { name: "Undo passage state change", exact: true })
      .click();
    await expect
      .poll(async () => (await units(page, id)).blocks[0]?.state)
      .toBe("stale_after_edit");
    await page.screenshot({ path: testInfo.outputPath("pdf-processing-ocr-stale.png") });
    await app.close();
    app = await launchApp(dir);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await openPdf(page, id, "?entry=queue");
    expect((await units(page, id)).summary).toEqual(reconciled.summary);
    expect(audit(dir, id).locations).toEqual(lineage);
    await expect(page.getByTestId("source-return-briefing")).toContainText("1 stale after edit");
    await expect(page.getByTestId("source-pending-rail")).toContainText(
      "1 outputs need verification",
    );
    expect(fs.existsSync(path.join(dir, "assets", "sources", id, "ocr", "page-1.json"))).toBe(true);
    expect(audit(dir, id).foreignKeys).toEqual([]);
  } finally {
    await app.close();
  }
});

test("1000-page PDF remains bounded in the large-collection fixture and survives restart", async () => {
  const testInfo = test.info();
  const dir = makeDataDir();
  const fixture = path.join(dir, "thousand-pages.pdf");
  fs.writeFileSync(fixture, buildProcessingPdf(1000));
  let app = await launchApp(dir, { pdfImportPath: fixture, seedScale: true });
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const importStarted = performance.now();
    const id = await importPdf(page);
    const importMs = performance.now() - importStarted;
    expect(importMs).toBeLessThan(60_000);
    const openStarted = performance.now();
    await openPdf(page, id);
    const openMs = performance.now() - openStarted;
    expect(openMs).toBeLessThan(60_000);
    expect((await units(page, id)).summary.totalBlocks).toBe(1000);
    await assertPainted(page, 1);
    await goToPage(page, 1000);
    await assertPainted(page, 1000);
    expect(
      await page
        .locator("[data-pdf-page] canvas")
        .evaluateAll(
          (canvases) =>
            canvases.filter(
              (canvas) =>
                (canvas as HTMLCanvasElement).width > 0 && (canvas as HTMLCanvasElement).height > 0,
            ).length,
        ),
    ).toBeLessThanOrEqual(5);
    await page
      .getByRole("region", { name: "Processing state", exact: true })
      .getByRole("button", { name: "Defer remaining content", exact: true })
      .click();
    await expect.poll(async () => (await units(page, id)).blocks.at(-1)?.state).toBe("needs_later");
    await page.getByTestId("pdf-set-readpoint").click();
    await expect(page.getByTestId("reader-flash")).toContainText("page 1000");
    const samples = await page.evaluate(async (sourceId) => {
      const api = window.appApi as unknown as AppApi;
      const asOf = new Date().toISOString();
      const timings: Record<string, number[]> = { units: [], summary: [], yield: [], queue: [] };
      for (let i = -1; i < 10; i++) {
        for (const key of ["units", "summary", "yield", "queue"] as const) {
          const start = performance.now();
          if (key === "units") await api.processingUnits.open({ sourceId });
          if (key === "summary") await api.blockProcessing.summary({ sourceElementId: sourceId });
          if (key === "yield") await api.sourceYield.list();
          if (key === "queue") await api.queue.list({ limit: 50, asOf });
          if (i >= 0) timings[key]!.push(performance.now() - start);
        }
      }
      return timings;
    }, id);
    const budgets = { units: 2000, summary: 2000, yield: 10_000, queue: 4000 };
    const timingRows = Object.entries(samples).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
      const budgetMs = budgets[name as keyof typeof budgets];
      expect(p95, `${name} p95, 1000 PDF pages in M20 smoke collection`).toBeLessThan(budgetMs);
      return {
        name,
        samples: values.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95,
        budgetMs,
      };
    });
    await testInfo.attach("pdf-1000-page-performance", {
      body: JSON.stringify({ importMs, openMs, timingRows }, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("pdf-processing-page-1000.png") });
    const saved = audit(dir, id);
    expect(saved.units).toHaveLength(1000);
    expect(saved.foreignKeys).toEqual([]);
    await app.close();
    app = await launchApp(dir);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await openPdf(page, id, "?entry=queue");
    await expect(page.getByTestId("pdf-page-indicator")).toContainText("Page 1000 of 1000");
    expect((await units(page, id)).summary).toMatchObject({
      totalBlocks: 1000,
      unresolvedBlocks: 1000,
      stateCounts: { needs_later: 1 },
    });
    expect(audit(dir, id)).toEqual(saved);
    await expect(page.getByTestId("source-return-briefing")).toContainText("1 deferred");
    await page
      .getByTestId("source-return-briefing")
      .getByRole("button", { name: "First deferred", exact: true })
      .click();
    await expect(page.getByTestId("pdf-page-indicator")).toContainText("Page 1000 of 1000");
    await page.evaluate(
      async ({ sourceId, date }) => {
        await (window.appApi as unknown as AppApi).queue.schedule({
          id: sourceId,
          choice: { kind: "manual", date },
        });
      },
      { sourceId: id, date: DUE },
    );
  } finally {
    await app.close();
  }
});
