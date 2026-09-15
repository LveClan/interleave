import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import Database from "better-sqlite3";
import type { AppApi } from "../../apps/desktop/src/shared/contract";
import { ensureBuilt, launchApp, makeDataDir } from "./launch";

const fixtures = path.join(__dirname, "fixtures");
const videoPath = path.join(fixtures, "media-processing.webm");
const subtitlesPath = path.join(fixtures, "media-processing.vtt");
const audioPath = path.resolve(
  __dirname,
  "../../packages/importers/src/__fixtures__/transcript/tiny-audio.mp3",
);

interface Coverage {
  durationMs: number;
  ranges: { startMs: number; endMs: number }[];
  playedMs: number;
}

function readDatabase<T>(dir: string, read: (db: Database.Database) => T): T {
  const db = new Database(path.join(dir, "app.sqlite"), { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function coverage(dir: string, sourceId: string): Coverage {
  return readDatabase(dir, (db) => {
    const row = db
      .prepare(
        "SELECT duration_ms, coverage FROM source_media_playback WHERE source_element_id = ?",
      )
      .get(sourceId) as { duration_ms: number; coverage: string } | undefined;
    const ranges = JSON.parse(row?.coverage ?? "[]") as Coverage["ranges"];
    return {
      durationMs: row?.duration_ms ?? 0,
      ranges,
      playedMs: ranges.reduce((sum, range) => sum + range.endMs - range.startMs, 0),
    };
  });
}

function units(page: Page, sourceId: string) {
  return page.evaluate(
    (id) => (window.appApi as AppApi).processingUnits.open({ sourceId: id }),
    sourceId,
  );
}

async function seek(player: Locator, seconds: number) {
  await player.evaluate((element, position) => {
    const media = element as HTMLMediaElement;
    media.pause();
    media.currentTime = position;
  }, seconds);
  await expect
    .poll(() => player.evaluate((element) => (element as HTMLMediaElement).seeking))
    .toBe(false);
  await expect
    .poll(() => player.evaluate((element) => (element as HTMLMediaElement).currentTime))
    .toBeCloseTo(seconds, 1);
}

async function play(player: Locator) {
  // These are native player operations; no synthetic events or coverage IPC calls.
  await player.evaluate(async (element) => {
    const media = element as HTMLMediaElement;
    media.muted = true;
    await media.play();
  });
}

async function frame(player: Locator) {
  const dimensions = await player.evaluate((element) => {
    const video = element as HTMLVideoElement;
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      frames: video.getVideoPlaybackQuality().totalVideoFrames,
      error: video.error?.message ?? null,
    };
  });
  expect(dimensions.error).toBeNull();
  const screenshot = await player.screenshot();
  const pixels = await player.page().evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(
      0,
      0,
      canvas.width,
      Math.max(1, Math.floor(canvas.height * 0.7)),
    ).data;
    let nonblank = 0,
      checksum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const red = data[i] ?? 0,
        green = data[i + 1] ?? 0,
        blue = data[i + 2] ?? 0;
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 40) nonblank++;
      checksum = (checksum + red * (i + 1)) >>> 0;
    }
    return { nonblank, checksum };
  }, screenshot.toString("base64"));
  return { ...dimensions, ...pixels };
}

async function importMedia(page: Page) {
  await page.getByTestId("nav-inbox").click();
  await page.getByTestId("inbox-import-import-media").click();
  await expect(page.getByTestId("inbox-row")).toHaveCount(1, { timeout: 20_000 });
  return page.evaluate(async () => {
    const api = window.appApi as AppApi;
    const { items } = await api.inbox.list();
    const id = items[0]?.id;
    if (!id) throw new Error("Imported media missing");
    await api.inbox.triage({ id, action: { kind: "accept" } });
    await api.elements.setPriority({ id, action: { kind: "set", priority: "A" } });
    return id;
  });
}

test.setTimeout(240_000);

test("real video coverage, seek gaps, segment actions, clip lineage and consumers survive restart", async () => {
  ensureBuilt();
  const dir = makeDataDir();
  let app = await launchApp(dir, { mediaImportPath: videoPath, subtitlesPath });
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const origin = new URL(page.url());
    const base = `${origin.protocol}//${origin.host}`;
    const id = await importMedia(page);
    await page.evaluate(async (sourceId) => {
      await (window.appApi as AppApi).queue.schedule({
        id: sourceId,
        choice: { kind: "manual", date: new Date().toISOString() },
      });
    }, id);
    await page.goto(`${base}/process`);
    await expect(page.getByTestId("process-item")).toHaveAttribute("data-element-id", id);
    await page.getByTestId("process-action-open").click();
    await expect(page.getByTestId("media-reader-video")).toBeVisible();
    await page.goto(`${base}/source/${id}`);
    let player = page.getByTestId("media-reader-video");
    await expect(player).toBeVisible();
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2);
    await expect.poll(() => units(page, id).then((result) => result.blocks.length)).toBe(2);
    await expect.poll(() => coverage(dir, id).durationMs).toBe(184_000);
    expect(coverage(dir, id).playedMs).toBe(0);

    await play(player);
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0.6);
    const firstFrame = await frame(player);
    expect(firstFrame).toMatchObject({ width: 160, height: 90 });
    expect(firstFrame.nonblank).toBeGreaterThan(1000);
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBeGreaterThan(2);
    const laterFrame = await frame(player);
    expect(laterFrame.checksum).not.toBe(firstFrame.checksum);
    await player.evaluate((element) => (element as HTMLVideoElement).pause());
    await expect.poll(() => coverage(dir, id).playedMs).toBeGreaterThan(1500);
    const beforeSeek = coverage(dir, id);
    expect(beforeSeek.playedMs).toBeLessThan(10_000);

    await seek(player, 178);
    // Wait beyond the two-second persistence cadence to observe real seek events.
    await page.waitForTimeout(2300);
    expect(coverage(dir, id)).toEqual(beforeSeek);
    await play(player);
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).ended), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect
      .poll(() => units(page, id).then((result) => result.blocks.map((block) => block.state)))
      .toEqual(["unread", "read"]);
    const watched = coverage(dir, id);
    expect(watched.playedMs).toBeGreaterThan(7000);
    expect(watched.playedMs).toBeLessThan(20_000);
    expect(watched.ranges.some((range) => range.startMs >= 178_000)).toBe(true);
    expect(watched.ranges.some((range) => range.startMs < 10_000 && range.endMs > 170_000)).toBe(
      false,
    );
    await page.getByTestId("media-set-readpoint").click();
    await expect(page.getByTestId("reader-flash")).toContainText("Read-point set");

    const controls = page.getByRole("region", { name: "Processing state", exact: true });
    await controls.getByRole("button", { name: "Defer remaining content" }).click();
    await expect(page.locator(".processing-segments__unit").nth(1)).toHaveAttribute(
      "data-state",
      "needs_later",
    );
    await controls.getByRole("button", { name: "Undo passage state change" }).click();
    await expect(page.locator(".processing-segments__unit").nth(1)).toHaveAttribute(
      "data-state",
      "read",
    );
    await controls.getByRole("button", { name: "Defer remaining content" }).click();
    const pending = page.getByTestId("source-pending-rail");
    await pending.getByRole("button", { name: "Pending passages (1)", exact: true }).click();
    await expect(
      pending.getByRole("button", { name: "Mark read (still unresolved)" }),
    ).toBeEnabled();
    await pending.getByRole("button", { name: "Mark read (still unresolved)" }).click();
    await expect(pending).toContainText("Pending passages (0)");
    await pending.getByRole("button", { name: "Undo passage state change" }).click();
    await expect(pending).toContainText("Pending passages (1)");
    await pending.locator(".source-pending__target").click();
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBe(180);
    expect(await player.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);

    // The clip crosses the boundary, but contributes one output to source totals.
    await page
      .getByTestId("media-reader-cue")
      .nth(2)
      .click({ modifiers: ["Shift"] });
    await page
      .getByTestId("media-reader-cue")
      .nth(3)
      .click({ modifiers: ["Shift"] });
    await page.getByTestId("media-clip-confirm").click();
    await expect(page.getByTestId("reader-flash")).toContainText("saved as a topic");
    const clipped = await units(page, id);
    const clipId = clipped.blocks[0]?.outputElementIds[0];
    expect(clipId).toBeTruthy();
    expect(clipped.blocks[1]?.outputElementIds).toEqual([clipId]);
    expect(clipped.summary).toMatchObject({ extractedOutputCount: 1, unresolvedBlocks: 2 });
    await page.locator(".processing-segments__unit").nth(0).click();
    await controls.getByRole("button", { name: "Finish remaining content" }).click();
    await expect(page.locator(".processing-segments__unit").nth(0)).toHaveAttribute(
      "data-state",
      "extracted",
    );
    await expect
      .poll(() => units(page, id).then((result) => result.summary.unresolvedBlocks))
      .toBe(1);

    await page.getByTestId("reader-mark-done").click();
    await expect(page.getByTestId("done-intent-breakdown")).toHaveText("1 deferred");
    await page.screenshot({ path: test.info().outputPath("media-done-breakdown.png") });
    await page.getByTestId("done-intent-later").click();
    await expect
      .poll(() =>
        readDatabase(dir, (db) => {
          const row = db
            .prepare(
              "SELECT payload FROM operation_log WHERE element_id = ? AND op_type = 'reschedule_element' ORDER BY rowid DESC LIMIT 1",
            )
            .get(id) as { payload: string } | undefined;
          return JSON.parse(row?.payload ?? "{}").scheduleReason;
        }),
      )
      .toMatchObject({ kind: "source_unresolved_shortened", unresolvedRatio: 0.5 });

    const snapshot = await page.evaluate(async (sourceId) => {
      const api = window.appApi as AppApi;
      const state = await api.processingUnits.open({ sourceId });
      const { briefing } = await api.sourceReturn.briefing({ sourceId, scheduledReturn: true });
      const { rows } = await api.sourceYield.list();
      const yieldRow = rows.find((row) => row.source.id === sourceId);
      await api.queue.schedule({
        id: sourceId,
        choice: { kind: "manual", date: new Date().toISOString() },
      });
      return { state, briefing, yieldRow };
    }, id);
    expect(snapshot.state.summary).toMatchObject({
      totalBlocks: 2,
      terminalBlocks: 1,
      unresolvedBlocks: 1,
      extractedOutputCount: 1,
      stateCounts: { extracted: 1, needs_later: 1 },
    });
    expect(snapshot.briefing).toMatchObject({
      readPctDelta: null,
      firstDeferredBlockId: "media:segment:180000",
    });
    expect(snapshot.briefing?.readPct).toBeCloseTo(watched.playedMs / watched.durationMs, 5);
    expect(snapshot.yieldRow).toMatchObject({
      readPctKnown: true,
      unresolvedBlocks: 1,
      extractedOutputCount: 1,
    });
    expect(snapshot.yieldRow?.readPct).toBeCloseTo(watched.playedMs / watched.durationMs, 5);

    await page.goto(`${base}/queue`);
    await page
      .getByTestId("queue-item")
      .filter({ hasText: "media-processing" })
      .getByTestId("queue-open")
      .click();
    await expect(page.getByTestId("source-return-briefing")).toBeVisible();
    player = page.getByTestId("media-reader-video");
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBe(182);
    const briefing = page.getByTestId("source-return-briefing");
    await expect(briefing).toContainText("1 deferred");
    await briefing.getByRole("button", { name: "First deferred" }).click();
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBe(180);
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await expect(player).toBeInViewport();
      expect((await frame(player)).nonblank).toBeGreaterThan(1000);
      await page.screenshot({ path: test.info().outputPath(`media-${theme}.png`) });
    }
    await page.setViewportSize({ width: 900, height: 750 });
    await expect(briefing).toBeInViewport();
    expect(await briefing.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(
      await page
        .locator(".processing-units")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath("media-narrow.png") });
    await player.scrollIntoViewIfNeeded();
    const playerBox = await player.boundingBox();
    expect(playerBox?.width).toBeGreaterThan(240);
    expect(playerBox?.height).toBeGreaterThan(130);
    expect((await frame(player)).nonblank).toBeGreaterThan(1000);
    await page.screenshot({ path: test.info().outputPath("media-narrow-player.png") });
    expect(coverage(dir, id)).toEqual(watched);
    await app.close();

    app = await launchApp(dir);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    expect(coverage(dir, id)).toEqual(watched);
    expect((await units(page, id)).summary).toEqual(snapshot.state.summary);
    expect(fs.existsSync(path.join(dir, "assets", "sources", id, "original.webm"))).toBe(true);
    const persisted = readDatabase(dir, (db) => ({
      location: db
        .prepare(
          "SELECT source_element_id, block_ids, timestamp_ms, clip FROM source_locations WHERE element_id = ?",
        )
        .get(clipId),
      source: db.prepare("SELECT source_id, type FROM elements WHERE id = ?").get(clipId),
      playbackLogs: db
        .prepare(
          "SELECT COUNT(*) AS n FROM operation_log WHERE element_id = ? AND json_extract(payload, '$.mediaPlayback.action') = 'record_coverage'",
        )
        .get(id) as { n: number },
      clipLogs: db
        .prepare(
          "SELECT COUNT(*) AS n FROM operation_log WHERE element_id = ? AND op_type = 'create_extract'",
        )
        .get(clipId) as { n: number },
      foreignKeys: db.pragma("foreign_key_check"),
      integrity: db.pragma("integrity_check", { simple: true }),
    }));
    expect(persisted.location).toMatchObject({ source_element_id: id, timestamp_ms: 178_000 });
    const location = persisted.location as { clip: string; block_ids: string };
    expect(JSON.parse(location.clip)).toMatchObject({ startMs: 178_000, endMs: 182_000 });
    expect(JSON.parse(location.block_ids).length).toBeGreaterThan(0);
    expect(persisted.source).toEqual({ source_id: id, type: "media_fragment" });
    expect(persisted.playbackLogs.n).toBeGreaterThan(1);
    expect(persisted.clipLogs.n).toBe(1);
    expect(persisted.foreignKeys).toEqual([]);
    expect(persisted.integrity).toBe("ok");
    await page.goto(`${base}/source/${id}?entry=queue`);
    player = page.getByTestId("media-reader-video");
    await expect(page.getByTestId("source-return-briefing")).toContainText("1 deferred");
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBe(182);
    await page
      .getByTestId("source-return-briefing")
      .getByRole("button", { name: "First deferred" })
      .click();
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBe(180);
    await page
      .getByTestId("source-pending-rail")
      .getByRole("button", { name: "Pending passages (1)", exact: true })
      .click();
    await expect(page.locator(".source-pending__target")).toContainText("180-184 s");
    await page.screenshot({ path: test.info().outputPath("media-after-restart.png") });
    const inspection = await page.evaluate(
      (elementId) => (window.appApi as AppApi).inspector.get({ id: elementId }),
      clipId!,
    );
    expect(inspection.data?.scheduler.kind).toBe("attention");
    await page.goto(`${base}/extract/${clipId}`);
    await expect(page.getByTestId("extract-clip")).toBeVisible();
    await test.info().attach("media-persistence.json", {
      body: JSON.stringify({ watched, snapshot, persisted }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await app.close();
  }
});

test("local audio records actual playback and preserves coverage across restart", async () => {
  ensureBuilt();
  const dir = makeDataDir();
  let app = await launchApp(dir, { mediaImportPath: audioPath, subtitlesPath });
  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const origin = new URL(page.url());
    const base = `${origin.protocol}//${origin.host}`;
    const id = await importMedia(page);
    await page.goto(`${base}/source/${id}`);
    const player = page.getByTestId("media-reader-audio");
    await expect(player).toBeVisible();
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLAudioElement).readyState))
      .toBeGreaterThanOrEqual(2);
    await seek(player, 0.5);
    await page.waitForTimeout(2300);
    expect(coverage(dir, id).playedMs).toBe(0);
    await seek(player, 0);
    await play(player);
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLAudioElement).ended), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect.poll(() => coverage(dir, id).playedMs).toBeGreaterThan(500);
    const watched = coverage(dir, id);
    expect(watched.playedMs).toBeLessThanOrEqual(watched.durationMs);
    const state = await units(page, id);
    expect(state.summary.playbackReadPct).toBeCloseTo(watched.playedMs / watched.durationMs, 5);
    await app.close();
    app = await launchApp(dir);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    expect(coverage(dir, id)).toEqual(watched);
    expect((await units(page, id)).summary).toEqual(state.summary);
    await page.goto(`${base}/source/${id}`);
    await expect(page.getByTestId("media-reader-audio")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("audio-after-restart.png") });
  } finally {
    await app.close();
  }
});
