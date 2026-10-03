import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as Localization from "expo-localization";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Appbar,
  Button,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { PeopleSettlementsList } from "../components/PeopleSettlementsList";
import { useAuth } from "../contexts/AuthContext";
import { usePeopleSettlements, type PersonSettlementView } from "../hooks/usePeopleSettlements";
import { useProfile } from "../hooks/useProfile";
import { useUserProfiles } from "../hooks/useUserProfiles";
import { useCreateSettlement, useCreateSettlements } from "../hooks/useSettlements";
import { useGroups } from "../hooks/useGroups";
import { Group } from "../types";
import { getDefaultCurrency } from "../utils/currency";
import { showErrorAlert } from "../utils/errorHandling";
import { createPreviewRateBook } from "../utils/previewRates";
import { buildSettleShareMessage } from "../utils/settleShareMessage";
import { shareSettleDraft } from "../utils/shareSettleDraft";
import {
  clubPersonSettlements,
  membersFromSettlementLine,
  personSettleNotes,
  personSettlePlan,
  personSettlementHeadline,
  settleBalanceFromLine,
  settlementSummary,
  type GroupSettlementContext,
  type GroupSettlementLine,
} from "../utils/peopleSettlements";
import { SettlementFormScreen } from "./SettlementFormScreen";

interface AllSettlementsScreenProps {
  onOpenGroup?: (group: Group) => void;
  preview?: boolean;
}

const YOU = "you";

function previewPeople(): PersonSettlementView[] {
  const book = createPreviewRateBook();
  const groups: GroupSettlementContext[] = [
    {
      groupId: "trip",
      groupName: "Phuket",
      balances: [
        { user_id: YOU, participant_id: "p-you-trip", amount: -500, currency: "INR", full_name: "You" },
        {
          user_id: "u-maya",
          participant_id: "p-maya-trip",
          amount: 500,
          currency: "INR",
          full_name: "Maya Kapoor",
          email: "maya@example.com",
        },
      ],
      unifyEnabled: true,
      settlementCurrency: "INR",
      rateBook: book,
      defaultCurrency: "INR",
    },
    {
      groupId: "home",
      groupName: "Roommates",
      balances: [
        { user_id: YOU, participant_id: "p-you-home", amount: 200, currency: "INR", full_name: "You" },
        {
          user_id: "u-maya",
          participant_id: "p-maya-home",
          amount: -200,
          currency: "INR",
          full_name: "Maya",
          email: "maya@example.com",
        },
      ],
      unifyEnabled: true,
      settlementCurrency: "INR",
      rateBook: book,
      defaultCurrency: "INR",
    },
    {
      groupId: "dinner",
      groupName: "Dinner club",
      balances: [
        { user_id: YOU, participant_id: "p-you-dinner", amount: -80, currency: "USD", full_name: "You" },
        {
          user_id: "u-raj",
          participant_id: "p-raj-dinner",
          amount: 80,
          currency: "USD",
          full_name: "Raj",
          email: "raj@example.com",
        },
      ],
      unifyEnabled: false,
      settlementCurrency: "USD",
      rateBook: book,
      defaultCurrency: "INR",
    },
  ];

  return clubPersonSettlements(groups, YOU).map((person) => ({
    ...person,
    headline: personSettlementHeadline(person, "INR", book),
  }));
}

export const AllSettlementsScreen: React.FC<AllSettlementsScreenProps> = ({
  onOpenGroup,
  preview = false,
}) => {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const live = usePeopleSettlements();
  const { data: profile } = useProfile();
  const { data: groups } = useGroups();
  const createSettlement = useCreateSettlement();
  const createSettlements = useCreateSettlements();
  const [selectedLine, setSelectedLine] = useState<GroupSettlementLine | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonSettlementView | null>(null);

  const people = preview ? previewPeople() : live.people;
  const summary = preview ? settlementSummary(people) : live.summary;
  const isLoading = preview ? false : live.isLoading;
  const profileUserIds = useMemo(
    () => preview ? [] : people.map((person) => person.userId).filter((id): id is string => !!id),
    [people, preview],
  );
  const userProfiles = useUserProfiles(profileUserIds);
  const profileCountryCodesByUserId = useMemo(() => {
    const countries: Record<string, string | null> = {};
    userProfiles.data.forEach((userProfile, userId) => {
      countries[userId] = userProfile.country_code ?? null;
    });
    return countries;
  }, [userProfiles.data]);
  const currentUserName = profile?.full_name?.trim()
    || user?.email?.split("@")[0]?.trim()
    || "you";
  const deviceCountryCode = useMemo(
    () => Localization.getLocales?.()[0]?.regionCode ?? null,
    [],
  );

  const selectedMembers = useMemo(() => {
    if (!selectedLine || !user?.id) return { members: [], participants: [] };
    return membersFromSettlementLine(selectedLine, user.id);
  }, [selectedLine, user?.id]);

  const handleOpenGroup = (groupId: string) => {
    const group = groups.find((item) => item.id === groupId);
    if (group) onOpenGroup?.(group);
  };

  const handleSharePerson = (person: PersonSettlementView, paymentUrl?: string | null) => {
    const message = buildSettleShareMessage({
      lines: person.lines.map((line) => ({
        counterpartyName: person.displayName,
        direction: line.direction,
        amount: line.amount,
        currency: line.currency,
        groupName: line.groupName,
      })),
      paymentUrl,
    });

    void shareSettleDraft(message, paymentUrl).catch((error) => {
      showErrorAlert(error, signOut, "Could not share settle message");
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Content title="Settlements" titleStyle={{ fontWeight: "bold" }} />
      </Appbar.Header>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text variant="bodyLarge" style={{ marginTop: 16 }}>
            Loading settlements...
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
            The same person is grouped across every leftover payment. One
            action records a settlement in each group so you only exchange the
            net.
          </Text>

          {preview ? (
            <Surface
              style={[styles.previewBanner, { backgroundColor: theme.colors.secondaryContainer }]}
              elevation={0}
            >
              <Text variant="labelLarge" style={{ color: theme.colors.onSecondaryContainer, fontWeight: "700" }}>
                Preview data
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSecondaryContainer }}>
                Maya appears in two groups so you can review how one person is clubbed together.
              </Text>
            </Surface>
          ) : null}

          {people.length === 0 ? (
            <Surface style={styles.empty} elevation={0}>
              <MaterialCommunityIcons name="check-decagram" size={28} color={theme.colors.primary} />
              <Text variant="titleMedium" style={{ fontWeight: "700", color: theme.colors.onSurface }}>
                You are all caught up
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}>
                When a group still has a simplified payment that includes you, it will show up here by person.
              </Text>
            </Surface>
          ) : (
            <>
              <Surface
                style={[styles.summaryCard, { backgroundColor: theme.colors.primaryContainer }]}
                elevation={0}
              >
                <Text variant="labelMedium" style={{ color: theme.colors.onPrimaryContainer, opacity: 0.8 }}>
                  People to settle
                </Text>
                <Text variant="headlineSmall" style={{ color: theme.colors.onPrimaryContainer, fontWeight: "800" }}>
                  {summary.personCount} {summary.personCount === 1 ? "person" : "people"}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onPrimaryContainer }}>
                  {summary.lineCount} group {summary.lineCount === 1 ? "payment" : "payments"}
                  {summary.payCount > 0 ? ` · ${summary.payCount} to pay` : ""}
                  {summary.receiveCount > 0 ? ` · ${summary.receiveCount} to receive` : ""}
                </Text>
              </Surface>

              <PeopleSettlementsList
                people={people}
                confirmingPerson={selectedPerson}
                submitting={createSettlements.isLoading}
                preview={preview}
                currentUserName={currentUserName}
                currentUserCountryCode={profile?.country_code ?? null}
                deviceCountryCode={deviceCountryCode}
                profileCountryCodesByUserId={profileCountryCodesByUserId}
                onSettlePerson={setSelectedPerson}
                onCancelPerson={() => setSelectedPerson(null)}
                onConfirmPerson={async () => {
                  if (!selectedPerson) return;
                  if (preview) {
                    setSelectedPerson(null);
                    return;
                  }
                  const plan = personSettlePlan(selectedPerson, personSettleNotes(selectedPerson));
                  try {
                    await createSettlements.mutate(plan.recordable);
                    setSelectedPerson(null);
                  } catch (error) {
                    showErrorAlert(error, signOut, "Couldn’t settle all groups");
                  }
                }}
                onSettleLine={(line) => {
                  if (preview) {
                    handleOpenGroup(line.groupId);
                    return;
                  }
                  setSelectedLine(line);
                }}
                onSharePerson={handleSharePerson}
              />
            </>
          )}

          {live.error && !preview ? (
            <Button mode="contained" onPress={() => void live.refetch()} style={{ marginTop: 16 }}>
              Retry
            </Button>
          ) : null}
        </ScrollView>
      )}

      {selectedLine && user?.id ? (
        <SettlementFormScreen
          visible
          balance={settleBalanceFromLine(selectedLine)}
          settlement={null}
          groupMembers={selectedMembers.members}
          participants={selectedMembers.participants}
          currentUserId={user.id}
          groupId={selectedLine.groupId}
          defaultCurrency={selectedLine.currency || getDefaultCurrency()}
          fromParticipantId={
            selectedLine.direction === "pay"
              ? selectedLine.you.participant_id
              : selectedLine.other.participant_id
          }
          toParticipantId={
            selectedLine.direction === "pay"
              ? selectedLine.other.participant_id
              : selectedLine.you.participant_id
          }
          initialAmount={selectedLine.amount}
          initialCurrency={selectedLine.currency}
          onSave={async (data) => {
            await createSettlement.mutate(data);
            setSelectedLine(null);
          }}
          onDismiss={() => setSelectedLine(null)}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "visible",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  previewBanner: {
    borderRadius: 12,
    padding: 14,
    gap: 4,
    marginBottom: 16,
  },
  summaryCard: {
    borderRadius: 16,
    padding: 16,
    gap: 4,
    marginBottom: 16,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 40,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
});
