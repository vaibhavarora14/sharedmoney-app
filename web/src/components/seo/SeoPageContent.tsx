import { Check } from "lucide-react";
import { trackRelatedPageClick } from "../../analytics";
import type { PlatformDestination } from "../../landingContent";
import { relatedPages, type SeoPage } from "../../seoPages";
import { HeroAppCard } from "../landing/HeroAppCard";
import { PlatformCta } from "../landing/PlatformCta";

export function PageHero({
  page,
  primaryDestination,
  secondaryDestinations = [],
}: {
  page: SeoPage;
  primaryDestination: PlatformDestination;
  secondaryDestinations?: PlatformDestination[];
}) {
  const storeCta = (
    <div className="route-hero-actions">
      <PlatformCta
        destination={primaryDestination}
        placement={`route_${page.id}`}
        appearance="primary"
      />
      {secondaryDestinations.length > 0 ? (
        <div className="route-hero-secondary-actions">
          {secondaryDestinations.map((destination) => (
            <PlatformCta
              key={destination.platform}
              destination={destination}
              placement={`route_${page.id}_secondary`}
              appearance="text"
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="route-hero">
      <div className="container route-hero-shell">
        <div className="route-hero-copy">
          <p className="kicker">{page.eyebrow}</p>
          <h1>{page.heading}</h1>
          {page.lead ? <p className="route-hero-lead">{page.lead}</p> : null}
          {/* Keep the store CTA under the trust line so it stays above the fold on short mobile viewports. */}
          {page.lead ? storeCta : null}
          <p className="route-hero-body">{page.body}</p>
          {page.lead ? null : storeCta}
        </div>
        <HeroAppCard />
      </div>
      <div className="container">
        <ul className="route-hero-proof" aria-label={`${page.heading} highlights`}>
          {page.proof.map((item) => (
            <li key={item}>
              <span className="proof-tick" aria-hidden>
                <Check size={13} strokeWidth={2.4} />
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function SeoPageContent({ page }: { page: SeoPage }) {
  const related = relatedPages(page);

  return (
    <>
      {/* Home follows trust (band), so these cards stay on a white page. Other routes use a band after the white hero. */}
      <section
        className={`section seo-sections${page.kind === "home" ? "" : " section-band"}`}
      >
        <div className="container seo-section-grid">
          {page.sections.map((section) => (
            <article className="seo-copy-card" key={section.heading}>
              <h2>{section.heading}</h2>
              <p>{section.body}</p>
              <ul>
                {section.bullets.map((item) => (
                  <li key={item}>
                    <span className="proof-tick" aria-hidden>
                      <Check size={13} strokeWidth={2.4} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {page.kind === "home" ? null : (
        <section className="section seo-faq-section" aria-labelledby="page-faq-title">
          <div className="container seo-faq-shell">
            <div className="section-head">
              <p className="kicker">Questions, answered</p>
              <h2 id="page-faq-title">Useful details before you start.</h2>
            </div>
            <div className="seo-faq-list">
              {page.faqs.map((faq) => (
                <details key={faq.question} className="seo-faq-item">
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {related.length > 0 ? (
        <section className="section related-section section-band" aria-labelledby="related-pages-title">
          <div className="container">
            <div className="section-head">
              <p className="kicker">Keep exploring</p>
              <h2 id="related-pages-title">More ways to make group money clear.</h2>
            </div>
            <nav className="related-pages" aria-label="Related SharedMoney pages">
              {related.map((relatedPage) => (
                <a
                  className="related-link-card"
                  href={relatedPage.path}
                  key={relatedPage.id}
                  onClick={() => trackRelatedPageClick(page, relatedPage)}
                >
                  <span>{relatedPage.eyebrow}</span>
                  <strong>{relatedPage.heading}</strong>
                  <small>
                    Explore <span aria-hidden="true">→</span>
                  </small>
                </a>
              ))}
            </nav>
          </div>
        </section>
      ) : null}
    </>
  );
}

export function NotFoundPage() {
  return (
    <main id="main-content" className="not-found-page">
      <div className="container">
        <p className="kicker">404</p>
        <h1>We can’t find that page</h1>
        <p>The link may be old or mistyped. Your groups and balances aren’t affected.</p>
        <p className="not-found-actions">
          <a className="cta cta-primary" href="/">
            Go to SharedMoney home
          </a>
          <a className="cta cta-secondary" href="/app">
            Open web app
          </a>
        </p>
      </div>
    </main>
  );
}
