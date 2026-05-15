export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      <a href="/">
        <strong>🏠</strong>
        Accueil
      </a>

      <a href="/matchs">
        <strong>✅</strong>
        Mes choix
      </a>

      <a href="/tous-les-choix">
        <strong>👀</strong>
        Tous les choix
      </a>

      <a href="/qb-ratings">
        <strong>📊</strong>
        QB Ratings
      </a>
<a href="/analytics" className="bottom-nav-item">
  <span>📈</span>
  <small>Analytics</small>
</a>
      <a href="/classements">
        <strong>🏆</strong>
        Classements
      </a>
    </nav>
  );
}
