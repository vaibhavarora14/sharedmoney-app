import { assert } from "jsr:@std/assert@1";
import { darkThemeTokens } from "../themeTokens.ts";
import { compositeHex, contrastRatio, relativeLuminance } from "./colorContrast.ts";

/**
 * react-native-paper 5.14.5 MD3 dark `surfaceDisabled`:
 * neutral90 rgb(230, 225, 229) at opacity level 2 (0.12), painted on our surface.
 */
const MD3_DARK_DISABLED_OVERLAY = "#E6E1E5";
const MD3_DARK_DISABLED_ALPHA = 0.12;

/** #9BB8FF, the previous pale primary, sits at about 0.485 and reads as inactive. */
const PALE_PRIMARY_LUMINANCE = 0.4;

Deno.test("dark primary stays readable and stronger than a disabled wash", () => {
  const { primary, onPrimary, surface, background } = darkThemeTokens;
  const disabledOnSurface = compositeHex(MD3_DARK_DISABLED_OVERLAY, MD3_DARK_DISABLED_ALPHA, surface);
  const disabledOnBackground = compositeHex(
    MD3_DARK_DISABLED_OVERLAY,
    MD3_DARK_DISABLED_ALPHA,
    background,
  );

  const label = contrastRatio(onPrimary, primary);
  const linkOnSurface = contrastRatio(primary, surface);
  const linkOnBackground = contrastRatio(primary, background);
  const againstDisabledOnSurface = contrastRatio(primary, disabledOnSurface);
  const againstDisabledOnBackground = contrastRatio(primary, disabledOnBackground);
  const luminance = relativeLuminance(primary);

  assert(label >= 4.5, `onPrimary on primary is ${label.toFixed(2)}, need >= 4.5`);
  assert(linkOnSurface >= 4.5, `primary on surface is ${linkOnSurface.toFixed(2)}, need >= 4.5`);
  assert(
    linkOnBackground >= 4.5,
    `primary on background is ${linkOnBackground.toFixed(2)}, need >= 4.5`,
  );
  assert(
    againstDisabledOnSurface >= 3,
    `primary vs disabled fill on surface is ${againstDisabledOnSurface.toFixed(2)}, need >= 3`,
  );
  assert(
    againstDisabledOnBackground >= 3,
    `primary vs disabled fill on background is ${againstDisabledOnBackground.toFixed(2)}, need >= 3`,
  );
  assert(
    luminance <= PALE_PRIMARY_LUMINANCE,
    `primary luminance ${luminance.toFixed(3)} is still a pale tint`,
  );
});

Deno.test("dark primary button label on primary fill meets WCAG AA", () => {
  const { primary, onPrimary, surfaceElevated } = darkThemeTokens;
  const label = contrastRatio(onPrimary, primary);
  const notNowOnElevated = contrastRatio(primary, surfaceElevated);
  assert(
    label >= 4.5,
    `contained button onPrimary on primary is ${label.toFixed(2)}, need >= 4.5`,
  );
  assert(
    notNowOnElevated >= 4.5,
    `Not now primary on elevated surface is ${notNowOnElevated.toFixed(2)}, need >= 4.5`,
  );
});
