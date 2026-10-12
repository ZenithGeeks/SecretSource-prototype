// k6 load test for the researcher routes. LOCAL ONLY: run it by hand against
// `docker compose up`, never against production and never from CI.
//
//   k6 run loadtest/researcher.js
//   k6 run -e BASE_URL=http://localhost:8080 -e TOKEN=<supabase access token> loadtest/researcher.js
//
// BASE_URL  gateway, default http://localhost:8080 (routes are at the root, no /api).
// TOKEN     bearer token; only needed when login is on (SUPABASE_URL set).
//
// Thresholds are p95 budgets per route. They are a starting point: if the library you
// seeded is much larger or smaller, tune them. A blocked event loop (#228) or an O(n^2)
// graph (#224) pushes every route over budget, which fails the run.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const TOKEN = __ENV.TOKEN || "";
const HEADERS = { "Content-Type": "application/json" };
if (TOKEN) HEADERS.Authorization = `Bearer ${TOKEN}`;

// Fixed so runs are comparable. consensus reuses stored verdicts and makes no LLM calls.
const QUESTION = "Does the cited evidence support the main claim?";

export const options = {
  scenarios: {
    // Page load: what the frontend fires together (home, graph, projects, analyses).
    page_load: {
      executor: "constant-vus",
      vus: 5,
      duration: "1m",
      exec: "pageLoad",
    },
    // A low, steady rate of consensus questions alongside it.
    consensus: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 2,
      exec: "consensus",
    },
  },
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "http_req_duration{route:home}": ["p(95)<500"],
    "http_req_duration{route:graph}": ["p(95)<1500"],
    "http_req_duration{route:projects}": ["p(95)<500"],
    "http_req_duration{route:analyses}": ["p(95)<500"],
    "http_req_duration{route:consensus}": ["p(95)<1500"],
  },
};

function get(path, route) {
  return {
    method: "GET",
    url: `${BASE_URL}${path}`,
    params: { headers: HEADERS, tags: { route } },
  };
}

export function pageLoad() {
  const responses = http.batch([
    get("/researcher/home", "home"),
    get("/researcher/graph", "graph"),
    get("/researcher/projects", "projects"),
    get("/analyses", "analyses"),
  ]);
  for (const r of responses) check(r, { "status 200": (x) => x.status === 200 });
  sleep(1);
}

export function consensus() {
  const r = http.post(
    `${BASE_URL}/researcher/consensus`,
    JSON.stringify({ question: QUESTION }),
    { headers: HEADERS, tags: { route: "consensus" } },
  );
  check(r, { "status 200": (x) => x.status === 200 });
}
