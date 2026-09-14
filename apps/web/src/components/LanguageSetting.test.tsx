import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppApi, LocaleState } from "../lib/appApi";
import { LanguageSetting } from "./LanguageSetting";

afterEach(() => {
  delete window.appApi;
});

it("saves through typed settings and rolls a rejected selection back", async () => {
  const updateMany = vi.fn().mockRejectedValueOnce(new Error("test write rejected"));
  const unsubscribe = vi.fn();
  let receive: ((state: LocaleState) => void) | undefined;
  window.appApi = {
    locale: {
      get: async () => ({ preference: "system", systemLocale: "zh-CN", locale: "en" }),
      onChanged: (callback: (state: LocaleState) => void) => {
        receive = callback;
        return unsubscribe;
      },
    },
    settings: { updateMany },
  } as unknown as AppApi;
  const { unmount } = render(<LanguageSetting />);
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("system"));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save the language preference",
  );
  expect(updateMany).toHaveBeenCalledWith({ patch: { language: "en" } });
  expect(screen.getByRole("combobox")).toHaveValue("system");
  act(() => receive?.({ preference: "en", systemLocale: "zh-CN", locale: "en" }));
  expect(screen.getByRole("combobox")).toHaveValue("en");
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
