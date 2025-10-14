/**
 * v2v3flashloanbot.js
 * 
 * Arbitrage bot that exploits price differences between Uniswap V2 and V3
 * using Balancer FLASHLOAN to fund the trades
 * 
 * Flow:
 * 1. Manipulation script creates price difference (V2 cheap, V3 expensive)
 * 2. Bot detects opportunity
 * 3. Bot calls ArbitrageV3 contract with flashloan
 * 4. Contract borrows X tokens from Balancer
 * 5. Contract swaps on V2 (buy cheap)
 * 6. Contract swaps on V3 (sell expensive)
 * 7. Contract repays flashloan + fee
 * 8. Bot receives profit
 * 
 * Network: Sepolia Testnet
 * DEXes: Uniswap V2 & V3
 * Flash Loan: Balancer
 * 
 * Usage: node v2v3flashloanbot.js
 */

require('./helpers/serverbot.js');
require("dotenv").config();
const ethers = require("ethers");
const config = require('./config.json');
const TelegramBot = require('node-telegram-bot-api');
const {
  calculateFlashloanRepayment,
  calculateTrueNetProfit,
  calculateAmountOutMinimum,
  formatProfitAnalysis
} = require('./helpers/profitCalculator');

// ============================================
// PROVIDER SETUP - SEPOLIA TESTNET
// ============================================

const provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL);

console.log(`\n🌐 Connected to Sepolia testnet`);
console.log(`   RPC: ${process.env.ETH_SEPOLIA_RPC_URL.substring(0, 50)}...`);

// ============================================
// CONTRACT INSTANCES
// ============================================

// Uniswap V2 Contracts
const v2Router = new ethers.Contract(
  config.UNISWAP.V2_ROUTER_02_ADDRESS,
  require("@uniswap/v2-periphery/build/IUniswapV2Router02.json").abi,
  provider
);

const v2Factory = new ethers.Contract(
  config.UNISWAP.FACTORY_ADDRESS,
  require("@uniswap/v2-core/build/IUniswapV2Factory.json").abi,
  provider
);

// Uniswap V3 Contracts
const v3Router = new ethers.Contract(
  config.UNISWAPV3.V3_ROUTER_02_ADDRESS,
  require("@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json").abi,
  provider
);

const v3Factory = new ethers.Contract(
  config.UNISWAPV3.FACTORY_ADDRESS,
  require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json").abi,
  provider
);

// ArbitrageV3 Contract (with flashloan)
const arbitrageV3 = new ethers.Contract(
  config.PROJECT_SETTINGS.ARBITRAGE_V3_ADDRESS,
  require("./artifacts/contracts/ArbitrageV3.sol/ArbitrageV3.json").abi,
  provider
);

// ============================================
// ERC20 ABI
// ============================================

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

// ============================================
// CONFIGURATION
// ============================================

const TOKEN_PAIR = {
  token0: process.env.ARB_AGAINST,  // One token (e.g., LINK)
  token1: process.env.ARB_FOR,      // Other token (e.g., WETH)
};

const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD) || 0.1; // 0.1%
const MIN_PROFIT_THRESHOLD = ethers.parseEther(process.env.MIN_PROFIT_THRESHOLD || "0.001");
const FLASH_LOAN_FEE = parseFloat(process.env.FLASH_LOAN_FEE) || 0.0009; // 0.09% Balancer fee
const SLIPPAGE_TOLERANCE = 50n; // 0.5% in basis points
const V2_FEE = 3000; // V2 uses fixed fee
const V3_FEE_TIER = 3000; // 0.3% V3 fee tier

// ============================================
// TELEGRAM BOT SETUP
// ============================================

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
let isRunning = true;
let isExecuting = false;
let successCount = 0;
let tradeHistory = [];
let logHistory = [];

const MAX_LOG_HISTORY = 50;

const sendMessage = (text) => {
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' })
    .catch(e => console.error('Telegram error:', e.message));
};

// ============================================
// ENHANCED LOGGING
// ============================================

const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  logHistory.push(`[${new Date().toISOString()}] ${message}`);
  if (logHistory.length > MAX_LOG_HISTORY) logHistory.shift();
  originalLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  logHistory.push(`[ERROR] ${new Date().toISOString()}: ${message}`);
  if (logHistory.length > MAX_LOG_HISTORY) logHistory.shift();
  originalError.apply(console, args);
};

// ============================================
// TELEGRAM COMMANDS
// ============================================

bot.onText(/\/start/, (msg) => {
  isRunning = true;
  sendMessage(`✅ **V2↔V3 Flashloan Arbitrage Bot STARTED**\n\nUsing Balancer flashloans to exploit V2/V3 price differences`);
});

bot.onText(/\/stop/, (msg) => {
  isRunning = false;
  sendMessage("❌ **Bot STOPPED**");
});

bot.onText(/\/status/, async (msg) => {
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await provider.getBalance(signer.address);
  sendMessage(
    `**V2↔V3 Flashloan Bot Status**\n` +
    `State: ${isRunning ? '✅ Running' : '❌ Stopped'}\n` +
    `Trades Executed: ${successCount}\n` +
    `ETH Balance: ${ethers.formatEther(balance)}\n` +
    `Contract: ${config.PROJECT_SETTINGS.ARBITRAGE_V3_ADDRESS}`
  );
});

bot.onText(/\/history/, (msg) => {
  if (tradeHistory.length === 0) {
    sendMessage("No trades recorded yet.");
    return;
  }
  let message = "**Recent Trades (Last 5)**\n\n";
  tradeHistory.slice(-5).reverse().forEach(t => {
    message += `**Trade #${t.id}**\n` +
      `Pair: ${t.pair}\n` +
      `Flashloan: ${t.flashAmount} WETH\n` +
      `Profit: ${t.profit}\n` +
      `Direction: ${t.direction}\n` +
      `TX: ${t.txHash}\n\n`;
  });
  sendMessage(message);
});

bot.onText(/\/logs/, (msg) => {
  if (logHistory.length === 0) {
    sendMessage("No logs.");
    return;
  }
  sendMessage("```\n" + logHistory.slice(-15).join('\n') + "\n```");
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get token metadata
 */
async function getTokenMetadata(tokenAddress) {
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [symbol, decimals, name] = await Promise.all([
      token.symbol(),
      token.decimals(),
      token.name()
    ]);
    return { symbol, decimals, name, address: tokenAddress };
  } catch (error) {
    console.error(`Error getting metadata for ${tokenAddress}: ${error.message}`);
    return null;
  }
}

/**
 * Get V2 price for amount
 */
async function getPriceV2(token0, token1, amountIn) {
  try {
    const path = [token0, token1];
    const amounts = await v2Router.getAmountsOut(amountIn, path);
    return amounts[1];
  } catch (error) {
    console.error(`Error getting V2 price: ${error.message}`);
    return 0n;
  }
}

/**
 * Get V3 price for amount
 */
async function getPriceV3(token0, token1, amountIn) {
  try {
    // For V3, we need to calculate price from pool
    // This is simplified - in reality you'd use quoter
    // For now, estimate based on reserves
    const path = [token0, token1];
    
    // Try V2 as approximation (V3 liquidity might be similar)
    const v2Amounts = await v2Router.getAmountsOut(amountIn, path);
    
    // V3 prices might be slightly different due to fee tier
    // This is a simplification
    return v2Amounts[1];
  } catch (error) {
    console.error(`Error getting V3 price: ${error.message}`);
    return 0n;
  }
}

/**
 * Execute arbitrage using flashloan from Balancer
 */
async function executeFlashloanArbitrage(opportunity, signer) {
  if (isExecuting) {
    console.log("⏳ Already executing, skipping...");
    return;
  }

  isExecuting = true;

  try {
    const { amountIn, expectedProfit, direction } = opportunity;

    console.log(`\n💸 EXECUTING FLASHLOAN ARBITRAGE`);
    console.log(`   Flashloan Amount: ${ethers.formatEther(amountIn)}`);
    console.log(`   Direction: ${direction}`);
    console.log(`   Expected Profit: ${ethers.formatEther(expectedProfit)}`);

    // Determine direction
    // direction = true: Start on V2 (buy V2, sell V3)
    // direction = false: Start on V3 (buy V3, sell V2)
    const startOnV2 = direction === "V2→V3";

    // Call ArbitrageV3 contract
    // Contract will:
    // 1. Request flashloan from Balancer
    // 2. Swap on V2 or V3 (buy)
    // 3. Swap on V3 or V2 (sell)
    // 4. Repay flashloan + fee
    // 5. Send profit to caller

    console.log(`\n📞 Calling ArbitrageV3 contract...`);
    console.log(`   Start on: ${startOnV2 ? 'V2' : 'V3'}`);

    const tx = await arbitrageV3.connect(signer).executeTrade(
      startOnV2,                    // Start on V2
      TOKEN_PAIR.token0,            // LINK
      TOKEN_PAIR.token1,            // WETH
      V3_FEE_TIER,                  // 3000 (0.3%)
      amountIn,                     // Flashloan amount
      calculateAmountOutMinimum(
        amountIn,
        50,
        ethers.parseEther("0"),
        ethers.parseEther("0")
      ),
      { gasLimit: 1500000 }
    );

    console.log(`   TX Hash: ${tx.hash}`);
    console.log(`   Waiting for confirmation...`);

    const receipt = await tx.wait();

    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

    successCount++;

    sendMessage(
      `🚀 **Flashloan Arbitrage Success!** 🚀\n\n` +
      `Flashloan: ${ethers.formatEther(amountIn)} ${TOKEN_PAIR.token1}\n` +
      `Strategy: ${direction}\n` +
      `Profit: ${ethers.formatEther(expectedProfit)}\n` +
      `[View TX](https://sepolia.etherscan.io/tx/${receipt.hash})`
    );

    tradeHistory.push({
      id: successCount,
      pair: `${TOKEN_PAIR.token0}/${TOKEN_PAIR.token1}`,
      flashAmount: ethers.formatEther(amountIn),
      profit: `${ethers.formatEther(expectedProfit)}`,
      direction: direction,
      txHash: receipt.hash
    });

    console.log(`\n✅ TRADE #${successCount} COMPLETED`);

  } catch (error) {
    console.error(`❌ Flashloan arbitrage failed: ${error.message}`);
    if (error.reason) console.error(`Reason: ${error.reason}`);
    sendMessage(`❌ **Trade Failed**\n\n${error.reason || error.message}`);
  } finally {
    isExecuting = false;
  }
}

// ============================================
// CORE ARBITRAGE LOGIC
// ============================================

async function checkForArbitrage(signer) {
  try {
    // Get token metadata
    const token0 = await getTokenMetadata(TOKEN_PAIR.token0);
    const token1 = await getTokenMetadata(TOKEN_PAIR.token1);

    if (!token0 || !token1) {
      console.log(`❌ Could not get token metadata`);
      return null;
    }

    // Test amount for price checking
    const testAmount = ethers.parseEther("0.1");

    // Get prices on both pools
    const priceV2 = await getPriceV2(TOKEN_PAIR.token1, TOKEN_PAIR.token0, testAmount);
    const priceV3 = await getPriceV3(TOKEN_PAIR.token1, TOKEN_PAIR.token0, testAmount);

    if (priceV2 === 0n || priceV3 === 0n) {
      console.log(`❌ Could not get quotes`);
      return null;
    }

    // Calculate price difference
    const priceRatio = Number(priceV3) / Number(priceV2);
    const priceDifference = Math.abs((priceRatio - 1) * 100);

    console.log(`\n📊 PRICE CHECK`);
    console.log(`   Pair: ${token1.symbol}/${token0.symbol}`);
    console.log(`   V2 Price: ${ethers.formatEther(priceV2)} ${token0.symbol}`);
    console.log(`   V3 Price: ${ethers.formatEther(priceV3)} ${token0.symbol}`);
    console.log(`   Difference: ${priceDifference.toFixed(4)}%`);

    // Check if difference exceeds threshold
    if (priceDifference < PROFIT_THRESHOLD) {
      console.log(`   ⏭️ Below threshold (${PROFIT_THRESHOLD}%)`);
      return null;
    }

    console.log(`   ✅ ABOVE THRESHOLD! Analyzing...`);

    // Determine direction: which is cheaper?
    const v2Cheaper = priceV2 < priceV3;
    const direction = v2Cheaper ? "V2→V3" : "V3→V2";

    console.log(`   💡 Strategy: ${direction}`);

    // Scan different flashloan amounts
    let bestOpportunity = null;
    let bestProfit = -Infinity;

    let flashAmount = ethers.parseEther("0.1");
    const maxAmount = ethers.parseEther("2.0");
    const step = ethers.parseEther("0.1");

    while (flashAmount <= maxAmount) {
      try {
        // Get prices for this amount
        const amountOut1V2 = await getPriceV2(TOKEN_PAIR.token1, TOKEN_PAIR.token0, flashAmount);
        const amountOut2V3 = await getPriceV3(TOKEN_PAIR.token0, TOKEN_PAIR.token1, amountOut1V2);

        // Calculate profit
        const gasPrice = (await provider.getFeeData()).gasPrice;
        const profitAnalysis = calculateTrueNetProfit(
          flashAmount,
          amountOut1V2,
          amountOut2V3,
          gasPrice,
          FLASH_LOAN_FEE,      // Balancer fee
          600000n              // Gas units for dual swaps with flashloan
        );

        if (profitAnalysis.isProfitable && profitAnalysis.netProfit >= MIN_PROFIT_THRESHOLD) {
          if (Number(profitAnalysis.netProfit) > bestProfit) {
            bestProfit = Number(profitAnalysis.netProfit);
            bestOpportunity = {
              amountIn: flashAmount,
              expectedProfit: profitAnalysis.netProfit,
              profitAnalysis: profitAnalysis,
              direction: direction
            };
          }
        }
      } catch (e) {
        // Continue scanning
      }

      flashAmount += step;
    }

    if (bestOpportunity) {
      console.log(`\n🎯 OPPORTUNITY FOUND!`);
      console.log(`   Flashloan: ${ethers.formatEther(bestOpportunity.amountIn)}`);
      console.log(`   Expected Profit: ${ethers.formatEther(bestOpportunity.expectedProfit)}`);
      console.log(formatProfitAnalysis(bestOpportunity.profitAnalysis));
      return bestOpportunity;
    }

  } catch (error) {
    console.error(`Error checking for arbitrage: ${error.message}`);
  }

  return null;
}

// ============================================
// MAIN LOOP
// ============================================

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`   V2 ↔ V3 UNISWAP ARBITRAGE BOT (Flashloan Powered)`);
  console.log(`   Network: Sepolia Testnet`);
  console.log(`   Flash Loan: Balancer`);
  console.log(`   Strategy: Detect price difference, use flashloan, profit`);
  console.log(`${"=".repeat(70)}\n`);

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`📍 Signer: ${signer.address}`);
  console.log(`🎯 Token Pair: ${TOKEN_PAIR.token0} ↔ ${TOKEN_PAIR.token1}`);
  console.log(`📊 Profit Threshold: ${PROFIT_THRESHOLD}%`);
  console.log(`💰 Min Profit: ${ethers.formatEther(MIN_PROFIT_THRESHOLD)} ETH`);
  console.log(`⚡ Flashloan Fee: ${(FLASH_LOAN_FEE * 100).toFixed(3)}%`);
  console.log(`📜 ArbitrageV3 Contract: ${config.PROJECT_SETTINGS.ARBITRAGE_V3_ADDRESS}\n`);

  sendMessage(`🤖 **V2↔V3 Flashloan Arbitrage Bot Started**\n\nMonitoring Sepolia testnet for price differences...`);

  // Listen to new blocks
  let checkCount = 0;
  provider.on('block', async (blockNumber) => {
    if (!isRunning || isExecuting) return;

    checkCount++;
    console.log(`\n📦 Block #${blockNumber} - Check #${checkCount}`);

    try {
      const opportunity = await checkForArbitrage(signer);

      if (opportunity) {
        await executeFlashloanArbitrage(opportunity, signer);
      }
    } catch (error) {
      console.error(`Block handler error: ${error.message}`);
    }
  });

  console.log(`🚀 Bot listening for arbitrage opportunities...\n`);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
