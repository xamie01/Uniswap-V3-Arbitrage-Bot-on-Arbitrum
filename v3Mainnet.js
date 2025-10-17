// SPDX-License-Identifier: MIT
/**
 * arb_v3v3_multi_arb_bot.js
 * * FINAL ENHANCED VERSION: Arbitrage between Uniswap V3 and Sushiswap V3 
 * for multiple token pairs on Arbitrum, with Multi-RPC Failover.
 */

require('./helpers/serverbot.js'); // Assuming this sets up a heartbeat/server
require("dotenv").config();
const ethers = require("ethers");
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config.json');

// IMPORT FAILOVER MANAGER
const { getProvider } = require("./helpers/rpcManager.js");

// Assuming helper functions are available
const { getTokenAndContract, getV3Price, getQuote } = require('./helpers/helpers'); 
const { 
  calculateTrueNetProfit, 
  calculateAmountOutMinimum 
} = require('./helpers/profitCalculator'); 

// ============================================
// CONFIGURATION & GLOBAL STATE
// ============================================

// Contract instances are initialized later when the provider is active
let uFactory, sFactory, uQuoter, sQuoter, arbitrageV3;

// --- ARBITRAGE PARAMETERS ---
const BASE_TOKEN = process.env.ARB_FOR; // e.g., WETH address on Arbitrum
const TARGET_TOKENS = (process.env.ARB_AGAINST_TOKENS || "")
  .split(',')
  .map(addr => addr.trim())
  .filter(addr => addr && addr !== "");

const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD) || 0.1; // %
const FLASH_LOAN_FEE = parseFloat(process.env.FLASH_LOAN_FEE) || 0.0009;
const SLIPPAGE_TOLERANCE = 50n; // 0.5% in basis points
const MIN_PROFITABLE_TRADE = ethers.parseEther(process.env.MIN_PROFIT_THRESHOLD || "0.001");
const ESTIMATED_GAS_UNITS = 500000n;

// ============================================
// BOT STATE & TELEGRAM SETUP (Unchanged)
// ============================================

let isRunning = true;
let isExecuting = false;
let successCount = 0;
let tradeHistory = [];
let logHistory = [];
const MAX_LOG_HISTORY = 50;

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// --- ENHANCED LOGGING & TELEGRAM MESSAGING ---
const sendMessage = (text) => {
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' })
    .catch(e => console.error('Telegram error:', e.message));
};

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

// ... (Telegram Commands remain the same) ...
bot.onText(/\/start/, (msg) => {
    isRunning = true;
    sendMessage("✅ V3 Arbitrage Bot **STARTED**");
});
// ... (All other commands) ...

// ============================================
// INITIALIZATION AND CONTRACT SETUP
// ============================================

/**
 * Initializes contract instances using the current active provider.
 * This should be called once at startup.
 */
async function initializeContracts(provider) {
    uFactory = new ethers.Contract(
        config.UNISWAPV3.FACTORY_ADDRESS,
        require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json").abi,
        provider
    );
    sFactory = new ethers.Contract(
        config.SUSHISWAPV3.FACTORY_ADDRESS,
        require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json").abi,
        provider
    );
    uQuoter = new ethers.Contract(
        config.UNISWAPV3.QUOTER_V2_ADDRESS,
        require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi,
        provider
    );
    sQuoter = new ethers.Contract(
        config.SUSHISWAPV3.QUOTER_V2_ADDRESS,
        require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi,
        provider
    );
    arbitrageV3 = new ethers.Contract(
        config.PROJECT_SETTINGS.ARBITRAGE_V3_ADDRESS,
        require("./artifacts/contracts/ArbitrageV3.sol/ArbitrageV3.json").abi,
        provider
    );
}

// ============================================
// ARBITRAGE LOGIC (Modified to use current provider)
// ============================================

/**
 * Checks a token pair for an arbitrage opportunity.
 * NOTE: The logic here remains the same, but the contracts use the globally
 * initialized instances which hold the correct provider reference.
 */
async function checkPair(token0Address, token1Address) {
  // --- (Function body remains the same, assuming getTokenAndContract, 
  //      getV3Price, and getQuote use the global contract instances) ---
  try {
    // We must pass the current provider to helpers that need it for raw calls or token metadata
    const provider = await getProvider(); 
    const { token0, token1 } = await getTokenAndContract(token0Address, token1Address, provider);
    
    // 1. Get current prices and fee tiers from both DEXes
    // Contracts are initialized with a provider and will use it
    const uResult = await getV3Price(uFactory, token0.address, token1.address);
    const sResult = await getV3Price(sFactory, token0.address, token1.address);
    
    if (!uResult || !sResult) {
      console.log(`   ⏭️ Skipping ${token0.symbol} - one or both pools not found.`);
      return null;
    }
    
    // 2. Calculate price difference
    const priceRatio = sResult.price / uResult.price;
    const priceDifferencePercent = Math.abs((priceRatio - 1) * 100);
    
    console.log(`\n📊 ${token0.symbol}/${token1.symbol} Price Check`);
    
    if (priceDifferencePercent < PROFIT_THRESHOLD) {
      return null;
    }
    
    // 3. Determine optimal direction
    const startOnUni = uResult.price < sResult.price;
    const [buyQuoter, sellQuoter] = startOnUni ? [uQuoter, sQuoter] : [sQuoter, uQuoter];
    const feeTier = startOnUni ? uResult.fee : sResult.fee;
    
    // 4. Get gas price for cost calculation
    const gasPriceData = await provider.getFeeData();
    const gasPrice = gasPriceData.gasPrice;
    
    // 5. Scan for best profitable flashloan amount
    let bestOpportunity = null;
    let bestNetProfit = 0n;
    
    let testAmount = ethers.parseEther("0.1");
    const maxAmount = ethers.parseEther("2.0");
    const step = ethers.parseEther("0.1"); 

    while (testAmount <= maxAmount) {
      try {
        // First swap (Flashloan Token0 -> Token1)
        const quote1 = await getQuote(buyQuoter, token0.address, token1.address, testAmount, feeTier);
        if (quote1.amountOut === 0n) { break; }
        
        // Second swap (Token1 -> Token0 for repayment)
        const quote2 = await getQuote(sellQuoter, token1.address, token0.address, quote1.amountOut, feeTier);
        if (quote2.amountOut === 0n) { break; }
        
        // Calculate true net profit
        const profitAnalysis = calculateTrueNetProfit(
          testAmount, 
          quote1.amountOut, 
          quote2.amountOut, 
          gasPrice,
          FLASH_LOAN_FEE,
          ESTIMATED_GAS_UNITS
        );
        
        if (profitAnalysis.isProfitable && profitAnalysis.netProfit > bestNetProfit) {
          bestNetProfit = profitAnalysis.netProfit;
          bestOpportunity = {
            amountIn: testAmount,
            amountFromFirstSwap: quote1.amountOut,
            amountFromSecondSwap: quote2.amountOut,
            profitAnalysis: profitAnalysis,
            startOnUni: startOnUni,
            feeTier: feeTier,
            token0: token0,
            token1: token1
          };
        }
      } catch (e) {
        // Ignore specific amount errors and continue
      }
      
      testAmount = testAmount + step;
    }
    
    if (bestOpportunity) {
      console.log(`\n🎯 BEST OPPORTUNITY SELECTED: ${ethers.formatEther(bestOpportunity.profitAnalysis.netProfit)}`);
      return bestOpportunity;
    }
    
  } catch (error) {
    console.error(`Error analyzing pair: ${token0Address.substring(0, 6)}...: ${error.message}`);
  }
  
  return null;
}

// ============================================
// EXECUTION LOGIC (Modified to get Signer on demand)
// ============================================

async function executeTrade(opportunity) {
  if (isExecuting) {
    console.log("⏳ Already executing a trade, skipping...");
    return;
  }
  
  isExecuting = true;
  
  try {
    // Retrieve the active provider and create a Signer using it
    const provider = await getProvider();
    const activeSigner = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    console.log(`\n💸 Executing arbitrage trade...`);
    
    // Calculate minimum amount out
    const amountOutMinimum = calculateAmountOutMinimum(
      opportunity.amountFromSecondSwap, 
      Number(SLIPPAGE_TOLERANCE),
      opportunity.profitAnalysis.totalRepayRequired,
      opportunity.profitAnalysis.gasCostInWei
    );
    
    // Execute the trade using the active signer connected to the current RPC
    const tx = await arbitrageV3.connect(activeSigner).executeTrade(
      opportunity.startOnUni, 
      opportunity.token0.address,
      opportunity.token1.address,
      opportunity.feeTier,
      opportunity.amountIn, 
      amountOutMinimum,
      { gasLimit: 1500000 } 
    );
    
    // ... (rest of execution and logging remains the same) ...
    console.log(`   TX Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    
    successCount++;
    const profit = opportunity.profitAnalysis.breakdown.netProfit;
    const pair = `${opportunity.token0.symbol}/${opportunity.token1.symbol}`;
    
    console.log(`\n✅ TRADE SUCCESSFUL!`);
    
    sendMessage(
      `🚀 **Arbitrage Success!** 🚀\n\n` +
      `Pair: ${pair}\n` +
      `Profit: **${profit} ${opportunity.token0.symbol}**\n` +
      `[View TX](https://arbiscan.io/tx/${receipt.hash})` // Changed explorer link for Arbitrum
    );
    
    tradeHistory.push({
      id: successCount,
      pair: pair,
      profit: `${profit} ${opportunity.token0.symbol}`,
      txHash: receipt.hash
    });
    
  } catch (error) {
    console.error(`❌ Trade execution failed: ${error.reason || error.message}`);
    sendMessage(`❌ **Trade Failed**\n\nReason: ${error.reason || error.message.substring(0, 100)}...`);
  } finally {
    isExecuting = false;
  }
}

// ============================================
// MAIN LOOP (Modified to use RPC Failover)
// ============================================

async function main() {
    if (TARGET_TOKENS.length === 0) {
        console.error("❌ ERROR: No tokens configured in ARB_AGAINST_TOKENS in .env");
        process.exit(1);
    }

    // 1. Initial RPC Check and Contract Initialization
    const initialProvider = await getProvider();
    await initializeContracts(initialProvider);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`   V3 ↔ V3 MULTI-TOKEN FLASHLOAN ARBITRAGE BOT`);
    console.log(`   Network: Arbitrum Mainnet (Multi-RPC)`);
    console.log(`${"=".repeat(70)}\n`);
    
    sendMessage(`🤖 **Bot Starting**\nMonitoring ${TARGET_TOKENS.length} token pairs on Arbitrum...`);

    // 2. Listen to new blocks via a reliable polling interval (instead of provider.on('block'))
    // Using polling is safer with failover to ensure connection stability.
    let currentBlockNumber = 0;
    const POLLING_INTERVAL_MS = 3000; // Check every 3 seconds (approx 1 Arbitrum block)

    setInterval(async () => {
        if (!isRunning || isExecuting) return;
        
        try {
            const provider = await getProvider(); // Get current active/failover provider
            const latestBlock = await provider.getBlockNumber();

            if (latestBlock > currentBlockNumber) {
                currentBlockNumber = latestBlock;
                console.log(`\n${"=".repeat(50)}`);
                console.log(`📦 Block ${latestBlock} - Scanning ${TARGET_TOKENS.length} pairs...`);

                // Iterate over all token pairs
                for (const tokenAddr of TARGET_TOKENS) {
                    const opportunity = await checkPair(BASE_TOKEN, tokenAddr.trim());
                    
                    if (opportunity) {
                        await executeTrade(opportunity);
                        break; // Execute only one profitable trade per block
                    }

                    // Small delay to help with sequential processing
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        } catch (error) {
            console.error(`Main loop error: ${error.message}`);
            // The next loop iteration will call getProvider() and attempt to failover
        }
    }, POLLING_INTERVAL_MS);


    console.log(`🚀 Bot listening for block events...`);
}

main().catch(error => {
    console.error("Fatal error during main execution:", error);
    process.exit(1);
});
