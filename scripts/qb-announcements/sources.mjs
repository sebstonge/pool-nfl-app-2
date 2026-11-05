import { mapBounded } from "../../lib/regular-publication/espn.mjs";

// Official club domains from https://www.nfl.com/teams/.
function team(espnId, name, host, ...aliases) {
  const origin = `https://www.${host}`;
  return Object.freeze({ espnId, name, aliases: Object.freeze([name, ...aliases]), origin, index: `${origin}/news/` });
}

export const TEAM_SOURCES = Object.freeze({
  ARI: team("22", "Arizona Cardinals", "azcardinals.com", "Cardinals", "Arizona", "Cards"),
  ATL: team("1", "Atlanta Falcons", "atlantafalcons.com", "Falcons", "Atlanta"),
  BAL: team("33", "Baltimore Ravens", "baltimoreravens.com", "Ravens", "Baltimore"),
  BUF: team("2", "Buffalo Bills", "buffalobills.com", "Bills", "Buffalo"),
  CAR: team("29", "Carolina Panthers", "panthers.com", "Panthers", "Carolina"),
  CHI: team("3", "Chicago Bears", "chicagobears.com", "Bears", "Chicago"),
  CIN: team("4", "Cincinnati Bengals", "bengals.com", "Bengals", "Cincinnati"),
  CLE: team("5", "Cleveland Browns", "clevelandbrowns.com", "Browns", "Cleveland"),
  DAL: team("6", "Dallas Cowboys", "dallascowboys.com", "Cowboys", "Dallas"),
  DEN: team("7", "Denver Broncos", "denverbroncos.com", "Broncos", "Denver"),
  DET: team("8", "Detroit Lions", "detroitlions.com", "Lions", "Detroit"),
  GB: team("9", "Green Bay Packers", "packers.com", "Packers", "Green Bay"),
  HOU: team("34", "Houston Texans", "houstontexans.com", "Texans", "Houston"),
  IND: team("11", "Indianapolis Colts", "colts.com", "Colts", "Indianapolis"),
  JAX: team("30", "Jacksonville Jaguars", "jaguars.com", "Jaguars", "Jacksonville", "Jags"),
  KC: team("12", "Kansas City Chiefs", "chiefs.com", "Chiefs", "Kansas City"),
  LAC: team("24", "Los Angeles Chargers", "chargers.com", "Chargers", "LA Chargers", "L.A. Chargers"),
  LAR: team("14", "Los Angeles Rams", "therams.com", "Rams", "LA Rams", "L.A. Rams"),
  LV: team("13", "Las Vegas Raiders", "raiders.com", "Raiders", "Las Vegas"),
  MIA: team("15", "Miami Dolphins", "miamidolphins.com", "Dolphins", "Miami", "Fins"),
  MIN: team("16", "Minnesota Vikings", "vikings.com", "Vikings", "Minnesota"),
  NE: team("17", "New England Patriots", "patriots.com", "Patriots", "New England", "Pats"),
  NO: team("18", "New Orleans Saints", "neworleanssaints.com", "Saints", "New Orleans"),
  NYG: team("19", "New York Giants", "giants.com", "Giants", "NY Giants"),
  NYJ: team("20", "New York Jets", "newyorkjets.com", "Jets", "NY Jets"),
  PHI: team("21", "Philadelphia Eagles", "philadelphiaeagles.com", "Eagles", "Philadelphia"),
  PIT: team("23", "Pittsburgh Steelers", "steelers.com", "Steelers", "Pittsburgh"),
  SEA: team("26", "Seattle Seahawks", "seahawks.com", "Seahawks", "Seattle"),
  SF: team("25", "San Francisco 49ers", "49ers.com", "49ers", "San Francisco", "Niners"),
  TB: team("27", "Tampa Bay Buccaneers", "buccaneers.com", "Buccaneers", "Tampa Bay", "Bucs"),
  TEN: team("10", "Tennessee Titans", "tennesseetitans.com", "Titans", "Tennessee"),
  WAS: team("28", "Washington Commanders", "commanders.com", "Commanders", "Washington"),
});

const NFL_ORIGIN = "https://www.nfl.com";
export const NFL_INDEX = `${NFL_ORIGIN}/news/series/around-the-nfl-news`;
const TEAM_BY_ORIGIN = new Map(Object.entries(TEAM_SOURCES).map(([abbr, source]) => [source.origin, abbr]));
const ORIGINS = new Set([NFL_ORIGIN, ...TEAM_BY_ORIGIN.keys()]);
const ARTICLE_PATH = /^\/news\/[a-z0-9][a-z0-9_-]*\/?$/i;
const PRODUCT = "NFLPoolQbWatch";
const CONCURRENCY = 4;
const MAX_REQUESTS = 48;
const REQUEST_MS = 8000;
const RUN_MS = 55000;
const MAX_BODY = 4 * 1024 * 1024;
const MAX_ROBOTS = 512 * 1024;
const MAX_LINKS_PER_SOURCE = 80;

function publicUrl(value, base) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (ORIGINS.has(url.origin)) return url;
    // Bare domains in links are aliases of the official www domains.
    const www = `https://www.${url.hostname}`;
    if (ORIGINS.has(www)) {
      url.hostname = `www.${url.hostname}`;
      return url;
    }
  } catch {
    return null;
  }
  return null;
}

function articleUrl(value, base) {
  const url = publicUrl(value, base);
  if (!url || !ARTICLE_PATH.test(url.pathname)) return null;
  return url.origin + url.pathname.replace(/\/$/, "");
}

const ENTITIES = {
  amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", zwnj: "", zwj: "",
};

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, key) => {
    if (key[0] !== "#") return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : entity;
    const point = key[1].toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function plainText(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
}

function attributes(tag) {
  const result = Object.create(null);
  for (const [, name, double, single, bare] of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    result[name.toLowerCase()] = decodeEntities(double ?? single ?? bare);
  }
  return result;
}

export function discoverArticleUrls(text, sourceUrl) {
  const urls = new Set();
  const links = /<(?:link|guid)\b[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+))\s*<\/(?:link|guid)>|<(?:a|link)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  // RSS <link> elements have text content, whereas Atom and HTML links use href.
  for (const match of text.matchAll(links)) {
    const href = match[1] ?? (match[2] ? decodeEntities(match[2]) : attributes(match[0]).href);
    const url = href && articleUrl(href, sourceUrl);
    if (url) urls.add(url);
  }
  return [...urls];
}

function structuredArticle(html) {
  for (const [, tag, content] of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(tag).type?.toLowerCase() !== "application/ld+json") continue;
    try {
      const root = JSON.parse(content);
      const entries = [root].flat().flatMap(entry => [entry, ...(Array.isArray(entry?.["@graph"]) ? entry["@graph"] : [])]);
      const match = entries.find(entry => [entry?.["@type"]].flat().some(type => /(?:^|\/)(?:NewsArticle|Article|BlogPosting)$/.test(type)));
      if (match) return match;
    } catch {
      // Other publishing metadata remains available when structured data is malformed.
    }
  }
  return {};
}

function validDate(values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    // Only absolute timestamps can be compared to kickoff and publication cutoffs.
    if (!/(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC))$/i.test(value.trim())) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function articleParagraphs(html, articleBody) {
  // Structured story text excludes bylines, related articles, and gallery captions.
  if (typeof articleBody === "string") {
    const structured = articleBody.split(/\r?\n+|<\/p\s*>/i).map(plainText).filter(Boolean);
    if (structured.length) return [...new Set(structured)].slice(0, 120);
  }
  const content = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<blockquote\b[^>]*\b(?:twitter-tweet|instagram-media|tiktok-embed|bluesky-embed)\b[^>]*>[\s\S]*?<\/blockquote\s*>/gi, "")
    .replace(/<(script|style|header|footer|nav|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const body = content.match(/<article\b[^>]*>([\s\S]*)<\/article\s*>/i)?.[1]
    ?? content.match(/<main\b[^>]*>([\s\S]*)<\/main\s*>/i)?.[1]
    ?? content;
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => plainText(match[1]));
  return [...new Set(paragraphs.filter(Boolean))].slice(0, 120);
}

export function parseArticle(html, url) {
  const requested = articleUrl(url);
  if (!requested) return null;

  const origin = new URL(requested).origin;
  const data = structuredArticle(html);
  const metadata = new Map();
  const times = new Map();
  let canonical = requested;
  for (const [tag, element] of html.matchAll(/<(meta|link|time)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const attrs = attributes(tag);
    switch (element.toLowerCase()) {
      case "meta": {
        const key = attrs.property ?? attrs.name ?? attrs.itemprop;
        if (key && attrs.content) metadata.set(key.toLowerCase(), attrs.content);
        break;
      }
      case "link": {
        if (attrs.rel?.toLowerCase() !== "canonical") break;
        const candidate = articleUrl(attrs.href, requested);
        if (candidate && new URL(candidate).origin === origin) canonical = candidate;
        break;
      }
      case "time":
        if (attrs.datetime) {
          const key = (attrs.itemprop ?? "time").toLowerCase();
          if (!times.has(key)) times.set(key, attrs.datetime);
        }
        break;
    }
  }
  const publishedAt = validDate([
    data.datePublished, metadata.get("article:published_time"), metadata.get("datepublished"),
    metadata.get("og:published_time"), times.get("datepublished"), times.get("time"),
  ]);
  const updatedAt = validDate([
    data.dateModified, metadata.get("article:modified_time"), metadata.get("datemodified"),
    metadata.get("og:updated_time"), times.get("datemodified"),
  ]);
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1];
  const title = [data.headline, metadata.get("og:title"), heading]
    .filter(value => typeof value === "string").map(plainText).find(Boolean);
  const paragraphs = articleParagraphs(html, data.articleBody);
  if (!title || !publishedAt || paragraphs.length === 0) return null;
  return { url: canonical, teamHint: TEAM_BY_ORIGIN.get(origin) ?? null, publishedAt, updatedAt, title, paragraphs };
}

function robotsPolicy(text) {
  const groups = [];
  let group = { agents: [], rules: [], delay: 0 };
  let readRules = false;
  for (const line of text.split(/\r?\n/)) {
    const [, field, value] = /^\s*([\w-]+)\s*:\s*([^#]*?)\s*(?:#.*)?$/.exec(line) ?? [];
    switch (field?.toLowerCase()) {
      case "user-agent":
        if (readRules) {
          groups.push(group);
          group = { agents: [], rules: [], delay: 0 };
          readRules = false;
        }
        group.agents.push(value.toLowerCase());
        break;
      case "allow":
      case "disallow": {
        readRules = true;
        if (!value.startsWith("/")) break;
        const pattern = value.replace(/\$$/, "").split("*")
          .map(segment => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
        group.rules.push({
          path: new RegExp(`^${pattern}${value.endsWith("$") ? "$" : ""}`),
          length: value.replace(/[*$]/g, "").length,
          allow: field.toLowerCase() === "allow",
        });
        break;
      }
      case "crawl-delay":
        readRules = true;
        if (/^\d+(?:\.\d+)?$/.test(value)) group.delay = Number(value) * 1000;
        break;
    }
  }
  groups.push(group);
  const specific = groups.filter(entry => entry.agents.includes(PRODUCT.toLowerCase()));
  const selected = specific.length ? specific : groups.filter(entry => entry.agents.includes("*"));
  const rules = selected.flatMap(entry => entry.rules).sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow));
  return {
    delay: Math.max(0, ...selected.map(entry => entry.delay)),
    allows: path => rules.find(rule => rule.path.test(path))?.allow ?? true,
  };
}

async function responseText(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Response exceeds the size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Response exceeds the size limit");
    }
    text += decoder.decode(value, { stream: true });
  }
}

function roundRobin(lists) {
  const result = [];
  for (let offset = 0; lists.some(list => offset < list.length); offset++) {
    for (const list of lists) if (list[offset]) result.push(list[offset]);
  }
  return [...new Set(result)];
}

function rankedLinks({ url, text }, origin) {
  const links = [[], [], [], []];
  for (const link of discoverArticleUrls(text, url)) {
    if (!link.startsWith(`${origin}/`)) continue;
    const slug = link.slice(origin.length + "/news/".length).toLowerCase();
    if (/(?:^|-)(?:starter|starting-quarterback|starting-qb|qb1|under-center|to-start|will-start)(?:-|$)/.test(slug)) {
      links[0].push(link);
    } else if (/(?:^|-)(?:qb|quarterbacks?)(?:-|$)/.test(slug)) {
      links[1].push(link);
    } else if (/(?:^|-)(?:injury-report|practice|game-status|inactives)(?:-|$)/.test(slug)) {
      links[2].push(link);
    } else {
      links[3].push(link);
    }
  }
  return links.flat().slice(0, MAX_LINKS_PER_SOURCE);
}

// One request at a time per origin. Robots are checked once per run and a
// blocked/rate-limited origin stays paused. Only selected clubs and explicitly
// targeted article URLs can add origins to a run.
export async function collectArticles({
  teams = [], urls = [], seenUrls = [], limit = 24, fetcher = fetch, retryAfterByOrigin = {},
  timeBudgetMs = RUN_MS,
} = {}) {
  const deadline = Date.now() + Math.min(RUN_MS, timeBudgetMs);
  const errors = [];
  const states = new Map();
  const known = new Set(Array.from(seenUrls, value => articleUrl(value)).filter(Boolean));
  const selected = [...new Set(teams.map(value => String(value).toUpperCase().replace(/^WSH$/, "WAS")))]
    .filter(abbr => Object.hasOwn(TEAM_SOURCES, abbr)).slice(0, 4);
  const indexes = [NFL_INDEX, ...selected.map(abbr => TEAM_SOURCES[abbr].index)];
  let requests = 0;

  function report(url, message, extra = {}) {
    errors.push({ url, message, ...extra });
  }

  async function request(start, state, kind, acceptPath) {
    let url = new URL(start);
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (state.blocked || (kind === "article" && known.has(articleUrl(url.href)))) return null;
      if (kind !== "robots" && !state.policy.allows(url.pathname)) {
        report(url.href, "robots.txt disallows this path");
        return null;
      }
      const waitMs = kind === "robots" ? 0 : Math.max(0, state.nextRequest - Date.now());
      if (requests >= MAX_REQUESTS || Date.now() + waitMs >= deadline) {
        report(url.href, "Request budget reached");
        return null;
      }
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      const remaining = deadline - Date.now();
      if (requests >= MAX_REQUESTS || remaining <= 0) {
        report(url.href, "Request budget reached");
        return null;
      }

      try {
        requests++;
        state.nextRequest = Date.now() + (state.policy?.delay ?? 0);
        const response = await fetcher(url.href, {
          redirect: "manual",
          signal: AbortSignal.timeout(Math.min(REQUEST_MS, remaining)),
          headers: {
            "user-agent": `${PRODUCT}/1.0`,
            accept: kind === "robots" ? "text/plain" : "text/html, application/rss+xml, application/atom+xml, application/xml",
          },
        });
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter || [401, 403, 429].includes(response.status)) {
          state.blocked = true;
          await response.body?.cancel();
          report(url.href, `HTTP ${response.status}`, { status: response.status, ...(retryAfter && { retryAfter }) });
          return null;
        }
        if (response.redirected) {
          await response.body?.cancel();
          report(url.href, "Unexpected redirect");
          return null;
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          const next = location && new URL(location, url);
          if (!next || next.origin !== url.origin || !publicUrl(next.href) || !acceptPath(next.pathname)) {
            report(url.href, "Redirect leaves the allowed origin or path");
            return null;
          }
          next.search = "";
          next.hash = "";
          url = next;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (kind === "robots" && [404, 410].includes(response.status)) return { url: url.href, text: "" };
          if (kind !== "feed" || ![404, 410].includes(response.status)) {
            report(url.href, `HTTP ${response.status}`, { status: response.status });
          }
          return null;
        }
        const text = await responseText(response, kind === "robots" ? MAX_ROBOTS : MAX_BODY);
        if (kind === "robots" && /^\s*<(?:!doctype|html|head|body)\b/i.test(text)) {
          report(url.href, "robots.txt returned an HTML page");
          return null;
        }
        return { url: url.href, text };
      } catch (error) {
        report(url.href, error.message);
        return null;
      }
    }
    report(start, "Redirect limit reached");
    return null;
  }

  async function checkRobots(origin) {
    if (states.has(origin)) return states.get(origin);
    const state = { blocked: false, policy: null, nextRequest: 0 };
    states.set(origin, state);
    if (Date.parse(retryAfterByOrigin[origin]) > Date.now()) {
      state.blocked = true;
      return state;
    }
    const robots = await request(`${origin}/robots.txt`, state, "robots", path => path === "/robots.txt");
    if (robots) {
      state.policy = robotsPolicy(robots.text);
      state.nextRequest += state.policy.delay;
    } else {
      state.blocked = true;
    }
    return state;
  }

  const lists = await mapBounded(indexes, async index => {
    const { origin, pathname } = new URL(index);
    const state = await checkRobots(origin);
    if (origin !== NFL_ORIGIN) {
      const feed = await request(`${origin}/rss/news`, state, "feed", path => /^\/rss\/news\/?$/.test(path));
      if (feed && /<(?:rss|feed|rdf:RDF)\b/i.test(feed.text)) {
        const links = rankedLinks(feed, origin);
        if (links.length) return links;
      }
    }
    const page = await request(index, state, "index", path => path.replace(/\/$/, "") === pathname.replace(/\/$/, ""));
    return page ? rankedLinks(page, origin) : [];
  }, CONCURRENCY);
  const discoveredUrls = roundRobin(lists);
  const articleLimit = Number.isSafeInteger(limit) ? Math.min(32, Math.max(0, limit)) : 24;
  const candidates = [...new Set([...urls.map(value => articleUrl(value)).filter(Boolean), ...discoveredUrls])]
    .filter(url => !known.has(url) && !states.get(new URL(url).origin)?.blocked).slice(0, articleLimit);
  const byOrigin = new Map();
  for (const url of candidates) {
    const { origin } = new URL(url);
    if (!byOrigin.has(origin)) byOrigin.set(origin, []);
    byOrigin.get(origin).push(url);
  }

  const articlesByCandidate = new Map();
  await mapBounded([...byOrigin], async ([origin, links]) => {
    const state = await checkRobots(origin);
    for (const url of links) {
      if (state.blocked) break;
      const page = await request(url, state, "article", path => ARTICLE_PATH.test(path));
      if (!page) continue;
      const article = parseArticle(page.text, page.url);
      if (!article) {
        report(page.url, "Article title, publication timestamp or body could not be read");
        continue;
      }
      if (!known.has(article.url)) {
        if (article.updatedAt && article.updatedAt < article.publishedAt) {
          report(article.url, "Article modification timestamp precedes publication");
        }
        articlesByCandidate.set(url, article);
      }
      known.add(url);
      known.add(articleUrl(page.url));
      known.add(article.url);
    }
  }, CONCURRENCY);

  const articles = candidates.map(url => articlesByCandidate.get(url)).filter(Boolean);
  return { articles, discoveredUrls, errors, requests };
}
