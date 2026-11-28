# @feraterra/plugin-elizaos (`v1.0.2`)

Zero-runtime-dependency TypeScript / ESM **ElizaOS** plugin for [**FeraTerra**](https://feraterra.app) — sovereign central limit order book (CLOB) perpetuals, spot, basis spreads, **anonymous zero-key pre-trade order simulation (`account_id: 0`)**, **headless protocol terms discovery (`GET /terms`)**, leaderboard rankings, and cryptographic solvency verification on Base (`https://testnet.feraterra.app`).

- **Zero npm bloat:** Uses Node.js built-in `fetch` and `node:crypto` with `0` runtime dependencies.
- **Full TypeScript & ESM support:** Ships `src/index.mjs`, `src/index.d.ts`, and `src/index.ts`.
- **Anonymous zero-key pre-trade safety (`account_id: 0`):** Dry-run order fills, slippage, segmented maker/taker fees, and initial margin (`required_imr_usd`) via `POST /order/preview` with **zero wallet keys, zero API credentials, and zero state mutation** (or pass `accountId >= 1` for live cross-margin portfolio simulation).
- **Headless terms & EIP-191 discovery (`GET /terms`):** Inspect machine-readable protocol terms (`https://feraterra.app/terms`, `headless_protocol: true`, `non_custodial: true`, `benchmark_only: true`, `monetary_prizes: false`) referenced by EIP-191 session wallet login (`Terms: https://feraterra.app/terms`).
- **Cryptographic solvency audit:** Verifies `ARENA_LEDGER_TIP_V2_1` rolling `Keccak-256` state roots and `secp256k1` operator signatures (`ecrecover`) completely client-side.

---

## Installation

```bash
npm install @feraterra/plugin-elizaos
# or directly from GitHub:
npm install github:FeraTerra/elizaos-plugin-feraterra
```

Or clone directly:

```bash
git clone https://github.com/FeraTerra/elizaos-plugin-feraterra.git
cd elizaos-plugin-feraterra
node --test test/plugin.test.mjs
```

---

## ElizaOS Integration

Register `feraterraPlugin` in your ElizaOS agent character or runtime configuration (works out of the box with **zero secrets** for market data, `GET /terms`, `GET /leaderboard`, solvency proofs, and `account_id: 0` order previews):

```ts
import { feraterraPlugin } from "@feraterra/plugin-elizaos";

export const character = {
  name: "FeraTerraQuant",
  plugins: [feraterraPlugin],
  settings: {
    secrets: {
      FERATERRA_API_URL: "https://testnet.feraterra.app",
      // Optional: omit or set "0" for anonymous zero-key POST /order/preview;
      // set >= 1 with FERATERRA_API_KEY/SECRET for account-bound portfolio simulation.
      FERATERRA_ACCOUNT_ID: "0"
    }
  }
};
```

### Environment Variables / Runtime Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `FERATERRA_API_URL` | `https://testnet.feraterra.app` | Base HTTPS URL of the FeraTerra gateway. |
| `FERATERRA_ACCOUNT_ID` | `0` (anonymous zero-key) | Default numeric trader account ID for stateless `POST /order/preview` (`0` = anonymous zero-key simulation without credentials; `>= 1` = account-bound portfolio margin simulation). |
| `FERATERRA_EXPECTED_OPERATOR` | *(optional)* | Optional pinned `0x...` operator Ethereum address for strict `GET /ledger/tip` signer pinning. |
| `FERATERRA_API_KEY` | *(optional)* | Optional HMAC API key for authenticated account-bound requests. |
| `FERATERRA_API_SECRET` | *(optional)* | Optional HMAC API secret for authenticated account-bound requests. |

---

## Exported Actions & Provider

### Actions (`feraterraPlugin.actions`)

| Action Name | Endpoint | Description |
| :--- | :--- | :--- |
| `FERATERRA_LIST_MARKETS` | `GET /markets` | Lists live FeraTerra perpetual, spot, basis spread, and bounded-claim markets with unified symbols, USD mark prices, and best bid/ask quotes. |
| `FERATERRA_GET_ORDERBOOK` | `GET /book` | Fetches live L2/L3 order book depth, top-of-book bid/ask USD prices, and spread by symbol (e.g. `BTC-USD-PERP`, `BTC/USD:USD`) or numeric `marketId`. |
| `FERATERRA_GET_LEADERBOARD` | `GET /leaderboard` | Retrieves the ranked trader leaderboard sorted by `equity`, `pnl`, `streak`, `volume`, or `roi` (`benchmark_only: true`, `monetary_prizes: false`). |
| `FERATERRA_GET_TERMS` | `GET /terms` | Fetches machine-readable FeraTerra protocol terms (`https://feraterra.app/terms`), non-custodial scope, benchmark-only policy, chain ID, and L2 collateral vault address. |
| `FERATERRA_PREVIEW_ORDER` | `POST /order/preview` | Executes a stateless, zero-mutation pre-trade order simulation (`account_id: 0` anonymous zero-key default, or `account_id >= 1` portfolio mode) returning estimated fill size, resting size, slippage, fee/rebate, and margin impact. |
| `FERATERRA_VERIFY_SOLVENCY` | `GET /ledger/tip` + `GET /health` | Audits exchange health conservation invariants and cryptographically verifies the `Keccak-256` + `secp256k1` signed WAL ledger tip (`state_root`, `ledger_chain_hash`, `wal_seq`). |

### Context Provider (`feraterraPlugin.providers`)

- **`feraterraMarketSummaryProvider`** (`FERATERRA_MARKET_SUMMARY`): Injects a concise real-time summary of active FeraTerra markets, mark prices, BBO spreads, and current WAL sequence into the ElizaOS agent prompt state.

---

## Standalone Client Usage

You can also use `FeraTerraClient` directly in any Node.js 20+ or TypeScript script with zero credentials:

```ts
import { FeraTerraClient } from "@feraterra/plugin-elizaos";

const client = new FeraTerraClient({
  baseUrl: process.env.FERATERRA_API_URL ?? "https://testnet.feraterra.app",
});

const terms = await client.getTerms(); // GET /terms -> { terms_url: "https://feraterra.app/terms", ... }
const markets = await client.listMarkets({ activeOnly: true });
const book = await client.getOrderbook({ symbol: "BTC-USD-PERP", depth: 10 });
const preview = await client.previewOrder({
  accountId: 0, // Anonymous zero-key simulation (zero credentials or WAL mutation)
  symbol: "BTC-USD-PERP",
  side: "buy",
  amount: 0.05,
  postOnly: true,
  markPeg: true,
  pegOffsetTicks: -50,
});
const leaderboard = await client.getLeaderboard({ limit: 10, sort: "equity" });
const solvency = await client.verifySolvency();
```

---

## Headless Discovery & Zero-Install MCP Endpoint

In addition to this native ElizaOS plugin, any MCP-compatible agent runtime (ElizaOS MCP client, Claude Desktop, Cursor, Windsurf, or custom orchestrators) can connect directly to the hosted **24-tool Streamable HTTP MCP gateway** with zero local installation:

- **Remote Streamable HTTP MCP URL:** `https://mcp.feraterra.app/mcp`
- **Testnet REST, Terms & OpenAPI Discovery:** `https://testnet.feraterra.app/llms.txt`, `https://testnet.feraterra.app/terms`, and `https://testnet.feraterra.app/openapi.json`
- **EIP-191 Session Wallet Onboarding:** When upgrading from read-only/preview (`account_id: 0`) to live order entry, sign the deterministic `POST /auth/challenge` message ending with `Terms: https://feraterra.app/terms` (`POST /auth/wallet`).

```json
{
  "mcpServers": {
    "feraterra": {
      "type": "streamable-http",
      "url": "https://mcp.feraterra.app/mcp"
    }
  }
}
```

---

## Testing

The test suite uses Node's built-in `node:test` and `node:assert` modules with deterministic `fetch` handlers (zero network flakiness and zero external test packages):

```bash
npm test
# or directly:
node --test test/plugin.test.mjs
```

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 FeraTerra.
