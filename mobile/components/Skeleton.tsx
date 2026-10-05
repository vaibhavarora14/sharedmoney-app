import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, View, ViewProps, ViewStyle } from "react-native";
import { useTheme } from "react-native-paper";

/** One animation and one accessibility stop per loading region. */
export function SkeletonGroup({ children, style, ...props }: ViewProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  // Stay static until the system preference is known (also on query failure).
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      preferenceChanged = true;
      if (mounted) setReduceMotion(reduced);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (mounted && !preferenceChanged) setReduceMotion(reduced);
    }).catch(() => {});
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    opacity.setValue(1);
    if (reduceMotion) return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.55, duration: 850, useNativeDriver: true, isInteraction: false }),
      Animated.timing(opacity, { toValue: 1, duration: 850, useNativeDriver: true, isInteraction: false }),
    ]));
    pulse.start();
    return () => {
      pulse.stop();
      opacity.setValue(1);
    };
  }, [opacity, reduceMotion]);

  return (
    <View {...props} accessible accessibilityLabel="Loading" accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}>
      <Animated.View style={[style, { opacity }]} pointerEvents="none"
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </Animated.View>
    </View>
  );
}

/** Decorative block; put related blocks inside a SkeletonGroup. */
export function Skeleton({ width, height, borderRadius = 6 }: {
  width: ViewStyle["width"];
  height: number;
  borderRadius?: number;
}) {
  const theme = useTheme();
  return <View accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={{ width, height, borderRadius, backgroundColor: theme.colors.surfaceVariant }} />;
}
