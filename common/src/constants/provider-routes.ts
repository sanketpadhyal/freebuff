export const PROVIDER_ROUTE_IDS = [
  'fireworks/deployment',
  'fireworks/serverless',
  'minimax/official',
  'xiaomi/official',
  'openrouter/novita/fp8',
  'mimo/openrouter',
  'infron/makora',
  'deepseek/openrouter',
  'deepseek/crof',
  'deepseek/runinfra',
  'deepseek/official',
] as const

export type ProviderRouteId = (typeof PROVIDER_ROUTE_IDS)[number]

export const FIREWORKS_DEPLOYMENT_PROVIDER_ROUTE =
  'fireworks/deployment' satisfies ProviderRouteId
export const FIREWORKS_SERVERLESS_PROVIDER_ROUTE =
  'fireworks/serverless' satisfies ProviderRouteId
export const MINIMAX_OFFICIAL_PROVIDER_ROUTE =
  'minimax/official' satisfies ProviderRouteId
/**
 * Marks a MiMo session as diverted off Xiaomi's direct API to the OpenRouter
 * lane. Like {@link DEEPSEEK_INFRON_MAKORA_PROVIDER_ROUTE} it says *that* the
 * session is on the fallback, NOT which upstream serves it — that is
 * {@link MIMO_OPENROUTER_UPSTREAM} below, so repointing it also moves every
 * session already pinned here, with no migration.
 *
 * Named generically on purpose. Its predecessor
 * {@link MIMO_NOVITA_PROVIDER_ROUTE} baked the upstream into a value that gets
 * persisted in `free_session.provider_route` and read back unvalidated, so
 * changing upstreams meant either a migration or a name that lies.
 */
export const MIMO_OPENROUTER_PROVIDER_ROUTE =
  'mimo/openrouter' satisfies ProviderRouteId
/**
 * The upstreams that serve {@link MIMO_OPENROUTER_PROVIDER_ROUTE}, preferred
 * first: Xiaomi's OWN endpoint, reached through OpenRouter's account rather
 * than our direct API key, with Novita behind it purely as depth.
 *
 * It lives next to the route id because the two are meant to be read together —
 * the id says which lane a session is pinned to, this says who serves it — and
 * in `common/` rather than in mimo-router.ts so `scripts/mimo-smoke.ts` can
 * assert against the REAL value without importing the billing chain. A smoke
 * test that restates this config would keep passing after the upstream moved,
 * reporting a lane it no longer covers.
 *
 * Novita served the lane until 2026-08-01, which was most of what made the
 * fallback expensive. Measured over 6h of prod that day, attributing rows by
 * whether their cost reproduces our Xiaomi formula:
 *
 *   openrouter/novita   18,268 reqs (42.6%)  19.2% cache  $364.11  $0.138/M in
 *   xiaomi direct       24,631 reqs (57.4%)  90.5% cache   $63.76  $0.018/M in
 *
 * Novita is also 20% dearer per token before caching ($0.168/$0.336 against
 * Xiaomi's $0.14/$0.28) and prices cache reads at $0.0034/M against $0.0028/M.
 * Xiaomi's OpenRouter endpoint is priced identically to our direct rate, so the
 * lane costs the same as the primary and differs only in whose rate limit and
 * prompt cache it draws on — which is the entire point of having it.
 */
export const MIMO_OPENROUTER_UPSTREAM_ORDER = [
  'xiaomi/fp8',
  'novita/fp8',
] as const

/**
 * Fresh OpenRouter `provider` block for the MiMo lane.
 *
 * TWO ENTRIES DELIBERATELY, and it must never go back to one. A pinned session
 * has no health check and no un-pin path — `routeWithStickyFallback` short
 * -circuits straight to the fallback — so if the lane's only upstream is down,
 * one transient Xiaomi blip wedges every remaining request in that session
 * rather than degrading a single one. That is not hypothetical: a one-deep pin
 * on DeepSeek's Infron lane took out 1,160 requests across 191 users for ~32h
 * when `makora` went offline (2026-07-26/27, fixed in #1045).
 *
 * Verified live on this lane 2026-08-01: within an `allow_fallbacks:false`
 * order list, an unroutable first entry is SKIPPED rather than failing the
 * request — `order:['nosuchprovider','xiaomi/fp8']` returned 200 from Xiaomi —
 * while `order:['xiaomi/fp8','novita/fp8']` still serves from Xiaomi when it is
 * healthy. So the depth costs nothing in the normal case and is the difference
 * between a degraded session and a wedged one in the bad case. Novita is second
 * because it is the best-understood host for this model: it served ~43% of MiMo
 * traffic through late July, so its compatibility with our request shape is
 * proven, and it only ever serves when Xiaomi cannot.
 *
 * Returns a NEW object with a NEW array every call. These arrays get aliased
 * into an outgoing request body, and this file's peer
 * `INFRON_PROVIDER_ORDER` was made copy-on-assignment in #1045 for exactly that
 * reason — one downstream mutation would corrupt routing process-wide.
 */
export function mimoOpenRouterProvider(): Record<string, unknown> {
  return {
    order: [...MIMO_OPENROUTER_UPSTREAM_ORDER],
    allow_fallbacks: false,
  }
}
/**
 * LEGACY MiMo fallback pin, written while the OpenRouter lane was hardcoded to
 * Novita FP8. Still recognized on READ so sessions pinned before
 * {@link MIMO_OPENROUTER_PROVIDER_ROUTE} shipped keep serving from the fallback
 * instead of silently reverting to a Xiaomi-direct attempt they already failed.
 * Never written anymore; expires with its session.
 */
export const MIMO_NOVITA_PROVIDER_ROUTE =
  'openrouter/novita/fp8' satisfies ProviderRouteId
/**
 * DeepSeek V4 Flash's CrofAI lane — and, since the 2026-08-15 cutover, the
 * COHORT MARK that says a session belongs on it.
 *
 * This id now carries two meanings that deliberately coincide. Written at
 * ADMISSION it means "this session was admitted after the cutover, so it enters
 * the cascade on CrofAI". Written by the CASCADE it means "this session
 * diverted onto CrofAI". Both want the same thing — enter on CrofAI — which is
 * why pins written by the pre-cutover code needed no migration when the
 * cutover shipped, and why nothing has to distinguish them on read.
 *
 * A session with NO pin is, by construction, one admitted before the cutover
 * shipped: it runs the pre-cutover order and keeps the prompt cache it has
 * already paid to warm. See `deepseekEntryLane` and
 * docs/freebuff-deepseek-provider-cutover.md.
 *
 * Reference prices per M — CrofAI/Infron/OpenRouter from live billing
 * 2026-08-04, RunInfra from runinfra.ai/pricing and Infron re-read from its
 * catalog on 2026-08-16, DeepSeek from its published card after the 16:00 UTC
 * 2026-08-16 repricing:
 *
 *                        input    cache read   output
 *   CrofAI 0731         0.1200     0.0030     0.2100
 *   RunInfra 0731       0.1300     0.0100     0.2700
 *   Infron alibaba      0.2120     0.0210     0.6360
 *   DeepSeek off-peak   0.2200     0.0070     0.6600
 *   DeepSeek peak       0.4400     0.0140     1.3200
 *   (retired) OpenRouter 0.0881    0.0176     0.1761
 *
 * A coding turn re-sends its whole prefix every step, so cache reads are most
 * of the tokens and that is the term that decides the bill. Infron's own
 * 2026-08-16 repricing (from 0.0690/0.0144/0.1375) turned it from the cheapest
 * lane into the dearest, which is what put {@link
 * DEEPSEEK_RUNINFRA_PROVIDER_ROUTE} ahead of it.
 *
 * The DeepSeek repricing also made CrofAI the cheapest lane outright rather
 * than a near-tie: it is now cheaper than DeepSeek direct on every term, by
 * 2.3x on cache reads off-peak and 4.7x at peak. The lane ORDER has not been
 * revisited to match — see docs/freebuff-deepseek-provider-cutover.md.
 *
 * It also serves `deepseek-v4-flash-0731` — the GA build, the same one
 * DeepSeek's own API serves — where Infron's undated slug is a frozen preview
 * snapshot. So this lane matches the DeepSeek-direct lane behind it in
 * behaviour as well as price.
 */
export const DEEPSEEK_CROF_PROVIDER_ROUTE =
  'deepseek/crof' satisfies ProviderRouteId
/**
 * DeepSeek's own API — the lane a cutover session diverts to, and the lane
 * every PRE-cutover session still enters on.
 *
 * It was the unpinned default until 2026-08-15, which is why it had no route id
 * before: a lane nothing ever moves to needs no name. Now that a cutover
 * session can divert here, it has to be able to say so, and to stay — its
 * prompt cache is warm on this upstream, and sending the next turn back to a
 * CrofAI that just failed would pay a cold prefill to reach a lane we already
 * know is unhealthy. The pin skips CrofAI as an ENTRY point only: it stays in
 * the order behind this lane, because by the next turn the blip has usually
 * cleared and CrofAI is still far cheaper than the lanes below.
 *
 * Behind CrofAI for cutover sessions because DeepSeek is the side that
 * repriced — as of 16:00 UTC 2026-08-16 its cache reads are $0.0070/M off-peak
 * and $0.0140/M at peak against CrofAI's $0.0030, so what used to be a
 * marginal loss on that term is now a 2.3-4.7x one — and because of the
 * failure record that made this a cascade at all: on 2026-08-03/04 it shed peak
 * load with 3,934 x 503 "Service is too busy" and diverted 4,997 sessions at
 * once, and on 2026-08-11 it accepted 650 requests in six hours and then sent
 * nothing, tripping the four-minute first-token watchdog. Note that the
 * watchdog is DeepSeek-direct-only (see `handleDeepSeekStream`); no equivalent
 * guards the CrofAI lane now serving in front of it.
 */
export const DEEPSEEK_OFFICIAL_PROVIDER_ROUTE =
  'deepseek/official' satisfies ProviderRouteId
/**
 * DeepSeek V4 Flash's LAST resort: the Infron lane, now tier 4 of four.
 *
 * DEMOTED FROM TIER 3 ON 2026-08-16. It was the cheapest route we had —
 * measured live 2026-08-04 on a 45,008-token prompt at $0.069/M input and
 * ~$0.0144/M cache read — and Infron then repriced its Alibaba Cloud Int.
 * group to $0.212/M input, $0.021/M cache read and $0.636/M output. That is
 * 3.1x, 1.4x and 4.6x, and it turns the cheapest lane into the dearest one.
 *
 * {@link DEEPSEEK_RUNINFRA_PROVIDER_ROUTE} is cheaper on input, cache reads and
 * output alike, and a measured agent turn confirms the list prices rather than
 * contradicting them: costed on one real 29-call buffbench turn, RunInfra came
 * to $0.0444 against this lane's $0.0820 — 1.85x. So Infron ahead of RunInfra
 * is wrong on both paper and practice.
 *
 * So it sits behind {@link DEEPSEEK_CROF_PROVIDER_ROUTE}, {@link
 * DEEPSEEK_OFFICIAL_PROVIDER_ROUTE} and {@link
 * DEEPSEEK_RUNINFRA_PROVIDER_ROUTE}, and it must never be the lane a session
 * settles on. Its own failure mode is why nothing cheap may sit below it: a
 * single aggregator account behind one Alibaba provider group, which when
 * 4,997 sessions diverted onto it in one window returned 13,286 saturation
 * 429s and then ran out of credits entirely, leaking the raw billing error to
 * 1,086 users. This only works because the cascade RE-PINS on each hop — a
 * session that finds Infron saturated does not pay a doomed Infron attempt on
 * every later turn.
 *
 * The `makora` in the name is historical (that upstream went offline in
 * 2026-07). The id says only *that* a session is on this lane, never which
 * upstream serves it — that is INFRON_PROVIDER_ORDER, keyed by model — so
 * repointing the upstream also moves sessions already pinned here. Renaming the
 * value itself would need a migration; it is persisted in
 * `free_session.provider_route` and read back unvalidated.
 */
export const DEEPSEEK_INFRON_MAKORA_PROVIDER_ROUTE =
  'infron/makora' satisfies ProviderRouteId
/**
 * DeepSeek V4 Flash's SECOND backup: the RunInfra lane, tier 3 of four.
 *
 * Added because the three lanes ahead of it have each failed in the one way a
 * cascade cannot absorb — by running out of money. DeepSeek shed peak load,
 * Infron's aggregator account went dry and leaked its billing error to 1,086
 * users, and CrofAI returned 401 "Not Enough Credits" off its own prepaid
 * balance. Three lanes whose failures are that correlated with a divert storm
 * are, on the worst day, one lane. RunInfra is a fourth independent account
 * and balance behind them; that independence, not its price, is the reason it
 * exists.
 *
 * List prices are on {@link DEEPSEEK_CROF_PROVIDER_ROUTE}. It is dearer than
 * CrofAI on all three terms, so it can never sit above it; it sits above Infron
 * because Infron repriced on 2026-08-16 into the dearest lane we have.
 *
 * VALIDATED ON A REAL AGENT TURN rather than a price table, which is unusual
 * for this file and worth the words. One buffbench task was run end to end
 * through this lane against a local server: 29 model calls, 1,202,712 input
 * tokens (82.3% cached), 25,287 output tokens. Costing that exact token
 * profile against each lane's card:
 *
 *   CrofAI            $0.0338
 *   RunInfra          $0.0444
 *   DeepSeek off-peak $0.0705
 *   Infron            $0.0820
 *   DeepSeek peak     $0.1409
 *
 * So RunInfra ahead of Infron is right by 1.85x on measured traffic, which is
 * what this lane's placement rests on. Note the DeepSeek rows sit BELOW
 * RunInfra on this workload since the 2026-08-16 repricing — that is a question
 * about the entry lane, not about this one, and it belongs to
 * docs/freebuff-deepseek-provider-cutover.md rather than here.
 *
 * The cache has a COLD START. Over that turn it served 82.3% of input tokens
 * from cache, but the aggregate hides the shape: the first few calls missed
 * outright despite sharing a large prefix, then it held at 98-99% for the
 * remaining ~25 calls. A synthetic probe showed the same thing (three misses,
 * then 99.1% hits), with ~600ms latency on a hit against ~1,500ms on a miss.
 * `prompt_cache_key` did not pin routing. The practical consequence is that a
 * long session gets the list rate and a very short one pays closer to fresh
 * input — acceptable for a lane only sustained failure reaches.
 *
 * Two further constraints, both measured rather than published: its hard output
 * ceiling is 32,768 tokens (see RUNINFRA_DEEPSEEK_V4_FLASH_MAX_TOKENS — below
 * the 48,000 budget the product considers safe, so expect more empty
 * length-capped answers here), and it returns no `cost`, so its price table
 * bills every request rather than catching a rare gap.
 *
 * What makes it a better tier-3 than the OpenRouter lane it replaced in the
 * cascade: that lane priced cache reads at $0.0176/M and was reached 1,205
 * times in 24h, which is how DeepSeek's daily bill went from $9k to $39.7k.
 * RunInfra is 1.76x under it on exactly that term. Depth still costs something
 * — 3.3x CrofAI's cache read — which is why it leaves NO RESUMABLE PIN (see
 * `asDeepSeekLane`): a session that touches it starts its next turn from the
 * primary again rather than settling here for the rest of its hour.
 *
 * Like its peers the id names the LANE, not the upstream, and it is persisted
 * in `free_session.provider_route` and read back unvalidated — so renaming the
 * value would need a migration, while repointing what serves it would not.
 */
export const DEEPSEEK_RUNINFRA_PROVIDER_ROUTE =
  'deepseek/runinfra' satisfies ProviderRouteId
/**
 * RETIRED as a DeepSeek lane on 2026-08-11. Kept as a recognized id because it
 * is persisted in `free_session.provider_route` and read back unvalidated —
 * sessions still carrying the pin must not crash; they simply start from the
 * primary again, which is the right answer for a lane that no longer exists.
 *
 * Why it went: it prices cache reads at $0.0176/M against CrofAI's $0.0030,
 * and an agent turn re-sends its whole prefix every step, so ~98% of the
 * tokens land on exactly that term. Being "last resort" did not bound the
 * damage — the pin only moved forward, so one transient 429 on the lane above
 * parked a session here for the rest of its hour. It was reached 1,205 times
 * in 24h, more often than the lane ahead of it, and DeepSeek's daily bill went
 * from $9k to $39.7k over four days while volume rose only 41%. Depth that
 * costs 5.9x on the dominant token class is not depth.
 *
 * The replacement for that depth is retries: the two cheap lanes are attempted
 * three times each before anything diverts.
 *
 * (Historical, for the MiMo lane which still uses OpenRouter:)
 * DeepSeek V4 Flash's LAST resort: the OpenRouter lane, tier 4 of four.
 *
 * Reached when DeepSeek direct and then {@link
 * DEEPSEEK_INFRON_MAKORA_PROVIDER_ROUTE} have both failed retryably. Dearer per
 * token than Infron but backed by many independent upstreams and a balance that
 * is not one account's, which is exactly what a divert storm needs — see the
 * Infron route's doc for why the cheap lane cannot be the last one.
 *
 * Like its MiMo peer it names the LANE, not the upstream — that is {@link
 * DEEPSEEK_OPENROUTER_UPSTREAM_ORDER} below, so repointing the order also moves
 * every session already pinned here, with no migration.
 */
export const DEEPSEEK_OPENROUTER_PROVIDER_ROUTE =
  'deepseek/openrouter' satisfies ProviderRouteId
/**
 * The upstreams that serve {@link DEEPSEEK_OPENROUTER_PROVIDER_ROUTE},
 * preferred first.
 *
 * Chosen as *cheapest that still preserves the prompt cache*, which for an
 * agent workload are not the same axis. Cache-read price is what actually
 * drives this bill — a coding turn re-sends a long prefix every step, so most
 * input tokens are cache reads — and the OpenRouter catalog splits cleanly on
 * it (checked live 2026-08-04, per M):
 *
 *   streamlake/fp8   $0.0881 in  $0.0176 cache  $0.1761 out  fp8   384k max out
 *   baidu/fp8        $0.0882 in  $0.0176 cache  $0.1764 out  fp8   131k max out
 *   gmicloud/fp8     $0.0938 in  $0.0188 cache  $0.1876 out  fp8   no stated cap
 *   ── everything below is >=1.5x the cache-read price ──
 *   most of the tail  $0.14   in  $0.0280 cache  $0.2800 out
 *   parasail/coreweave/phala     $0.0700 cache  (4x)
 *   morph, mancer/fp4            NO cache read at all
 *
 * So the three cheapest on input are also the three cheapest on cache read;
 * there is no tradeoff to make here, which is why the list is short.
 *
 * DELIBERATELY NOT `deepseek` (OpenRouter's DeepSeek-first-party endpoint).
 * It had by far the best cache read of any entry here, and was tempting for
 * that alone, but it is the same upstream whose failure triggers this fallback,
 * reached through a middleman — pointing the lane there would divert an outage
 * onto itself. The Infron lane can use the 0731 model without this problem
 * because it pins independent Alibaba upstreams. (The price argument has since
 * evaporated anyway: DeepSeek's 2026-08-16 repricing put first-party cache
 * reads at $0.0070/M off-peak and $0.0140/M at peak, at or above the tail
 * quoted above. The routing reason is the one that still stands.)
 *
 * `deepinfra/fp4` is skipped despite sitting third on price: fp4 quantization,
 * and a 65,536-token output cap that would truncate long agent turns. fp8 is
 * the floor for this lane.
 *
 * THREE ENTRIES, and it must never go to one — see the identical warning on
 * {@link mimoOpenRouterProvider}. A pinned session has no health check and no
 * un-pin path, so a one-deep lane turns a single upstream blip into a wedged
 * session. That is not hypothetical here: this model's previous fallback was
 * pinned one-deep to `makora` and took out 1,160 requests across 191 users for
 * ~32h when it went offline (2026-07-26/27, #1045).
 *
 * Caveat on the third entry: `gmicloud/fp8` does not list `stop` in its
 * supported parameters. Without `require_parameters` OpenRouter drops the
 * unsupported field rather than refusing to route, so a turn served there does
 * not honor the global stop sequence. Accepted for depth — it only serves when
 * both fp8 upstreams above it are unavailable — but do not promote it.
 */
export const DEEPSEEK_OPENROUTER_UPSTREAM_ORDER = [
  'streamlake/fp8',
  'baidu/fp8',
  'gmicloud/fp8',
] as const

/**
 * The OpenRouter output cap this lane requests.
 *
 * Matches `streamlake/fp8`'s 384,000-token ceiling — the first upstream in the
 * order — so a caller's explicit budget can never make the preferred endpoint
 * ineligible. Slightly under DeepSeek direct's 393,216, same as the Infron lane
 * this replaces: keep fallback requests inside the contract of the route that
 * will actually serve them.
 */
export const DEEPSEEK_OPENROUTER_MAX_TOKENS = 384_000

/**
 * Fresh OpenRouter `provider` block for the DeepSeek V4 Flash lane.
 *
 * Returns a NEW object with a NEW array every call — these arrays get aliased
 * into an outgoing request body, and one downstream mutation would corrupt
 * routing process-wide (the bug `INFRON_PROVIDER_ORDER` was made
 * copy-on-assignment for in #1045).
 *
 * `allow_fallbacks: false` is what preserves the prompt cache: it holds the
 * session to this order instead of letting OpenRouter spread turns across
 * twenty endpoints that each keep their own cache. Cache fragmentation is the
 * expensive failure mode, not a slightly dearer per-token rate — measured on
 * the MiMo lane, a scattered fallback averaged 27.6k cache_read against ~150k
 * prompts, paying a full cold prefill per divert.
 */
export function deepseekOpenRouterProvider(): Record<string, unknown> {
  return {
    order: [...DEEPSEEK_OPENROUTER_UPSTREAM_ORDER],
    allow_fallbacks: false,
  }
}
