import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sitemapLocPath, sitemapLocsMatchingRedirects } from "../src/sitemapRedirects.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const contentPath = path.resolve(__dirname, "../src/seo-content.json");
const siteUrl = "https://sharedmoney.app";
const pages = JSON.parse(await readFile(contentPath, "utf8"));
const failures = [];

function report(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function hasUrl(html, url) {
  return html.includes(url) || html.includes(url.replaceAll("&", "&amp;"));
}

function outputPath(page) {
  return page.path === "/" ? path.join(distDir, "index.html") : path.join(distDir, page.path, "index.html");
}

function pageUrl(page) {
  return `${siteUrl}${page.path === "/" ? "" : page.path}`;
}

report(pages.length === 11, `Expected 11 indexable routes, found ${pages.length}.`);
report(new Set(pages.map((page) => page.path)).size === pages.length, "SEO paths must be unique.");

const playStoreUrl =
  "https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney&pcampaignid=web_share";
const appStoreUrl = "https://apps.apple.com/app/id6755923591";
const homePage = pages.find((page) => page.path === "/");
report(Boolean(homePage), "Home page must exist in seo-content.json.");

const iosFaqPaths = ["/", "/split-bills", "/group-expense-tracker", "/trip-expense-splitter"];
for (const pagePath of iosFaqPaths) {
  const page = pages.find((candidate) => candidate.path === pagePath);
  report(Boolean(page), `Expected SEO page at ${pagePath}.`);
  report(
    Boolean(page?.faqs.some((faq) => faq.question.includes("App Store"))),
    `${pagePath}: FAQ must include App Store status.`,
  );
  report(
    Boolean(
      page?.faqs.some(
        (faq) =>
          faq.question.includes("App Store") &&
          /live on the App Store/i.test(faq.answer) &&
          !/pending review|waiting for App Store review/i.test(faq.answer),
      ),
    ),
    `${pagePath}: App Store FAQ must say iOS is live.`,
  );
}

for (const page of pages) {
  const filePath = outputPath(page);
  try {
    await access(filePath);
  } catch {
    failures.push(`Missing generated page: ${filePath}`);
    continue;
  }

  const html = await readFile(filePath, "utf8");
  const h1s = html.match(/<h1(?:\s[^>]*)?>/gi) ?? [];
  const canonical = `<link rel="canonical" href="${pageUrl(page)}" />`;

  report(html.includes(`<title>${page.title}</title>`), `${page.path}: incorrect title.`);
  report(html.includes(`<meta name="description" content="${page.description}" />`), `${page.path}: incorrect description.`);
  report(html.includes(canonical), `${page.path}: incorrect canonical.`);
  report(!html.includes('name="keywords"'), `${page.path}: deprecated meta keywords tag remains.`);
  report(h1s.length === 1, `${page.path}: expected one H1, found ${h1s.length}.`);
  report(
    page.kind === "home"
      ? html.includes(`<h1 class="hero-display">${page.heading}</h1>`)
      : html.includes(`<h1>${page.heading}</h1>`),
    `${page.path}: static H1 does not match route content.`,
  );
  report(html.includes('type="application/ld+json"'), `${page.path}: missing structured data.`);
  report(hasUrl(html, playStoreUrl), `${page.path}: missing Google Play store link.`);
  report(hasUrl(html, appStoreUrl), `${page.path}: missing App Store install URL.`);
  report(html.includes("Download on the App Store"), `${page.path}: missing App Store CTA copy.`);
  report(!html.includes("App Store listing pending review"), `${page.path}: stale pending-review iOS copy remains.`);
  report(html.includes('data-seo-cta'), `${page.path}: missing SSR CTA tracking markers.`);
  report(html.includes('data-platform="android"'), `${page.path}: missing android SSR CTA marker.`);
  report(html.includes('data-platform="ios"'), `${page.path}: missing ios SSR CTA marker.`);
  report(html.includes('data-platform="web"'), `${page.path}: missing web SSR CTA marker.`);
  report(
    page.kind === "home"
      ? html.includes('data-placement="hero_android"') &&
          html.includes('data-placement="hero_ios"') &&
          html.includes('data-placement="hero_secondary"') &&
          html.includes('data-placement="header"')
      : html.includes('data-placement="ssr_fallback"'),
    `${page.path}: missing CTA placement marker.`,
  );

  if (page.kind === "home") {
    report(
      html.includes('"operatingSystem":"iOS, Android, Web"') ||
        html.includes('"operatingSystem": "iOS, Android, Web"'),
      `${page.path}: SoftwareApplication JSON-LD must include iOS, Android, Web.`,
    );
    report(html.includes("no bank link"), `${page.path}: hero copy must include no bank link.`);
    report(
      html.includes("dinners. <br>No daily limits, no ads, no bank link.") ||
        html.includes("dinners. <br/>No daily limits, no ads, no bank link."),
      `${page.path}: homepage hero must break after dinners.`,
    );
    report(html.includes('data-hydrate="home"'), `${page.path}: homepage must hydrate the painted document.`);
    report(html.includes('id="sm-hero-lead"'), `${page.path}: homepage LCP lead must be in the document.`);
    report(html.includes("<style>"), `${page.path}: homepage CSS must be inlined.`);
    report(
      !/<link rel="stylesheet"[^>]*href="\/assets\/index-[^"]+\.css"/.test(html),
      `${page.path}: homepage must not render-block on the main stylesheet.`,
    );
    report(
      !html.includes("dinners. No daily limits"),
      `${page.path}: homepage hero must not leave No on the dinners line.`,
    );
    report(
      html.includes('id="switching-from-splitwise"') && html.includes("Switching from Splitwise"),
      `${page.path}: homepage must include the Switching from Splitwise section.`,
    );
    report(!html.toLowerCase().includes("whatsapp"), `${page.path}: homepage must not claim WhatsApp features.`);
    report(html.includes('href="/faq">FAQ</a>'), `${page.path}: static footer must link FAQ to /faq.`);
    report(
      html.includes("No bank link") && html.includes(page.description),
      `${page.path}: meta description must keep the no bank link claim.`,
    );
  }

  for (const relatedId of page.related) {
    const related = pages.find((candidate) => candidate.id === relatedId);
    report(Boolean(related), `${page.path}: unknown related route ${relatedId}.`);
    if (related) {
      report(html.includes(`href="${related.path}"`), `${page.path}: missing internal link to ${related.path}.`);
    }
  }

  report(
    html.includes('href="/splitwise-alternative">Splitwise alternative</a>'),
    `${page.path}: footer must link to /splitwise-alternative.`,
  );
  report(
    html.includes('href="/in/splitwise-alternative">Splitwise alternative in India</a>'),
    `${page.path}: footer must link to /in/splitwise-alternative.`,
  );
}

const splitBillTitle = "Bill Split Calculator: Tax, Tip and Fees, Free | SharedMoney";
const splitBillDescription =
  "Free bill splitter: split a bill with tax, tip and fees, evenly or by weight, for up to 20 people. No sign-up; values stay in your browser.";
const splitBillH1 = "Bill split calculator, down to the last cent.";
const splitBill = pages.find((page) => page.path === "/tools/split-bill-calculator");
report(Boolean(splitBill), "/tools/split-bill-calculator must exist.");
report(splitBillTitle.length <= 60, "Split-bill title must stay within 60 characters.");
report(splitBillDescription.length <= 155, "Split-bill description must stay within 155 characters.");
if (splitBill) {
  report(splitBill.title === splitBillTitle, "/tools/split-bill-calculator: title must lead with Bill Split Calculator.");
  report(splitBill.description === splitBillDescription, "/tools/split-bill-calculator: description must use bill splitter wording.");
  report(splitBill.heading === splitBillH1, "/tools/split-bill-calculator: visible H1 must use bill split calculator wording.");
  report(splitBill.eyebrow === "Free bill split calculator", "/tools/split-bill-calculator: eyebrow must use bill split calculator wording.");
  report(splitBill.updated === "2026-11-21", "/tools/split-bill-calculator: sitemap lastmod must be 2026-11-21.");
  report(
    splitBill.faqs.some((faq) => faq.question === "How do I split a bill with tax and tip?"),
    "/tools/split-bill-calculator: must include a tax and tip FAQ.",
  );
  const splitHtml = await readFile(outputPath(splitBill), "utf8");
  report(splitHtml.includes(`<title>${splitBillTitle}</title>`), "/tools/split-bill-calculator: built title mismatch.");
  report(
    splitHtml.includes(`<meta name="description" content="${splitBillDescription}" />`),
    "/tools/split-bill-calculator: built meta description mismatch.",
  );
  report(
    splitHtml.includes(`<meta property="og:title" content="${splitBillTitle}" />`),
    "/tools/split-bill-calculator: built og:title mismatch.",
  );
  report(
    splitHtml.includes(`"name":"${splitBillTitle}"`),
    "/tools/split-bill-calculator: built JSON-LD name mismatch.",
  );
  report(
    splitHtml.includes(`<h1>${splitBillH1}</h1>`),
    "/tools/split-bill-calculator: built H1 changed.",
  );
  report(
    splitHtml.includes("<p>Free bill split calculator</p>"),
    "/tools/split-bill-calculator: built eyebrow must use bill split calculator wording.",
  );
  report(
    splitHtml.includes("How do I split a bill with tax and tip?"),
    "/tools/split-bill-calculator: built FAQ must cover tax and tip.",
  );
  const builtBody = splitHtml.split("</head>")[1] ?? "";
  report(!builtBody.includes(splitBillTitle), "/tools/split-bill-calculator: title leaked into visible HTML.");
  report(!builtBody.includes(splitBillDescription), "/tools/split-bill-calculator: description leaked into visible HTML.");
}

const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
const vercel = JSON.parse(await readFile(path.resolve(__dirname, "../../vercel.json"), "utf8"));
const redirects = Array.isArray(vercel.redirects) ? vercel.redirects : [];
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
for (const page of pages) {
  report(sitemap.includes(`<loc>${pageUrl(page)}</loc><lastmod>${page.updated}</lastmod>`), `${page.path}: missing sitemap entry or lastmod.`);
}
report(
  sitemapLocs.every((loc) => sitemapLocPath(loc) !== "/faq"),
  "/faq must not be listed in the sitemap; it redirects to /#faq.",
);
report(
  sitemap.includes("<loc>https://sharedmoney.app/flatmate-expense-tracker</loc>"),
  "/flatmate-expense-tracker must be listed in the sitemap.",
);
const redirectLocs = sitemapLocsMatchingRedirects(sitemapLocs, redirects);
report(
  redirectLocs.length === 0,
  `Sitemap must list canonical URLs only. Redirect sources found: ${redirectLocs.join(", ")}`,
);
for (const splitwisePath of ["/splitwise-alternative", "/in/splitwise-alternative"]) {
  const page = pages.find((candidate) => candidate.path === splitwisePath);
  report(Boolean(page), `${splitwisePath} must remain an indexable route.`);
  if (!page) continue;
  report(
    sitemap.includes(`<loc>${pageUrl(page)}</loc><lastmod>${page.updated}</lastmod>`),
    `${splitwisePath}: must remain in the sitemap with its lastmod.`,
  );
  const filePath = outputPath(page);
  try {
    await access(filePath);
  } catch {
    failures.push(`${splitwisePath}: missing generated page.`);
    continue;
  }
  const html = await readFile(filePath, "utf8");
  report(
    html.includes(`<link rel="canonical" href="${pageUrl(page)}" />`),
    `${splitwisePath}: must keep a self-canonical.`,
  );
}

const notFound = await readFile(path.join(distDir, "404.html"), "utf8");
report(notFound.includes('name="robots" content="noindex,follow"'), "404 page must be noindex.");
report(notFound.includes("We can’t find that page") && notFound.includes("/assets/"), "404 page must use the branded site shell.");

if (failures.length > 0) {
  throw new Error(`SEO verification failed:\n- ${failures.join("\n- ")}`);
}

console.log(`SEO verification passed for ${pages.length} indexable routes.`);
