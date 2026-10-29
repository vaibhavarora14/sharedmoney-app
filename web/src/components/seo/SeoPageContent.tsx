import { trackRelatedPageClick } from "../../analytics";
import type { PlatformDestination } from "../../landingContent";
import { relatedPages, type SeoPage } from "../../seoPages";
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
        <div>
          <p className="kicker">{page.eyebrow}</p>
          <h1>{page.heading}</h1>
          {page.lead ? <p className="route-hero-lead">{page.lead}</p> : null}
          {/* Keep the store CTA under the trust line so it stays above the fold on short mobile viewports. */}
          {page.lead ? storeCta : null}
          <p className="route-hero-body">{page.body}</p>
          {page.lead ? null : storeCta}
        </div>
        <ul aria-label={`${page.heading} highlights`}>
          {page.proof.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </section>
  );
}

export function SeoPageContent({ page }: { page: SeoPage }) {
  const related = relatedPages(page);

  return (
    <>
      <section className="section seo-sections">
        <div className="container seo-section-grid">
          {page.sections.map((section) => (
            <article className="seo-copy-card" key={section.heading}>
              <h2>{section.heading}</h2>
              <p>{section.body}</p>
              <ul>
                {section.bullets.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

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

      {related.length > 0 ? (
        <section className="section related-section" aria-labelledby="related-pages-title">
          <div className="container">
            <div className="section-head">
              <p className="kicker">Keep exploring</p>
              <h2 id="related-pages-title">More ways to make group money clear.</h2>
            </div>
            <nav className="related-pages" aria-label="Related SharedMoney pages">
              {related.map((relatedPage) => (
                <a
                  href={relatedPage.path}
                  key={relatedPage.id}
                  onClick={() => trackRelatedPageClick(page, relatedPage)}
                >
                  <span>{relatedPage.eyebrow}</span>
                  <strong>{relatedPage.heading}</strong>
                  <small>Explore</small>
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
          <a className="cta cta-primary" href="/">Go to SharedMoney home</a>
          <a className="cta cta-secondary" href="/app">Open web app</a>
        </p>
      </div>
    </main>
  );
}
