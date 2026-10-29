import { workflowSteps } from "../../landingContent";

export function WorkflowSection() {
  return (
    <section id="how-it-works" className="section workflow-section section-band" aria-labelledby="workflow-title">
      <div className="container">
        <div className="section-head section-head-wide">
          <p className="kicker">How it works</p>
          <h2 id="workflow-title">Add. See. Settle.</h2>
        </div>

        <ol className="workflow-rail">
          {workflowSteps.map((item) => (
            <li key={item.step}>
              <span className="workflow-number">{item.step}</span>
              <item.icon size={23} aria-hidden />
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
