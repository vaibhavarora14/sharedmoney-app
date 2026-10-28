import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { ReceiptText, Scale, UsersRound } from "lucide-react";

export type DeviceType = "android" | "ios" | "desktop";
export type Platform = "android" | "ios" | "web";
export type UseCaseKey = "trips" | "roommates" | "dinner";
export type BalanceTone = "positive" | "negative" | "neutral";

type LucideIcon = ComponentType<LucideProps>;

export type PlatformDestination = {
  platform: Platform;
  label: string;
  status: string;
  href: string;
  ariaLabel: string;
};

export type LandingSection = {
  id: string;
  label: string;
};

export type ScenarioMember = {
  initials: string;
  name: string;
  detail: string;
  amount: string;
  tone: BalanceTone;
};

export type ScenarioActivity = {
  date: string;
  title: string;
  detail: string;
  amount?: string;
};

export type SettlementScenario = {
  id: UseCaseKey;
  label: string;
  kicker: string;
  title: string;
  summary: string;
  tone: "blue" | "coral" | "green";
  members: ScenarioMember[];
  activity: ScenarioActivity[];
  totals: {
    label: string;
    value: string;
  }[];
};

export type WorkflowStep = {
  step: string;
  icon: LucideIcon;
  title: string;
  summary: string;
};

export const platformDestinations: PlatformDestination[] = [
  {
    platform: "android",
    label: "Get the Android app",
    status: "Android | Available now",
    href: "https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney&pcampaignid=web_share",
    ariaLabel: "Download SharedMoney for Android from Google Play",
  },
  {
    platform: "ios",
    label: "Get the iOS app",
    status: "iOS | Available now",
    href: "https://apps.apple.com/app/id6755923591",
    ariaLabel: "Download SharedMoney for iOS from the App Store",
  },
  {
    platform: "web",
    label: "Open web app",
    status: "Web | Open now",
    href: "https://sharedmoney.app/app",
    ariaLabel: "Open the SharedMoney web app",
  },
];

export const primaryDestinationByDevice: Record<DeviceType, Platform> = {
  android: "android",
  ios: "ios",
  desktop: "android",
};

export const sectionNav: LandingSection[] = [
  { id: "product", label: "Product" },
  { id: "how-it-works", label: "How it works" },
  { id: "trust", label: "Trust" },
];

export const useCaseKeys: UseCaseKey[] = ["trips", "roommates", "dinner"];

export const useCaseScenarios: Record<UseCaseKey, SettlementScenario> = {
  trips: {
    id: "trips",
    label: "Trips",
    kicker: "Summer Vacation",
    title: "The trip keeps moving. The ledger keeps up.",
    summary:
      "Hotels, rides, and dinners stay in one shared history, even when different people pay in different currencies.",
    tone: "blue",
    members: [
      {
        initials: "MA",
        name: "Maya",
        detail: "Hostel and train tickets",
        amount: "is owed INR 13,200",
        tone: "positive",
      },
      {
        initials: "NO",
        name: "Noor",
        detail: "Airport rides",
        amount: "owes INR 7,800",
        tone: "negative",
      },
      {
        initials: "YO",
        name: "You",
        detail: "Food and museum passes",
        amount: "owes INR 5,400",
        tone: "negative",
      },
    ],
    activity: [
      { date: "Jul 14", title: "Maya added hostel", detail: "Split across 4 people", amount: "INR 19,800" },
      { date: "Jul 15", title: "Noor added airport ride", detail: "Paid in EUR", amount: "EUR 72" },
      { date: "Jul 16", title: "You added museum passes", detail: "Unequal split", amount: "INR 4,950" },
    ],
    totals: [
      { label: "Expenses", value: "6" },
      { label: "Currencies", value: "3" },
      { label: "Transfers to settle", value: "2" },
    ],
  },
  roommates: {
    id: "roommates",
    label: "Roommates",
    kicker: "Maple Street",
    title: "Recurring costs without recurring confusion.",
    summary:
      "Rent, utilities, and groceries stay readable when bills arrive on different days and different roommates pay.",
    tone: "coral",
    members: [
      {
        initials: "RI",
        name: "Rina",
        detail: "Paid rent",
        amount: "settled",
        tone: "neutral",
      },
      {
        initials: "NO",
        name: "Noor",
        detail: "Paid groceries",
        amount: "owes INR 540",
        tone: "negative",
      },
      {
        initials: "YO",
        name: "You",
        detail: "Paid utilities",
        amount: "is owed INR 540",
        tone: "positive",
      },
    ],
    activity: [
      { date: "Jun 01", title: "Rina added rent", detail: "Equal split", amount: "INR 72,000" },
      { date: "Jun 08", title: "You added electricity", detail: "3 participants", amount: "INR 3,780" },
      { date: "Jun 10", title: "Noor added groceries", detail: "Shared kitchen", amount: "INR 2,520" },
    ],
    totals: [
      { label: "Monthly expenses", value: "8" },
      { label: "Roommates", value: "3" },
      { label: "Open transfer", value: "1" },
    ],
  },
  dinner: {
    id: "dinner",
    label: "Dinner Groups",
    kicker: "Weekly Dinner Club",
    title: "Good food. Clear balances.",
    summary:
      "The host can change every week. SharedMoney keeps every expense, split, and balance visible to the whole group.",
    tone: "green",
    members: [
      {
        initials: "AR",
        name: "Ari",
        detail: "Dinner at the bistro",
        amount: "is owed INR 4,880",
        tone: "positive",
      },
      {
        initials: "KA",
        name: "Kai",
        detail: "Groceries and snacks",
        amount: "owes INR 2,620",
        tone: "negative",
      },
      {
        initials: "SA",
        name: "Sam",
        detail: "Movie night",
        amount: "owes INR 2,260",
        tone: "negative",
      },
    ],
    activity: [
      { date: "Thu", title: "Kai added groceries", detail: "Split across 4 people", amount: "INR 7,020" },
      { date: "Sat", title: "Ari added dinner", detail: "Ari paid", amount: "INR 4,630" },
      { date: "Sun", title: "Sam added snacks", detail: "Sam paid", amount: "INR 3,000" },
    ],
    totals: [
      { label: "Group total", value: "INR 14,650" },
      { label: "Members", value: "4" },
      { label: "Transfers to settle", value: "2" },
    ],
  },
};

export const workflowSteps: WorkflowStep[] = [
  {
    step: "01",
    icon: ReceiptText,
    title: "Add",
    summary: "Amount, payer, category, split.",
  },
  {
    step: "02",
    icon: UsersRound,
    title: "See",
    summary: "Owes you, you owe, or settled.",
  },
  {
    step: "03",
    icon: Scale,
    title: "Settle",
    summary: "Record what closes the balance.",
  },
];

export function getPrimaryDestination(device: DeviceType): PlatformDestination {
  const primaryPlatform = primaryDestinationByDevice[device];
  return (
    platformDestinations.find((item) => item.platform === primaryPlatform) ??
    platformDestinations[0]
  );
}

export function getSecondaryDestinations(
  primaryPlatform: Platform,
): PlatformDestination[] {
  return platformDestinations.filter((item) => item.platform !== primaryPlatform);
}
