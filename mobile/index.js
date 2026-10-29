import 'expo-insights';
import { registerRootComponent } from 'expo';

// Local design-review only. Never set in Production store/OTA builds.
const whatsappPreview = process.env.EXPO_PUBLIC_WHATSAPP_OTP_UI_PREVIEW;
const upiPreview = process.env.EXPO_PUBLIC_UPI_UI_PREVIEW;
const App = upiPreview
  ? require('./UpiUiPreviewApp').default
  : whatsappPreview && process.env.EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN === 'true'
    ? require('./WhatsAppOtpPreviewApp').default
    : require('./App').default;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
