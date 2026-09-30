import { StyleSheet } from "react-native";

// 8pt grid spacing system for consistency
const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const styles = StyleSheet.create({
  dateHeaderContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8, // Reduced from 16
    marginBottom: 0, // Reduced from 4
  },
  dateHeaderText: {
    fontWeight: "700",
    marginRight: SPACING.md,
    textTransform: "uppercase",
    fontSize: 12,
    letterSpacing: 1,
  },
  dateHeaderLine: {
    flex: 1,
    height: 1,
    opacity: 0.2, // Subtle divider
  },
  
  // MD3 List Item Style
  activityItem: {
    flexDirection: "row",
    paddingVertical: SPACING.sm, // 8
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: 40, // Standard Tonal Avatar Size
    height: 40,
    borderRadius: 20,
    marginRight: SPACING.lg, // 16
    justifyContent: "center",
    alignItems: "center",
  },
  activityContent: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 0, // Align with icon top or center? Center usually better for 2 lines.
    minHeight: 40,
  },
  activityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  activityMeta: {
    alignItems: "center",
    flexDirection: "row",
  },
  safetyMenuButton: {
    margin: -8,
    marginLeft: 0,
  },
  activityUser: {
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  activityTime: {
    // handled by font variant
  },
  activityDescription: {
    // handled by font variant
  },

  // Empty State
  emptyStateCard: {
    marginTop: SPACING.lg,
    backgroundColor: 'transparent',
    borderWidth: 0,
    elevation: 0,
  },
  emptyStateContent: {
    alignItems: "center",
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: SPACING.lg,
  },
  emptyStateTitle: {
    marginBottom: SPACING.sm,
    textAlign: "center",
    fontWeight: '600',
  },
  emptyStateMessage: {
    textAlign: "center",
    maxWidth: 280,
  },
});
