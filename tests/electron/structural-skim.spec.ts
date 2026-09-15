import fs from "node:fs";
import path from "node:path";
import type { SourceStructure, StructureRange } from "@interleave/core";
import { expect, type Locator, type Page, test } from "@playwright/test";
import Database from "better-sqlite3";
import type { AppApi } from "../../apps/web/src/lib/appApi";
import { ensureBuilt, launchApp, makeDataDir } from "./launch";
import { structuralSkimPdf } from "./structural-skim-fixture";

type Bridge = Pick<
  AppApi,
  | "sources"
  | "sourceStructure"
  | "inbox"
  | "inspector"
  | "queue"
  | "readPoints"
  | "processingUnits"
  | "blockProcessing"
>;

test.setTimeout(300_000);
test.beforeAll(() => ensureBuilt());

async function firstPage(app: Awaited<ReturnType<typeof launchApp>>) {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !!window.appApi);
  return page;
}

async function openSource(page: Page, id: string) {
  const url = new URL(page.url());
  await page.goto(`${url.protocol}//${url.host}/source/${id}`);
}

async function structure(page: Page, sourceId: string): Promise<SourceStructure> {
  return page.evaluate(
    (sourceId) => (window.appApi as unknown as Bridge).sourceStructure.list({ sourceId }),
    sourceId,
  );
}

async function reader(page: Page, topicId: string) {
  return page.evaluate(
    (topicId) => (window.appApi as unknown as Bridge).sourceStructure.reader({ topicId }),
    topicId,
  );
}

async function queue(page: Page, daysAhead = 0) {
  return page.evaluate(
    (asOf) => (window.appApi as unknown as Bridge).queue.list({ asOf, limit: 200 }),
    new Date(Date.now() + daysAhead * 86_400_000).toISOString(),
  );
}

async function accept(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const api = window.appApi as unknown as Bridge;
    await api.inbox.triage({ id, action: { kind: "accept" } });
    await api.queue.schedule({
      id,
      choice: { kind: "manual", date: new Date().toISOString() },
    });
  }, id);
}

async function openSkim(page: Page, sourceId: string) {
  await openSource(page, sourceId);
  const skim = page.getByRole("region", { name: "Structural skim", exact: true });
  await skim.getByRole("button", { name: "Structural skim", exact: true }).click();
  await expect(skim.locator("li").first()).toBeVisible();
  return skim;
}

async function choose(skim: Locator, title: string, verdict: string) {
  await skim
    .getByRole("combobox", { name: `${title}: Verdict`, exact: true })
    .selectOption(verdict);
}

async function apply(skim: Locator) {
  await skim.getByRole("button", { name: "Apply skim", exact: true }).click();
  await expect(skim.getByRole("alert")).toHaveCount(0);
  await expect(skim.getByRole("button", { name: "Apply skim", exact: true })).toBeDisabled();
  await expect(skim.getByRole("button", { name: "Undo section batch", exact: true })).toBeEnabled();
  await expect(skim.getByRole("alert")).toHaveCount(0);
}

function assigned(data: SourceStructure, title: string) {
  const range = data.ranges.find((range) => range.title === title);
  if (!range?.topicId) throw new Error(`Assigned section missing: ${title}`);
  return { ...range, topicId: range.topicId };
}

function audit(dir: string, sourceId: string) {
  const db = new Database(path.join(dir, "app.sqlite"), { readonly: true });
  try {
    const operations = db.prepare("SELECT payload FROM operation_log").all() as {
      payload: string;
    }[];
    return {
      sections: db.prepare("SELECT * FROM source_sections WHERE source_id = ?").all(sourceId),
      operations: operations.map((row) => JSON.parse(row.payload)),
      foreignKeyViolations: db.pragma("foreign_key_check"),
      integrity: db.pragma("integrity_check", { simple: true }),
    };
  } finally {
    db.close();
  }
}

async function screenshots(page: Page, surface: Locator, prefix: string) {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await expect(surface).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath(`${prefix}-light.png`) });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: test.info().outputPath(`${prefix}-dark.png`) });
  await page.setViewportSize({ width: 900, height: 750 });
  await expect(surface).toBeInViewport();
  expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath(`${prefix}-narrow.png`) });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 1360, height: 900 });
}

test("300-page PDF outline triage, chapter queue, whole-batch undo and restart", async () => {
  const dir = makeDataDir();
  const pdfPath = path.join(dir, "T134-300-page-book.pdf");
  fs.writeFileSync(pdfPath, structuralSkimPdf());
  let app = await launchApp(dir, { pdfImportPath: pdfPath });
  try {
    let page = await firstPage(app);
    await page.getByTestId("nav-inbox").click();
    await page.getByTestId("inbox-import-import-pdf").click();
    await expect(page.getByTestId("inbox-row")).toHaveCount(1, { timeout: 60_000 });
    const sourceId = await page.evaluate(async () => {
      const result = await (window.appApi as unknown as Bridge).inbox.list();
      const id = result.items[0]?.id;
      if (!id) throw new Error("PDF source missing");
      return id;
    });
    await accept(page, sourceId);
    const initial = await structure(page, sourceId);
    expect(initial.format).toBe("pdf");
    expect(initial.units).toHaveLength(300);
    expect(initial.ranges.map((range) => range.title)).toEqual([
      "Front matter",
      ...Array.from({ length: 14 }, (_, i) => `Chapter ${String(i + 2).padStart(2, "0")}`),
    ]);
    expect(initial.ranges.every((range) => range.unitIds.length === 20)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "assets", "sources", sourceId, "original.pdf"))).toEqual(
      fs.readFileSync(pdfPath),
    );
    const skim = await openSkim(page, sourceId);
    await expect(skim.locator("li")).toHaveCount(15);
    const verdictStarted = performance.now();
    for (const [index, range] of initial.ranges.entries()) {
      await choose(
        skim,
        range.title,
        index === 0 ? "ignore" : index === 14 ? "extract_worthy" : "later",
      );
    }
    await skim
      .getByRole("combobox", { name: "Chapter 15: Priority", exact: true })
      .selectOption("0.875");
    await apply(skim);
    const verdictMs = performance.now() - verdictStarted;
    await test.info().attach("300-page-triage-timing", {
      body: JSON.stringify({
        pages: 300,
        sections: 15,
        verdictMs,
        excludes: "fixture generation, import, initial outline load",
      }),
      contentType: "application/json",
    });
    expect(verdictMs).toBeLessThan(60_000);
    const firstPass = await structure(page, sourceId);
    expect(firstPass.ranges.every((range) => range.topicId && range.verdict)).toBe(true);
    const currentQueue = await queue(page);
    expect(currentQueue.items.map((item) => item.id)).toEqual([
      assigned(firstPass, "Chapter 15").topicId,
    ]);
    expect(currentQueue.items[0]?.sectionSourceTitle).toBeTruthy();
    const afterApply = audit(dir, sourceId);
    expect(afterApply.sections).toHaveLength(15);
    expect(afterApply.operations.filter((payload) => payload.skimApply)).toHaveLength(1);
    expect(afterApply.foreignKeyViolations).toEqual([]);
    expect(afterApply.integrity).toBe("ok");
    await screenshots(page, skim, "pdf-skim");

    await skim.getByRole("button", { name: "Undo section batch", exact: true }).click();
    await expect(skim.getByRole("button", { name: "Undo section batch", exact: true })).toHaveCount(
      0,
    );
    expect(
      (await structure(page, sourceId)).ranges.every((range) => !range.topicId && !range.verdict),
    ).toBe(true);
    expect(audit(dir, sourceId).sections).toHaveLength(0);
    expect((await queue(page)).items.map((item) => item.id)).toEqual([sourceId]);
    for (const [index, range] of initial.ranges.entries()) {
      await choose(
        skim,
        range.title,
        index === 0 ? "ignore" : index === 14 ? "extract_worthy" : "later",
      );
    }
    await apply(skim);
    const current = await structure(page, sourceId);
    const selected = assigned(current, "Chapter 15");
    const deferred = assigned(current, "Chapter 02");
    expect((await queue(page, 8)).items.map((item) => item.id)).toEqual(
      expect.arrayContaining(
        current.ranges.filter((range) => range.verdict !== "ignore").map((range) => range.topicId),
      ),
    );
    expect(
      (await queue(page, 8)).items.some(
        (item) => item.id === sourceId || item.id === assigned(current, "Front matter").topicId,
      ),
    ).toBe(false);
    expect(
      (await reader(page, deferred.topicId))?.blocks.every(
        (block) => block.state === "needs_later",
      ),
    ).toBe(true);
    const url = new URL(page.url());
    await page.goto(`${url.protocol}//${url.host}/queue`);
    const row = page.getByTestId("queue-item").filter({ hasText: "Chapter 15" });
    await expect(row).toContainText("Section of");
    await row.getByTestId("queue-open").click();
    await expect(page).toHaveURL(new RegExp(`/source/${selected.topicId}`));
    await expect(page.locator(".section-reader")).toBeVisible();
    await expect(page.getByTestId("pdf-page-281")).toBeVisible();
    await expect(page.getByTestId("pdf-page-1")).toHaveCount(0);
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-pdf-page="281"] canvas');
      if (!canvas?.width || !canvas.height) return false;
      const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels?.some((value, index) => index % 4 !== 3 && value < 180) ?? false;
    });
    await page.waitForFunction(
      () => !!document.querySelector('[data-pdf-page="281"] .textLayer span')?.textContent,
    );
    await page.evaluate(() => {
      const span = document.querySelector('[data-pdf-page="281"] .textLayer span');
      if (!span) throw new Error("PDF text missing");
      const range = document.createRange();
      range.selectNodeContents(span);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await page.getByTestId("pdf-set-readpoint").click();
    const point = await page.evaluate(
      (elementId) => (window.appApi as unknown as Bridge).readPoints.get({ elementId }),
      selected.topicId,
    );
    expect((await reader(page, selected.topicId))?.blockPages[point.readPoint?.blockId ?? ""]).toBe(
      281,
    );
    expect(
      (
        await page.evaluate(
          (elementId) => (window.appApi as unknown as Bridge).readPoints.get({ elementId }),
          sourceId,
        )
      ).readPoint,
    ).toBeNull();
    await screenshots(page, page.locator(".section-reader__toolbar").first(), "pdf-section-reader");
    await page.getByTestId("done-intent-trigger").click();
    await expect(page.getByTestId("done-intent-breakdown")).toContainText("20 unread");
    await page.getByTestId("done-intent-finished").click();
    await expect
      .poll(async () => (await reader(page, selected.topicId))?.summary.terminalBlocks)
      .toBe(20);
    expect((await reader(page, deferred.topicId))?.summary.terminalBlocks).toBe(0);
    await page.getByRole("button", { name: "Undo section batch", exact: true }).click();
    await expect
      .poll(async () => (await reader(page, selected.topicId))?.summary.unresolvedBlocks)
      .toBe(20);

    await app.close();
    app = await launchApp(dir, { pdfImportPath: pdfPath });
    page = await firstPage(app);
    expect((await structure(page, sourceId)).ranges).toEqual(current.ranges);
    expect((await queue(page)).items.map((item) => item.id)).toEqual([selected.topicId]);
    expect(
      (await reader(page, selected.topicId))?.blocks.map((block) => block.stableBlockId),
    ).toEqual(selected.unitIds);
    expect(
      (
        await page.evaluate(
          (elementId) => (window.appApi as unknown as Bridge).readPoints.get({ elementId }),
          selected.topicId,
        )
      ).readPoint,
    ).toEqual(point.readPoint);
    await openSource(page, selected.topicId);
    await expect(page.getByTestId("pdf-page-281")).toBeVisible();
    const inspector = await page.evaluate(
      (id) => (window.appApi as unknown as Bridge).inspector.get({ id }),
      selected.topicId,
    );
    expect(inspector.data?.source?.id).toBe(sourceId);
    expect(inspector.data?.location?.page).toBe(281);
    expect(audit(dir, sourceId).foreignKeyViolations).toEqual([]);
  } finally {
    await app.close();
  }
});

test("EPUB skim reuses chapter topics, preserves extraction lineage and chapter read-points after restart", async () => {
  const dir = makeDataDir();
  const fixture = path.resolve(
    __dirname,
    "../../packages/importers/src/__fixtures__/epub/epub3-three-chapters.epub",
  );
  let app = await launchApp(dir, { epubImportPath: fixture });
  try {
    let page = await firstPage(app);
    await page.getByTestId("nav-inbox").click();
    await page.getByTestId("inbox-import-import-file").click();
    await page.getByTestId("import-file-choose").click();
    await page.getByTestId("import-file-submit").click();
    await expect(page.getByTestId("import-file-modal")).toBeHidden({ timeout: 20_000 });
    const sourceId = await page.evaluate(async () => {
      const source = (await (window.appApi as unknown as Bridge).inbox.list()).items[0];
      if (!source) throw new Error("EPUB source missing");
      return source.id;
    });
    await accept(page, sourceId);
    const initial = await structure(page, sourceId);
    expect(initial.format).toBe("epub");
    expect(initial.ranges).toHaveLength(3);
    const chapter = initial.ranges[0] as StructureRange;
    if (!chapter.topicId) throw new Error("Original EPUB topic missing");
    const originalLocation = await page.evaluate(
      (id) => (window.appApi as unknown as Bridge).inspector.get({ id }),
      chapter.topicId,
    );
    const skim = await openSkim(page, sourceId);
    for (const [index, range] of initial.ranges.entries()) {
      await choose(skim, range.title, ["extract_worthy", "later", "ignore"][index]!);
    }
    await apply(skim);
    expect((await structure(page, sourceId)).ranges.map((range) => range.topicId)).toEqual(
      initial.ranges.map((range) => range.topicId),
    );
    await skim.getByRole("button", { name: "Undo section batch", exact: true }).click();
    await expect(skim.getByRole("button", { name: "Undo section batch", exact: true })).toHaveCount(
      0,
    );
    expect((await structure(page, sourceId)).ranges.map((range) => range.topicId)).toEqual(
      initial.ranges.map((range) => range.topicId),
    );
    expect((await structure(page, sourceId)).ranges.every((range) => range.verdict === null)).toBe(
      true,
    );
    for (const [index, range] of initial.ranges.entries()) {
      await choose(skim, range.title, ["extract_worthy", "later", "ignore"][index]!);
    }
    await apply(skim);
    await skim.getByRole("button", { name: chapter.title, exact: true }).click();
    await expect(page.locator(".section-reader .ProseMirror")).toBeVisible();
    const data = await reader(page, chapter.topicId);
    expect(data?.contentDocumentId).toBe(chapter.topicId);
    expect(data?.blocks.map((block) => block.stableBlockId)).toEqual(chapter.unitIds);
    const lastBlockId = chapter.unitIds.at(-1)!;
    await page
      .getByRole("combobox", { name: "Section position", exact: true })
      .selectOption(lastBlockId);
    await page.getByRole("button", { name: "Save section read-point", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (elementId) => (window.appApi as unknown as Bridge).readPoints.get({ elementId }),
              chapter.topicId!,
            )
          ).readPoint?.blockId,
      )
      .toBe(lastBlockId);
    const paragraph = page.locator(".section-reader .ProseMirror p[data-block-id]").first();
    await paragraph.click({ clickCount: 3 });
    const selectedBlockId = await paragraph.getAttribute("data-block-id");
    await page.getByRole("button", { name: "Mark read (still unresolved)", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await reader(page, chapter.topicId ?? ""))?.blocks.find(
            (block) => block.stableBlockId === selectedBlockId,
          )?.state,
      )
      .toBe("read");
    expect(
      (await reader(page, chapter.topicId))?.blocks.find(
        (block) => block.stableBlockId === lastBlockId,
      )?.state,
    ).toBe("unread");
    await paragraph.click({ clickCount: 3 });
    await expect(
      page.getByRole("button", { name: "Extract selection", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Extract selection", exact: true }).click();
    const findExtract = () =>
      page.evaluate(
        async ({ sourceId, chapterId }) => {
          const api = window.appApi as unknown as Bridge;
          const candidates = (await api.inspector.list()).elements.filter(
            (element) => element.type === "extract",
          );
          for (const candidate of candidates) {
            const result = await api.inspector.get({ id: candidate.id });
            if (
              result.data?.source?.id === sourceId &&
              result.data.location?.sourceElementId === chapterId
            )
              return candidate.id;
          }
          return null;
        },
        { sourceId, chapterId: chapter.topicId },
      );
    await expect.poll(findExtract).not.toBeNull();
    const extractId = await findExtract();
    expect(
      (
        await page.evaluate(
          (id) => (window.appApi as unknown as Bridge).inspector.get({ id }),
          chapter.topicId,
        )
      ).data?.location,
    ).toEqual(originalLocation.data?.location);
    await screenshots(
      page,
      page.locator(".section-reader__toolbar").first(),
      "epub-section-reader",
    );
    await app.close();
    app = await launchApp(dir, { epubImportPath: fixture });
    page = await firstPage(app);
    expect((await structure(page, sourceId)).ranges.map((range) => range.topicId)).toEqual(
      initial.ranges.map((range) => range.topicId),
    );
    expect(await findExtract()).toBe(extractId);
    expect(
      (
        await page.evaluate(
          (elementId) => (window.appApi as unknown as Bridge).readPoints.get({ elementId }),
          chapter.topicId,
        )
      ).readPoint?.blockId,
    ).toBe(lastBlockId);
    await openSource(page, chapter.topicId);
    await expect(page.getByRole("combobox", { name: "Section position", exact: true })).toHaveValue(
      lastBlockId,
    );
    expect(audit(dir, sourceId).sections).toHaveLength(3);
    expect(audit(dir, sourceId).foreignKeyViolations).toEqual([]);
  } finally {
    await app.close();
  }
});

test("document headings and manual ranges reject overlap atomically and schedule disjoint sections", async () => {
  const dir = makeDataDir();
  let app = await launchApp(dir);
  try {
    let page = await firstPage(app);
    const sourceId = await page.evaluate(async () => {
      const result = await (window.appApi as unknown as Bridge).sources.importMarkdownText({
        title: "T134 structured document",
        priority: "A",
        text: "Preface paragraph.\n\n# Chapter Alpha\n\nAlpha argument.\n\n## Nested Detail\n\nNested argument.\n\n# Chapter Beta\n\nBeta argument.",
      });
      return result.id;
    });
    await accept(page, sourceId);
    const initial = await structure(page, sourceId);
    expect(initial.format).toBe("document");
    expect(initial.ranges.map((range) => [range.title, range.depth, range.unitIds.length])).toEqual(
      [
        ["Introduction", 0, 1],
        ["Chapter Alpha", 0, 4],
        ["Nested Detail", 1, 2],
        ["Chapter Beta", 0, 2],
      ],
    );
    const beforeRejected = audit(dir, sourceId);
    const rejected = await page.evaluate(
      async ({ sourceId, ranges }) => {
        try {
          await (window.appApi as unknown as Bridge).sourceStructure.apply({
            sourceId,
            decisions: ranges.map((range) => ({
              range,
              verdict: "extract_worthy",
              priority: 0.875,
            })),
          });
          return false;
        } catch {
          return true;
        }
      },
      {
        sourceId,
        ranges: initial.ranges.filter((range) =>
          ["Chapter Alpha", "Nested Detail"].includes(range.title),
        ),
      },
    );
    expect(rejected).toBe(true);
    expect(audit(dir, sourceId)).toEqual(beforeRejected);
    const skim = await openSkim(page, sourceId);
    await skim.getByRole("textbox", { name: "Section title", exact: true }).fill("Alpha focus");
    await skim.getByRole("combobox", { name: "From", exact: true }).selectOption({ value: "1" });
    await skim.getByRole("combobox", { name: "Through", exact: true }).selectOption({ value: "2" });
    await skim.getByRole("button", { name: "Make section", exact: true }).click();
    await expect(
      skim.getByRole("combobox", { name: "Alpha focus: Verdict", exact: true }),
    ).toBeVisible();
    await choose(skim, "Introduction", "ignore");
    await choose(skim, "Chapter Beta", "ignore");
    await choose(skim, "Nested Detail", "later");
    const choice = skim.getByRole("combobox", { name: "Alpha focus: Verdict", exact: true });
    await choice.focus();
    await choice.press("ArrowDown");
    await choice.press("Enter");
    await expect(choice).toHaveValue("extract_worthy");
    await apply(skim);
    const current = await structure(page, sourceId);
    const manual = assigned(current, "Alpha focus");
    expect(manual.unitIds).toEqual(initial.units.slice(1, 3).map((unit) => unit.id));
    expect((await queue(page)).items.map((item) => item.id)).toEqual([manual.topicId]);
    await screenshots(page, skim, "document-skim");
    await skim.getByRole("button", { name: "Alpha focus", exact: true }).click();
    await expect(page.locator(".section-reader .ProseMirror")).toContainText("Alpha argument.");
    await expect(page.locator(".section-reader .ProseMirror")).not.toContainText(
      "Nested argument.",
    );
    await page.getByTestId("done-intent-trigger").click();
    await expect(page.getByTestId("done-intent-breakdown")).toContainText("2 unread");
    await page.getByTestId("done-intent-later").click();
    await expect
      .poll(async () =>
        (await reader(page, manual.topicId))?.blocks.every(
          (block) => block.state === "needs_later",
        ),
      )
      .toBe(true);
    expect((await queue(page)).items).toHaveLength(0);
    await app.close();
    app = await launchApp(dir);
    page = await firstPage(app);
    expect(assigned(await structure(page, sourceId), "Alpha focus").topicId).toBe(manual.topicId);
    expect(
      (await reader(page, manual.topicId))?.blocks.every((block) => block.state === "needs_later"),
    ).toBe(true);
    const futureIds = (await queue(page, 8)).items.map((item) => item.id);
    expect(futureIds).toEqual(
      expect.arrayContaining([manual.topicId, assigned(current, "Nested Detail").topicId]),
    );
    expect(futureIds).not.toContain(sourceId);
    expect(audit(dir, sourceId).foreignKeyViolations).toEqual([]);
  } finally {
    await app.close();
  }
});
