import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import { Button, Modal, Portal, Text, useTheme } from "react-native-paper";
import { STORE_URL_ANDROID, STORE_URL_IOS } from "../constants/storeUrls";

interface ForceUpdateModalProps {
  visible: boolean;
  message?: string;
  storeUrlIos?: string;
  storeUrlAndroid?: string;
}

export const ForceUpdateModal: React.FC<ForceUpdateModalProps> = ({
  visible,
  message = "Please update your app to continue using SharedMoney.",
  storeUrlIos = STORE_URL_IOS,
  storeUrlAndroid = STORE_URL_ANDROID,
}) => {
  const theme = useTheme();

  const handleUpdatePress = () => {
    const storeUrl = Platform.OS === "ios" ? storeUrlIos : storeUrlAndroid;
    Linking.openURL(storeUrl).catch((err) => {
      console.error("Failed to open store URL:", err);
    });
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        dismissable={false}
        dismissableBackButton={false}
        contentContainerStyle={[
          styles.container,
          { backgroundColor: theme.colors.surface },
        ]}
      >
        <View style={styles.content}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: theme.colors.primaryContainer },
            ]}
          >
            <MaterialCommunityIcons
              name="cellphone-arrow-down"
              size={48}
              color={theme.colors.primary}
            />
          </View>

          <Text
            variant="headlineSmall"
            style={[styles.title, { color: theme.colors.onSurface }]}
          >
            Update Required
          </Text>

          <Text
            variant="bodyLarge"
            style={[styles.message, { color: theme.colors.onSurfaceVariant }]}
          >
            {message}
          </Text>

          <Text
            variant="bodyMedium"
            style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
          >
            A newer version of SharedMoney is available with important updates
            and improvements.
          </Text>

          <Button
            mode="contained"
            onPress={handleUpdatePress}
            style={styles.button}
            contentStyle={styles.buttonContent}
            icon="download"
          >
            Update Now
          </Button>
        </View>
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 24,
    padding: 24,
    borderRadius: 28,
    maxWidth: 600, // Matching WEB_MAX_WIDTH implicitly
    alignSelf: "center",
    width: "100%",
  },
  content: {
    alignItems: "center",
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    textAlign: "center",
    marginBottom: 24,
    opacity: 0.8,
  },
  button: {
    borderRadius: 24,
    width: "100%",
  },
  buttonContent: {
    paddingVertical: 8,
  },
});
