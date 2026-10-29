import seoContent from "./seo-content.json";

export type SeoPageKind = "home" | "page" | "tools" | "tool";
export type SeoTool = "split_bill" | "settle_up";

export type SeoSection = {
  heading: string;
  body: string;
  bullets: string[];
};

export type SeoFaq = {
  question: string;
  answer: string;
};

export type SeoProofItem =
  | string
  | {
      title: string;
      body: string;
    };

export type SeoPage = {
  id: string;
  path: string;
  kind: SeoPageKind;
  tool?: SeoTool;
  region: "global" | "india";
  updated: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  /** Optional trust line rendered directly under the H1 with lead styling. */
  lead?: string;
  body: string;
  proof: SeoProofItem[];
  sections: SeoSection[];
  faqs: SeoFaq[];
  related: string[];
};

export function proofItemKey(item: SeoProofItem): string {
  return typeof item === "string" ? item : item.title;
}

export function isProofDetail(
  item: SeoProofItem,
): item is { title: string; body: string } {
  return typeof item !== "string";
}

export const siteUrl = "https://sharedmoney.app";
export const appUrl = `${siteUrl}/app`;
export const brandName = "SharedMoney";

export const seoPages = seoContent as SeoPage[];
export const pageByPath = new Map(seoPages.map((page) => [page.path, page]));
export const pageById = new Map(seoPages.map((page) => [page.id, page]));

export const primaryNavigation = seoPages.filter(
  (page) => page.id === "split-bills" || page.id === "trip-expense-splitter" || page.id === "roommate-expense-tracker" || page.id === "tools",
);

export function normalizeSeoPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return pageByPath.has(normalized) ? normalized : null;
}

export function relatedPages(page: SeoPage): SeoPage[] {
  return page.related
    .map((id) => pageById.get(id))
    .filter((related): related is SeoPage => Boolean(related));
}

export function pageUrl(page: SeoPage): string {
  return `${siteUrl}${page.path === "/" ? "" : page.path}`;
}
