import React from "react";
import { StyleSheet, View } from "react-native";
import { Provider as PaperProvider, Text, useTheme } from "react-native-paper";
import { QuickSettleSheet, type QuickSettlePreview } from "../components/QuickSettleSheet";
import { settleHeroFromPeople } from "../utils/homePosition";
import { darkTheme, lightTheme } from "../theme";

export type QuickSettleShot = "s1" | "s2" | "s3" | "s4" | "s5" | "s7" | "s8";

const SHOTS: readonly QuickSettleShot[] = ["s1", "s2", "s3", "s4", "s5", "s7", "s8"];

export function readQuickSettleShot(url: string | null | undefined): QuickSettleShot {
  const match = /[?&#]shot=(s[0-9]+)/i.exec(url || "");
  const value = match?.[1]?.toLowerCase() ?? "s1";
  return (SHOTS as readonly string[]).includes(value) ? value as QuickSettleShot : "s1";
}

const sheetFor: Partial<Record<QuickSettleShot, QuickSettlePreview>> = {
  s2: "people",
  s3: "offer",
  s4: "form",
  s5: "success",
  s8: "guest",
};

function Row({ name, detail, amount, owed }: { name: string; detail: string; amount: string; owed: boolean | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, { color: theme.colors.onSurface }]}>{name}</Text>
        <Text style={[styles.detail, { color: theme.colors.onSurfaceVariant }]}>{detail}</Text>
      </View>
      <Text style={[styles.amount, owed === true ? styles.owed : owed === false ? styles.owe : styles.even]}>{amount}</Text>
    </View>
  );
}

const SETTLE_PEOPLE = [
  { netsByCurrency: { INR: 2860 } },
  { netsByCurrency: { INR: 1250 } },
  { netsByCurrency: { INR: 800 } },
  { netsByCurrency: { INR: 500 } },
  { netsByCurrency: { INR: -700 } },
];

function HomeFrame({ shot }: { shot: QuickSettleShot }) {
  const theme = useTheme();
  const after = shot === "s5" || shot === "s7" || shot === "s8";
  const guest = shot === "s8";
  const settleHero = settleHeroFromPeople(SETTLE_PEOPLE);
  const settleNumber = settleHero.kind === "amount" ? settleHero.numberText : "";
  const settleLine = settleHero.kind === "amount" ? settleHero.mutedLine : "";
  return (
    <View style={styles.home}>
      <Text style={[styles.header, { color: theme.colors.onSurface }]}>{shot === "s7" ? "Settle" : "Groups"}</Text>
      <Text style={[styles.kicker, { color: theme.colors.onSurfaceVariant }]}>You're owed</Text>
      <Text style={[styles.hero, { color: theme.colors.onSurface }]}>
        {shot === "s7" ? settleNumber : guest ? "₹2,350" : after ? "₹4,710" : "₹4,210"}
      </Text>
      <Text style={[styles.kicker, { color: theme.colors.onSurfaceVariant }]}>
        {shot === "s7"
          ? settleLine
          : guest
            ? "Across 2 groups and Kabir"
            : after
              ? "Across 3 groups and Kabir"
              : "Across 3 groups"}
      </Text>
      {shot !== "s7" ? (
        <View style={[styles.pill, { backgroundColor: theme.colors.primaryContainer }]} testID="home-settle-pill">
          <Text style={[styles.pillText, { color: theme.colors.onPrimaryContainer }]}>Settle up with someone</Text>
        </View>
      ) : null}
      {shot === "s7" ? (
        <>
          <Row name="Dev" detail="Office lunch" amount="₹2,860" owed />
          <Row name="Rahul" detail="Goa trip · Flat 4B" amount="₹1,250" owed />
          <Row name="Meera" detail="Goa trip" amount="₹800" owed />
          <Row name="Kabir" detail="Direct" amount="₹500" owed />
          <Row name="Aisha" detail="Flat 4B" amount="₹700" owed={false} />
          <Text style={[styles.recent, { color: theme.colors.onSurfaceVariant }]}>RECENT</Text>
          <View style={styles.recentRow}>
            <View style={[styles.avatar, { backgroundColor: theme.dark ? "#3B2F63" : "#E8E1F7" }]}>
              <Text style={{ fontWeight: "700", color: theme.dark ? "#ECE5FF" : "#3B2F63" }}>K</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameLine}>
                <Text style={[styles.name, { color: theme.colors.onSurface }]}>You paid Kabir</Text>
                <Text style={[styles.pillTag, { backgroundColor: theme.colors.surfaceVariant, color: theme.colors.onSurfaceVariant }]}>Direct</Text>
              </View>
              <Text style={[styles.detail, { color: theme.colors.onSurfaceVariant }]}>Movie tickets · Today</Text>
            </View>
            <Text style={[styles.amount, { color: theme.colors.onSurface }]}>₹500</Text>
          </View>
        </>
      ) : (
        <>
          <Row name="Goa trip" detail="Aisha added Dinner · 2h" amount="You're owed ₹2,400" owed />
          <Row name="Flat 4B" detail="You added Rent · 4d" amount={guest ? "You owe ₹550" : "You owe ₹1,050"} owed={false} />
          {guest ? null : <Row name="Office lunch" detail="You settled with Dev · 3d" amount="You're owed ₹2,860" owed />}
          {guest ? null : <Row name="Weekend Pune" detail="Quiet since 8 Oct" amount="Even" owed={null} />}
          {after ? <Row name="Direct · Kabir" detail="Movie tickets · now" amount="You're owed ₹500" owed /> : null}
        </>
      )}
    </View>
  );
}

export function QuickSettlePreviewScreen({ shot, dark }: { shot: QuickSettleShot; dark: boolean }) {
  const theme = dark ? darkTheme : lightTheme;
  const sheet = sheetFor[shot];
  return (
    <PaperProvider theme={theme}>
      <View style={[styles.phone, { backgroundColor: theme.colors.background }]} testID={`quick-settle-${shot}`}>
        <HomeFrame shot={shot} />
        {sheet ? (
          <QuickSettleSheet
            visible
            preview={sheet}
            source="home_header"
            onDismiss={() => undefined}
          />
        ) : null}
      </View>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  phone: { width: 390, height: 844, alignSelf: "center", overflow: "hidden" },
  home: { paddingTop: 64, paddingHorizontal: 16 },
  header: { fontSize: 24, fontWeight: "700", marginBottom: 12 },
  kicker: { fontSize: 15, opacity: 0.7 },
  hero: { fontSize: 40, fontWeight: "700", letterSpacing: -0.8 },
  sub: { fontSize: 13, opacity: 0.7, marginBottom: 8 },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  pillText: { fontWeight: "700" },
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DCE3EC",
    gap: 12,
  },
  name: { fontSize: 17, fontWeight: "700" },
  detail: { fontSize: 13 },
  amount: { fontWeight: "700" },
  owed: { color: "#0B6B58" },
  owe: { color: "#8E2A45" },
  even: { fontWeight: "500", opacity: 0.7 },
  recent: { marginTop: 16, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, opacity: 0.7 },
  recentRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  pillTag: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
});
