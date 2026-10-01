import { assertEquals } from "jsr:@std/assert@1";
import {
  formatNetworkErrorMessage,
  isBenignConnectivityError,
} from "./networkErrors.ts";

Deno.test("production network errors use concise connectivity wording", () => {
  assertEquals(
    formatNetworkErrorMessage({
      apiUrl: "http://localhost:54321/functions/v1",
      errorName: "TypeError",
      errorMessage: "Network request failed",
      isDevelopment: false,
    }),
    "Unable to connect. Check your internet connection and try again.",
  );
});

Deno.test("development retains emulator setup guidance", () => {
  assertEquals(
    formatNetworkErrorMessage({
      apiUrl: "http://localhost:54321/functions/v1",
      errorName: "TypeError",
      errorMessage: "Network request failed",
      isDevelopment: true,
    }),
    "Cannot connect to server. For Android emulator, use 10.0.2.2 instead of localhost in EXPO_PUBLIC_API_URL",
  );
});

Deno.test("production timeouts remain concise and actionable", () => {
  assertEquals(
    formatNetworkErrorMessage({
      apiUrl: "https://api.example.com",
      errorName: "AbortError",
      errorMessage: "aborted",
      isDevelopment: false,
    }),
    "Request timed out. Check your connection and try again.",
  );
});

Deno.test("isBenignConnectivityError matches production connectivity copy", () => {
  assertEquals(
    isBenignConnectivityError(
      new Error("Unable to connect. Check your internet connection and try again."),
    ),
    true,
  );
});

Deno.test("isBenignConnectivityError matches production timeout copy", () => {
  assertEquals(
    isBenignConnectivityError(
      new Error("Request timed out. Check your connection and try again."),
    ),
    true,
  );
});

Deno.test("isBenignConnectivityError matches classic fetch failures", () => {
  assertEquals(
    isBenignConnectivityError(new TypeError("Network request failed")),
    true,
  );
  assertEquals(
    isBenignConnectivityError(new TypeError("Failed to fetch")),
    true,
  );
});

Deno.test("isBenignConnectivityError rejects unrelated errors", () => {
  assertEquals(
    isBenignConnectivityError(new Error("Unable to register this device for notifications")),
    false,
  );
  assertEquals(isBenignConnectivityError(new TypeError("Cannot read property x")), false);
});
