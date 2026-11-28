import React from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import { Avatar, useTheme } from "react-native-paper";
import {
  DENSE_AVATAR_SIZE,
  avatarInitialsFontSize,
  avatarToneFill,
  avatarToneInk,
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
  const tone = avatarToneFill(theme.dark, avatarToneIndex(personKey || name));
  return (
    <Avatar.Text
      size={size}
      label={personInitials(name)}
      style={StyleSheet.flatten([
        { backgroundColor: tone },
        style,
      ])}
      color={avatarToneInk(theme.dark)}
      labelStyle={{ fontWeight: "600", fontSize: avatarInitialsFontSize(size) }}
    />
  );
};
