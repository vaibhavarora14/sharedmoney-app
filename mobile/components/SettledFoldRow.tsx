import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React from "react";
import { Pressable, StyleProp, StyleSheet, ViewStyle } from "react-native";
import { Text, useTheme } from "react-native-paper";

interface SettledFoldRowProps {
  count: number;
  expanded: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export const SettledFoldRow: React.FC<SettledFoldRowProps> = ({
  count,
  expanded,
  onPress,
  style,
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`Settled, ${count} ${count === 1 ? "group" : "groups"}`}
      testID="settled-groups-accordion"
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceVariant },
        style,
      ]}
    >
      <Text
        variant="bodySmall"
        style={{ color: theme.colors.onSurfaceVariant, fontWeight: "500" }}
      >
        {`Settled · ${count}`}
      </Text>
      <MaterialCommunityIcons
        name={expanded ? "chevron-up" : "chevron-down"}
        size={18}
        color={theme.colors.onSurfaceVariant}
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
  },
});
