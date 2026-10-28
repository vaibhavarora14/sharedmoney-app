/**
 * Contract tests for whatsapp-otp send refusals.
 * Handler wiring lives in index.ts; pure helpers are covered in
 * `_shared/whatsapp-otp.test.ts`.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import {
  isPhoneCountryAllowed,
  mapReserveWhatsAppOtpError,
  OtpBudgetExhaustedError,
  resolveWhatsAppOtpBudgetConfig,
  WHATSAPP_BUDGET_EXHAUSTED_CODE,
  WHATSAPP_BUDGET_EXHAUSTED_MESSAGE,
} from '../_shared/whatsapp-otp.ts';

function makeEnv(entries: Record<string, string | undefined>): Deno.Env {
  return {
    get(key: string) {
      return entries[key];
    },
    set() {},
    delete() {},
    toObject() {
      return Object.fromEntries(
        Object.entries(entries).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
    },
    has(key: string) {
      return entries[key] !== undefined && entries[key] !== '';
    },
  } as Deno.Env;
}

Deno.test('budget refusal is 503-shaped, not FEATURE_DISABLED', () => {
  assertEquals(WHATSAPP_BUDGET_EXHAUSTED_CODE, 'WHATSAPP_BUDGET_EXHAUSTED');
  assertEquals(WHATSAPP_BUDGET_EXHAUSTED_CODE.includes('FEATURE'), false);
  assertEquals(
    /another sign-in method/i.test(WHATSAPP_BUDGET_EXHAUSTED_MESSAGE),
    true,
  );
  const err = mapReserveWhatsAppOtpError('WHATSAPP_BUDGET_EXHAUSTED');
  assertEquals(err instanceof OtpBudgetExhaustedError, true);
  assertEquals(err.message, WHATSAPP_BUDGET_EXHAUSTED_MESSAGE);
});

Deno.test('handleSend preconditions: invalid budget config fails closed', () => {
  assertEquals(
    resolveWhatsAppOtpBudgetConfig(makeEnv({ WHATSAPP_MONTHLY_BUDGET_INR: 'nope' })),
    null,
  );
});

Deno.test('handleSend preconditions: non-IN numbers rejected by default allow-list', () => {
  const config = resolveWhatsAppOtpBudgetConfig(makeEnv({}));
  assertEquals(config?.allowedCountryCodes, ['91']);
  assertEquals(isPhoneCountryAllowed('+919876543210', config!.allowedCountryCodes), true);
  assertEquals(isPhoneCountryAllowed('+14155552671', config!.allowedCountryCodes), false);
});
