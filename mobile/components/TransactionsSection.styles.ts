import { StyleSheet } from "react-native";
import {
  DENSE_CARD_GAP,
  DENSE_CARD_RADIUS,
  DENSE_SUBLINE_LINE_HEIGHT,
  DENSE_TITLE_LINE_HEIGHT,
  DENSE_TITLE_SUBLINE_GAP,
} from "../utils/denseListTokens";


export const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  list: {
    gap: DENSE_CARD_GAP,
  },
  cardWrap: {
    marginHorizontal: 16,
    marginBottom: DENSE_CARD_GAP,
    position: "relative",
  },
  card: {
    borderRadius: 0,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  highlightOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: DENSE_CARD_RADIUS,
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
    minWidth: 0,
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
    fontWeight: "700",
    lineHeight: DENSE_TITLE_LINE_HEIGHT,
  },
  titleSlot: {
    flexGrow: 1,
    minWidth: 0,
  },
  subline: {
    marginTop: DENSE_TITLE_SUBLINE_GAP,
    minWidth: 0,
    lineHeight: DENSE_SUBLINE_LINE_HEIGHT,
  },
  amountCol: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  amountValue: {
    fontWeight: "600",
    flexShrink: 0,
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
