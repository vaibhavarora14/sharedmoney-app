import React from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import { Avatar, useTheme } from "react-native-paper";
import {
  AVATAR_TONE_INK,
  AVATAR_TONES,
  DENSE_AVATAR_SIZE,
} from "../utils/denseListTokens";
import { avatarToneIndex, personInitials } from "../utils/personInitials";

interface PersonAvatarProps {
  name: string;
  uri?: string | null;
  size?: number;
  personKey?: string;
  style?: StyleProp<ViewStyle>;
}

export const PersonAvatar: React.FC<PersonAvatarProps> = ({
  name,
  uri,
  size = DENSE_AVATAR_SIZE,
  personKey,
  style,
}) => {
  const theme = useTheme();
  if (uri) {
    return <Avatar.Image source={{ uri }} size={size} style={style} />;
  }
  const tone = AVATAR_TONES[avatarToneIndex(personKey || name)];
  return (
    <Avatar.Text
      size={size}
      label={personInitials(name)}
      style={StyleSheet.flatten([
        {
          backgroundColor: theme.dark ? theme.colors.primaryContainer : tone,
        },
        style,
      ])}
      color={theme.dark ? theme.colors.onPrimaryContainer : AVATAR_TONE_INK}
      labelStyle={{ fontWeight: "600", fontSize: Math.max(11, Math.round(size * 0.32)) }}
    />
  );
};
