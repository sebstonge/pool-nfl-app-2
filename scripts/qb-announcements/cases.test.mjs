import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./cases.mjs";
import { classifyArticle } from "./classify.mjs";
import { TEAM_SOURCES } from "./sources.mjs";

const schedules = {
  3: {
    firstKickoffAt: "2026-09-25T00:15:00Z",
    games: [{ id: "401872955", teams: ["WAS", "SEA"], kickoffAt: "2026-09-27T17:00:00Z" }],
  },
  5: {
    firstKickoffAt: "2026-10-09T00:15:00Z",
    games: [{ id: "401872988", teams: ["WAS", "NYG"], kickoffAt: "2026-10-11T17:00:00Z" }],
  },
  8: {
    firstKickoffAt: "2026-10-30T00:15:00Z",
    games: [{ id: "401873035", teams: ["WAS", "PHI"], kickoffAt: "2026-11-02T01:20:00Z" }],
  },
  9: {
    firstKickoffAt: "2026-11-06T01:15:00Z",
    games: [
      { id: "401873037", teams: ["BAL", "JAX"], kickoffAt: "2026-11-06T01:15:00Z" },
      { id: "401873048", teams: ["ARI", "SEA"], kickoffAt: "2026-11-08T21:25:00Z" },
      { id: "401873044", teams: ["PHI", "NYG"], kickoffAt: "2026-11-08T18:00:00Z" },
    ],
  },
};

const reasons = {
  "was-week-3-mariota": "starter_confirmed",
  "was-week-5-daniels-after-lock": "late_publication",
  "was-week-8-practice-report": "no_starter_announcement",
  "was-week-8-gameday-after-lock": "late_publication",
  "ari-week-9-minshew": "starter_confirmed",
  "bal-week-9-fagnano": "starter_confirmed",
  "phi-week-9-milton-reported": "unattributed_report",
  "sea-week-9-lock-conditional": "invalid_update",
};

function replay(item, metadata = {}) {
  return classifyArticle({
    url: item.url,
    teamHint: item.url.startsWith(TEAM_SOURCES[item.team].origin) ? item.team : null,
    ...item.replay,
    ...metadata,
  }, {
    ...schedules[item.week],
    season: item.season,
    week: item.week,
    asOf: "2026-11-05T16:00:00Z",
    teams: TEAM_SOURCES,
    previous: { [item.team]: item.baseline },
    rosters: { [item.team]: [item.baseline, item.subject] },
  });
}

for (const item of cases) {
  test(item.id, () => {
    const result = replay(item);
    assert.equal(result.status, item.expectedStatus);
    assert.equal(result.reason, reasons[item.id]);
    assert.equal(result.team, item.team);
    if (item.expectedStatus !== "rejected") {
      assert.deepEqual(result.previousQB, item.baseline);
      assert.deepEqual(result.newQB, item.subject);
      assert.equal(result.espnAthleteId, item.subject.id);
      assert.equal(result.match.id, schedules[item.week].games.find(game => game.teams.includes(item.team)).id);
    }
  });
}

test("Seattle's wording remains conditional when the invalid update time is set aside", () => {
  const item = cases.find(({ id }) => id === "sea-week-9-lock-conditional");
  const result = replay(item, { updatedAt: null });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.reason, "qualified_announcement");
  assert.deepEqual(result.newQB, item.subject);
  assert.equal(result.match.id, "401873048");
});
