import React from "react";
import { StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import type { DensePerson } from "../utils/denseListPeople";
import {
  DENSE_STACK_AVATAR_SIZE,
  DENSE_STACK_MAX,
  DENSE_STACK_OVERLAP,
} from "../utils/denseListTokens";
import { PersonAvatar } from "./PersonAvatar";

interface AvatarStackProps {
  people: DensePerson[];
  size?: number;
  max?: number;
}

export const AvatarStack: React.FC<AvatarStackProps> = ({
  people,
  size = DENSE_STACK_AVATAR_SIZE,
  max = DENSE_STACK_MAX,
}) => {
  const theme = useTheme();
  const visible = people.slice(0, max);
  const extra = people.length - visible.length;
  const width = visible.length === 0
    ? size
    : size + (visible.length - 1) * (size - DENSE_STACK_OVERLAP) + (extra > 0 ? size - DENSE_STACK_OVERLAP : 0);

  return (
    <View
      style={[styles.stack, { width, height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {visible.map((person, index) => (
        <View
          key={person.key}
          style={[
            styles.slot,
            {
              left: index * (size - DENSE_STACK_OVERLAP),
              zIndex: index + 1,
              borderColor: theme.colors.surface,
            },
          ]}
        >
          <PersonAvatar
            name={person.name}
            uri={person.avatarUrl}
            personKey={person.key}
            size={size}
          />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.slot,
            styles.extra,
            {
              left: visible.length * (size - DENSE_STACK_OVERLAP),
              zIndex: visible.length + 1,
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: theme.colors.surfaceVariant,
              borderColor: theme.colors.surface,
            },
          ]}
        >
          <Text
            variant="labelSmall"
            style={{ color: theme.colors.onSurfaceVariant, fontWeight: "700" }}
          >
            {`+${extra}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    position: "relative",
    flexShrink: 0,
  },
  slot: {
    position: "absolute",
    top: 0,
    borderWidth: 2,
    borderRadius: 999,
  },
  extra: {
    alignItems: "center",
    justifyContent: "center",
  },
});
