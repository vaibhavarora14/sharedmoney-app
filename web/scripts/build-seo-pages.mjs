import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const indexPath = path.join(distDir, "index.html");
const contentPath = path.resolve(__dirname, "../src/seo-content.json");
const siteUrl = "https://sharedmoney.app";
const appUrl = `${siteUrl}/app`;
const playStoreUrl =
  "https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney&pcampaignid=web_share";
const appStoreUrl = "https://apps.apple.com/app/id6755923591";
const ogImage = `${siteUrl}/og-sharedmoney.png`;
const pages = JSON.parse(await readFile(contentPath, "utf8"));
const pagesById = new Map(pages.map((page) => [page.id, page]));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pageUrl(pagePath) {
  return `${siteUrl}${pagePath === "/" ? "" : pagePath}`;
}

function linkedPages(page) {
  return page.related.map((id) => pagesById.get(id)).filter(Boolean);
}

function pageLink(page) {
  return `<a href="${escapeHtml(page.path)}">${escapeHtml(page.heading)}</a>`;
}

function ctaMarkup(page) {
  const webHref = `${appUrl}?utm_source=organic&utm_medium=seo&utm_campaign=${escapeHtml(page.id)}`;
  const ctaAttrs = (platform) =>
    `class="cta" data-seo-cta data-platform="${platform}" data-placement="ssr_fallback"`;
  const badgeAttrs = (platform) =>
    `class="store-badge store-badge-${platform}" data-seo-cta data-platform="${platform}" data-placement="ssr_fallback"`;

  return [
    `<p class="store-badges"><a ${badgeAttrs("android")} href="${playStoreUrl}"><img src="/badges/google-play-badge.svg" alt="Get it on Google Play" width="239" height="71" /></a><a ${badgeAttrs("ios")} href="${appStoreUrl}"><img src="/badges/app-store-badge.svg" alt="Download on the App Store" width="120" height="40" /></a></p>`,
    `<p><a ${ctaAttrs("web")} href="${webHref}">Open the SharedMoney web app</a></p>`,
  ].join("");
}

function fallbackMarkup(page) {
  const proofItems = page.proof.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const sections = page.sections
    .map((section) => {
      const bullets = section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      return `<section><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p><ul>${bullets}</ul></section>`;
    })
    .join("");
  const faqs = page.faqs
    .map(
      (faq) =>
        `<details><summary>${escapeHtml(faq.question)}</summary><p>${escapeHtml(faq.answer)}</p></details>`,
    )
    .join("");
  const related = linkedPages(page).map((relatedPage) => `<li>${pageLink(relatedPage)}</li>`).join("");

  const lead = page.lead ? `<p>${escapeHtml(page.lead)}</p>` : "";
  return `<main id="main-content"><article class="seo-source"><header><p>${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.heading)}</h1>${lead}<p>${escapeHtml(page.body)}</p><ul>${proofItems}</ul>${ctaMarkup(page)}</header>${sections}<section><h2>Common questions</h2>${faqs}</section><nav aria-label="Related SharedMoney pages"><h2>Explore SharedMoney</h2><ul>${related}</ul></nav><footer><a href="/privacy">Privacy Policy</a><a href="/delete-account">Delete Account</a><a href="mailto:support@sharedmoney.app">Contact support</a></footer></article></main>`;
}

function structuredData(page) {
  const canonical = pageUrl(page.path);
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "SharedMoney", item: siteUrl },
      ...(page.path === "/"
        ? []
        : [
            {
              "@type": "ListItem",
              position: 2,
              name: page.heading,
              item: canonical,
            },
          ]),
    ],
  };

  if (page.kind === "home") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          name: "SharedMoney",
          url: siteUrl,
        },
        {
          "@type": "Organization",
          name: "SharedMoney",
          url: siteUrl,
          logo: `${siteUrl}/sharedmoney-mark.svg`,
        },
        {
          "@type": "SoftwareApplication",
          name: "SharedMoney",
          url: siteUrl,
          applicationCategory: "FinanceApplication",
          operatingSystem: "iOS, Android, Web",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          description: page.description,
        },
        {
          "@type": "FAQPage",
          mainEntity: page.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: faq.answer,
            },
          })),
        },
      ],
    };
  }

  const graph = [
    {
      "@type": "WebPage",
      name: page.title,
      description: page.description,
      url: canonical,
      isPartOf: { "@type": "WebSite", name: "SharedMoney", url: siteUrl },
      breadcrumb,
    },
    breadcrumb,
  ];

  if (page.kind === "tool") {
    graph.push({
      "@type": "WebApplication",
      name: page.heading,
      url: canonical,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description: page.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function replaceMeta(html, selector, markup) {
  const expression = new RegExp(`<meta\\s+${selector}[^>]*>`, "i");
  return expression.test(html) ? html.replace(expression, markup) : html.replace("</head>", `    ${markup}\n  </head>`);
}

function renderPage(template, page) {
  const canonical = pageUrl(page.path);
  const jsonLd = escapeHtml(JSON.stringify(structuredData(page))).replaceAll("&quot;", '"');
  let html = template
    .replace(/<title>.*?<\/title>/is, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/<meta\s+name="title"[^>]*>/i, `<meta name="title" content="${escapeHtml(page.title)}" />`)
    .replace(/<meta\s+name="keywords"[^>]*>\s*/i, "")
    .replace(/<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${escapeHtml(page.title)}" />`)
    .replace(/<meta\s+property="og:image"[^>]*>/i, `<meta property="og:image" content="${ogImage}" />`)
    .replace(/<meta\s+property="og:image:alt"[^>]*>/i, `<meta property="og:image:alt" content="SharedMoney group balances and shared expense ledger." />`)
    .replace(/<meta\s+property="twitter:url"[^>]*>/i, `<meta property="twitter:url" content="${canonical}" />`)
    .replace(/<meta\s+property="twitter:title"[^>]*>/i, `<meta property="twitter:title" content="${escapeHtml(page.title)}" />`)
    .replace(/<meta\s+property="twitter:image"[^>]*>/i, `<meta property="twitter:image" content="${ogImage}" />`)
    .replace(/<meta\s+property="twitter:image:alt"[^>]*>/i, `<meta property="twitter:image:alt" content="SharedMoney group balances and shared expense ledger." />`)
    .replace(/<script\s+type="application\/ld\+json">.*?<\/script>/is, `<script type="application/ld+json">${jsonLd}</script>`)
    .replace('<div id="root"></div>', `<div id="root">${fallbackMarkup(page)}</div>`);

  html = replaceMeta(html, 'name="description"', `<meta name="description" content="${escapeHtml(page.description)}" />`);
  html = replaceMeta(html, 'property="og:description"', `<meta property="og:description" content="${escapeHtml(page.description)}" />`);
  html = replaceMeta(html, 'property="twitter:description"', `<meta property="twitter:description" content="${escapeHtml(page.description)}" />`);

  if (!html.includes('rel="canonical"')) {
    html = html.replace("</head>", `    <link rel="canonical" href="${canonical}" />\n  </head>`);
  }

  return html;
}

// Copy mirrors NotFoundPage in src/components/seo/SeoPageContent.tsx. The page
// reuses the built shell so it ships the site stylesheet, font and header, and
// Vercel still serves it with HTTP 404.
function notFoundMarkup(template) {
  const title = "Page not found | SharedMoney";
  const body = `<main id="main-content" class="not-found-page"><div class="container"><p class="kicker">404</p><h1>We can’t find that page</h1><p>The link may be old or mistyped. Your groups and balances aren’t affected.</p><p class="not-found-actions"><a class="cta cta-primary" href="/">Go to SharedMoney home</a><a class="cta cta-secondary" href="${appUrl}">Open web app</a></p></div></main>`;
  let html = template
    .replace(/<title>.*?<\/title>/is, `<title>${title}</title>`)
    .replace(/<meta\s+name="title"[^>]*>/i, `<meta name="title" content="${title}" />`)
    .replace(/<link\s+rel="canonical"[^>]*>\s*/i, "")
    .replace(/<script\s+type="application\/ld\+json">.*?<\/script>\s*/is, "")
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  html = replaceMeta(html, 'name="robots"', '<meta name="robots" content="noindex,follow" />');
  return html;
}

const template = await readFile(indexPath, "utf8");

for (const page of pages) {
  const html = renderPage(template, page);
  const targetDir = page.path === "/" ? distDir : path.join(distDir, page.path);
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "index.html"), html);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
  .map((page) => `  <url><loc>${pageUrl(page.path)}</loc><lastmod>${page.updated}</lastmod></url>`)
  .join("\n")}\n</urlset>\n`;

await writeFile(path.join(distDir, "sitemap.xml"), sitemap);
await writeFile(path.join(distDir, "404.html"), notFoundMarkup(template));
