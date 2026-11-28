import React from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { Surface, useTheme } from "react-native-paper";
import {
  DENSE_CARD_RADIUS,
  DENSE_ROW_MIN_HEIGHT,
  denseCardSurface,
} from "../utils/denseListTokens";

interface DenseListCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: "button";
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export const DenseListCard: React.FC<DenseListCardProps> = ({
  children,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityHint,
  style,
}) => {
  const theme = useTheme();
  const surface = denseCardSurface(theme);
  const body = (
    <View style={styles.body}>{children}</View>
  );

  return (
    <Surface
      elevation={surface.elevation}
      style={[
        styles.card,
        { backgroundColor: surface.backgroundColor },
        style,
      ]}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          disabled={disabled}
          testID={testID}
          accessibilityRole={accessibilityRole ?? "button"}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          style={({ pressed }) => [
            pressed && !disabled && { backgroundColor: theme.colors.surfaceVariant },
          ]}
        >
          {body}
        </Pressable>
      ) : (
        <View
          testID={testID}
          accessibilityLabel={accessibilityLabel}
        >
          {body}
        </View>
      )}
    </Surface>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: DENSE_CARD_RADIUS,
    overflow: "hidden",
  },
  body: {
    minHeight: DENSE_ROW_MIN_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
