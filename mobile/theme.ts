import { MD3LightTheme, MD3DarkTheme, configureFonts } from "react-native-paper";
import { Platform } from "react-native";

const BRAND_CANVAS = "#F7F9FC";
const BRAND_INK = "#17202A";
const BRAND_ACTION = "#1F5EFF";
const BRAND_SEA = "#00866E";
const BRAND_BERRY = "#C95872";

// Light Theme Colors
const lightColors = {
  ...MD3LightTheme.colors,
  primary: BRAND_ACTION,
  onPrimary: "#ffffff",
  primaryContainer: "#DCE6FF",
  onPrimaryContainer: "#123A99",
  secondary: BRAND_BERRY,
  onSecondary: "#ffffff",
  secondaryContainer: "#F8E2E8",
  onSecondaryContainer: "#842A43",
  tertiary: BRAND_SEA,
  onTertiary: "#ffffff",
  tertiaryContainer: "#DFF6EF",
  onTertiaryContainer: "#075E51",
  error: "#B42318",
  onError: "#ffffff",
  errorContainer: "#FDE2DD",
  onErrorContainer: "#7A271A",
  background: BRAND_CANVAS,
  onBackground: BRAND_INK,
  surface: "#ffffff",
  onSurface: BRAND_INK,
  surfaceVariant: "#EEF2F7",
  onSurfaceVariant: "#4A5870",
  outline: "#74859B",
  outlineVariant: "#DCE3EC",
  elevation: {
    level0: "transparent",
    level1: "#FFFFFF",
    level2: "#F2F5FA",
    level3: "#ECF1F7",
    level4: "#E5ECF4",
    level5: "#DDE7F1",
  },
};

// Dark Theme Colors
const darkColors = {
  ...MD3DarkTheme.colors,
  primary: "#9BB8FF",
  onPrimary: "#101827",
  primaryContainer: "#183D98",
  onPrimaryContainer: "#E8EEFF",
  secondary: "#E58AA2",
  onSecondary: "#1F0B12",
  secondaryContainer: "#642338",
  onSecondaryContainer: "#FFE3EA",
  tertiary: "#68D6C2",
  onTertiary: "#041B17",
  tertiaryContainer: "#075E51",
  onTertiaryContainer: "#D8FBF3",
  error: "#FFB4A8",
  onError: "#2A0704",
  errorContainer: "#8C1D18",
  onErrorContainer: "#FFEDEA",
  background: "#11171D",
  onBackground: "#E6ECF3",
  surface: "#17202A",
  onSurface: "#E6ECF3",
  surfaceVariant: "#222D38",
  onSurfaceVariant: "#B7C2CF",
  outline: "#52606F",
  outlineVariant: "#344252",
  elevation: {
    level0: "transparent",
    level1: "#1A2530",
    level2: "#1E2A36",
    level3: "#23313E",
    level4: "#283744",
    level5: "#2D3C4A",
  },
};

const fontConfig = {
  fontFamily: Platform.select({
    web: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
    ios: "System",
    default: "sans-serif",
  }),
};

export const lightTheme = {
  ...MD3LightTheme,
  colors: lightColors,
  fonts: configureFonts({config: fontConfig}),
  roundness: 8,
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: darkColors,
  fonts: configureFonts({config: fontConfig}),
  roundness: 8,
};
