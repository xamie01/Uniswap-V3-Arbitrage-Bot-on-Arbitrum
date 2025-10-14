// v3bot.js - UPDATED VERSION with correct flashloan calculations
require('./helpers/serverbot.js');
require("dotenv").config();
const ethers = require("ethers");
const config = require('./config.json');
const TelegramBot = require('node-telegram-bot-api');
const { getTokenAndContract, getV3Price, getQuote, findValidPool } = require('./helpers/helpers');
const { 
  calculateFlashloanRepayment, 
  calculateTrueNetProfit, 
  calculateAmountOutMinimum 
} = require('./helpers/profitCalculator'); // NEW: Import profit helpers

// --- PROVIDER SETUP ---
const provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL);

// --- CONTRACT INSTANCES ---
const uFactory = new ethers.Contract(
  config.UNISWAPV3.FACTORY_ADDRESS,
  require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json").abi,
  provider
);

const sFactory = new ethers.Contract(
  config.SUSHISWAPV3.FACTORY_ADDRESS,
  require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json").abi,
  provider
);

const uQuoter = new ethers.Contract(
  config.UNISWAPV3.QUOTER_V2_ADDRESS,
  require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi,
  provider
);

const sQuoter = new ethers.Contract(
  config.SUSHISWAPV3.QUOTER_V2_ADDRESS,
  require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi,
  provider
);

const arbitrageV3 = new ethers.Contract(
  config.PROJECT_SETTINGS.ARBITRAGE_V3_ADDRESS,
  require("./artifacts/contracts/ArbitrageV3.sol/ArbitrageV3.json").abi,
  provider
);

// --- CONFIG ---
const arbForAddress = process.env.ARB_FOR;
const tokensAgainst = process.env.ARB_AGAINST_TOKENS.split(',').map(t => t.trim());
const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD) || 0.1;
const FLASH_LOAN_FEE = parseFloat(process.env.FLASH_LOAN_FEE) || 0.0009;
const SLIPPAGE_TOLERANCE = 50n; // 0.5% in basis points
const MIN_PROFITABLE_TRADE = ethers.parseEther(process.env.MIN_PROFIT_THRESHOLD || "0.001");

// --- TELEGRAM BOT ---
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
let isRunning = true;
let isExecuting = false;
let successCount = 0;
let tradeHistory = [];
let logHistory = [];

// --- ENHANCED LOGGING ---
const originalLog = console.log;
const originalError = console.error;
const MAX_LOG_HISTORY = 50;

const sendMessage = (text) => {
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' })
    .catch(e => console.error('Telegram error:', e.message));
};

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

// --- TELEGRAM COMMANDS ---
bot.onText(/\/start/, (msg) => {
  isRunning = true;
  sendMessage("✅ Bot **STARTED**");
});

bot.onText(/\/stop/, (msg) => {
  isRunning = false;
  sendMessage("❌ Bot **STOPPED**");
});

bot.onText(/\/status/, async (msg) => {
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await provider.getBalance(signer.address);
  sendMessage(
    `**Status Report**\n` +
    `State: ${isRunning ? '✅ Running' : '❌ Stopped'}\n` +
    `Trades: ${successCount}\n` +
    `Balance: ${ethers.formatEther(balance)} ETH`
  );
});

bot.onText(/\/history/, (msg) => {
  if (tradeHistory.length === 0) {
    sendMessage("No successful trades recorded.");
    return;
  }
  let message = "**Recent Trade History (Last 5)**\n\n";
  tradeHistory.slice(-5).reverse().forEach(t => {
    message += `**#${t.id}:** ${t.pair}\n` +
      `Profit: ${t.profit}\n` +
      `[View Tx](https://sepolia.etherscan.io/tx/${t.txHash})\n\n`;
  });
  sendMessage(message);
});

bot.onText(/\/logs/, (msg) => {
  if (logHistory.length === 0) {
    sendMessage("No logs recorded.");
    return;
  }
  sendMessage("```\n" + logHistory.slice(-15).join('\n') + "\n```");
});

// ============================================
// UPDATED checkPair - With Correct Calculations
// ============================================

async function checkPair(token0Address, token1Address, signer) {
  try {
    const { token0, token1 } = await getTokenAndContract(token0Address, token1Address, provider);
    
    // Get prices from both DEXes
    const uResult = await getV3Price(uFactory, token0.address, token1.address, provider);
    const sResult = await getV3Price(sFactory, token0.address, token1.address, provider);
    
    if (!uResult || !sResult) {
      return null;
    }
    
    // Calculate price difference
    const priceRatio = sResult.price / uResult.price;
    const priceDifferencePercent = Math.abs((priceRatio - 1) * 100);
    
    // Skip if below threshold
    if (priceDifferencePercent < PROFIT_THRESHOLD) {
      return null;
    }
    
    console.log(`\n📊 ${token0.symbol}/${token1.symbol} - Difference: ${priceDifferencePercent.toFixed(4)}%`);
    
    // Determine direction
    const startOnUni = uResult.price < sResult.price;
    const [buyQuoter, sellQuoter] = startOnUni ? [uQuoter, sQuoter] : [sQuoter, uQuoter];
    const feeTier = startOnUni ? uResult.fee : sResult.fee;
    
    // Get gas price
    const gasPriceData = await provider.getFeeData();
    const gasPrice = gasPriceData.gasPrice;
    
    // Scan for best profitable amount
    let bestOpportunity = null;
    let testAmount = ethers.parseEther("0.1");
    const maxAmount = ethers.parseEther("2.0");
    const step = ethers.parseEther("0.1");
    
    while (testAmount <= maxAmount) {
      // Get quote for first swap
      const quote1 = await getQuote(buyQuoter, token0.address, token1.address, testAmount, feeTier);
      if (quote1.amountOut === 0n) {
        testAmount += step;
        continue;
      }
      
      // Get quote for second swap
      const quote2 = await getQuote(sellQuoter, token1.address, token0.address, quote1.amountOut, feeTier);
      if (quote2.amountOut === 0n) {
        testAmount += step;
        continue;
      }
      
      // Estimate gas (typical for V3 dual swaps with flashloan)
      const estimatedGasUnits = 500000n;
      
      // CORRECTED: Calculate true net profit with all costs
      const profitAnalysis = calculateTrueNetProfit(
        testAmount,
        quote1.amountOut,
        quote2.amountOut,
        gasPrice,
        FLASH_LOAN_FEE,
        estimatedGasUnits
      );
      
      // Check if profitable and meets minimum threshold
      if (profitAnalysis.isProfitable && profitAnalysis.netProfit >= MIN_PROFITABLE_TRADE) {
        console.log(`   ✅ ${ethers.formatEther(testAmount)} → Profit: ${profitAnalysis.breakdown.profit}`);
        
        if (!bestOpportunity || profitAnalysis.netProfit > bestOpportunity.profitAnalysis.netProfit) {
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
      }
      
      testAmount += step;
    }
    
    if (bestOpportunity) {
      console.log(`\n🚀 BEST OPPORTUNITY FOUND:`);
      console.log(`   Profit: ${bestOpportunity.profitAnalysis.breakdown.profit} ${bestOpportunity.token0.symbol}`);
      console.log(`   Direction: ${bestOpportunity.startOnUni ? 'Uniswap → Sushiswap' : 'Sushiswap → Uniswap'}`);
      return bestOpportunity;
    }
    
  } catch (error) {
    console.error(`Error analyzing pair: ${error.message}`);
  }
  
  return null;
}

// ============================================
// EXECUTE TRADE
// ============================================

async function executeTrade(opportunity, signer) {
  if (isExecuting) {
    console.log("⏳ Already executing a trade, skipping...");
    return;
  }
  
  isExecuting = true;
  
  try {
    console.log(`\n💸 Executing arbitrage trade...`);
    console.log(`   Pair: ${opportunity.token0.symbol}/${opportunity.token1.symbol}`);
    console.log(`   Amount: ${ethers.formatEther(opportunity.amountIn)} ${opportunity.token0.symbol}`);
    
    // Calculate minimum amount out with proper slippage protection
    const amountOutMinimum = calculateAmountOutMinimum(
      opportunity.amountFromFirstSwap,
      Number(SLIPPAGE_TOLERANCE),
      opportunity.profitAnalysis.totalRepayRequired,
      opportunity.profitAnalysis.gasCostInWei
    );
    
    console.log(`   Min output: ${ethers.formatEther(amountOutMinimum)} ${opportunity.token0.symbol}`);
    
    // Execute the trade
    const tx = await arbitrageV3.connect(signer).executeTrade(
      opportunity.startOnUni,
      opportunity.token0.address,
      opportunity.token1.address,
      opportunity.feeTier,
      opportunity.amountIn,
      amountOutMinimum,
      { gasLimit: 1500000 }
    );
    
    console.log(`   TX Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    
    successCount++;
    const profit = opportunity.profitAnalysis.breakdown.profit;
    const pair = `${opportunity.token0.symbol}/${opportunity.token1.symbol}`;
    
    console.log(`\n✅ TRADE SUCCESSFUL!`);
    console.log(`   Profit: ${profit} ${opportunity.token0.symbol}`);
    
    sendMessage(
      `🚀 **Arbitrage Success!** 🚀\n\n` +
      `Pair: ${pair}\n` +
      `Profit: ${profit} ${opportunity.token0.symbol}\n` +
      `[View on Explorer](https://sepolia.etherscan.io/tx/${receipt.hash})`
    );
    
    tradeHistory.push({
      id: successCount,
      pair: pair,
      profit: `${profit} ${opportunity.token0.symbol}`,
      txHash: receipt.hash
    });
    
  } catch (error) {
    console.error(`❌ Trade execution failed: ${error.message}`);
    sendMessage(`❌ **Trade Failed**\n\n${error.reason || error.message}`);
  } finally {
    isExecuting = false;
  }
}

// ============================================
// MAIN LOOP
// ============================================

async function main() {
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`🤖 Bot started for address: ${signer.address}`);
  sendMessage(`🤖 **Arbitrage Bot Started**\nAddress: ${signer.address}`);
  
  // Listen to new blocks
  provider.on('block', async (blockNumber) => {
    if (!isRunning || isExecuting) return;
    
    try {
      console.log(`\n📦 Block ${blockNumber} - Scanning ${tokensAgainst.length} pairs...`);
      
      // Check each token pair sequentially to avoid race conditions
      for (const tokenAddr of tokensAgainst) {
        const opportunity = await checkPair(arbForAddress, tokenAddr.trim(), signer);
        if (opportunity) {
          await executeTrade(opportunity, signer);
          break; // Execute one trade per block
        }
      }
    } catch (error) {
      console.error(`Block handler error: ${error.message}`);
    }
  });
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
