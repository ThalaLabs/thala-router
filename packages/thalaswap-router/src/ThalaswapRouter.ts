import { findRouteGivenExactInput, findRouteGivenExactOutput } from "./router";
import { PoolDataClient } from "./PoolDataClient";
import {
  Coin,
  Graph,
  Route,
  AssetIndex,
  BalanceIndex,
  LiquidityPool,
  Pool,
} from "./types";
import { EntryPayload, createEntryPayload } from "@thalalabs/surf";
import { STABLE_POOL_SCRIPTS_ABI } from "./abi/stable_pool_scripts";
import { WEIGHTED_POOL_SCRIPTS_ABI } from "./abi/weighted_pool_scripts";
import { MULTIHOP_ROUTER_ABI } from "./abi/multihop_router";
import { Aptos, Network } from "@aptos-labs/ts-sdk";
import { COIN_WRAPPER_ABI } from "./abi/coin_wrapper";

const encodeWeight = (weight: number, resourceAddress: string): string => {
  return `${resourceAddress}::weighted_pool::Weight_${Math.floor(weight * 100).toString()}`;
};

const DEFAULT_MAX_ALLOWED_SWAP_PERCENTAGE = 0.5;

// Encode the pool type arguments for a given pool
// If extendStableArgs is true, then the stable pool type arguments will be extended to 8 arguments (filled with additional 4 nulls)
const encodePoolType = (
  pool: LiquidityPool,
  extendStableArgs: boolean,
  resourceAddress: string,
): string[] => {
  const NULL_TYPE = `${resourceAddress}::base_pool::Null`;
  const NULL_4 = Array(4).fill(NULL_TYPE);

  if (pool.poolType === "Stable") {
    const typeArgs = NULL_4.map((nullType, i) =>
      i < pool.coinAddresses.length ? pool.coinAddresses[i] : nullType,
    );
    return extendStableArgs ? typeArgs.concat(NULL_4) : typeArgs;
  } else {
    const typeArgsForCoins = NULL_4.map((nullType, i) =>
      i < pool.coinAddresses.length ? pool.coinAddresses[i] : nullType,
    );
    const typeArgsForWeights = NULL_4.map((nullType, i) =>
      i < pool.weights!.length
        ? encodeWeight(pool.weights![i], resourceAddress)
        : nullType,
    );
    return typeArgsForCoins.concat(typeArgsForWeights);
  }
};

const calcMinReceivedValue = (
  expectedAmountOut: number,
  slippage: number,
): number => expectedAmountOut * (1.0 - slippage / 100);

const calcMaxSoldValue = (expectedAmountIn: number, slippage: number): number =>
  expectedAmountIn * (1.0 + slippage / 100);

const scaleUp = (amount: number, decimals: number): number => {
  return Math.floor(amount * Math.pow(10, decimals));
};

type Options = {
  maxAllowedSwapPercentage?: number;
  poolFilter?: (pool: Pool) => boolean;
};

class ThalaswapRouter {
  public client: PoolDataClient;
  private graph: Graph | null = null;
  private coins: Coin[] | null = null;
  private resourceAddress?: string;
  private v2ResourceAddress?: string;
  private v2LensAddress?: string;
  private multirouterAddress: string;
  private options: Options;

  constructor({
    network,
    fullnode,
    resourceAddress,
    v2ResourceAddress,
    v2LensAddress,
    multirouterAddress,
    options,
  }: {
    network: Network;
    fullnode: string;
    resourceAddress?: string;
    v2ResourceAddress?: string;
    v2LensAddress?: string;
    multirouterAddress: string;
    options?: Options;
  }) {
    this.resourceAddress = resourceAddress;
    this.v2ResourceAddress = v2ResourceAddress;
    this.v2LensAddress = v2LensAddress;
    this.multirouterAddress = multirouterAddress;
    this.client = new PoolDataClient({
      network,
      fullnode,
      resourceAddress,
      v2ResourceAddress,
      v2LensAddress,
    });
    this.options = options ?? {};
  }

  setPoolDataClient(client: PoolDataClient) {
    this.client = client;
  }

  async refreshData() {
    const poolData = await this.client.getPoolData();
    const pools = poolData.pools;
    this.coins = poolData.coins;
    this.graph = await this.buildGraph(pools);
  }

  async buildGraph(pools: Pool[]): Promise<Graph> {
    const tokens: Set<string> = new Set();
    const graph: Graph = {};

    for (const pool of pools) {
      // Apply pool filter if provided
      if (this.options.poolFilter && !this.options.poolFilter(pool)) {
        continue;
      }

      // Convert pool data to LiquidityPool type
      const assets = ["asset0", "asset1", "asset2", "asset3"]
        .filter((a) => pool[a as AssetIndex])
        .map((a) => pool[a as AssetIndex]!);

      const balances = ["balance0", "balance1", "balance2", "balance3"]
        .filter((b, i) => assets[i])
        .map((b) => pool[b as BalanceIndex] as number);

      const weights = pool.poolType === "Weighted" ? pool.weights! : undefined;

      const amp = pool.poolType === "Stable" ? pool.amp! : undefined;

      const convertedPool: LiquidityPool = {
        coinAddresses: assets.map((a) => a.address),
        balances,
        poolType: pool.poolType,
        swapFee: pool.swapFee,
        weights,
        amp,
        type: pool.type,
        isV2: pool.isV2,
      };

      for (let i = 0; i < assets.length; i++) {
        const token = assets[i].address;
        tokens.add(token);
        for (let j = 0; j < assets.length; j++) {
          if (i !== j) {
            if (!graph[token]) graph[token] = [];

            graph[token].push({
              pool: convertedPool,
              fromIndex: i,
              toIndex: j,
            });
          }
        }
      }
    }

    return graph;
  }

  async getRouteGivenExactInput(
    startToken: string,
    endToken: string,
    amountIn: number,
    maxHops: number = 3,
  ): Promise<Route | null> {
    await this.refreshData();

    if (!this.graph) {
      console.error("Failed to load pools");
      return null;
    }

    return findRouteGivenExactInput(
      this.graph,
      startToken,
      endToken,
      amountIn,
      maxHops,
      this.options.maxAllowedSwapPercentage ??
        DEFAULT_MAX_ALLOWED_SWAP_PERCENTAGE,
    );
  }

  async getRouteGivenExactOutput(
    startToken: string,
    endToken: string,
    amountOut: number,
    maxHops: number = 3,
  ): Promise<Route | null> {
    await this.refreshData();

    if (!this.graph) {
      console.error("Failed to load pools");
      return null;
    }

    return findRouteGivenExactOutput(
      this.graph,
      startToken,
      endToken,
      amountOut,
      maxHops,
      this.options.maxAllowedSwapPercentage ??
        DEFAULT_MAX_ALLOWED_SWAP_PERCENTAGE,
    );
  }

  // balanceCoinIn is the user's balance of input coin. If it's specified, this function will check
  // (1) for exact-in type of swap, throw an error if the user doesn't have enough balance to perform the swap.
  // (2) for exact-out type of swap, the maximum input amount is limited by the user's balance.
  async encodeRoute(
    route: Route,
    slippagePercentage: number,
    balanceCoinIn?: number,
  ): Promise<EntryPayload> {
    if (route.path.length === 0 || route.path.length > 3) {
      throw new Error("Invalid route");
    }

    if (route.path[0].pool.isV2) {
      return this.encodeRouteV2(route, slippagePercentage, balanceCoinIn);
    }

    if (!this.resourceAddress) {
      throw new Error("Resource address is not set");
    }

    const tokenInDecimals = this.coins!.find(
      (coin) => coin.address === route.path[0].from,
    )!.decimals;
    const tokenOutDecimals = this.coins!.find(
      (coin) => coin.address === route.path[route.path.length - 1].to,
    )!.decimals;
    let amountInArg: number;
    let amountOutArg: number;
    if (route.type === "exact_input") {
      if (balanceCoinIn !== undefined && balanceCoinIn < route.amountIn) {
        throw new Error("Insufficient balance");
      }
      amountInArg = scaleUp(route.amountIn, tokenInDecimals);
      amountOutArg = scaleUp(
        calcMinReceivedValue(route.amountOut, slippagePercentage),
        tokenOutDecimals,
      );
    } else {
      const maxSoldValueAfterSlippage = calcMaxSoldValue(
        route.amountIn,
        slippagePercentage,
      );
      amountInArg = scaleUp(
        balanceCoinIn !== undefined
          ? Math.min(balanceCoinIn, maxSoldValueAfterSlippage)
          : maxSoldValueAfterSlippage,
        tokenInDecimals,
      );
      amountOutArg = scaleUp(route.amountOut, tokenOutDecimals);
    }
    if (route.path.length == 1) {
      const path = route.path[0];
      const functionName =
        route.type === "exact_input" ? "swap_exact_in" : "swap_exact_out";
      const abi =
        path.pool.poolType === "Stable"
          ? STABLE_POOL_SCRIPTS_ABI
          : WEIGHTED_POOL_SCRIPTS_ABI;
      const typeArgs = encodePoolType(
        path.pool,
        false,
        this.resourceAddress,
      ).concat([path.from, path.to]);

      return createEntryPayload(abi, {
        function: functionName,
        typeArguments: typeArgs as any,
        functionArguments: [amountInArg, amountOutArg],
        address: this.resourceAddress as `0x${string}`,
      });
    } else if (route.path.length == 2) {
      const path0 = route.path[0];
      const path1 = route.path[1];
      const typeArgs = encodePoolType(path0.pool, true, this.resourceAddress)
        .concat(encodePoolType(path1.pool, true, this.resourceAddress))
        .concat([path0.from, path0.to, path1.to]);
      const functionName =
        route.type === "exact_input" ? "swap_exact_in_2" : "swap_exact_out_2";

      return createEntryPayload(MULTIHOP_ROUTER_ABI, {
        function: functionName,
        typeArguments: typeArgs as any,
        functionArguments: [amountInArg, amountOutArg],
        address: this.multirouterAddress as `0x${string}`,
      });
    } else {
      // route.path.length == 3
      const path0 = route.path[0];
      const path1 = route.path[1];
      const path2 = route.path[2];
      const typeArgs = encodePoolType(path0.pool, true, this.resourceAddress)
        .concat(encodePoolType(path1.pool, true, this.resourceAddress))
        .concat(encodePoolType(path2.pool, true, this.resourceAddress))
        .concat([path0.from, path0.to, path1.to, path2.to]);
      const functionName =
        route.type === "exact_input" ? "swap_exact_in_3" : "swap_exact_out_3";

      return createEntryPayload(MULTIHOP_ROUTER_ABI, {
        function: functionName,
        typeArguments: typeArgs as any,
        functionArguments: [amountInArg, amountOutArg],
        address: this.multirouterAddress as `0x${string}`,
      });
    }
  }

  private async encodeRouteV2(
    route: Route,
    slippagePercentage: number,
    balanceCoinIn?: number,
  ): Promise<EntryPayload> {
    if (route.path.length === 0 || route.path.length > 3) {
      throw new Error("Invalid route");
    }

    if (!this.v2ResourceAddress) {
      throw new Error("V2 resource address is not set");
    }

    const coinType = await getCoinType(
      this.client.client,
      route.path[0].from,
      this.v2ResourceAddress,
    );

    const tokenInDecimals = this.coins!.find(
      (coin) => coin.address === route.path[0].from,
    )!.decimals;
    const tokenOutDecimals = this.coins!.find(
      (coin) => coin.address === route.path[route.path.length - 1].to,
    )!.decimals;
    let amountInArg: number;
    let amountOutArg: number;
    if (route.type === "exact_input") {
      if (balanceCoinIn !== undefined && balanceCoinIn < route.amountIn) {
        throw new Error("Insufficient balance");
      }
      amountInArg = scaleUp(route.amountIn, tokenInDecimals);
      amountOutArg = scaleUp(
        calcMinReceivedValue(route.amountOut, slippagePercentage),
        tokenOutDecimals,
      );
    } else {
      const maxSoldValueAfterSlippage = calcMaxSoldValue(
        route.amountIn,
        slippagePercentage,
      );
      amountInArg = scaleUp(
        balanceCoinIn !== undefined
          ? Math.min(balanceCoinIn, maxSoldValueAfterSlippage)
          : maxSoldValueAfterSlippage,
        tokenInDecimals,
      );
      amountOutArg = scaleUp(route.amountOut, tokenOutDecimals);
    }
    if (route.path.length == 1) {
      const path = route.path[0];
      const functionName =
        `swap_exact_${route.type === "exact_input" ? "in" : "out"}_${path.pool.poolType === "Stable" ? "stable" : "weighted"}` as const;

      return createEntryPayload(COIN_WRAPPER_ABI, {
        function: functionName,
        typeArguments: [coinType],
        functionArguments: [
          path.pool.type as `0x${string}`,
          path.from as `0x${string}`,
          amountInArg,
          path.to as `0x${string}`,
          amountOutArg,
        ],
        address: this.v2ResourceAddress as `0x${string}`,
      });
    }

    throw new Error("Invalid route");
  }
}

export { ThalaswapRouter };

async function getCoinType(
  client: Aptos,
  coinFaAddress: string,
  v2ResourceAddress: string,
) {
  const result = (await client.view({
    payload: {
      function: "0x1::coin::paired_coin",
      typeArguments: [],
      functionArguments: [coinFaAddress],
    },
  })) as [
    {
      vec:
        | []
        | [
            {
              account_address: string;
              module_name: string;
              struct_name: string;
            },
          ];
    },
  ];

  const optionalCoinType = result[0].vec[0];

  return !optionalCoinType
    ? `${v2ResourceAddress}::coin_wrapper::Notacoin`
    : `${optionalCoinType.account_address}::${fromHex(optionalCoinType.module_name.slice(2))}::${fromHex(optionalCoinType.struct_name.slice(2))}`;
}

function fromHex(h: string): string {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(hexStringToUint8Array(h));
}

function hexStringToUint8Array(hexString: string) {
  // Remove "0x" prefix if present
  hexString = hexString.replace(/^0x/, "");

  // Ensure the length of the hex string is even
  if (hexString.length % 2 !== 0) {
    hexString = "0" + hexString;
  }

  const uint8Array = new Uint8Array(hexString.length / 2);

  for (let i = 0; i < hexString.length; i += 2) {
    const byte = parseInt(hexString.slice(i, i + 2), 16);
    uint8Array[i / 2] = byte;
  }

  return uint8Array;
}
