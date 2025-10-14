/**
 * scripts/v3manipulate_improved.js
 * 
 * IMPROVED VERSION: Only performs buy/sell operations
 * Does NOT seed pools (assumes pools already have liquidity)
 * 
 * Purpose: Create price differences between Uniswap V2 and V3
 * to test arbitrage bot
 * 
 * Usage: npx hardhat run scripts/v3manipulate_improved.js --network sepolia
 */

require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

// ============================================
// CONFIGURATION
// ============================================

// Use real mock token addresses deployed to Sepolia
const TOKEN_CONFIGS = {
  LINK: {
    address: process.env.LINK_TOKEN_ADDRESS || "0x...", // Set in .env
    symbol: "LINK",
    decimals: 18
  },
  ARB: {
    address: process.env.ARB_TOKEN_ADDRESS || "0x...", // Set in .env
    symbol: "ARB",
    decimals: 18
  },
  UNI: {
    address: process.env.UNI_TOKEN_ADDRESS || "0x...", // Set in .env
    symbol: "UNI",
    decimals: 18
  },
  WETH: {
    address: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9", // Sepolia testnet WETH9
    symbol: "WETH",
    decimals: 18
  }
};

// Uniswap addresses on Sepolia
const UNISWAP_CONFIG = {
  V2_ROUTER: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
  V3_ROUTER: "0xb41b78Ce3D1BDEDE48A3d303eD2564F6d1F6fff0",
  V2_FACTORY: "0xF62c03E08ada871A0bEb309762E260a7a6a880E6",
  V3_FACTORY: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c"
};

// ABIs
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

const UNISWAP_V2_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

const UNISWAP_V3_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountIn)"
];

// ============================================
// MAIN FUNCTIONS
// ============================================

/**
 * Create price difference by buying on V2
 * This lowers V2 price and raises V3 price
 */
async function buyOnV2(
  signer,
  tokenInAddress,
  tokenOutAddress,
  amountIn,
  v2Router,
  wethAddress
) {
  console.log(`\n💰 BUYING on Uniswap V2`);
  console.log(`   Selling: ${ethers.formatEther(amountIn)} ${TOKEN_CONFIGS.WETH.symbol}`);
  console.log(`   Buying: ${TOKEN_CONFIGS.LINK.symbol}`);

  // Approve V2 router to spend tokenIn
  const tokenIn = new ethers.Contract(tokenInAddress, ERC20_ABI, signer);
  const approveTx = await tokenIn.approve(v2Router.getAddress(), amountIn);
  await approveTx.wait();
  console.log(`   ✅ Approved V2 router`);

  // Build path
  const path = [tokenInAddress, tokenOutAddress];

  // Execute swap
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
  const swapTx = await v2Router.swapExactTokensForTokens(
    amountIn,
    0, // Accept any amount (slippage doesn't matter for testing)
    path,
    signer.address,
    deadline,
    { gasLimit: 500000 }
  );

  const receipt = await swapTx.wait();
  console.log(`   ✅ V2 swap complete: ${receipt.hash}`);

  // Get amount out from events
  const amounts = await v2Router.getAmountsOut(amountIn, path);
  console.log(`   Output: ${ethers.formatEther(amounts[1])} ${TOKEN_CONFIGS.LINK.symbol}`);

  return amounts[1];
}

/**
 * Create price difference by selling on V3
 * This raises V3 price for the token we bought on V2
 */
async function sellOnV3(
  signer,
  tokenInAddress,
  tokenOutAddress,
  amountIn,
  v3Router,
  feeTier
) {
  console.log(`\n📈 SELLING on Uniswap V3`);
  console.log(`   Selling: ${ethers.formatEther(amountIn)} ${TOKEN_CONFIGS.LINK.symbol}`);
  console.log(`   Buying: ${TOKEN_CONFIGS.WETH.symbol}`);

  // Approve V3 router
  const tokenIn = new ethers.Contract(tokenInAddress, ERC20_ABI, signer);
  const approveTx = await tokenIn.approve(v3Router.getAddress(), amountIn);
  await approveTx.wait();
  console.log(`   ✅ Approved V3 router`);

  // Execute swap on V3
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  
  const params = {
    tokenIn: tokenInAddress,
    tokenOut: tokenOutAddress,
    fee: feeTier,
    recipient: signer.address,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: 0, // Accept any amount
    sqrtPriceLimitX96: 0
  };

  const swapTx = await v3Router.exactInputSingle(params, {
    gasLimit: 500000
  });

  const receipt = await swapTx.wait();
  console.log(`   ✅ V3 swap complete: ${receipt.hash}`);
  console.log(`   Fee tier: ${feeTier / 100}%`);

  return receipt;
}

/**
 * Check price on V2
 */
async function getPriceV2(v2Router, tokenInAddress, tokenOutAddress, amountIn) {
  const path = [tokenInAddress, tokenOutAddress];
  const amounts = await v2Router.getAmountsOut(amountIn, path);
  return amounts[1];
}

/**
 * Check price on V3 using quoter
 */
async function getPriceV3(quoter, tokenInAddress, tokenOutAddress, amountIn, feeTier) {
  try {
    const params = {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee: feeTier,
      amountIn: amountIn,
      sqrtPriceLimitX96: 0
    };
    
    const result = await quoter.quoteExactInputSingle.staticCall(params);
    return result.amountOut;
  } catch (error) {
    console.error(`Error getting V3 quote: ${error.message}`);
    return 0n;
  }
}

/**
 * Display price comparison
 */
async function displayPriceComparison(
  v2Router,
  v3Quoter,
  tokenInAddress,
  tokenOutAddress,
  amountIn,
  v3FeeTier,
  tokenInSymbol,
  tokenOutSymbol
) {
  try {
    const priceV2 = await getPriceV2(v2Router, tokenInAddress, tokenOutAddress, amountIn);
    const priceV3 = await getPriceV3(v3Quoter, tokenInAddress, tokenOutAddress, amountIn, v3FeeTier);

    const testAmount = ethers.parseEther("1.0");
    const priceV2_1 = await getPriceV2(v2Router, tokenInAddress, tokenOutAddress, testAmount);
    const priceV3_1 = await getPriceV3(v3Quoter, tokenInAddress, tokenOutAddress, testAmount, v3FeeTier);

    const v2Rate = Number(priceV2_1) / Number(testAmount);
    const v3Rate = Number(priceV3_1) / Number(testAmount);
    const priceDiff = Math.abs((v3Rate - v2Rate) / v2Rate) * 100;

    console.log(`\n┌─────────────────────────────────────────────────┐`);
    console.log(`│        CURRENT PRICE COMPARISON`);
    console.log(`├─────────────────────────────────────────────────┤`);
    console.log(`│ For ${ethers.formatEther(amountIn)} ${tokenInSymbol}:`);
    console.log(`│ V2 Output: ${ethers.formatEther(priceV2)} ${tokenOutSymbol}`);
    console.log(`│ V3 Output: ${ethers.formatEther(priceV3)} ${tokenOutSymbol}`);
    console.log(`├─────────────────────────────────────────────────┤`);
    console.log(`│ Rate per 1 ${tokenInSymbol}:`);
    console.log(`│ V2: ${v2Rate.toFixed(6)} ${tokenOutSymbol}`);
    console.log(`│ V3: ${v3Rate.toFixed(6)} ${tokenOutSymbol}`);
    console.log(`│ Difference: ${priceDiff.toFixed(4)}%`);
    console.log(`└─────────────────────────────────────────────────┘\n`);

    return { priceV2, priceV3, priceDiff };
  } catch (error) {
    console.error(`Error displaying prices: ${error.message}`);
    return null;
  }
}

/**
 * Get wallet token balance
 */
async function getBalance(signer, tokenAddress, tokenSymbol) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const balance = await token.balanceOf(signer.address);
  console.log(`   ${tokenSymbol}: ${ethers.formatEther(balance)}`);
  return balance;
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  UNISWAP V2 vs V3 PRICE MANIPULATION TOOL`);
  console.log(`  Network: Sepolia Testnet`);
  console.log(`  Purpose: Create arbitrage opportunities`);
  console.log(`${"=".repeat(60)}\n`);

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`📍 Signer address: ${signer.address}`);

  // Setup contracts
  const v2Router = new ethers.Contract(
    UNISWAP_CONFIG.V2_ROUTER,
    UNISWAP_V2_ROUTER_ABI,
    signer
  );

  const v3Router = new ethers.Contract(
    UNISWAP_CONFIG.V3_ROUTER,
    UNISWAP_V3_ROUTER_ABI,
    signer
  );

  // Get V3 Quoter ABI from deployment
  const quoterABI = require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi;
  const v3Quoter = new ethers.Contract(
    "0x..." // QuoterV2 address on Sepolia - check Uniswap docs
  );

  // Configuration
  const TOKEN_PAIR = {
    in: TOKEN_CONFIGS.WETH.address,
    out: TOKEN_CONFIGS.LINK.address,
    inSymbol: "WETH",
    outSymbol: "LINK"
  };

  const V3_FEE_TIER = 3000; // 0.3% fee

  const SWAP_AMOUNT = ethers.parseEther("0.5"); // 0.5 WETH per swap

  console.log(`\n📦 CONFIGURATION`);
  console.log(`   Pair: ${TOKEN_PAIR.inSymbol} → ${TOKEN_PAIR.outSymbol}`);
  console.log(`   V3 Fee Tier: ${V3_FEE_TIER / 100}%`);
  console.log(`   Swap Amount: ${ethers.formatEther(SWAP_AMOUNT)} ${TOKEN_PAIR.inSymbol}`);

  // Check balances
  console.log(`\n💼 WALLET BALANCES`);
  await getBalance(signer, TOKEN_PAIR.in, TOKEN_PAIR.inSymbol);
  await getBalance(signer, TOKEN_PAIR.out, TOKEN_PAIR.outSymbol);

  // Initial price comparison
  console.log(`\n📊 INITIAL PRICE COMPARISON`);
  await displayPriceComparison(
    v2Router,
    v3Quoter,
    TOKEN_PAIR.in,
    TOKEN_PAIR.out,
    SWAP_AMOUNT,
    V3_FEE_TIER,
    TOKEN_PAIR.inSymbol,
    TOKEN_PAIR.outSymbol
  );

  // Perform swaps to create price difference
  console.log(`\n🔄 EXECUTING SWAPS TO CREATE PRICE DIFFERENCE\n`);
  console.log(`Strategy: Buy on V2 (lowers V2 price) → Sell on V3 (raises V3 price)`);
  console.log(`This creates an arbitrage opportunity where V2 is cheaper than V3\n`);

  try {
    // Step 1: Buy on V2
    const linkAmount = await buyOnV2(
      signer,
      TOKEN_PAIR.in,
      TOKEN_PAIR.out,
      SWAP_AMOUNT,
      v2Router,
      TOKEN_PAIR.in
    );

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Sell on V3
    await sellOnV3(
      signer,
      TOKEN_PAIR.out,
      TOKEN_PAIR.in,
      linkAmount,
      v3Router,
      V3_FEE_TIER
    );

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check final balances
    console.log(`\n💼 FINAL WALLET BALANCES`);
    await getBalance(signer, TOKEN_PAIR.in, TOKEN_PAIR.inSymbol);
    await getBalance(signer, TOKEN_PAIR.out, TOKEN_PAIR.outSymbol);

    // Final price comparison
    console.log(`\n📊 FINAL PRICE COMPARISON`);
    const finalPrices = await displayPriceComparison(
      v2Router,
      v3Quoter,
      TOKEN_PAIR.in,
      TOKEN_PAIR.out,
      SWAP_AMOUNT,
      V3_FEE_TIER,
      TOKEN_PAIR.inSymbol,
      TOKEN_PAIR.outSymbol
    );

    if (finalPrices && finalPrices.priceDiff > 0.1) {
      console.log(`✅ SUCCESS: Created ${finalPrices.priceDiff.toFixed(4)}% price difference`);
      console.log(`   The arbitrage bot should find this opportunity!\n`);
    } else {
      console.log(`⚠️  Price difference is small. Repeat script to increase gap.\n`);
    }

  } catch (error) {
    console.error(`\n❌ Error during execution: ${error.message}`);
    console.error(error);
  }

  console.log(`${"=".repeat(60)}\n`);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
