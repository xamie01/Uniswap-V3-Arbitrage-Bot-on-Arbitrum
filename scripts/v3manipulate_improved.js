/**
 * scripts/v3manipulate_sepolia.js - FIXED FOR SEPOLIA
 * 
 * Creates price differences between Uniswap V2 and V3 on SEPOLIA
 * 
 * IMPORTANT: Uses correct Sepolia addresses
 * 
 * Usage: npx hardhat run scripts/v3manipulate_sepolia.js --network sepolia
 */

require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

// ============================================
// SEPOLIA ADDRESSES (DO NOT CHANGE)
// ============================================

const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"; // Correct Sepolia WETH

const UNISWAP_SEPOLIA = {
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
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

const UNISWAP_V2_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

const UNISWAP_V3_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)"
];

// ============================================
// VALIDATION
// ============================================

async function validateToken(tokenAddress, signer) {
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const [symbol, name, decimals] = await Promise.all([
      token.symbol(),
      token.name(),
      token.decimals()
    ]);
    return { valid: true, symbol, name, decimals, address: tokenAddress };
  } catch (error) {
    return { valid: false, error: error.message, address: tokenAddress };
  }
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  UNISWAP V2 vs V3 PRICE MANIPULATION - SEPOLIA TESTNET`);
  console.log(`  Purpose: Create arbitrage opportunities`);
  console.log(`${"=".repeat(70)}\n`);

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`📍 Signer address: ${signer.address}\n`);

  // ============================================
  // TOKEN SETUP - IMPORTANT!
  // ============================================

  console.log(`📝 TOKEN CONFIGURATION:`);
  console.log(`   Base Token (WETH): ${SEPOLIA_WETH}`);
  console.log(`   Using .env ARB_AGAINST_TOKENS\n`);

  // Get tokens from .env
  let BASE_TOKEN = process.env.ARB_FOR;
  let TARGET_TOKEN = process.env.ARB_AGAINST_TOKENS 
    ? process.env.ARB_AGAINST_TOKENS.split(',')[0].trim()
    : null;

  // FIX: Use Sepolia WETH if ARB_FOR is wrong
  if (!BASE_TOKEN || BASE_TOKEN === "0x82af49447d8a07e3bd95bd0d56f35241523fbab1") {
    console.log(`⚠️  Using Arbitrum mainnet WETH address, switching to Sepolia WETH`);
    BASE_TOKEN = SEPOLIA_WETH;
  }

  if (!TARGET_TOKEN) {
    console.error("❌ ERROR: ARB_AGAINST_TOKENS must be set in .env");
    console.error("   Format: 0xtoken1,0xtoken2,0xtoken3");
    process.exit(1);
  }

  console.log(`🔍 VALIDATING TOKENS:\n`);

  // Validate base token
  console.log(`Checking Base Token: ${BASE_TOKEN}`);
  const baseTokenInfo = await validateToken(BASE_TOKEN, signer);
  if (!baseTokenInfo.valid) {
    console.error(`❌ Base token invalid: ${baseTokenInfo.error}`);
    process.exit(1);
  }
  console.log(`   ✅ Valid: ${baseTokenInfo.symbol} (${baseTokenInfo.name})\n`);

  // Validate target token
  console.log(`Checking Target Token: ${TARGET_TOKEN}`);
  const targetTokenInfo = await validateToken(TARGET_TOKEN, signer);
  if (!targetTokenInfo.valid) {
    console.error(`❌ Target token invalid: ${targetTokenInfo.error}`);
    console.error(`\n   This address is not a valid ERC20 token on Sepolia!`);
    console.error(`   Please check:`);
    console.error(`   1. Is this the correct Sepolia token address?`);
    console.error(`   2. Have you deployed your mock tokens?`);
    console.error(`   3. Did you set ARB_AGAINST_TOKENS correctly in .env?\n`);
    process.exit(1);
  }
  console.log(`   ✅ Valid: ${targetTokenInfo.symbol} (${targetTokenInfo.name})\n`);

  // Setup contracts
  const v2Router = new ethers.Contract(
    UNISWAP_SEPOLIA.V2_ROUTER,
    UNISWAP_V2_ROUTER_ABI,
    signer
  );

  const v3Router = new ethers.Contract(
    UNISWAP_SEPOLIA.V3_ROUTER,
    UNISWAP_V3_ROUTER_ABI,
    signer
  );

  const baseToken = new ethers.Contract(BASE_TOKEN, ERC20_ABI, signer);
  const targetToken = new ethers.Contract(TARGET_TOKEN, ERC20_ABI, signer);

  // Swap configuration
  const SWAP_AMOUNT = ethers.parseEther("0.1");

  console.log(`⚙️  SWAP CONFIGURATION`);
  console.log(`   Amount: ${ethers.formatEther(SWAP_AMOUNT)} ${baseTokenInfo.symbol}`);
  console.log(`   Direction: ${baseTokenInfo.symbol} ↔ ${targetTokenInfo.symbol}`);
  console.log(`   V2 Router: ${UNISWAP_SEPOLIA.V2_ROUTER}`);
  console.log(`   V3 Router: ${UNISWAP_SEPOLIA.V3_ROUTER}\n`);

  // Check balances
  console.log(`💼 WALLET BALANCES (Before):`);
  const baseBalance = await baseToken.balanceOf(signer.address);
  const targetBalance = await targetToken.balanceOf(signer.address);
  console.log(`   ${baseTokenInfo.symbol}: ${ethers.formatEther(baseBalance)}`);
  console.log(`   ${targetTokenInfo.symbol}: ${ethers.formatEther(targetBalance)}\n`);

  if (Number(ethers.formatEther(baseBalance)) < 0.5) {
    console.error(`❌ ERROR: Insufficient ${baseTokenInfo.symbol} balance!`);
    console.error(`   Need: 0.5, Have: ${ethers.formatEther(baseBalance)}`);
    process.exit(1);
  }

  // Get initial prices
  console.log(`📊 INITIAL PRICES:`);
  const testAmount = ethers.parseEther("1.0");
  
  try {
    const initialPrices = await v2Router.getAmountsOut(testAmount, [BASE_TOKEN, TARGET_TOKEN]);
    const initialPrice = Number(ethers.formatEther(initialPrices[1]));
    console.log(`   V2: 1 ${baseTokenInfo.symbol} = ${initialPrice.toFixed(6)} ${targetTokenInfo.symbol}\n`);

    console.log(`${"=".repeat(70)}`);
    console.log(`🔄 EXECUTING PRICE MANIPULATION`);
    console.log(`${"=".repeat(70)}\n`);

    console.log(`Strategy: Buy on V2 (lowers V2 price) → Sell on V3 (raises V3 price)`);
    console.log(`Result: Creates arbitrage gap\n`);

    // ============================================
    // STEP 1: BUY ON V2
    // ============================================

    console.log(`Step 1️⃣ : BUYING on Uniswap V2`);
    console.log(`   Input: ${ethers.formatEther(SWAP_AMOUNT)} ${baseTokenInfo.symbol}`);

    // Approve
    console.log(`   → Approving V2 Router...`);
    const approveTx1 = await baseToken.approve(UNISWAP_SEPOLIA.V2_ROUTER, SWAP_AMOUNT);
    await approveTx1.wait();
    console.log(`   ✅ Approved`);

    // Swap
    console.log(`   → Executing swap...`);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const swapTx1 = await v2Router.swapExactTokensForTokens(
      SWAP_AMOUNT,
      0,
      [BASE_TOKEN, TARGET_TOKEN],
      signer.address,
      deadline,
      { gasLimit: 500000 }
    );

    const receipt1 = await swapTx1.wait();
    const targetAmountReceived = await targetToken.balanceOf(signer.address);
    console.log(`   ✅ Swap complete`);
    console.log(`   Received: ${ethers.formatEther(targetAmountReceived)} ${targetTokenInfo.symbol}`);
    console.log(`   TX: ${receipt1.hash}\n`);

    // ============================================
    // STEP 2: SELL ON V3
    // ============================================

    console.log(`Step 2️⃣ : SELLING on Uniswap V3`);
    console.log(`   Input: ${ethers.formatEther(targetAmountReceived)} ${targetTokenInfo.symbol}`);

    // Approve
    console.log(`   → Approving V3 Router...`);
    const approveTx2 = await targetToken.approve(UNISWAP_SEPOLIA.V3_ROUTER, targetAmountReceived);
    await approveTx2.wait();
    console.log(`   ✅ Approved`);

    // Swap
    console.log(`   → Executing swap...`);
    const params = {
      tokenIn: TARGET_TOKEN,
      tokenOut: BASE_TOKEN,
      fee: 3000, // 0.3%
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      amountIn: targetAmountReceived,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    };

    const swapTx2 = await v3Router.exactInputSingle(params, { gasLimit: 500000 });
    const receipt2 = await swapTx2.wait();
    console.log(`   ✅ Swap complete`);
    console.log(`   Fee tier: 0.3%`);
    console.log(`   TX: ${receipt2.hash}\n`);

    // ============================================
    // RESULTS
    // ============================================

    console.log(`💼 WALLET BALANCES (After):`);
    const finalBaseBalance = await baseToken.balanceOf(signer.address);
    const finalTargetBalance = await targetToken.balanceOf(signer.address);
    console.log(`   ${baseTokenInfo.symbol}: ${ethers.formatEther(finalBaseBalance)}`);
    console.log(`   ${targetTokenInfo.symbol}: ${ethers.formatEther(finalTargetBalance)}\n`);

    console.log(`📊 FINAL PRICES:`);
    const finalPrices = await v2Router.getAmountsOut(testAmount, [BASE_TOKEN, TARGET_TOKEN]);
    const finalPrice = Number(ethers.formatEther(finalPrices[1]));
    const priceChange = (((initialPrice - finalPrice) / initialPrice) * 100).toFixed(2);

    console.log(`   V2: 1 ${baseTokenInfo.symbol} = ${finalPrice.toFixed(6)} ${targetTokenInfo.symbol}`);
    console.log(`   Change: ${priceChange}% (${priceChange > 0 ? 'dropped ✅' : 'increased ❌'})\n`);

    console.log(`${"=".repeat(70)}`);
    if (Math.abs(Number(priceChange)) > 0.1) {
      console.log(`✅ SUCCESS: Created ${Math.abs(Number(priceChange)).toFixed(2)}% price gap`);
      console.log(`   Bot can now find arbitrage opportunities!\n`);
    } else {
      console.log(`⚠️  Small gap (${Math.abs(Number(priceChange)).toFixed(2)}%)`);
      console.log(`   Run script again to widen gap\n`);
    }

  } catch (error) {
    console.error(`\n❌ Swap execution failed:`);
    console.error(`   ${error.message}\n`);
    if (error.reason) console.error(`   Reason: ${error.reason}`);
    process.exit(1);
  }
}

// ============================================
// RUN
// ============================================

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
