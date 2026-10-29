/**
 * HTML reconstruction of the Weekly Dinner Club group screen
 * (from web/public/group-story.png / Solid Pocket direction).
 */
export function HeroAppCard() {
  return (
    <div className="hero-plate" aria-hidden={false}>
      <div
        className="hero-app-card"
        role="img"
        aria-label="SharedMoney group screen: Weekly Dinner Club balances"
      >
        <div className="hero-app-top">
          <b>Weekly Dinner Club</b>
          <small>3 members</small>
        </div>
        <div className="hero-app-who">
          <span className="hero-app-av" aria-hidden>
            CH
          </span>
          <div>
            <strong>Charlie</strong>
            <span>owes you</span>
          </div>
          <span className="hero-app-amt is-pos">₹7,000.00</span>
        </div>
        <div className="hero-app-who">
          <span className="hero-app-av" aria-hidden>
            BO
          </span>
          <div>
            <strong>Bob</strong>
            <span>owes you</span>
          </div>
          <span className="hero-app-amt is-pos">₹1,000.00</span>
        </div>
        <div className="hero-app-tiles">
          <div className="hero-app-tile is-brand">
            <span>My spending</span>
            <b>₹7,000.00</b>
          </div>
          <div className="hero-app-tile is-pos">
            <span>Group summary</span>
            <b>₹21,000.00</b>
          </div>
        </div>
        <div className="hero-app-row">
          <span className="hero-app-av is-wash" aria-hidden>
            SU
          </span>
          <div>
            <strong>Sushi dinner</strong>
            <span>Aug 8 · You paid</span>
          </div>
          <span className="hero-app-amt">₹15,000.00</span>
        </div>
      </div>
    </div>
  );
}
