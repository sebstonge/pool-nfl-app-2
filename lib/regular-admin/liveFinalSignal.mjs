const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isFinalEspnCompetition(competition) {
  const type = competition?.status?.type;
  return type?.state === 'post' && type.completed === true
    && /^STATUS_FINAL(?:_OVERTIME|_OT|_\d+OT)?$/.test(type.name ?? '');
}

// Invoked by the existing live refresh, with no independent timer.
export function createLiveFinalSignal(auth, fetcher = fetch) {
  const handled = new Set();
  let sending = false;
  let rejectedToken;

  return async function signalFinalGames(gameIds) {
    if (sending) return;
    const normalized = gameIds.filter(id => typeof id === 'string' && uuidPattern.test(id))
      .map(id => id.toLowerCase());
    const pending = [...new Set(normalized)].filter(id => !handled.has(id));
    if (!pending.length) return;

    sending = true;
    try {
      const { data, error } = await auth.getSession();
      const token = data?.session?.access_token;
      if (error || !token || token === rejectedToken) return;

      const response = await fetcher('/api/push/qb-final', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameIds: pending }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) rejectedToken = token;
        return;
      }

      const { retryGameIds } = await response.json();
      if (!Array.isArray(retryGameIds)) return;
      const retry = new Set(retryGameIds);
      for (const id of pending) {
        if (!retry.has(id)) handled.add(id);
      }
    } catch {
      // A failed hint must not interrupt the live display. A later refresh
      // can send it again when the session or connection is available.
    } finally {
      sending = false;
    }
  };
}
