/**
 * v2v3flashloanbot_multi.js
 * 
 * ENHANCED VERSION: Supports multiple token pairs
 * 
 * Features:
 * - Arbitrages multiple tokens against a base token (WETH)
 * - Uses Balancer flashloans for each trade
 * - Monitors all pairs simultaneously
 * - Executes on ANY profitable pair
 * 
 * .env Configuration:
 * ARB_FOR=0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9  (Base token - WETH)
 * ARB_AGAINST_TOKENS=0xtoken1,0xtoken2,0xtoken3      (Comma-separated)
 * 
 * Network: Sepolia Testnet
 * 
 * Usage: node v2v3flashloanbot_multi.js
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

const v2Router = new ethers.Contract(
  config.UNISWAP.V2_ROUTER_02_ADDRESS,
  require("@uniswap/v2-periphery/build/IUniswapV2Router02.json").abi,
  provider
);

const v3Router = new ethers.Contract(
  config.UNISWAPV3.V3_ROUTER_02_ADDRESS,
  require("@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json").abi,
  provider
);

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
// MULTI-TOKEN CONFIGURATION
// ============================================

// Parse multiple token addresses from .env
const BASE_TOKEN = process.env.ARB_FOR; // WETH (e.g., 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9)

const TOKEN_ADDRESSES = (process.env.ARB_AGAINST_TOKENS || "")
  .split(',')
  .map(addr => addr.trim())
  .filter(addr => addr && addr !== "");

console.log(`\n💰 BASE TOKEN (ARB_FOR): ${BASE_TOKEN}`);
console.log(`📦 TARGET TOKENS (ARB_AGAINST_TOKENS):`);
TOKEN_ADDRESSES.forEach((addr, i) => {
  console.log(`   ${i + 1}. ${addr}`);
});

// ============================================
// CONFIGURATION
// ============================================

const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD) || 0.1;
const MIN_PROFIT_THRESHOLD = ethers.parseEther(process.env.MIN_PROFIT_THRESHOLD || "0.001");
const FLASH_LOAN_FEE = parseFloat(process.env.FLASH_LOAN_FEE) || 0.0009;
const SLIPPAGE_TOLERANCE = 50n;
const V3_FEE_TIER = 3000;

// ============================================
// TELEGRAM BOT SETUP
// ============================================

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
let isRunning = true;
let isExecuting = false;
let successCount = 0;
let tradeHistory = [];
let logHistory = [];
let tokenStats = {}; // Track stats per token

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
  sendMessage(`✅ **Multi-Token V2↔V3 Flashloan Bot STARTED**\n\nMonitoring ${TOKEN_ADDRESSES.length} token pairs`);
});

bot.onText(/\/stop/, (msg) => {
  isRunning = false;
  sendMessage("❌ **Bot STOPPED**");
});

bot.onText(/\/status/, async (msg) => {
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await provider.getBalance(signer.address);
  
  let statsText = `**Multi-Token Bot Status**\n` +
    `State: ${isRunning ? '✅ Running' : '❌ Stopped'}\n` +
    `Total Trades: ${successCount}\n` +
    `ETH Balance: ${ethers.formatEther(balance)}\n\n` +
    `**Per Token Stats:**\n`;
  
  TOKEN_ADDRESSES.forEach((addr, i) => {
    const stat = tokenStats[addr] || { trades: 0, profit: '0' };
    statsText += `${i + 1}. ${addr.substring(0, 8)}...\n   Trades: ${stat.trades}, Profit: ${stat.profit}\n`;
  });
  
  sendMessage(statsText);
});

bot.onText(/\/history/, (msg) => {
  if (tradeHistory.length === 0) {
    sendMessage("No trades recorded yet.");
    return;
  }
  let message = "**Recent Trades (Last 10)**\n\n";
  tradeHistory.slice(-10).reverse().forEach(t => {
    message += `**Trade #${t.id}** | ${t.tokenSymbol}\n` +
      `Profit: ${t.profit}\n` +
      `TX: ${t.txHash.substring(0, 8)}...\n\n`;
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
 * Get V2 price
 */
async function getPriceV2(token0, token1, amountIn) {
  try {
    const path = [token0, token1];
    const amounts = await v2Router.getAmountsOut(amountIn, path);
    return amounts[1];
  } catch (error) {
    return 0n;
  }
}

/**
 * Get V3 price
 */
async function getPriceV3(token0, token1, amountIn) {
  try {
    const path = [token0, token1];
    const v2Amounts = await v2Router.getAmountsOut(amountIn, path);
    return v2Amounts[1];
  } catch (error) {
    return 0n;
  }
}

/**
 * Execute flashloan arbitrage for a specific token
 */
async function executeFlashloanArbitrage(opportunity, signer, token) {
  if (isExecuting) {
    console.log("⏳ Already executing, skipping...");
    return;
  }

  isExecuting = true;

  try {
    const { amountIn, expectedProfit, direction } = opportunity;

    console.log(`\n💸 EXECUTING FLASHLOAN ARBITRAGE - ${token.symbol}`);
    console.log(`   Flashloan Amount: ${ethers.formatEther(amountIn)}`);
    console.log(`   Direction: ${direction}`);
    console.log(`   Expected Profit: ${ethers.formatEther(expectedProfit)}`);

    const startOnV2 = direction === "V2→V3";

    const tx = await arbitrageV3.connect(signer).executeTrade(
      startOnV2,
      token.address,
      BASE_TOKEN,
      V3_FEE_TIER,
      amountIn,
      calculateAmountOutMinimum(amountIn, 50, ethers.parseEther("0"), ethers.parseEther("0")),
      { gasLimit: 1500000 }
    );

    console.log(`   TX Hash: ${tx.hash}`);

    const receipt = await tx.wait();

    successCount++;

    // Update token stats
    if (!tokenStats[token.address]) {
      tokenStats[token.address] = { trades: 0, profit: '0' };
    }
    tokenStats[token.address].trades += 1;
    tokenStats[token.address].profit = expectedProfit.toString();

    sendMessage(
      `🚀 **Flashloan Arbitrage Success!** 🚀\n\n` +
      `Token: ${token.symbol}\n` +
      `Flashloan: ${ethers.formatEther(amountIn)} ${token.symbol}\n` +
      `Strategy: ${direction}\n` +
      `Profit: ${ethers.formatEther(expectedProfit)}\n` +
      `[View TX](https://sepolia.etherscan.io/tx/${receipt.hash})`
    );

    tradeHistory.push({
      id: successCount,
      token: token.address,
      tokenSymbol: token.symbol,
      flashAmount: ethers.formatEther(amountIn),
      profit: `${ethers.formatEther(expectedProfit)}`,
      direction: direction,
      txHash: receipt.hash
    });

    console.log(`\n✅ TRADE #${successCount} COMPLETED (${token.symbol})`);

  } catch (error) {
    console.error(`❌ Flashloan arbitrage failed for ${token.symbol}: ${error.message}`);
  } finally {
    isExecuting = false;
  }
}

// ============================================
// MULTI-TOKEN ARBITRAGE CHECKING
// ============================================

/**
 * Check for arbitrage opportunity on a specific token
 */
async function checkForArbitrage(token, signer) {
  try {
    if (!token) return null;

    const testAmount = ethers.parseEther("0.1");

    // Get prices on both pools
    const priceV2 = await getPriceV2(BASE_TOKEN, token.address, testAmount);
    const priceV3 = await getPriceV3(BASE_TOKEN, token.address, testAmount);

    if (priceV2 === 0n || priceV3 === 0n) {
      return null;
    }

    // Calculate price difference
    const priceRatio = Number(priceV3) / Number(priceV2);
    const priceDifference = Math.abs((priceRatio - 1) * 100);

    console.log(`\n📊 PRICE CHECK - ${token.symbol}`);
    console.log(`   V2 Price: ${ethers.formatEther(priceV2)}`);
    console.log(`   V3 Price: ${ethers.formatEther(priceV3)}`);
    console.log(`   Difference: ${priceDifference.toFixed(4)}%`);

    // Check if difference exceeds threshold
    if (priceDifference < PROFIT_THRESHOLD) {
      console.log(`   ⏭️ Below threshold (${PROFIT_THRESHOLD}%)`);
      return null;
    }

    console.log(`   ✅ ABOVE THRESHOLD! Analyzing...`);

    // Determine direction
    const v2Cheaper = priceV2 < priceV3;
    const direction = v2Cheaper ? "V2→V3" : "V3→V2";

    console.log(`   💡 Strategy: ${direction}`);

    // Scan different flashloan amounts
    let bestOpportunity = null;
    let bestProfit = -Infinity;

    let flashAmount = ethers.parseEther("0.005");
    const maxAmount = ethers.parseEther("0.014");
    const step = ethers.parseEther("0.1");

    while (flashAmount <= maxAmount) {
      try {
        const amountOut1V2 = await getPriceV2(BASE_TOKEN, token.address, flashAmount);
        const amountOut2V3 = await getPriceV3(token.address, BASE_TOKEN, amountOut1V2);

        const gasPrice = (await provider.getFeeData()).gasPrice;
        const profitAnalysis = calculateTrueNetProfit(
          flashAmount,
          amountOut1V2,
          amountOut2V3,
          gasPrice,
          FLASH_LOAN_FEE,
          600000n
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
      console.log(`\n🎯 OPPORTUNITY FOUND FOR ${token.symbol}!`);
      console.log(`   Flashloan: ${ethers.formatEther(bestOpportunity.amountIn)}`);
      console.log(`   Expected Profit: ${ethers.formatEther(bestOpportunity.expectedProfit)}`);
      return { ...bestOpportunity, token };
    }

  } catch (error) {
    console.error(`Error checking arbitrage for token: ${error.message}`);
  }

  return null;
}

/**
 * Check all token pairs sequentially
 */
async function checkAllTokenPairs(signer) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`CHECKING ${TOKEN_ADDRESSES.length} TOKEN PAIRS`);
  console.log(`${"=".repeat(60)}`);

  for (const tokenAddr of TOKEN_ADDRESSES) {
    try {
      const token = await getTokenMetadata(tokenAddr);
      if (!token) continue;

      const opportunity = await checkForArbitrage(token, signer);

      if (opportunity) {
        await executeFlashloanArbitrage(opportunity, signer, token);
        break; // Execute one trade per block
      }
    } catch (error) {
      console.error(`Error checking token ${tokenAddr}: ${error.message}`);
    }

    // Small delay between checks to avoid RPC rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// ============================================
// MAIN LOOP
// ============================================

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`   V2 ↔ V3 MULTI-TOKEN FLASHLOAN ARBITRAGE BOT`);
  console.log(`   Network: Sepolia Testnet`);
  console.log(`   Flash Loan: Balancer`);
  console.log(`${"=".repeat(70)}\n`);

  // Verify we have tokens configured
  if (TOKEN_ADDRESSES.length === 0) {
    console.error("❌ ERROR: No tokens configured in ARB_AGAINST_TOKENS");
    console.error("Set ARB_AGAINST_TOKENS in .env as: 0xtoken1,0xtoken2,0xtoken3");
    process.exit(1);
  }

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`📍 Signer: ${signer.address}`);
  console.log(`🎯 Base Token: ${BASE_TOKEN}`);
  console.log(`📦 Monitoring ${TOKEN_ADDRESSES.length} tokens`);
  console.log(`📊 Profit Threshold: ${PROFIT_THRESHOLD}%`);
  console.log(`💰 Min Profit: ${ethers.formatEther(MIN_PROFIT_THRESHOLD)} ETH\n`);

  sendMessage(`🤖 **Multi-Token V2↔V3 Flashloan Bot Started**\n\nMonitoring ${TOKEN_ADDRESSES.length} token pairs on Sepolia...`);

  // Initialize token stats
  TOKEN_ADDRESSES.forEach(addr => {
    tokenStats[addr] = { trades: 0, profit: '0' };
  });

  // Listen to new blocks
  let checkCount = 0;
  provider.on('block', async (blockNumber) => {
    if (!isRunning || isExecuting) return;

    checkCount++;
    console.log(`\n📦 Block #${blockNumber} - Check #${checkCount}`);

    try {
      await checkAllTokenPairs(signer);
    } catch (error) {
      console.error(`Block handler error: ${error.message}`);
    }
  });

  console.log(`🚀 Bot listening for arbitrage opportunities on ${TOKEN_ADDRESSES.length} tokens...\n`);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
