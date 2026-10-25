import styles from "./FullUpdateStatus.module.css";

const STEPS = [
  { key: "scores", label: "Scores ESPN", singular: "match", plural: "matchs" },
  { key: "teams", label: "Équipes NFL", singular: "équipe", plural: "équipes" },
  { key: "qb", label: "QB Ratings", singular: "QB", plural: "QB" },
  { key: "rankings", label: "Classements", singular: "joueur", plural: "joueurs" },
];

function countLabel(count, singular, plural) {
  return typeof count === "number" && Number.isFinite(count)
    ? `${count.toLocaleString("fr-CA")} ${count === 1 ? singular : plural}`
    : "Terminée";
}

export default function FullUpdateStatus({ state }) {
  if (!state) return null;

  const {
    status,
    week,
    activeStep,
    completed = {},
    stepStates = {},
    details = {},
    warnings = [],
    error,
  } = state;
  const isSuccess = status === "success";
  const isError = status === "error";
  const isPartial = status === "partial";
  const failedKey = error?.step || (isError ? activeStep : null);
  const failedStep = STEPS.find((step) => step.key === failedKey);
  const weekLabel = week == null ? "de la semaine en cours" : `de la semaine ${week}`;
  const title = isSuccess
    ? "✓ Mise à jour complétée"
    : isPartial
      ? failedStep ? `Mise à jour partielle — ${failedStep.label}` : "Mise à jour partielle"
      : isError
      ? failedStep
        ? `Échec de la mise à jour — ${failedStep.label}`
        : "Échec de la mise à jour"
      : "Mise à jour en cours";
  const subtitle = isSuccess
    ? week == null
      ? "Toutes les données sont à jour."
      : `Toutes les données de la semaine ${week} sont à jour.`
    : isPartial
      ? `Certaines données ${weekLabel} n’ont pas pu être mises à jour. Consulte les détails ci-dessous.`
      : isError
      ? `La mise à jour des données ${weekLabel} a été interrompue.`
      : `Mise à jour des données ${weekLabel}…`;
  const hasQbStats = typeof details.qbStats === "number" && Number.isFinite(details.qbStats);
  const hasNotifications = typeof details.notifications === "number" && Number.isFinite(details.notifications);
  const visibleWarnings = warnings.filter((warning) => typeof warning === "string" && warning.trim());
  const hasDetails = hasQbStats || hasNotifications || details.notificationNote || visibleWarnings.length > 0;

  return (
    <section
      className={`${styles.card} ${isSuccess ? styles.success : ""} ${isPartial ? styles.partial : ""}`}
      aria-label="Statut de la mise à jour complète"
    >
      <div role="status" aria-live={isError || error ? "assertive" : "polite"} aria-atomic="true">
        <h3 className={`${styles.title} ${isSuccess ? styles.successTitle : ""} ${isError ? styles.errorTitle : ""} ${isPartial ? styles.partialTitle : ""}`}>
          {title}
        </h3>
        <p className={styles.subtitle}>{subtitle}</p>

        <ol className={styles.steps} aria-label="Étapes de la mise à jour">
          {STEPS.map((step) => {
            const isFailed = step.key === failedKey || stepStates[step.key]?.status === "error";
            const isStepPartial = stepStates[step.key]?.status === "partial";
            const isDone = Object.prototype.hasOwnProperty.call(completed, step.key);
            const isActive = status === "running" && step.key === activeStep;
            const stepStatus = isFailed ? "failed" : isActive ? "active" : isStepPartial ? "partialStep" : isDone ? "done" : "pending";
            const count = isDone ? countLabel(completed[step.key], step.singular, step.plural) : null;
            const description = isFailed
              ? count ? `${count} · Échec` : "Échec"
              : isActive
                ? count ? `${count} · En cours…` : "En cours…"
                : isStepPartial
                  ? count ? `${count} · Partielle` : "Partielle"
                  : isDone
                    ? count
                    : "En attente";

            return (
              <li
                key={step.key}
                className={`${styles.step} ${styles[stepStatus]}`}
                aria-current={isActive ? "step" : undefined}
              >
                <span className={styles.icon} aria-hidden="true">
                  {isFailed || (!isActive && isStepPartial) ? "!" : isActive ? <span className={styles.spinner} /> : isDone ? "✓" : <span className={styles.dot} />}
                </span>
                <span className={styles.stepLabel}>{step.label}</span>
                <span className={styles.stepDescription}>{description}</span>
              </li>
            );
          })}
        </ol>

        {error?.message && <p className={styles.errorMessage}>{error.message}</p>}
      </div>

      {hasDetails && (
        <details className={styles.details}>
          <summary>
            Détails de la mise à jour
            {visibleWarnings.length > 0 && <span className={styles.warningBadge}>{visibleWarnings.length} {visibleWarnings.length === 1 ? "avertissement" : "avertissements"}</span>}
          </summary>
          <div className={styles.detailsContent}>
            {hasQbStats && <p>Stats QB NFL : {countLabel(details.qbStats, "QB", "QB")}.</p>}
            {hasNotifications && <p>Notifications classement : {countLabel(details.notifications, "envoi", "envois")}.</p>}
            {details.notificationNote && <p>{details.notificationNote}</p>}
            {visibleWarnings.length > 0 && (
              <ul className={styles.warnings}>
                {visibleWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
              </ul>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
