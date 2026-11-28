import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import defaultPlugin, {
  DEFAULT_FERATERRA_API_URL,
  DEFAULT_FERATERRA_TERMS_URL,
  FeraTerraClient,
  MAX_FERATERRA_TIMEOUT_MS,
  MIN_FERATERRA_TIMEOUT_MS,
  REMOTE_FERATERRA_MCP_URL,
  baseToLots,
  computeLedgerTipDigest,
  feraterraGetLeaderboardAction,
  feraterraGetOrderbookAction,
  feraterraGetTermsAction,
  feraterraListMarketsAction,
  feraterraMarketSummaryProvider,
  feraterraPlugin,
  feraterraPreviewOrderAction,
  feraterraVerifySolvencyAction,
  keccak256,
  lotsToBase,
  microToUsd,
  parseSymbolFromText,
  recoverLedgerTipSigner,
  ticksToUsd,
  usdToMicro,
  usdToTicks,
  verifyLedgerTip,
} from "../src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const VALID_OPERATOR_ADDRESS = "0x1563915e194D8CfBA1943570603F7606A3115508";
const VALID_CLEARINGHOUSE = "0x1111111111111111111111111111111111111111";
const VALID_CHAIN_HASH = `0x${"aa".repeat(32)}`;
const VALID_STATE_ROOT = `0x${"bb".repeat(32)}`;
const VALID_TIP_DIGEST = "0xec757ea855551c62ed323c60ff67aa688ca79b4aaa98145bebb05ca954ba15b7";
const VALID_TIP_SIGNATURE =
  "0x02ee8a47063e396fcbcdbe42cb706a07fa5ca7264ca92545040de0e95f050d4a5f6775f16ea824807ba79982d63ccb901830a8b467359797d6c6690116d294ee1c";

function createMockFetch(overrides = {}) {
  const calls = [];

  const mockFetch = async (input, init = {}) => {
    const urlStr = String(input);
    const parsedUrl = new URL(urlStr);
    const method = String(init.method || "GET").toUpperCase();
    const bodyObj = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      url: urlStr,
      origin: parsedUrl.origin,
      pathname: parsedUrl.pathname,
      searchParams: Object.fromEntries(parsedUrl.searchParams.entries()),
      method,
      redirect: init.redirect,
      headers: init.headers || {},
      body: bodyObj,
    });

    const routeKey = `${method} ${parsedUrl.pathname}`;
    if (typeof overrides[routeKey] === "function") {
      const custom = await overrides[routeKey]({ parsedUrl, method, body: bodyObj, init });
      return {
        ok: custom.status === undefined || (custom.status >= 200 && custom.status < 300),
        status: custom.status ?? 200,
        async text() {
          return JSON.stringify(custom.json);
        },
      };
    }

    if (routeKey === "GET /markets") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            wal_seq: 42,
            markets: [
              {
                market_id: 1,
                symbol: "BTC-USD-PERP",
                kind: "linear_perpetual",
                trading_status: "live",
                mark_price_ticks: 7_000_000,
                best_bid_ticks: 6_999_500,
                best_ask_ticks: 7_000_500,
              },
              {
                market_id: 2,
                symbol: "ETH-USD-SPOT",
                kind: "spot",
                trading_status: "live",
                mark_price_ticks: 350_000,
                best_bid_ticks: 349_950,
                best_ask_ticks: 350_050,
              },
              {
                market_id: 99,
                symbol: "OLD-USD-PERP",
                kind: "linear_perpetual",
                trading_status: "halted",
                mark_price_ticks: 10_000,
                best_bid_ticks: 0,
                best_ask_ticks: 0,
              },
            ],
          });
        },
      };
    }

    if (routeKey === "GET /book") {
      const mid = Number(parsedUrl.searchParams.get("market_id") || "1");
      const depth = Number(parsedUrl.searchParams.get("depth") || "20");
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            wal_seq: 42,
            market_id: mid,
            symbol: mid === 2 ? "ETH-USD-SPOT" : "BTC-USD-PERP",
            depth,
            bids: [
              [6_999_500, 15_000, 2],
              [6_999_000, 25_000, 3],
            ],
            asks: [
              [7_000_500, 12_500, 1],
              [7_001_000, 30_000, 4],
            ],
          });
        },
      };
    }

    if (routeKey === "GET /leaderboard") {
      const sort = parsedUrl.searchParams.get("sort") || "equity";
      const limit = Number(parsedUrl.searchParams.get("limit") || "25");
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            wal_seq: 42,
            sort_by: sort,
            entries: [
              { rank: 1, account_id: 77, equity_usd: "12500.00", pnl_usd: "2500.00" },
              { rank: 2, account_id: 88, equity_usd: "10420.50", pnl_usd: "420.50" },
            ].slice(0, limit),
          });
        },
      };
    }

    if (routeKey === "GET /terms") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            protocol: "FeraTerra",
            title: "FeraTerra Protocol Terms of Use",
            version: "1.0",
            terms_url: DEFAULT_FERATERRA_TERMS_URL,
            headless_protocol: true,
            non_custodial: true,
            benchmark_only: true,
            monetary_prizes: false,
            chain_id: 84532,
            clearinghouse_address: VALID_CLEARINGHOUSE,
            sections: [
              {
                id: "scope",
                heading: "Headless Non-Custodial Protocol Scope",
                body: "FeraTerra operates strictly as a headless, machine-readable execution protocol.",
              },
            ],
          });
        },
      };
    }

    if (routeKey === "POST /order/preview") {
      const isAnon = Number(bodyObj.account_id ?? 0) === 0;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            preview: true,
            stateless: true,
            anonymous: isAnon,
            account_id: Number(bodyObj.account_id ?? 0),
            would_accept: true,
            status: "Ok",
            effective_price_ticks: bodyObj.price_ticks,
            estimated_filled_lots: 0,
            estimated_resting_lots: bodyObj.qty_lots,
            estimated_avg_price_ticks: 0,
            estimated_slippage_bps: 0,
            estimated_fee_micro: 0,
            required_imr_micro: 35_000_000,
            pre_imr_micro: 0,
            post_imr_micro: isAnon ? 0 : 35_000_000,
            post_free_margin_micro: isAnon ? 0 : 965_000_000,
            wal_seq: 42,
          });
        },
      };
    }

    if (routeKey === "GET /ledger/tip") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            tip_domain: "ARENA_LEDGER_TIP_V2_1",
            chain_id: 84532,
            clearinghouse_address: VALID_CLEARINGHOUSE,
            wal_seq: 42,
            ledger_chain_hash: VALID_CHAIN_HASH,
            state_root: VALID_STATE_ROOT,
            tip_digest: VALID_TIP_DIGEST,
            operator_eth_address: VALID_OPERATOR_ADDRESS,
            operator_signature: VALID_TIP_SIGNATURE,
          });
        },
      };
    }

    if (routeKey === "GET /health") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            status: "healthy",
            wal_seq: 42,
            conservation_ok: true,
            double_entry_ok: true,
          });
        },
      };
    }

    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ ok: false, error: `unhandled_route:${routeKey}` });
      },
    };
  };

  return { mockFetch, calls };
}

describe("@feraterra/plugin-elizaos", () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = {};

  beforeEach(() => {
    for (const k of [
      "FERATERRA_API_URL",
      "FERATERRA_API_KEY",
      "FERATERRA_API_SECRET",
      "FERATERRA_ACCOUNT_ID",
      "FERATERRA_EXPECTED_OPERATOR",
    ]) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("exports plugin metadata, zero runtime dependencies, and matching TS declarations", () => {
    assert.equal(feraterraPlugin.name, "@feraterra/plugin-elizaos");
    assert.equal(defaultPlugin, feraterraPlugin);
    assert.ok(feraterraPlugin.description.length > 20);
    assert.equal(DEFAULT_FERATERRA_API_URL, "https://testnet.feraterra.app");
    assert.equal(REMOTE_FERATERRA_MCP_URL, "https://mcp.feraterra.app/mcp");
    assert.equal(DEFAULT_FERATERRA_TERMS_URL, "https://feraterra.app/terms");

    const actionNames = feraterraPlugin.actions.map((a) => a.name);
    assert.deepEqual(actionNames, [
      "FERATERRA_LIST_MARKETS",
      "FERATERRA_GET_ORDERBOOK",
      "FERATERRA_GET_LEADERBOARD",
      "FERATERRA_GET_TERMS",
      "FERATERRA_PREVIEW_ORDER",
      "FERATERRA_VERIFY_SOLVENCY",
    ]);
    assert.equal(feraterraPlugin.providers.length, 1);
    assert.equal(feraterraPlugin.providers[0], feraterraMarketSummaryProvider);

    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.name, "@feraterra/plugin-elizaos");
    assert.equal(pkg.version, "1.0.2");
    assert.equal(pkg.license, "MIT");
    assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
    assert.deepEqual(pkg.keywords, [
      "elizaos",
      "elizaos-plugin",
      "mcp",
      "defi",
      "perpetuals",
      "clob",
      "base",
      "feraterra",
    ]);

    const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
    assert.ok(readme.includes("(`v1.0.2`)"));
    assert.ok(readme.includes("L2 collateral vault address"));
    assert.ok(!readme.toLowerCase().includes("smart contract"));

    const dts = fs.readFileSync(path.join(REPO_ROOT, "src", "index.d.ts"), "utf8");
    const tsSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "index.ts"), "utf8");
    for (const sym of [
      "DEFAULT_FERATERRA_TERMS_URL",
      "MIN_FERATERRA_TIMEOUT_MS",
      "MAX_FERATERRA_TIMEOUT_MS",
      "parseSymbolFromText",
      "feraterraPlugin",
      "feraterraListMarketsAction",
      "feraterraGetOrderbookAction",
      "feraterraGetLeaderboardAction",
      "feraterraGetTermsAction",
      "feraterraPreviewOrderAction",
      "feraterraVerifySolvencyAction",
      "feraterraMarketSummaryProvider",
      "FeraTerraClient",
      "getTerms",
    ]) {
      assert.ok(dts.includes(sym), `src/index.d.ts missing ${sym}`);
      assert.ok(tsSrc.includes(sym), `src/index.ts missing ${sym}`);
    }
  });

  it("handles fixed-point conversions and Ethereum Keccak-256 vectors accurately", () => {
    assert.equal(ticksToUsd(7_000_000), "70000.00");
    assert.equal(usdToTicks("70000.25"), 7_000_025);
    assert.equal(lotsToBase(12_500), "1.2500");
    assert.equal(baseToLots("0.1"), 1_000);
    assert.equal(microToUsd(35_000_000), "35.000000");
    assert.equal(usdToMicro("12.5"), 12_500_000);

    const emptyHash = Buffer.from(keccak256(new Uint8Array(0))).toString("hex");
    assert.equal(
      emptyHash,
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
  });

  it("resolves FERATERRA_API_URL from default, process.env, and runtime.getSetting", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    await feraterraListMarketsAction.handler({}, { content: { text: "list markets" } });
    assert.equal(calls[0].origin, "https://testnet.feraterra.app");

    process.env.FERATERRA_API_URL = "https://env-node.feraterra.app/";
    await feraterraListMarketsAction.handler({}, { content: { text: "list markets" } });
    assert.equal(calls[1].origin, "https://env-node.feraterra.app");

    const mockRuntime = {
      getSetting(key) {
        return key === "FERATERRA_API_URL" ? "https://runtime-node.feraterra.app/" : undefined;
      },
    };
    await feraterraListMarketsAction.handler(mockRuntime, { content: { text: "list markets" } });
    assert.equal(calls[2].origin, "https://runtime-node.feraterra.app");
  });

  it("executes FERATERRA_LIST_MARKETS action and filters halted/kind markets", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    let cbPayload = null;
    const valid = await feraterraListMarketsAction.validate({}, { content: { text: "list" } });
    assert.equal(valid, true);

    const res = await feraterraListMarketsAction.handler(
      {},
      { content: { text: "List active markets on FeraTerra" } },
      {},
      {},
      async (p) => {
        cbPayload = p;
      }
    );

    assert.equal(res.success, true);
    assert.equal(res.data.count, 2);
    assert.equal(res.data.markets[0].unified_symbol, "BTC/USD:USD");
    assert.equal(res.data.markets[0].mark_price_usd, "70000.00");
    assert.equal(res.data.markets[1].unified_symbol, "ETH/USD");
    assert.ok(cbPayload && cbPayload.action === "FERATERRA_LIST_MARKETS");
    assert.equal(calls.length, 1);

    const perpOnly = await feraterraListMarketsAction.handler(
      {},
      { content: { text: "Show perpetual markets" } }
    );
    assert.equal(perpOnly.data.count, 1);
    assert.equal(perpOnly.data.markets[0].symbol, "BTC-USD-PERP");
  });

  it("executes FERATERRA_GET_ORDERBOOK action by symbol and by marketId", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    let cbPayload = null;
    const res = await feraterraGetOrderbookAction.handler(
      {},
      { content: { text: "Show BTC/USD:USD orderbook depth 5" } },
      {},
      {},
      async (p) => {
        cbPayload = p;
      }
    );

    assert.equal(res.success, true);
    assert.equal(res.data.market_id, 1);
    assert.equal(res.data.best_bid_usd, "69995.00");
    assert.equal(res.data.best_ask_usd, "70005.00");
    assert.equal(res.data.spread_usd, "10.00");
    assert.equal(res.data.formatted_bids[0].qty_base, "1.5000");
    assert.ok(cbPayload && cbPayload.text.includes("spread $10.00"));
    assert.equal(calls[1].pathname, "/book");
    assert.deepEqual(calls[1].searchParams, { market_id: "1", depth: "5" });

    calls.length = 0;
    const byId = await feraterraGetOrderbookAction.handler(
      {},
      { content: { text: "book" } },
      {},
      { marketId: 2, depth: 10 }
    );
    assert.equal(byId.success, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].searchParams, { market_id: "2", depth: "10" });
  });

  it("executes FERATERRA_GET_LEADERBOARD action with sort and limit parsing", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    let cbPayload = null;
    const res = await feraterraGetLeaderboardAction.handler(
      {},
      { content: { text: "Show top 1 leaderboard by pnl" } },
      {},
      {},
      async (p) => {
        cbPayload = p;
      }
    );

    assert.equal(res.success, true);
    assert.equal(res.data.sort_by, "pnl");
    assert.equal(res.data.entries.length, 1);
    assert.equal(res.data.entries[0].account_id, 77);
    assert.deepEqual(calls[0].searchParams, { limit: "1", sort: "pnl" });
    assert.ok(cbPayload && cbPayload.text.includes("#1 Account 77"));
  });

  it("executes FERATERRA_GET_TERMS action via headless GET /terms without credentials", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    let cbPayload = null;
    const valid = await feraterraGetTermsAction.validate({}, { content: { text: "terms" } });
    assert.equal(valid, true);

    const res = await feraterraGetTermsAction.handler(
      {
        getSetting(key) {
          if (key === "FERATERRA_API_KEY") return "unused_key";
          if (key === "FERATERRA_API_SECRET") return "unused_secret";
          return undefined;
        },
      },
      { content: { text: "Fetch FeraTerra protocol terms" } },
      {},
      {},
      async (p) => {
        cbPayload = p;
      }
    );

    assert.equal(res.success, true);
    assert.equal(res.data.terms_url, "https://feraterra.app/terms");
    assert.equal(res.data.headless_protocol, true);
    assert.equal(res.data.non_custodial, true);
    assert.equal(res.data.benchmark_only, true);
    assert.equal(res.data.monetary_prizes, false);
    assert.equal(res.data.chain_id, 84532);
    assert.equal(res.data.sections.length, 1);
    assert.ok(cbPayload && cbPayload.action === "FERATERRA_GET_TERMS");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, "/terms");
    assert.equal(calls[0].headers["X-Arena-API-Key"], undefined);
  });

  it("executes FERATERRA_PREVIEW_ORDER action for both anonymous zero-key (account_id=0) and account-bound simulations", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    // 1. Default unauthenticated zero-key preview (account_id: 0, zero auth headers)
    let anonCb = null;
    const anonRes = await feraterraPreviewOrderAction.handler(
      {
        getSetting(key) {
          if (key === "FERATERRA_API_KEY") return "should_not_send_on_anon";
          if (key === "FERATERRA_API_SECRET") return "should_not_send_on_anon";
          return undefined;
        },
      },
      {
        content: {
          text: "Preview buying 0.05 BTC-USD-PERP at $69950 post-only mark-peg on FeraTerra",
        },
      },
      {},
      { postOnlySlide: true, pegOffsetTicks: -50 },
      async (p) => {
        anonCb = p;
      }
    );

    assert.equal(anonRes.success, true);
    assert.equal(anonRes.data.anonymous, true);
    assert.equal(anonRes.data.account_id, 0);
    assert.equal(anonRes.data.would_accept, true);
    assert.equal(anonRes.data.qty_lots, 500);
    assert.equal(anonRes.data.required_imr_usd, "35.000000");
    assert.ok(anonCb && anonCb.text.includes("anonymous zero-key account_id=0"));

    const anonPost = calls.find((c) => c.method === "POST" && c.pathname === "/order/preview");
    assert.ok(anonPost);
    assert.equal(anonPost.headers["X-Arena-API-Key"], undefined);
    assert.deepEqual(anonPost.body, {
      account_id: 0,
      market_id: 1,
      side: "bid",
      tif: "post_only",
      stp: "cancel_resting",
      price_ticks: 6_995_000,
      qty_lots: 500,
      reduce_only: false,
      is_market: false,
      post_only_slide: true,
      mark_peg: true,
      peg_offset_ticks: -50,
    });

    calls.length = 0;

    // 2. Account-bound portfolio preview (account_id: 77)
    let cbPayload = null;
    const res = await feraterraPreviewOrderAction.handler(
      {},
      {
        content: {
          text: "Preview buying 0.1 BTC-USD-PERP at $70000 post-only for account 77",
        },
      },
      {},
      {},
      async (p) => {
        cbPayload = p;
      }
    );

    assert.equal(res.success, true);
    assert.equal(res.data.anonymous, false);
    assert.equal(res.data.account_id, 77);
    assert.equal(res.data.would_accept, true);
    assert.equal(res.data.qty_lots, 1_000);
    assert.equal(res.data.effective_price_usd, "70000.00");
    assert.equal(res.data.post_imr_usd, "35.000000");
    assert.equal(res.data.post_free_margin_usd, "965.000000");
    assert.ok(cbPayload && cbPayload.text.includes("ACCEPTED"));

    const postCall = calls.find((c) => c.method === "POST" && c.pathname === "/order/preview");
    assert.ok(postCall);
    assert.deepEqual(postCall.body, {
      account_id: 77,
      market_id: 1,
      side: "bid",
      tif: "post_only",
      stp: "cancel_resting",
      price_ticks: 7_000_000,
      qty_lots: 1_000,
      reduce_only: false,
      is_market: false,
    });

    // 3. Negative accountId rejected cleanly
    const client = new FeraTerraClient({ fetch: mockFetch });
    await assert.rejects(() => client.previewOrder({ accountId: -1, symbol: "BTC-USD-PERP" }), /accountId must be >= 0/);
  });

  it("executes FERATERRA_VERIFY_SOLVENCY action with real Keccak-256 + secp256k1 verification", async () => {
    const digest = computeLedgerTipDigest({
      walSeq: 42,
      ledgerChainHash: VALID_CHAIN_HASH,
      stateRoot: VALID_STATE_ROOT,
      chainId: 84532,
      clearinghouseAddress: VALID_CLEARINGHOUSE,
    });
    assert.equal(`0x${Buffer.from(digest).toString("hex")}`, VALID_TIP_DIGEST);
    assert.equal(recoverLedgerTipSigner(digest, VALID_TIP_SIGNATURE), VALID_OPERATOR_ADDRESS);

    const { mockFetch } = createMockFetch();
    globalThis.fetch = mockFetch;

    let cbPayload = null;
    const res = await feraterraVerifySolvencyAction.handler(
      {},
      {
        content: {
          text: `Verify FeraTerra solvency pinned to ${VALID_OPERATOR_ADDRESS}`,
        },
      },
      {},
      {},
      async (p) => {
        cbPayload = p;
      }
    );

    assert.equal(res.success, true);
    assert.equal(res.data.solvent, true);
    assert.equal(res.data.signature_verified, true);
    assert.equal(res.data.digest_verified, true);
    assert.equal(res.data.conservation_ok, true);
    assert.equal(res.data.pinned_operator_checked, true);
    assert.equal(res.data.recovered_operator_address, VALID_OPERATOR_ADDRESS);
    assert.ok(cbPayload && cbPayload.text.includes("VERIFIED"));

    // Adversarial test 1: mismatched pinned operator address fails closed
    const wrongOp = await feraterraVerifySolvencyAction.handler(
      {},
      { content: { text: "Verify solvency" } },
      {},
      { expectedOperatorAddress: "0x2222222222222222222222222222222222222222" }
    );
    assert.equal(wrongOp.success, false);
    assert.equal(wrongOp.data.solvent, false);
    assert.equal(wrongOp.data.signature_verified, false);

    // Adversarial test 2: tampered state_root fails digest verification
    const tampered = verifyLedgerTip({
      tip_domain: "ARENA_LEDGER_TIP_V2_1",
      chain_id: 84532,
      clearinghouse_address: VALID_CLEARINGHOUSE,
      wal_seq: 42,
      ledger_chain_hash: VALID_CHAIN_HASH,
      state_root: `0x${"cc".repeat(32)}`,
      tip_digest: VALID_TIP_DIGEST,
      operator_eth_address: VALID_OPERATOR_ADDRESS,
      operator_signature: VALID_TIP_SIGNATURE,
    });
    assert.equal(tampered.valid, false);
    assert.equal(tampered.digest_verified, false);
  });

  it("provides live market context via feraterraMarketSummaryProvider and signs HMAC headers when configured", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    const summary = await feraterraMarketSummaryProvider.get(
      {
        getSetting(key) {
          if (key === "FERATERRA_API_KEY") return "test_key_id";
          if (key === "FERATERRA_API_SECRET") return "test_secret_material";
          return undefined;
        },
      },
      { content: { text: "What are the current markets?" } }
    );

    assert.ok(summary.text.includes("BTC-USD-PERP (BTC/USD:USD): mark $70000.00"));
    assert.equal(String(summary), summary.text);
    assert.equal(summary.values.market_count, 2);
    assert.equal(calls[0].headers["X-Arena-API-Key"], "test_key_id");
    assert.ok(calls[0].headers["X-Arena-Signature"]?.length === 64);

    // Verify graceful error reporting when upstream HTTP fails
    const failing = createMockFetch({
      "GET /markets": async () => ({ status: 503, json: { ok: false, error: "maintenance" } }),
    });
    const client = new FeraTerraClient({ fetch: failing.mockFetch });
    await assert.rejects(() => client.listMarkets(), /maintenance/);

    const errAction = await feraterraListMarketsAction.handler(
      {},
      { content: { text: "list" } },
      {},
      { fetch: failing.mockFetch }
    );
    assert.equal(errAction.success, false);
    assert.match(errAction.error, /maintenance/);

    // Verify feraterraMarketSummaryProvider.get() catches upstream errors without crashing runtime
    globalThis.fetch = failing.mockFetch;
    const degradedSummary = await feraterraMarketSummaryProvider.get(
      {},
      { content: { text: "markets?" } }
    );
    assert.equal(degradedSummary.data.ok, false);
    assert.equal(degradedSummary.values.market_count, 0);
    assert.match(degradedSummary.text, /Market summary unavailable:.*maintenance/);
  });

  it("enforces cross-origin credential isolation, strict URL/redirect validation, timeout clamping, stopword filtering, and uncollared markPeg preview", async () => {
    const { mockFetch, calls } = createMockFetch();
    globalThis.fetch = mockFetch;

    // 1. Cross-origin options.baseUrl NEVER inherits runtime or env FERATERRA_API_KEY / FERATERRA_API_SECRET
    process.env.FERATERRA_API_KEY = "env_secret_key";
    process.env.FERATERRA_API_SECRET = "env_secret_hmac";
    const runtimeWithCreds = {
      getSetting(key) {
        if (key === "FERATERRA_API_URL") return "https://testnet.feraterra.app";
        if (key === "FERATERRA_API_KEY") return "rt_secret_key";
        if (key === "FERATERRA_API_SECRET") return "rt_secret_hmac";
        if (key === "FERATERRA_ACCOUNT_ID") return "77";
        return undefined;
      },
    };

    await feraterraListMarketsAction.handler(
      runtimeWithCreds,
      { content: { text: "list" } },
      {},
      { baseUrl: "https://untrusted-mirror.example.com" }
    );
    assert.equal(calls[0].origin, "https://untrusted-mirror.example.com");
    assert.equal(calls[0].redirect, "error");
    assert.equal(calls[0].headers["X-Arena-API-Key"], undefined);
    assert.equal(calls[0].headers["X-Arena-Signature"], undefined);

    // Same-origin options.baseUrl (with trailing slash) still authenticates cleanly
    calls.length = 0;
    await feraterraListMarketsAction.handler(
      runtimeWithCreds,
      { content: { text: "list" } },
      {},
      { baseUrl: "https://testnet.feraterra.app/" }
    );
    assert.equal(calls[0].origin, "https://testnet.feraterra.app");
    assert.equal(calls[0].redirect, "error");
    assert.equal(calls[0].headers["X-Arena-API-Key"], "rt_secret_key");
    assert.equal(calls[0].headers["X-Arena-Signature"]?.length, 64);

    // 2. Strict baseUrl validation: https + loopback http allowed; non-loopback http, userinfo, query, hash rejected
    assert.equal(new FeraTerraClient({ baseUrl: "http://127.0.0.1:8080/", fetch: mockFetch }).baseUrl, "http://127.0.0.1:8080");
    assert.equal(new FeraTerraClient({ baseUrl: "http://localhost:8080", fetch: mockFetch }).baseUrl, "http://localhost:8080");
    assert.equal(new FeraTerraClient({ baseUrl: "http://[::1]:8080", fetch: mockFetch }).baseUrl, "http://[::1]:8080");

    for (const badUrl of [
      "",
      "not-a-url",
      "http://testnet.feraterra.app",
      "ftp://testnet.feraterra.app",
      "https://user:pass@testnet.feraterra.app",
      "https://testnet.feraterra.app?foo=bar",
      "https://testnet.feraterra.app#",
      "https://testnet.feraterra.app#frag",
    ]) {
      assert.throws(() => new FeraTerraClient({ baseUrl: badUrl, fetch: mockFetch }), /baseUrl/);
    }

    // 3. Finite timeoutMs clamping to [250, 120_000]
    assert.equal(MIN_FERATERRA_TIMEOUT_MS, 250);
    assert.equal(MAX_FERATERRA_TIMEOUT_MS, 120_000);
    assert.equal(new FeraTerraClient({ timeoutMs: 10, fetch: mockFetch }).timeoutMs, 250);
    assert.equal(new FeraTerraClient({ timeoutMs: 999_999, fetch: mockFetch }).timeoutMs, 120_000);
    assert.equal(new FeraTerraClient({ timeoutMs: Number.NaN, fetch: mockFetch }).timeoutMs, 10_000);
    assert.equal(new FeraTerraClient({ timeoutMs: Number.POSITIVE_INFINITY, fetch: mockFetch }).timeoutMs, 10_000);

    // 4. Modifier stopword filtering in parseSymbolFromText
    assert.equal(parseSymbolFromText("Preview post-only mark-peg reduce-only buy 0.05 ETH-USD-SPOT"), "ETH-USD-SPOT");
    assert.equal(parseSymbolFromText("Preview post-only mark-peg reduce-only buy 0.05 SOL"), "SOL-USD-PERP");
    assert.equal(parseSymbolFromText("post-only mark-peg reduce-only"), undefined);

    // 5. Uncollared markPeg === true allows priceTicks = 0 (while non-markPeg limit still rejects 0)
    calls.length = 0;
    const uncollaredRes = await feraterraPreviewOrderAction.handler(
      {},
      { content: { text: "Preview post-only mark-peg buying 0.05 ETH-USD-SPOT" } },
      {},
      { pegOffsetTicks: -25 }
    );
    assert.equal(uncollaredRes.success, true);
    assert.equal(uncollaredRes.data.symbol, "ETH-USD-SPOT");
    const uncollaredPost = calls.find((c) => c.method === "POST" && c.pathname === "/order/preview");
    assert.ok(uncollaredPost);
    assert.equal(uncollaredPost.body.price_ticks, 0);
    assert.equal(uncollaredPost.body.mark_peg, true);
    assert.equal(uncollaredPost.body.peg_offset_ticks, -25);

    const directClient = new FeraTerraClient({ fetch: mockFetch });
    const zeroTickMp = await directClient.previewOrder({
      marketId: 1,
      side: "buy",
      amount: 0.02,
      priceTicks: 0,
      markPeg: true,
      postOnly: true,
    });
    assert.equal(zeroTickMp.ok, true);
    await assert.rejects(
      () => directClient.previewOrder({ marketId: 1, side: "buy", amount: 0.02, priceTicks: 0 }),
      /positive price or priceTicks/
    );
  });
});
