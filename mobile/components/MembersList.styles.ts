import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  memberCardRemoving: {
    opacity: 0.7,
  },
  memberLeft: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  memberRight: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  actionSlot: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  memberName: {
    marginBottom: 4,
  },
  removeMemberButton: {
    margin: 0,
    width: 40,
    height: 40,
  },
});
