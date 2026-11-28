import React from "react";
import { StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import type { DensePerson } from "../utils/denseListPeople";
import {
  DENSE_STACK_AVATAR_SIZE,
  DENSE_STACK_MAX,
  DENSE_STACK_OVERLAP,
  DENSE_STACK_RING,
  denseCardSurface,
  denseStackReservedWidth,
} from "../utils/denseListTokens";
import { PersonAvatar } from "./PersonAvatar";

interface AvatarStackProps {
  people: DensePerson[];
  size?: number;
  max?: number;
}

/** Fixed column so 1-face, 2-face, and 2+chip rows start the title at the same x. */
export function DenseAvatarSlot({
  children,
  size = DENSE_STACK_AVATAR_SIZE,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <View
      style={{
        width: denseStackReservedWidth(size),
        height: size,
        flexShrink: 0,
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

export const AvatarStack: React.FC<AvatarStackProps> = ({
  people,
  size = DENSE_STACK_AVATAR_SIZE,
  max = DENSE_STACK_MAX,
}) => {
  const theme = useTheme();
  const ringColor = denseCardSurface(theme).backgroundColor;
  const visible = people.slice(0, max);
  const extra = people.length - visible.length;
  const extraSlot = extra > 0 ? 1 : 0;
  const count = visible.length + extraSlot;
  const step = size - DENSE_STACK_OVERLAP;
  const width = count <= 1 ? size : size + (count - 1) * step;
  const inner = size - 2 * DENSE_STACK_RING;

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
              left: index * step,
              zIndex: index + 1,
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: ringColor,
              padding: DENSE_STACK_RING,
            },
          ]}
        >
          <PersonAvatar
            name={person.name}
            uri={person.avatarUrl}
            personKey={person.key}
            size={inner}
          />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.slot,
            styles.extra,
            {
              left: visible.length * step,
              zIndex: visible.length + 1,
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: ringColor,
              padding: DENSE_STACK_RING,
            },
          ]}
        >
          <View
            style={{
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              backgroundColor: theme.colors.surfaceVariant,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, fontWeight: "700" }}
            >
              {`+${extra}`}
            </Text>
          </View>
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
  },
  extra: {
    alignItems: "center",
    justifyContent: "center",
  },
});
