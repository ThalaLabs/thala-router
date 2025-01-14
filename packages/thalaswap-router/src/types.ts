type Edge = {
  pool: LiquidityPool;
  fromIndex: number;
  toIndex: number;
};

type SwapPath = {
  from: string;
  to: string;
  pool: LiquidityPool;
};

type Route = {
  path: SwapPath[];
  amountIn: number;
  amountOut: number;
  priceImpactPercentage: number;
  type: RouteType;
};

type LiquidityPool = {
  coinAddresses: string[];
  balances: number[];
  poolType: PoolType;
  swapFee: number;
  weights?: number[];
  amp?: number;
  rates: number[];
  type: string;
  isV2: boolean;
};

type Coin = {
  address: string;
  decimals: number;
};

type Pool = {
  asset0: Coin;
  asset1: Coin;
  asset2?: Coin;
  asset3?: Coin;
  asset4?: Coin;
  asset5?: Coin;
  type: string;
  poolType: "Weighted" | "Stable" | "Metastable";
  balance0: number;
  balance1: number;
  balance2?: number;
  balance3?: number;
  balance4?: number;
  balance5?: number;
  weights: number[];
  swapFee: number;
  amp?: number;
  isV2: boolean;
  lptAddress: string;
  rates: number[];
};

type PoolData = {
  pools: Pool[];
  coins: Coin[];
};

type RouteType = "exact_input" | "exact_output";
type PoolType = "Stable" | "Weighted" | "Metastable";
type Graph = Record<string, Edge[]>;
type Distances = Record<string, Record<number, number>>;
type Predecessors = Record<
  string,
  Record<number, { token: string; pool: LiquidityPool } | null>
>;

type AssetIndex =
  | "asset0"
  | "asset1"
  | "asset2"
  | "asset3"
  | "asset4"
  | "asset5";
type BalanceIndex =
  | "balance0"
  | "balance1"
  | "balance2"
  | "balance3"
  | "balance4"
  | "balance5";

export type {
  Edge,
  SwapPath,
  Route,
  LiquidityPool,
  Graph,
  Distances,
  Predecessors,
  PoolType,
  AssetIndex,
  BalanceIndex,
  Coin,
  PoolData,
  Pool,
};

export type LiquidityPoolMetadata = {
  type: string;
  poolType: PoolType;
  numCoins: number;
  coinAddresses: string[];
  weights: number[];
};
