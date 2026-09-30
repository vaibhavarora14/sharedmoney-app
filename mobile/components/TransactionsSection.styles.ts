import { StyleSheet } from "react-native";


export const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  list: {
    gap: 4, // Tighter rows; whitespace comes from row padding, not card chrome
  },
  card: {
    borderRadius: 0,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  highlightOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 8,
    borderWidth: 2,
  },
  pressable: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  soloEmptyCard: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 8,
  },
  soloEmptyTop: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 20,
  },
  soloEmptySecondary: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DCE3EC",
  },
  soloEmptySecondaryRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    display: 'flex',
    flexDirection: 'column',
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
    width: '100%',
  },
  title: {
    flexGrow: 1,
    flexShrink: 1,
    marginRight: 8,
    fontWeight: '600', // MD3 Title Medium is 500/Medium or 600/SemiBold
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    width: '100%',
  },
  typeLabel: {
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
    flexShrink: 0,
  },
  // Empty State — alone-group discipline: one sentence + one primary CTA
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 24,
    borderRadius: 0,
    marginTop: 8,
    backgroundColor: "transparent",
  },
  emptyActions: {
    marginTop: 16,
    alignItems: "center",
    gap: 4,
    width: "100%",
  },
  emptySecondaryButton: {
    marginTop: 4,
  },
  // Legacy styles (if referenced elsewhere, though unlikely for this component)
  sectionSurface: {},
  sectionContent: {},
});
