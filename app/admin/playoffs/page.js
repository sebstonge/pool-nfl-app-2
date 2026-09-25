/* =========================================================
   ADMIN PLAYOFFS — DESKTOP LAYOUT
   ========================================================= */

.seedAdminGrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
}

.seedAdminCard {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cardHeading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.cardHeading h2 {
  margin: 0;
}

.eyebrow {
  margin: 0 0 5px;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.58;
}

.mutedText {
  opacity: 0.7;
}

.helperText {
  margin-top: 12px;
  font-size: 0.88rem;
  opacity: 0.62;
}

.conferenceCard {
  min-width: 0;
}

.conferenceHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.conferenceHeader h2 {
  margin: 0;
}

.conferenceCount {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
  opacity: 0.72;
}

.seedList {
  display: grid;
  gap: 8px;
}

.roundAdminSection {
  margin-top: 4px;
}

.sectionHeading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin: 2px 2px 12px;
}

.sectionHeading h2 {
  margin: 0;
  font-size: 1.2rem;
}

.activationCard {
  margin-top: 2px;
}

.activationContent {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 32px;
}

.activationContent h2 {
  margin-top: 0;
}

.activationContent button {
  min-width: 210px;
}

/* =========================================================
   LARGE DESKTOP
   ========================================================= */

@media (min-width: 1100px) {
  .seedAdminGrid {
    grid-template-columns: minmax(0, 1.1fr) minmax(340px, 0.9fr);
  }

  .conferences {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* =========================================================
   TABLET / MOBILE
   ========================================================= */

@media (max-width: 800px) {
  .seedAdminGrid {
    grid-template-columns: 1fr;
  }

  .activationContent {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .activationContent button {
    width: 100%;
    min-width: 0;
  }

  .cardHeading {
    flex-direction: column;
  }
}
