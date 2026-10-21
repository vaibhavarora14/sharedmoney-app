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
