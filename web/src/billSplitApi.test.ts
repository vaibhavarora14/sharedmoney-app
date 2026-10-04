import { afterEach, describe, expect, it, vi } from "vitest";
import { billSplitRoute, createGuestBillSplit, requestBillSplit } from "./billSplitApi";
import { pageByPath } from "./seoPages";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("guest bill route", () => {
  const token = "ab".repeat(32);
  it("keeps all marketing/SEO routes separate", () => {
    for (const path of pageByPath.keys()) expect(billSplitRoute(path)).toBeUndefined();
    expect(billSplitRoute(`/join/${token}`)).toBeUndefined();
  });
  it("accepts only a complete lowercase token and handles missing/invalid links", () => {
    expect(billSplitRoute(`/split/${token}`)).toBe(token);
    expect(billSplitRoute(`/split/${token}/`)).toBe(token);
    expect(billSplitRoute("/split")).toBe("start");
    expect(billSplitRoute("/split/")).toBe("start");
    for (const path of ["/split/nope", `/split/${token}/extra`, `/split/${token.toUpperCase()}`]) {
      expect(billSplitRoute(path)).toBeNull();
    }
  });
  it("reads and confirms through the public RPC without a login session", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const bill = { amount_minor: 1001, currency: "USD", mode: "shares", participants: [
      { id: "person", display_name: "Guest", amount_minor: 751, confirmed: false },
    ] };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => bill });
    vi.stubGlobal("fetch", fetcher);
    expect(await requestBillSplit(token)).toEqual(bill);
    expect(await requestBillSplit(token, "person")).toEqual(bill);
    expect(fetcher.mock.calls[1][0]).toBe("https://example.invalid/rest/v1/rpc/confirm_bill_split_share");
    const options = fetcher.mock.calls[1][1];
    expect(JSON.parse(options.body)).toEqual({ p_token: token, p_participant_id: "person" });
    expect(options.credentials).toBe("omit");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(options.headers.Authorization).toBe("Bearer test-public-key");
  });
  it("does not request invalid links and preserves not-found responses", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
    vi.stubGlobal("fetch", fetcher);
    expect(await requestBillSplit("invalid")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public-key");
    expect(await requestBillSplit(token)).toBeNull();
    fetcher.mockResolvedValueOnce({ ok: false });
    await expect(requestBillSplit(token)).rejects.toThrow("Please try again");
  });
});

describe("no-account bill creation", () => {
  const input = { amount: 1001, currency: "USD", people: ["Alex", "Sam"], mode: "equal" as const, values: [] };
  it("creates through the local public RPC and returns a validated token", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "local-public-key");
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => "ab".repeat(32) });
    vi.stubGlobal("fetch", fetcher);
    expect(await createGuestBillSplit(input)).toBe("ab".repeat(32));
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:54321/rest/v1/rpc/create_guest_bill_split_session");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_amount_minor: 1001, p_currency: "USD", p_people: ["Alex", "Sam"], p_mode: "equal", p_values: null });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "omit", redirect: "error", headers: { Authorization: "Bearer local-public-key" } });
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => "invalid" });
    await expect(createGuestBillSplit(input)).rejects.toThrow("Could not create");
    fetcher.mockResolvedValueOnce({ ok: false });
    await expect(createGuestBillSplit(input)).rejects.toThrow("Could not create");
  });
  it("refuses non-local endpoints before sending any bill data", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-key");
    for (const base of ["https://project.supabase.co", "https://example.invalid", "http://localhost.example.com", "http://localhost@production.invalid", "file:///tmp/api"]) {
      vi.stubEnv("VITE_SUPABASE_URL", base);
      await expect(createGuestBillSplit(input)).rejects.toThrow("unavailable");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
