import { assertEquals } from "jsr:@std/assert@1";
import { isWhatsAppOtpLoginEnabled } from "./whatsappOtpLogin.ts";

Deno.test("WhatsApp OTP login flag defaults off", () => {
  assertEquals(isWhatsAppOtpLoginEnabled({}), false);
  assertEquals(
    isWhatsAppOtpLoginEnabled({ EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN: "false" }),
    false,
  );
  assertEquals(
    isWhatsAppOtpLoginEnabled({ EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN: "1" }),
    false,
  );
  assertEquals(
    isWhatsAppOtpLoginEnabled({ EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN: "true" }),
    true,
  );
});

Deno.test("default path reads process.env.EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN directly", () => {
  const key = "EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN";
  const previous = process.env[key];
  try {
    process.env[key] = "true";
    assertEquals(isWhatsAppOtpLoginEnabled(), true);
    process.env[key] = "false";
    assertEquals(isWhatsAppOtpLoginEnabled(), false);
    delete process.env[key];
    assertEquals(isWhatsAppOtpLoginEnabled(), false);
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

Deno.test("source keeps direct process.env.EXPO_PUBLIC member access for Expo inlining", async () => {
  const source = await Deno.readTextFile(
    new URL("./whatsappOtpLogin.ts", import.meta.url),
  );
  assertEquals(
    source.includes("process.env.EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN"),
    true,
  );
  // Regression: defaulting to process.env then reading env.EXPO_PUBLIC_* is not inlined.
  assertEquals(
    /=\s*process\.env\s+as\s+Record/.test(source),
    false,
  );
});
