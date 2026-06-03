'use strict';

const { PROXY_PROTOCOL_VERSION } = require('../mailbox/store');
const { AuthError } = require('../lifecycle/manager');
const { hubFetch } = require('../../gep/hubFetch');

const DEFAULT_POLL_INTERVAL_ACTIVE = 10_000;
const DEFAULT_POLL_INTERVAL_IDLE = 60_000;

class InboundSync {
  constructor({ store, hubUrl, getHeaders, logger }) {
    this.store = store;
    this.hubUrl = hubUrl;
    this.logger = logger || console;
    this.getHeaders = getHeaders;
  }

  async pull(channel = 'evomap-hub', limit = 50) {
    const cursorKey = `${channel}:inbound_cursor`;
    const cursor = this.store.getCursor(cursorKey);

    const endpoint = `${this.hubUrl}/a2a/mailbox/inbound`;

    try {
      const senderId = this.store.getState('node_id');
      const res = await hubFetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ sender_id: senderId, proxy_protocol_version: PROXY_PROTOCOL_VERSION, cursor, limit }),
        signal: AbortSignal.timeout(35_000),
      });

      if (res.status === 403 || res.status === 401) {
        const errText = await res.text().catch(() => 'unknown');
        throw new AuthError(`Hub ${res.status}: ${errText}`, res.status);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown');
        throw new Error(`Hub returned ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const messages = data.messages || [];

      if (messages.length > 0) {
        this.store.writeInboundBatch(
          messages.map(m => ({
            id: m.id,
            type: m.type,
            payload: m.payload,
            channel,
            priority: m.priority || 'normal',
            refId: m.ref_id,
            expiresAt: m.expires_at,
          }))
        );
      }

      if (data.next_cursor) {
        this.store.setCursor(cursorKey, data.next_cursor);
      }

      return { received: messages.length, cursor: data.next_cursor || cursor };
    } catch (err) {
      if (err instanceof AuthError) throw err;
      this.logger.error(`[inbound] pull failed: ${err.message}`);
      return { received: 0, error: err.message };
    }
  }

  async ackDelivered(channel = 'evomap-hub') {
    const delivered = this.store.list({
      type: '%',
      direction: 'inbound',
      status: 'delivered',
      limit: 100,
    }).filter(m => m.channel === channel);

    if (delivered.length === 0) return { acked: 0 };

    const endpoint = `${this.hubUrl}/a2a/mailbox/ack`;

    try {
      const senderId = this.store.getState('node_id');
      // Round-8 (§21.5): drain the response body so the undici long-poll
      // dispatcher pool is not leaked one socket per ack. ackDelivered
      // is called every inbound poll cycle (default 1-10s); the
      // pre-round-8 code captured no reference to res and never called
      // .json()/.text()/body.cancel(), so each ack pinned a socket
      // until GC. After a few minutes of activity the strict-pool was
      // exhausted and proxy-mode heartbeats hung on next acquire --
      // matches the "alive once then dead" user symptom in proxy mode.
      const res = await hubFetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ sender_id: senderId, message_ids: delivered.map(m => m.id) }),
        signal: AbortSignal.timeout(10_000),
      });
      try {
        if (res && res.body && typeof res.body.cancel === 'function') {
          await res.body.cancel().catch(() => {});
        }
      } catch (_) { /* never escape the drain helper */ }
      return { acked: delivered.length };
    } catch (err) {
      this.logger.error(`[inbound] ack failed: ${err.message}`);
      return { acked: 0, error: err.message };
    }
  }
}

module.exports = { InboundSync, DEFAULT_POLL_INTERVAL_ACTIVE, DEFAULT_POLL_INTERVAL_IDLE };
