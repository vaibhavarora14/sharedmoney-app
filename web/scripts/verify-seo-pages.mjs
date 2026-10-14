import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function outputPath(page) {
  return page.path === "/" ? path.join(distDir, "index.html") : path.join(distDir, page.path, "index.html");
}

function pageUrl(page) {
  return `${siteUrl}${page.path === "/" ? "" : page.path}`;
}

report(pages.length === 10, `Expected 10 indexable routes, found ${pages.length}.`);
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
  report(html.includes(`<h1>${page.heading}</h1>`), `${page.path}: static H1 does not match route content.`);
  report(html.includes('type="application/ld+json"'), `${page.path}: missing structured data.`);
  report(html.includes(playStoreUrl), `${page.path}: missing Google Play store link.`);
  report(html.includes(appStoreUrl), `${page.path}: missing App Store install URL.`);
  report(html.includes("Download on the App Store"), `${page.path}: missing App Store CTA copy.`);
  report(!html.includes("App Store listing pending review"), `${page.path}: stale pending-review iOS copy remains.`);
  report(html.includes('data-seo-cta'), `${page.path}: missing SSR CTA tracking markers.`);
  report(html.includes('data-platform="android"'), `${page.path}: missing android SSR CTA marker.`);
  report(html.includes('data-platform="ios"'), `${page.path}: missing ios SSR CTA marker.`);
  report(html.includes('data-platform="web"'), `${page.path}: missing web SSR CTA marker.`);
  report(html.includes('data-placement="ssr_fallback"'), `${page.path}: missing SSR CTA placement.`);

  if (page.kind === "home") {
    report(
      html.includes('"operatingSystem":"iOS, Android, Web"') ||
        html.includes('"operatingSystem": "iOS, Android, Web"'),
      `${page.path}: SoftwareApplication JSON-LD must include iOS, Android, Web.`,
    );
  }

  for (const relatedId of page.related) {
    const related = pages.find((candidate) => candidate.id === relatedId);
    report(Boolean(related), `${page.path}: unknown related route ${relatedId}.`);
    if (related) {
      report(html.includes(`href="${related.path}"`), `${page.path}: missing internal link to ${related.path}.`);
    }
  }
}

const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
for (const page of pages) {
  report(sitemap.includes(`<loc>${pageUrl(page)}</loc><lastmod>${page.updated}</lastmod>`), `${page.path}: missing sitemap entry or lastmod.`);
}

const notFound = await readFile(path.join(distDir, "404.html"), "utf8");
report(notFound.includes('name="robots" content="noindex,follow"'), "404 page must be noindex.");
report(notFound.includes("We can’t find that page") && notFound.includes("/assets/"), "404 page must use the branded site shell.");

if (failures.length > 0) {
  throw new Error(`SEO verification failed:\n- ${failures.join("\n- ")}`);
}

console.log(`SEO verification passed for ${pages.length} indexable routes.`);
