import {
  routingAcceptanceSummary,
  villageRouteCacheStats,
} from "./village-routes.ts";

/**
 * Read-only deployed-head diagnostics for WP-S002-004-008 acceptance.
 * Nothing here influences routing, world generation or simulation decisions.
 */
Object.defineProperty(window, "advisorRoutingAcceptance", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    summary: () => routingAcceptanceSummary(),
    cache: () => villageRouteCacheStats(),
  }),
});
