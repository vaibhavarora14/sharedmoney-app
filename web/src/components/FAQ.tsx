import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { pageByPath } from "../seoPages";

/** Visible Clear answers FAQ. Sourced from home seo-content so JSON-LD stays in sync. */
const homeFaqs = pageByPath.get("/")?.faqs ?? [];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="container faq">
      <div className="section-head section-head-wide">
        <p className="kicker">FAQ</p>
        <h2 id="faq-title">Clear answers.</h2>
      </div>

      <div className="faq-list" aria-labelledby="faq-title">
        {homeFaqs.map((faq, index) => {
          const isOpen = openIndex === index;

          return (
            <div className="faq-item" key={faq.question}>
              <button
                type="button"
                className={`faq-question ${isOpen ? "is-open" : ""}`}
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${index}`}
                id={`faq-question-${index}`}
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <span>{faq.question}</span>
                <ChevronDown
                  size={18}
                  className={`faq-toggle ${isOpen ? "is-open" : ""}`}
                  aria-hidden
                />
              </button>

              <div
                id={`faq-answer-${index}`}
                className={`faq-answer ${isOpen ? "is-open" : ""}`}
                role="region"
                aria-labelledby={`faq-question-${index}`}
                hidden={!isOpen}
              >
                <p>{faq.answer}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
