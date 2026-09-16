import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { ensureBuilt, launchApp, makeDataDir } from "./launch";

test.beforeAll(() => ensureBuilt());

test("Chinese desktop routes render translated controls and preserve imported content", async () => {
  const app = await launchApp(makeDataDir());
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await settings(page);
    await page.getByTestId("setting-language").selectOption("zh-CN");
    const url = new URL(page.url());
    const base = `${url.protocol}//${url.host}`;
    for (const route of [
      "/inbox",
      "/queue",
      "/review",
      "/library",
      "/search",
      "/concepts",
      "/analytics",
      "/analytics/sources",
      "/maintenance",
      "/maintenance/leeches",
      "/maintenance/retired",
      "/maintenance/stagnant",
      "/weekly",
      "/convert",
    ]) {
      await page.goto(`${base}${route}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      await expect(page.locator("main").first()).toContainText(/[\u4e00-\u9fff]/);
      await expect(page.locator("main").first()).not.toContainText(
        /(?:learning|collection|details|options)\.m[a-f0-9]{12}/,
      );
      await page.screenshot({
        path: test.info().outputPath(`chinese-${route.replaceAll("/", "-")}.png`),
      });
    }
    const source = await page.evaluate(async () => {
      if (!window.appApi) throw new Error("No bridge");
      return window.appApi.sources.importManual({
        title: "Keep My English Title",
        body: "Original source content stays unchanged.",
      });
    });
    await page.goto(`${base}/source/${source.id}`);
    await expect(page.getByText("Keep My English Title").first()).toBeVisible();
    await expect(page.locator("main")).toContainText("Original source content stays unchanged.");
    await page.screenshot({ path: test.info().outputPath("chinese-source.png") });
    await page.evaluate(() => window.appApi?.settings.updateMany({ patch: { language: "en" } }));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Chinese home and inspector switch live without translating stored titles", async () => {
  const app = await launchApp(makeDataDir());
  try {
    const page = await app.firstWindow();
    await settings(page);
    await page.getByTestId("setting-language").selectOption("zh-CN");
    await page.getByTestId("nav-home").click();
    const home = page.getByTestId("route-home");
    await expect(home).toBeVisible();
    await expect(page.getByTestId("home-loading")).toHaveCount(0);
    await expect(home.locator("h1")).not.toContainText("Good ");
    await expect(page.getByTestId("budget-meter")).not.toContainText("Within budget");
    await expect(page.getByTestId("home-open-queue")).not.toHaveText("Open queue");
    await expect(page.getByTestId("inspector-header")).toHaveText("详情面板");
    await expect(page.getByTestId("inspector")).toContainText("选择一个条目");
    const titles = await page.getByTestId("element-picker-item").allTextContents();
    for (const width of [1440, 1024]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setSize(width, 900),
        width,
      );
      await page.screenshot({ path: test.info().outputPath(`home-chinese-${width}.png`) });
      expect(await home.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
    }
    await page.evaluate(() => window.appApi?.settings.updateMany({ patch: { language: "en" } }));
    await expect(home.locator("h1")).toContainText("Good ");
    await expect(page.getByTestId("home-open-queue")).toHaveText("Open queue");
    await expect(page.getByTestId("inspector-header")).toHaveText("Inspector");
    expect(await page.getByTestId("element-picker-item").allTextContents()).toEqual(titles);
  } finally {
    await app.close();
  }
});

async function menuLabels(app: ElectronApplication) {
  return app.evaluate(
    ({ Menu }) =>
      Menu.getApplicationMenu()?.items.map((item) => ({
        label: item.label,
        children: item.submenu?.items.map((child) => ({
          label: child.label,
          role: child.role,
          accelerator: child.accelerator,
        })),
      })) ?? [],
  );
}

async function settings(page: Page) {
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("setting-language")).toBeVisible();
}

test("language preference persists across Electron restart and stays consistent with main", async () => {
  const directory = makeDataDir();
  const first = await launchApp(directory);
  try {
    const page = await first.firstWindow();
    await settings(page);
    await expect(page.getByTestId("setting-language")).toHaveValue("system");
    await expect(page.getByTestId("setting-language").locator("option")).toHaveCount(
      process.env.INTERLEAVE_I18N_TEST === "1" ? 4 : 3,
    );
    await page.getByTestId("setting-language").selectOption("en");
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.appApi?.settings.getAll())?.settings.language),
      )
      .toBe("en");
    expect(await page.evaluate(() => window.appApi?.locale.get())).toMatchObject({
      preference: "en",
      locale: "en",
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect((await menuLabels(first)).some((section) => section.label === "File")).toBe(true);
    await page.getByTestId("setting-language").scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("settings-english.png") });
    await expect(page.getByTestId("setting-language")).toHaveAccessibleName("Language");
    await expect(page.getByTestId("setting-budget")).toHaveAccessibleName("Daily review budget");
    await page.getByTestId("setting-language").selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByTestId("nav-settings")).toHaveText("设置");
    await expect(page.getByTestId("setting-language")).toHaveAccessibleName("语言");
    expect((await menuLabels(first)).some((section) => section.label === "文件")).toBe(true);
    await page.screenshot({ path: test.info().outputPath("settings-chinese.png") });
  } finally {
    await first.close();
  }

  const second = await launchApp(directory);
  try {
    const page = await second.firstWindow();
    await settings(page);
    await expect(page.getByTestId("setting-language")).toHaveValue("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    expect(await page.evaluate(() => window.appApi?.locale.get())).toMatchObject({
      preference: "zh-CN",
      locale: "zh-CN",
    });
    await page.evaluate(() => window.appApi?.settings.updateMany({ patch: { language: "xx-YY" } }));
    expect(await page.evaluate(() => window.appApi?.locale.get())).toMatchObject({
      preference: "xx-YY",
      locale: "en",
    });
    await expect(page.getByTestId("nav-settings")).toHaveText("Settings");
    await expect(page.getByTestId("setting-language")).toHaveValue("xx-YY");
    await expect(
      page.evaluate(() => window.appApi?.settings.updateMany({ patch: { language: "../../en" } })),
    ).rejects.toThrow();
    await page.getByTestId("setting-language").selectOption("system");
    await expect
      .poll(() => page.evaluate(async () => (await window.appApi?.locale.get())?.preference))
      .toBe("system");
  } finally {
    await second.close();
  }
});

test("long test language updates menus and UI, falls back, and preserves user content", async () => {
  const testInfo = test.info();
  test.skip(
    process.env.INTERLEAVE_I18N_TEST !== "1",
    "Requires the dedicated pseudo-language build",
  );
  const directory = makeDataDir();
  const app = await launchApp(directory);
  try {
    const page = await app.firstWindow();
    await settings(page);
    await page.getByTestId("setting-language").selectOption("en-XA");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
    await expect(page.getByTestId("nav-settings")).toContainText("extended text for layout");
    const menu = await menuLabels(app);
    expect(menu.some((section) => section.label === "[File extended text for layout]")).toBe(true);
    expect(menu.some((section) => section.label === "Edit")).toBe(true);
    expect(
      menu
        .flatMap((section) => section.children ?? [])
        .find((item) => item.label.includes("Back up"))?.accelerator,
    ).toBe("CmdOrCtrl+B");

    for (const width of [1440, 1024]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setSize(width, 900),
        width,
      );
      await page.screenshot({ path: testInfo.outputPath(`settings-long-${width}.png`) });
      const overflows = await page
        .locator(".setting-row, .shell-nav__item, .setting-row__control")
        .evaluateAll((elements) =>
          elements
            .filter((element) => element.scrollWidth > element.clientWidth + 2)
            .map((element) => element.textContent),
        );
      expect(overflows).toEqual([]);
    }
    await page.getByTestId("user-chip").click();
    await expect(page.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeVisible();
    await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByRole("dialog", { name: /Keyboard shortcuts/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("shortcuts-long.png") });
    await page.keyboard.press("Escape");

    const title = "User title <original>";
    const source = await page.evaluate(async (title) => {
      if (!window.appApi) throw new Error("Desktop bridge missing");
      const result = await window.appApi.sources.importManual({
        title,
        body: "Original content.",
      });
      await window.appApi?.elements.softDeleteSubtree({ id: result.id, includeSubtree: false });
      return result.id;
    }, title);
    await page.getByTestId("nav-trash").click();
    await expect(page.getByTestId("trash-row-title")).toHaveText(title);
    await page.getByTestId("trash-empty").click();
    await expect(page.getByTestId("trash-empty-confirm")).toContainText(
      "Permanently delete all 1?",
    );
    await page.screenshot({ path: testInfo.outputPath("trash-confirm-long.png") });
    await page.getByTestId("trash-empty-cancel").click();
    await page.getByTestId("trash-restore").click();
    await expect(page.getByTestId("trash-snackbar")).toContainText(`Restored · ${title}`);
    await expect(page.getByTestId("trash-row")).toHaveCount(0);
    expect(source).toBeTruthy();
  } finally {
    await app.close();
  }
  const restarted = await launchApp(directory);
  try {
    const page = await restarted.firstWindow();
    await settings(page);
    await expect(page.getByTestId("setting-language")).toHaveValue("en-XA");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
    expect(
      (await menuLabels(restarted)).some(
        (section) => section.label === "[File extended text for layout]",
      ),
    ).toBe(true);
    await page.getByTestId("setting-language").selectOption("en");
    await expect(page.getByTestId("nav-settings")).toHaveText("Settings");
  } finally {
    await restarted.close();
  }
});
