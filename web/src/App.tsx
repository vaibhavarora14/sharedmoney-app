import { useEffect, useRef, useState } from "react";
import { trackPageView } from "./analytics";
import { FAQ } from "./components/FAQ";
import { Calculator } from "./components/seo/Calculators";
import { NotFoundPage, PageHero, SeoPageContent } from "./components/seo/SeoPageContent";
import { Footer } from "./components/landing/Footer";
import { Header } from "./components/landing/Header";
import { Hero } from "./components/landing/Hero";
import { InstallSection } from "./components/landing/InstallSection";
import { TrustSection } from "./components/landing/TrustSection";
import { UseCases } from "./components/landing/UseCases";
import { WorkflowSection } from "./components/landing/WorkflowSection";
import { getPrimaryDestination, getSecondaryDestinations } from "./landingContent";
import { pageByPath, relatedPages, normalizeSeoPath, type SeoPage } from "./seoPages";
import { detectDevice } from "./utils/deviceDetection";
import { BillSplitPage } from "./components/BillSplitPage";
import { BillSplitStartPage } from "./components/BillSplitStartPage";
import { billSplitRoute } from "./billSplitApi";

function ToolDirectory({ page }: { page: SeoPage }) {
  return (
    <section className="section tool-directory" aria-labelledby="tool-directory-title">
      <div className="container">
        <div className="section-head">
          <p className="kicker">Choose a calculator</p>
          <h2 id="tool-directory-title">Two focused tools. No account required.</h2>
        </div>
        <div className="tool-directory-grid">
          {relatedPages(page).map((tool) => (
            <a className="tool-directory-card" href={tool.path} key={tool.id}>
              <span>{tool.eyebrow}</span>
              <strong>{tool.heading}</strong>
              <p>{tool.body}</p>
              <small>Open calculator</small>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [device] = useState(detectDevice);
  const [seoPath] = useState(() =>
    typeof window === "undefined" ? "/" : normalizeSeoPath(window.location.pathname),
  );
  const lastTrackedPath = useRef<string | null>(null);
  const primaryDestination = getPrimaryDestination(device);
  const secondaryDestinations = getSecondaryDestinations(primaryDestination.platform);
  const seoPage = seoPath ? pageByPath.get(seoPath) : undefined;
  const billToken = typeof window === "undefined" ? undefined : billSplitRoute(window.location.pathname);

  useEffect(() => {
    if (!seoPage || lastTrackedPath.current === seoPage.path) {
      return;
    }

    document.title = seoPage.title;
    lastTrackedPath.current = seoPage.path;
    trackPageView(seoPage);
  }, [seoPage]);

  if (billToken === "start") return <BillSplitStartPage />;
  if (billToken !== undefined) return <BillSplitPage token={billToken} />;

  if (!seoPage) {
    return (
      <div className="landing-page">
        <Header primaryDestination={primaryDestination} />
        <NotFoundPage />
        <Footer />
      </div>
    );
  }

  const isHome = seoPage.kind === "home";
  const isTool = seoPage.kind === "tool";
  const isToolDirectory = seoPage.kind === "tools";

  return (
    <div className="landing-page">
      <Header primaryDestination={primaryDestination} />

      <main id="main-content">
        {isHome ? (
          <>
            <Hero
              page={seoPage}
              primaryDestination={primaryDestination}
              secondaryDestinations={secondaryDestinations}
            />
            <WorkflowSection />
            <UseCases />
            <TrustSection />
          </>
        ) : (
          <PageHero page={seoPage} primaryDestination={primaryDestination} />
        )}

        {isTool ? (
          <section className="section calculator-section" aria-label={`${seoPage.heading} calculator`}>
            <div className="container calculator-shell">
              <Calculator page={seoPage} primaryDestination={primaryDestination} />
              <p className="calculator-privacy-note">Calculator values and names stay in this browser. SharedMoney analytics receives only anonymous tool-start and tool-complete events, never your entries.</p>
            </div>
          </section>
        ) : null}

        {isToolDirectory ? <ToolDirectory page={seoPage} /> : null}
        <SeoPageContent page={seoPage} />

        {isHome ? (
          <section id="faq" className="section faq-section">
            <FAQ />
          </section>
        ) : null}

        <InstallSection
          primaryDestination={primaryDestination}
          secondaryDestinations={secondaryDestinations}
        />
      </main>

      <Footer />
    </div>
  );
}

export default App;
