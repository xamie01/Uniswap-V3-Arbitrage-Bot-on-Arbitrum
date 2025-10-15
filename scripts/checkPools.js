/**
 * scripts/checkPools.js
 * 
 * Diagnostic script to check V2 and V3 pool status
 * 
 * Usage: npx hardhat run scripts/checkPools.js --network sepolia
 */

require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

const V2_FACTORY = "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";
const V3_FACTORY = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";

const V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

const POOL_ABI = [
  "function liquidity() external view returns (uint128)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  POOL DIAGNOSTIC TOOL`);
  console.log(`${"=".repeat(60)}\n`);

  const [signer] = await ethers.getSigners();
  console.log(`📍 Signer: ${signer.address}\n`);

  // Get tokens from .env
  let BASE_TOKEN = process.env.ARB_FOR;
  let TARGET_TOKEN = process.env.ARB_AGAINST_TOKENS 
    ? process.env.ARB_AGAINST_TOKENS.split(',')[0].trim()
    : null;

  if (!BASE_TOKEN || BASE_TOKEN === "0x82af49447d8a07e3bd95bd0d56f35241523fbab1") {
    BASE_TOKEN = SEPOLIA_WETH;
  }

  console.log(`🔍 CHECKING POOLS FOR:`);
  console.log(`   Base: ${BASE_TOKEN}`);
  console.log(`   Target: ${TARGET_TOKEN}\n`);

  // ============================================
  // CHECK V2 POOL
  // ============================================

  console.log(`${"=".repeat(60)}`);
  console.log(`V2 POOL CHECK`);
  console.log(`${"=".repeat(60)}\n`);

  const v2Factory = new ethers.Contract(V2_FACTORY, V2_FACTORY_ABI, signer);
  const v2PairAddress = await v2Factory.getPair(BASE_TOKEN, TARGET_TOKEN);

  console.log(`V2 Factory: ${V2_FACTORY}`);
  console.log(`V2 Pair Address: ${v2PairAddress}\n`);

  if (v2PairAddress === ethers.ZeroAddress) {
    console.log(`❌ V2 POOL DOES NOT EXIST`);
    console.log(`   You need to create it on Uniswap V2\n`);
  } else {
    console.log(`✅ V2 Pool exists\n`);
    
    const v2Pair = new ethers.Contract(v2PairAddress, PAIR_ABI, signer);
    const [reserve0, reserve1] = await v2Pair.getReserves();
    const token0 = await v2Pair.token0();
    const token1 = await v2Pair.token1();

    console.log(`   Token0: ${token0}`);
    console.log(`   Token1: ${token1}`);
    console.log(`   Reserve0: ${ethers.formatEther(reserve0)}`);
    console.log(`   Reserve1: ${ethers.formatEther(reserve1)}`);

    if (reserve0 === 0n || reserve1 === 0n) {
      console.log(`\n   ⚠️  WARNING: Pool has ZERO liquidity!`);
      console.log(`   Add liquidity before using\n`);
    } else {
      console.log(`\n   ✅ Pool has liquidity\n`);
    }
  }

  // ============================================
  // CHECK V3 POOLS (ALL FEE TIERS)
  // ============================================

  console.log(`${"=".repeat(60)}`);
  console.log(`V3 POOL CHECK`);
  console.log(`${"=".repeat(60)}\n`);

  const v3Factory = new ethers.Contract(V3_FACTORY, V3_FACTORY_ABI, signer);
  const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

  console.log(`V3 Factory: ${V3_FACTORY}\n`);

  for (const fee of feeTiers) {
    const v3PoolAddress = await v3Factory.getPool(BASE_TOKEN, TARGET_TOKEN, fee);
    
    console.log(`Fee Tier: ${fee / 10000}% (${fee})`);
    console.log(`Pool Address: ${v3PoolAddress}`);

    if (v3PoolAddress === ethers.ZeroAddress) {
      console.log(`❌ Pool does not exist for this fee tier\n`);
    } else {
      console.log(`✅ Pool exists`);
      
      try {
        const v3Pool = new ethers.Contract(v3PoolAddress, POOL_ABI, signer);
        const liquidity = await v3Pool.liquidity();
        const slot0 = await v3Pool.slot0();
        const token0 = await v3Pool.token0();
        const token1 = await v3Pool.token1();

        console.log(`   Token0: ${token0}`);
        console.log(`   Token1: ${token1}`);
        console.log(`   Liquidity: ${liquidity.toString()}`);
        console.log(`   Current Tick: ${slot0.tick}`);
        console.log(`   Sqrt Price: ${slot0.sqrtPriceX96.toString()}`);

        if (liquidity === 0n) {
          console.log(`\n   ⚠️  WARNING: Pool has ZERO liquidity!`);
          console.log(`   Add liquidity before using\n`);
        } else {
          console.log(`\n   ✅ Pool has liquidity\n`);
        }
      } catch (error) {
        console.log(`   ⚠️  Error reading pool: ${error.message}\n`);
      }
    }
  }

  // ============================================
  // RECOMMENDATIONS
  // ============================================

  console.log(`${"=".repeat(60)}`);
  console.log(`RECOMMENDATIONS`);
  console.log(`${"=".repeat(60)}\n`);

  if (v2PairAddress === ethers.ZeroAddress) {
    console.log(`1. ❌ CREATE V2 POOL`);
    console.log(`   Go to: https://app.uniswap.org/?chain=sepolia`);
    console.log(`   Add liquidity to V2 pool\n`);
  } else {
    console.log(`1. ✅ V2 Pool exists\n`);
  }

  let hasV3Pool = false;
  for (const fee of feeTiers) {
    const v3PoolAddress = await v3Factory.getPool(BASE_TOKEN, TARGET_TOKEN, fee);
    if (v3PoolAddress !== ethers.ZeroAddress) {
      hasV3Pool = true;
      console.log(`2. ✅ V3 Pool exists (${fee / 10000}% fee)\n`);
      break;
    }
  }

  if (!hasV3Pool) {
    console.log(`2. ❌ CREATE V3 POOL`);
    console.log(`   Go to: https://app.uniswap.org/?chain=sepolia`);
    console.log(`   Add liquidity to V3 pool (0.3% fee recommended)\n`);
  }

  console.log(`${"=".repeat(60)}\n`);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
