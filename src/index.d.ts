export declare const DEFAULT_FERATERRA_API_URL = "https://testnet.feraterra.app";
export declare const REMOTE_FERATERRA_MCP_URL = "https://mcp.feraterra.app/mcp";
export declare const DEFAULT_FERATERRA_TERMS_URL = "https://feraterra.app/terms";
export declare const PRICE_TICKS_PER_USD = 100;
export declare const LOTS_PER_BASE_UNIT = 10000;
export declare const MICRO_USD_PER_DOLLAR = 1000000;
export declare const MIN_FERATERRA_TIMEOUT_MS = 250;
export declare const MAX_FERATERRA_TIMEOUT_MS = 120000;

export interface ElizaMemoryContent {
  text?: string;
  action?: string;
  [key: string]: unknown;
}

export interface ElizaMemory {
  id?: string;
  userId?: string;
  entityId?: string;
  agentId?: string;
  roomId?: string;
  content: ElizaMemoryContent | string;
  createdAt?: number;
}

export interface ElizaState {
  [key: string]: unknown;
}

export interface ElizaAgentRuntime {
  getSetting?(key: string): string | undefined | null;
  character?: {
    name?: string;
    settings?: {
      secrets?: Record<string, string | undefined>;
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
}

export interface ElizaActionExample {
  name?: string;
  user?: string;
  content: {
    text: string;
    action?: string;
    [key: string]: unknown;
  };
}

export interface ElizaActionResult<TData = Record<string, unknown>> {
  success: boolean;
  text: string;
  data?: TData;
  values?: Record<string, unknown>;
  error?: string;
}

export type ElizaHandlerCallback = (response: {
  text: string;
  action?: string;
  data?: unknown;
  content?: unknown;
}) => Promise<unknown> | unknown;

export interface ElizaAction<TOptions = Record<string, unknown>, TData = Record<string, unknown>> {
  name: string;
  similes: string[];
  description: string;
  examples: ElizaActionExample[][];
  validate: (
    runtime: ElizaAgentRuntime,
    message: ElizaMemory,
    state?: ElizaState
  ) => Promise<boolean>;
  handler: (
    runtime: ElizaAgentRuntime,
    message: ElizaMemory,
    state?: ElizaState,
    options?: TOptions,
    callback?: ElizaHandlerCallback
  ) => Promise<ElizaActionResult<TData>>;
}

export interface ElizaProviderResult<TData = Record<string, unknown>> {
  text: string;
  data: TData;
  values: Record<string, unknown>;
  toString(): string;
}

export interface ElizaProvider<TData = Record<string, unknown>> {
  name: string;
  description: string;
  dynamic?: boolean;
  get: (
    runtime: ElizaAgentRuntime,
    message: ElizaMemory,
    state?: ElizaState
  ) => Promise<ElizaProviderResult<TData>>;
}

export interface ElizaPlugin {
  name: string;
  description: string;
  actions: ElizaAction[];
  providers: ElizaProvider[];
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json?(): Promise<unknown>;
}>;

export interface FeraTerraClientOptions {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  accountId?: number;
  expectedOperatorAddress?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export interface FeraTerraMarket {
  market_id: number;
  symbol: string;
  unified_symbol: string;
  kind: string;
  trading_status: string;
  mark_price_ticks: number;
  best_bid_ticks: number;
  best_ask_ticks: number;
  mark_price_usd: string;
  best_bid_usd: string;
  best_ask_usd: string;
  [key: string]: unknown;
}

export interface ListMarketsParams {
  kind?: string;
  symbol?: string;
  activeOnly?: boolean;
}

export interface ListMarketsResponse {
  ok: boolean;
  wal_seq: number;
  count: number;
  markets: FeraTerraMarket[];
}

export interface OrderbookLevel {
  price_ticks: number;
  price_usd: string;
  qty_lots: number;
  qty_base: string;
  order_count: number;
}

export interface GetOrderbookParams {
  marketId?: number;
  symbol?: string;
  depth?: number;
}

export interface GetOrderbookResponse {
  ok: boolean;
  wal_seq: number;
  market_id: number;
  symbol: string;
  unified_symbol: string;
  depth: number;
  best_bid_usd: string | null;
  best_ask_usd: string | null;
  spread_usd: string | null;
  bids: unknown[];
  asks: unknown[];
  formatted_bids: OrderbookLevel[];
  formatted_asks: OrderbookLevel[];
  [key: string]: unknown;
}

export type LeaderboardSort = "equity" | "pnl" | "streak" | "volume" | "roi" | string;

export interface GetLeaderboardParams {
  limit?: number;
  sort?: LeaderboardSort;
}

export interface LeaderboardEntry {
  rank: number;
  account_id: number;
  equity_usd?: string;
  [key: string]: unknown;
}

export interface GetLeaderboardResponse {
  ok: boolean;
  wal_seq: number;
  sort_by: string;
  entries: LeaderboardEntry[];
  [key: string]: unknown;
}

export interface PreviewOrderParams {
  accountId?: number;
  marketId?: number;
  symbol?: string;
  side?: "buy" | "sell" | "bid" | "ask";
  orderType?: "limit" | "market";
  amount?: number | string;
  qtyLots?: number;
  price?: number | string;
  priceTicks?: number;
  tif?: "gtc" | "ioc" | "fok" | "post_only";
  reduceOnly?: boolean;
  postOnly?: boolean;
  postOnlySlide?: boolean;
  markPeg?: boolean;
  pegOffsetTicks?: number;
  stp?: string;
  priorityFeePpm?: number;
}

export interface PreviewOrderResponse {
  ok: boolean;
  anonymous: boolean;
  account_id: number;
  would_accept: boolean;
  status: string;
  market_id: number;
  symbol: string;
  unified_symbol: string;
  side: "bid" | "ask";
  qty_lots: number;
  qty_base: string;
  effective_price_ticks: number;
  effective_price_usd: string;
  estimated_filled_lots: number;
  estimated_filled_base: string;
  estimated_resting_lots: number;
  estimated_resting_base: string;
  estimated_avg_price_ticks: number;
  estimated_avg_price_usd: string;
  estimated_slippage_bps: number;
  estimated_fee_micro: number;
  estimated_fee_usd: string;
  required_imr_micro: number;
  required_imr_usd: string;
  pre_imr_micro: number;
  pre_imr_usd: string;
  post_imr_micro: number;
  post_imr_usd: string;
  post_free_margin_micro: number;
  post_free_margin_usd: string;
  wal_seq: number;
  [key: string]: unknown;
}

export interface GetTermsParams {
  format?: "json";
}

export interface TermsSection {
  id: string;
  heading: string;
  body: string;
  [key: string]: unknown;
}

export interface GetTermsResponse {
  ok: boolean;
  protocol: string;
  title: string;
  version: string;
  terms_url: string;
  headless_protocol: boolean;
  non_custodial: boolean;
  benchmark_only: boolean;
  monetary_prizes: boolean;
  chain_id: number;
  clearinghouse_address: string;
  sections: TermsSection[];
  [key: string]: unknown;
}

export interface LedgerTipDigestParams {
  walSeq: number | bigint;
  ledgerChainHash: string;
  stateRoot: string;
  chainId?: number | bigint;
  clearinghouseAddress?: string;
}

export interface VerifyLedgerTipOptions {
  expectedOperatorAddress?: string;
  expectedChainId?: number;
  expectedClearinghouseAddress?: string;
  allowSelfAssertedSigner?: boolean;
}

export interface LedgerTipVerification {
  valid: boolean;
  digest_verified: boolean;
  signature_verified: boolean;
  pinned_operator_checked: boolean;
  computed_digest: string | null;
  recovered_operator_address: string | null;
  reason?: string;
}

export interface VerifySolvencyParams {
  expectedOperatorAddress?: string;
  expectedChainId?: number;
  expectedClearinghouseAddress?: string;
  includeHealth?: boolean;
}

export interface VerifySolvencyResponse {
  ok: boolean;
  solvent: boolean;
  signature_verified: boolean;
  digest_verified: boolean;
  conservation_ok: boolean;
  pinned_operator_checked: boolean;
  recovered_operator_address: string | null;
  operator_eth_address: string | null;
  wal_seq: number;
  state_root: string;
  ledger_chain_hash: string;
  tip_digest: string | null;
  chain_id: number;
  clearinghouse_address: string;
  health: Record<string, unknown> | null;
  tip: Record<string, unknown>;
}

export declare function ticksToUsd(ticks: number | bigint): string;
export declare function usdToTicks(usd: number | string): number;
export declare function lotsToBase(lots: number | bigint): string;
export declare function baseToLots(base: number | string): number;
export declare function microToUsd(micro: number | bigint): string;
export declare function usdToMicro(usd: number | string): number;

export declare function keccak256(input: Uint8Array): Uint8Array;
export declare function computeLedgerTipDigest(params: LedgerTipDigestParams): Uint8Array;
export declare function recoverLedgerTipSigner(digestBytes: Uint8Array, signatureHex: string): string;
export declare function verifyLedgerTip(
  tip: Record<string, unknown>,
  options?: VerifyLedgerTipOptions
): LedgerTipVerification;
export declare function parseSymbolFromText(text: string): string | undefined;

export declare class FeraTerraClient {
  readonly baseUrl: string;
  readonly accountId: number;
  readonly expectedOperatorAddress: string;
  readonly timeoutMs: number;

  constructor(options?: FeraTerraClientOptions);
  static fromRuntime(runtime?: ElizaAgentRuntime, overrides?: FeraTerraClientOptions): FeraTerraClient;

  listMarkets(params?: ListMarketsParams): Promise<ListMarketsResponse>;
  getOrderbook(params?: GetOrderbookParams): Promise<GetOrderbookResponse>;
  getLeaderboard(params?: GetLeaderboardParams): Promise<GetLeaderboardResponse>;
  getTerms(params?: GetTermsParams): Promise<GetTermsResponse>;
  previewOrder(params?: PreviewOrderParams): Promise<PreviewOrderResponse>;
  verifySolvency(params?: VerifySolvencyParams): Promise<VerifySolvencyResponse>;
}

export declare const feraterraListMarketsAction: ElizaAction<ListMarketsParams, ListMarketsResponse>;
export declare const feraterraGetOrderbookAction: ElizaAction<GetOrderbookParams, GetOrderbookResponse>;
export declare const feraterraGetLeaderboardAction: ElizaAction<GetLeaderboardParams, GetLeaderboardResponse>;
export declare const feraterraGetTermsAction: ElizaAction<GetTermsParams, GetTermsResponse>;
export declare const feraterraPreviewOrderAction: ElizaAction<PreviewOrderParams, PreviewOrderResponse>;
export declare const feraterraVerifySolvencyAction: ElizaAction<VerifySolvencyParams, VerifySolvencyResponse>;

export declare const feraterraMarketSummaryProvider: ElizaProvider<ListMarketsResponse>;

export declare const feraterraPlugin: ElizaPlugin;
export default feraterraPlugin;
