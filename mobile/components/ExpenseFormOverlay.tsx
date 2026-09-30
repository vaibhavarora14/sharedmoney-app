import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle } from "react-native";
import { SCREEN_TRANSITION_MS } from "../constants/layout";

interface ExpenseFormOverlayProps {
  backgroundColor: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Calm 200–300ms fade into expense detail (#320). No bounce / spring spam.
 */
export const ExpenseFormOverlay: React.FC<ExpenseFormOverlayProps> = ({
  backgroundColor,
  children,
  style,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: SCREEN_TRANSITION_MS,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.overlay,
        { backgroundColor, opacity },
        style,
      ]}
      accessibilityViewIsModal
    >
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
});
