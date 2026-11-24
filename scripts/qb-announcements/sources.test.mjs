import assert from "node:assert/strict";
import test from "node:test";
import { collectArticles, discoverArticleUrls, NFL_INDEX, parseArticle, TEAM_SOURCES } from "./sources.mjs";

const NFL = "https://www.nfl.com";
const BAL = TEAM_SOURCES.BAL.origin;
const CHI = TEAM_SOURCES.CHI.origin;
const BAL_FEED = `${BAL}/rss/news`;
const CHI_FEED = `${CHI}/rss/news`;
const TIMESTAMP = "2026-11-03T19:00:00Z";

function article(title = "Coach names starter") {
  return `<meta property="article:published_time" content="${TIMESTAMP}">
    <h1>${title}</h1><article><p>The head coach said the quarterback will start.</p></article>`;
}

function fake(routes) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    assert.match(options.headers["user-agent"], /^NFLPoolQbWatch\//);
    const response = routes[url];
    if (response instanceof Response) return response;
    if (typeof response === "string") return new Response(response);
    return new Response("", { status: 404 });
  };
  return { calls, fetcher };
}

test("maps all clubs to distinct official sources and ESPN IDs", () => {
  const teams = Object.values(TEAM_SOURCES);
  assert.equal(teams.length, 32);
  assert.equal(new Set(teams.map(source => source.origin)).size, 32);
  assert.equal(new Set(teams.map(source => source.espnId)).size, 32);
  assert.equal(TEAM_SOURCES.WAS.espnId, "28");
  assert.equal(TEAM_SOURCES.LAR.espnId, "14");
  assert.equal(TEAM_SOURCES.LAC.espnId, "24");
});

test("discovers canonical article links from HTML, RSS and Atom", () => {
  const content = `<a title="the > character" href="/news/coach-names-starter/?utm_source=feed#top">Article</a>
    <a href="//baltimoreravens.com/news/coach-names-starter">Duplicate</a>
    <link>https://www.baltimoreravens.com/news/quarterback-availability?tag=1&amp;tracking=2</link>
    <link><![CDATA[${BAL}/news/another-story?utm_source=example]]></link>
    <link href="/news/atom-story" rel="alternate" />
    <guid isPermaLink="true">${BAL}/news/rss-guid</guid>
    <a href="http://www.nfl.com/news/http-story">HTTP</a>
    <a href="https://www.nfl.com:8080/news/wrong-port">Wrong port</a>
    <a href="https://attacker.test/news/not-official">Off-site</a>
    <a href="https://www.nfl.com.attacker.test/news/not-official">Subdomain spoof</a>
    <a href="https://someone@www.nfl.com/news/with-userinfo">Credentials</a>
    <a href="/news/">Index</a>
    <a href="/news/series/around-the-nfl-news">Series</a>
    <a href="/news/%2frobots">Encoded path</a>`;
  assert.deepEqual(discoverArticleUrls(content, `${BAL}/news/`), [
    `${BAL}/news/coach-names-starter`, `${BAL}/news/quarterback-availability`,
    `${BAL}/news/another-story`, `${BAL}/news/atom-story`, `${BAL}/news/rss-guid`,
  ]);
});

test("parses dated article content and preserves the club host as team hint", () => {
  const html = `<script type="application/ld+json">{
      "@graph": [{"@type":"WebSite"},{"@type":["Article","NewsArticle"],"datePublished":"2026-11-03T14:00:00-05:00","dateModified":"2026-11-03T15:00:00-05:00"}]
    }</script>
    <link href="/news/starter-confirmed?tracking=yes" rel="canonical">
    <h1>Ravens&#x2019; starter &amp; backup named</h1>
    <main><article>
      <p>Joe Fagnano will <em>start</em> Thursday, the coach said.</p>
      <p>&ldquo;He will start,&rdquo; the coach said.<br>It is official.</p>
      <aside><p>Related story</p></aside>
    </article></main><footer><p>Page footer</p></footer>`;
  assert.deepEqual(parseArticle(html, `${BAL}/news/alternate-slug/?utm_campaign=feed`), {
    url: `${BAL}/news/starter-confirmed`,
    teamHint: "BAL",
    publishedAt: "2026-11-03T19:00:00.000Z",
    updatedAt: "2026-11-03T20:00:00.000Z",
    title: "Ravens’ starter & backup named",
    paragraphs: ["Joe Fagnano will start Thursday, the coach said.", "“He will start,” the coach said. It is official."],
  });
  const central = `${NFL}/news/starter-confirmed`;
  assert.deepEqual(parseArticle(`<link rel="canonical" href="${BAL}/news/mirror">${article()}`, central), {
    url: central,
    teamHint: null,
    publishedAt: "2026-11-03T19:00:00.000Z",
    updatedAt: null,
    title: "Coach names starter",
    paragraphs: ["The head coach said the quarterback will start."],
  });
  assert.equal(parseArticle(article().replace(TIMESTAMP, "2026-11-03"), central), null);
  assert.equal(parseArticle(article(), "https://attacker.test/news/slug"), null);
});

test("uses structured story text and headline before page headings and gallery captions", () => {
  const structured = {
    "@type": "NewsArticle", headline: "Coach names starter",
    datePublished: TIMESTAMP, dateModified: "2026-11-03T18:55:00Z",
    articleBody: "First paragraph.\n\nSecond paragraph.",
  };
  const html = `<script type="application/ld+json">${JSON.stringify(structured)}</script>
    <h1>Club News</h1><article><h1>Coach names starter</h1><p>Gallery caption</p></article>`;
  const story = parseArticle(html, `${BAL}/news/coach-names-starter`);
  assert.equal(story.title, structured.headline);
  assert.equal(story.updatedAt, "2026-11-03T18:55:00.000Z");
  assert.deepEqual(story.paragraphs, ["First paragraph.", "Second paragraph."]);
});

test("collects only selected feeds with index fallback, targeted links first and canonical seen deduplication", async () => {
  const central = `${NFL}/news/central-story`;
  const targeted = `${NFL}/news/targeted-story`;
  const seen = `${NFL}/news/already-seen`;
  const raven = `${BAL}/news/ravens-starter`;
  const bear = `${CHI}/news/bears-starter`;
  const { calls, fetcher } = fake({
    [NFL_INDEX]: `<a href="${central}">League</a><a href="${seen}/?utm=1">Seen</a>`,
    [BAL_FEED]: `<rss><channel><item><link>${raven}</link></item></channel></rss>`,
    [TEAM_SOURCES.CHI.index]: `<a href="${bear}">Club</a><a href="${TEAM_SOURCES.SF.origin}/news/linked-story">Other club</a>`,
    [central]: article("League story"),
    [targeted]: article("Targeted story"),
    [raven]: article("Ravens story"),
    [bear]: article("Bears story"),
  });
  const result = await collectArticles({
    teams: ["BAL", "CHI", "BAL", "invalid"],
    urls: [`${targeted}/?tracking=yes`, targeted, "https://attacker.test/news/bad", seen],
    seenUrls: [`${seen}#old`],
    limit: 3,
    fetcher,
  });

  assert.deepEqual(result.articles.map(row => row.url), [targeted, central, raven]);
  assert.deepEqual(result.discoveredUrls, [central, raven, bear, seen]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.requests, calls.length);
  assert.ok(calls.includes(CHI_FEED));
  assert.ok(calls.includes(TEAM_SOURCES.CHI.index));
  assert.ok(!calls.includes(TEAM_SOURCES.BAL.index));
  assert.ok(!calls.includes(bear));
  assert.ok(!calls.includes(seen));
  assert.deepEqual(new Set(calls.map(url => new URL(url).origin)), new Set([NFL, BAL, CHI]));
});

test("prioritizes quarterback and practice reports deep in a busy source index", async () => {
  const starter = `${NFL}/news/coach-names-starter`;
  const practice = `${NFL}/news/monday-practice-notes`;
  const generic = Array.from({ length: 100 }, (_, i) => `<a href="/news/news-item-${i}">Other news</a>`).join("");
  const { calls, fetcher } = fake({
    [NFL_INDEX]: `${generic}<a href="${practice}">Practice</a><a href="${starter}">Starter</a>`,
    [starter]: article(),
    [practice]: article(),
  });
  const result = await collectArticles({ limit: 2, fetcher });
  assert.deepEqual(result.articles.map(row => row.url), [starter, practice]);
  assert.deepEqual(result.discoveredUrls.slice(0, 2), [starter, practice]);
  assert.equal(calls.length, 4);
});

test("applies longest robots rule, specific user-agent and same-origin redirects", async () => {
  const allowed = `${BAL}/news/allowed-release`;
  const blocked = `${BAL}/news/blocked-release`;
  const redirect = `${BAL}/news/old-release`;
  const external = `${BAL}/news/external-redirect`;
  const { calls, fetcher } = fake({
    [NFL_INDEX]: "",
    [`${BAL}/robots.txt`]: `User-agent: *
      Disallow: /
      User-agent: NFLPoolQbWatch
      Disallow: /rss/
      Disallow: /news/*-release$
      Allow: /news/allowed-release$
      Allow: /news/old-release$`,
    [TEAM_SOURCES.BAL.index]: `<a href="${blocked}">Blocked</a>`,
    [redirect]: new Response(null, { status: 301, headers: { location: "/news/allowed-release?tag=1" } }),
    [external]: new Response(null, { status: 302, headers: { location: `${CHI}/news/other-club` } }),
    [allowed]: article(),
  });
  const result = await collectArticles({ teams: ["BAL"], urls: [redirect, allowed, external], fetcher });
  assert.deepEqual(result.articles.map(row => row.url), [allowed]);
  assert.equal(calls.filter(url => url === allowed).length, 1);
  assert.ok(!calls.includes(BAL_FEED));
  assert.ok(!calls.includes(blocked));
  assert.ok(!calls.some(url => url.startsWith(CHI)));
  assert.ok(result.errors.some(error => error.url === external && /Redirect/.test(error.message)));
});

test("stops an origin after blocking or a Retry-After response", async () => {
  const first = `${NFL}/news/rate-limited`;
  const second = `${NFL}/news/next-story`;
  const { calls, fetcher } = fake({
    [NFL_INDEX]: `<a href="${first}">Rate limited</a><a href="${second}">Later</a>`,
    [first]: new Response(null, { status: 503, headers: { "retry-after": "300" } }),
    [BAL_FEED]: new Response(null, { status: 403 }),
  });
  const result = await collectArticles({
    teams: ["BAL", "CHI"],
    urls: [`${BAL}/news/same-origin`, `${CHI}/news/targeted`],
    fetcher,
    retryAfterByOrigin: { [CHI]: new Date(Date.now() + 60000).toISOString() },
  });
  assert.deepEqual(result.articles, []);
  assert.deepEqual(result.errors.map(({ status, retryAfter }) => [status, retryAfter]), [[403, undefined], [503, "300"]]);
  assert.ok(!calls.includes(TEAM_SOURCES.BAL.index));
  assert.ok(!calls.includes(second));
  assert.ok(!calls.some(url => url.startsWith(CHI)));
});

test("fails closed when robots cannot be loaded and discards undated articles", async () => {
  const undated = `${NFL}/news/undated`;
  const { calls, fetcher } = fake({
    [`${BAL}/robots.txt`]: new Response(null, { status: 500 }),
    [NFL_INDEX]: `<a href="${undated}">Undated</a>`,
    [undated]: "<h1>Undated</h1><p>The coach named a starter.</p>",
  });
  const result = await collectArticles({ teams: ["BAL"], fetcher });
  assert.deepEqual(result.articles, []);
  assert.ok(!calls.includes(BAL_FEED));
  assert.ok(!calls.includes(TEAM_SOURCES.BAL.index));
  assert.ok(result.errors.some(error => error.url === undated && /timestamp/.test(error.message)));
});
