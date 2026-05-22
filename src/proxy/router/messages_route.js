'use strict';

// /v1/messages handler for Phase C. Three pipeline stages wrap _proxyAnthropic:
//   1. extract stateless features  (router/features.js)
//   2. pickForTurn → tier → concrete model (router/model_router.js + DEFAULT_TIER_MODELS)
//   3. rewriteModel preserving cache_control breakpoints (router/cache_passthrough.js)
//
// Each stage has its own fallback so a single bad input never breaks the
// passthrough: classifier throw → forward unmodified; rewriter throw →
// forward unmodified; upstream 5xx on a router-rewritten request → one
// retry with the client's original model (a one-hub/prism-style gateway
// may return 503 "no channel" for a tier-target model the upstream isn't
// configured for; falling back to the original model is more useful than
// a hard 503). All other non-2xx is relayed verbatim — we don't fabricate
// SSE error frames. Telemetry-style log lines record which fallback fired
// so the realized-vs-projected delta is measurable post-merge.

const { pickForTurn } = require('./model_router');
const { rewriteModel } = require('./cache_passthrough');
const { extractFeatures } = require('./features');

const DEFAULT_TIER_MODELS = Object.freeze({
  cheap: 'claude-haiku-4-5',
  mid: 'claude-sonnet-4-6',
  expensive: 'claude-opus-4-7',
});

function resolveTierModels() {
  return {
    cheap: process.env.EVOMAP_MODEL_CHEAP || DEFAULT_TIER_MODELS.cheap,
    mid: process.env.EVOMAP_MODEL_MID || DEFAULT_TIER_MODELS.mid,
    expensive: process.env.EVOMAP_MODEL_EXPENSIVE || DEFAULT_TIER_MODELS.expensive,
  };
}

function buildMessagesHandler({ anthropicProxy, logger, routerEnabled } = {}) {
  if (typeof anthropicProxy !== 'function') {
    throw new Error('buildMessagesHandler requires anthropicProxy(path, body, opts)');
  }
  const log = logger || console;
  // Phase C slice 6: flag is read at handler construction (proxy start), not
  // per-request — flipping the env var requires a proxy restart, fine for an
  // MVP feature flag. Explicit boolean override wins so tests stay hermetic.
  const enabled = typeof routerEnabled === 'boolean'
    ? routerEnabled
    : process.env.EVOMAP_ROUTER_ENABLED === '1';

  return async ({ body, headers }) => {
    const inboundHeaders = headers || {};
    // x-api-key is satisfied by either the inbound header OR a proxy-side
    // ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN env (token mediation, see
    // _proxyAnthropic). The proxy server itself has already auth-checked
    // `Authorization: Bearer <proxy_token>` before reaching this handler.
    const hasInboundKey = !!inboundHeaders['x-api-key'];
    const hasProxyEnvCreds = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    if (!hasInboundKey && !hasProxyEnvCreds) {
      throw Object.assign(new Error('x-api-key required'), { statusCode: 401 });
    }

    const originalModel = body && typeof body.model === 'string' ? body.model : null;
    let chosenModel = originalModel;
    let decisionTier = null;
    let decisionReason = null;
    let fallback = null;

    if (enabled) {
      try {
        const features = extractFeatures(body);
        const decision = pickForTurn({
          features,
          router_state: { history: [], pinned: null },
          config: { default_tier: 'mid', disable: false, hard_pin_after_plan: false },
        });
        decisionTier = decision.tier;
        decisionReason = decision.reason;
        const tierModel = resolveTierModels()[decision.tier];
        if (tierModel) chosenModel = tierModel;
      } catch (err) {
        fallback = 'classifier_error';
        log.warn?.(JSON.stringify({
          event: 'router_fallback',
          reason: 'classifier_error',
          original_model: originalModel,
          would_have_been: null,
          error: err.message,
        }));
      }

    }

    let outboundBody = body;
    if (enabled && chosenModel && chosenModel !== originalModel) {
      try {
        outboundBody = rewriteModel(body, chosenModel);
      } catch (err) {
        fallback = fallback || 'rewrite_error';
        log.warn?.(JSON.stringify({
          event: 'router_fallback',
          reason: 'rewrite_error',
          original_model: originalModel,
          would_have_been: chosenModel,
          error: err.message,
        }));
        outboundBody = body;
        chosenModel = originalModel;
      }
    }

    if (enabled) {
      log.log?.(JSON.stringify({
        event: 'router_decision',
        tier: decisionTier,
        reason: decisionReason,
        original_model: originalModel,
        chosen_model: chosenModel,
        escalation_skipped: false,
        fallback,
      }));
    }

    const upstream = await anthropicProxy('/v1/messages', outboundBody, {
      inboundHeaders,
    });

    if (upstream.stream) {
      const forwardHeaders = {};
      const ct = upstream.headers && upstream.headers['content-type'];
      if (ct) forwardHeaders['Content-Type'] = ct;
      return {
        status: upstream.status,
        stream: upstream.stream,
        headers: forwardHeaders,
      };
    }

    // First upstream returned non-stream. If it's a 5xx on a router-rewritten
    // request, retry once with the client's original model. This covers the
    // common one-hub/prism case where the chosen tier model has no channel
    // configured — a hard 503 is worse for the caller than a slightly more
    // expensive successful response. The retry may come back streaming when
    // the client originally sent stream:true (the first attempt errored out
    // as JSON before any SSE flowed, so streaming the second attempt is
    // still safe). The result-shape branch below handles both cases.
    let finalUpstream = upstream;
    if (
      enabled
      && upstream.status >= 500
      && chosenModel
      && chosenModel !== originalModel
    ) {
      log.warn?.(JSON.stringify({
        event: 'router_fallback',
        reason: 'upstream_5xx_retry',
        original_model: originalModel,
        would_have_been: chosenModel,
        upstream_status: upstream.status,
      }));
      // Drain the first upstream's body before retrying. fetch Response
      // bodies are single-read streams; if the retry succeeds, finalUpstream
      // moves to the retry response and the original `upstream` body is
      // never consumed, so undici keeps the underlying TCP socket pinned
      // in the awaiting-body state. Under sustained 5xx storms from the
      // rewritten model (the exact scenario this branch targets), every
      // successful retry leaks one socket out of the pool.
      //
      // We don't need the parsed body — text() reads the full body before
      // returning, which is enough to release the socket. If the retry
      // throws, finalUpstream stays pointing at the (now-drained) upstream
      // and the .text() at line 195 short-circuits on the empty Response
      // — but that loses the original 503 body, so cache it here too and
      // restore it on the throw path.
      let drainedFirst = '';
      if (upstream.text) {
        try { drainedFirst = await upstream.text(); } catch { /* socket already gone */ }
      }
      try {
        const retryBody = rewriteModel(body, originalModel);
        finalUpstream = await anthropicProxy('/v1/messages', retryBody, {
          inboundHeaders,
        });
      } catch (err) {
        // Replay the drained first response so the caller still sees the
        // original 503 + body, not an empty stream.
        finalUpstream = {
          status: upstream.status,
          headers: upstream.headers,
          stream: null,
          text: () => drainedFirst,
        };
        log.warn?.(JSON.stringify({
          event: 'router_fallback',
          reason: 'upstream_5xx_retry_failed',
          original_model: originalModel,
          would_have_been: chosenModel,
          error: err.message,
        }));
      }
    }

    if (finalUpstream.stream) {
      const forwardHeaders = {};
      const ct = finalUpstream.headers && finalUpstream.headers['content-type'];
      if (ct) forwardHeaders['Content-Type'] = ct;
      return {
        status: finalUpstream.status,
        stream: finalUpstream.stream,
        headers: forwardHeaders,
      };
    }
    // Upstream is normally JSON, but a misconfigured local gateway (prism
    // without a route configured), a CDN 4xx page, or a load balancer 502
    // can return text/plain or HTML. Read the body as text (single
    // consumption — fetch Response bodies cannot be read twice) and parse
    // ourselves; on parse failure, wrap the raw text in an {error} envelope
    // so the client gets the real upstream status + a readable body
    // instead of a 500 "Unexpected non-whitespace character".
    // Default to {} not null: src/proxy/server/http.js wraps results as
    // `result.body || result`, and a falsy body would serialize the entire
    // internal {status, body} envelope to the client.
    let respBody = {};
    let raw = '';
    if (finalUpstream.text) {
      try { raw = await finalUpstream.text(); } catch { /* ignore */ }
    }
    if (raw.length > 0) {
      try {
        respBody = JSON.parse(raw);
      } catch {
        respBody = { error: raw };
        log.warn?.(JSON.stringify({
          event: 'router_fallback',
          reason: 'upstream_non_json',
          upstream_status: finalUpstream.status,
          preview: raw.slice(0, 200),
        }));
      }
    }
    return { status: finalUpstream.status, body: respBody };
  };
}

module.exports = { buildMessagesHandler, DEFAULT_TIER_MODELS, resolveTierModels };
