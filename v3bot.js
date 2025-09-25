// bot.js
require('./helpers/serverbot.js');
require("dotenv").config();
const ethers = require("ethers");
const config = require('./config.json');
const TelegramBot = require('node-telegram-bot-api');
const { getTokenAndContract, getV3Price, getQuote, findValidPool } = require('./helpers/helpers');

// --- Provider Setup for ARBITRUM SEPOLIA ---
const provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL);

// --- Contract Instances (ensure config.json is updated) ---
const uFactory = new ethers.Contract(config.UNISWAPV3.V3_FACTORY_ADDRESS, require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json").abi, provider);
const sFactory = new ethers.Contract(config.SUSHISWAPV3.V3_FACTORY_ADDRESS, require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json").abi, provider);
const uQuoter = new ethers.Contract(config.UNISWAPV3.QUOTER_V2_ADDRESS, require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi, provider);
const sQuoter = new ethers.Contract(config.SUSHISWAPV3.QUOTER_V2_ADDRESS, require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json").abi, provider);
const arbitrageV3 = new ethers.Contract(config.ARBITRAGE_V3_ADDRESS, require("./artifacts/contracts/ArbitrageV3.sol/ArbitrageV3.json").abi, provider);


// --- CONFIG & STATE VARIABLES ---
const arbForAddress = process.env.ARB_FOR; 
const tokensAgainst = process.env.ARB_AGAINST_TOKENS.split(',');
const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD) || 0.1;
const FLASH_LOAN_FEE = parseFloat(process.env.FLASH_LOAN_FEE) || 0.0009;
const SLIPPAGE_TOLERANCE = 50n; // 0.5%

// --- TELEGRAM BOT SETUP ---
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
let isRunning = true; let isExecuting = false; let successCount = 0;
let tradeHistory = []; let logHistory = [];

// --- LOGGING & TELEGRAM ---
const originalLog = console.log; const originalError = console.error;
const MAX_LOG_HISTORY = 50;
const sendMessage = (text) => { bot.sendMessage(process.env.TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' }); };
console.log = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    logHistory.push(`[LOG] ${new Date().toISOString()}: ${message}`);
    if (logHistory.length > MAX_LOG_HISTORY) logHistory.shift();
    originalLog.apply(console, args);
};
console.error = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    logHistory.push(`[ERROR] ${new Date().toISOString()}: ${message}`);
    if (logHistory.length > MAX_LOG_HISTORY) logHistory.shift();
    sendMessage(`🚨 **CRITICAL ERROR** 🚨\n\n${message}`);
    originalError.apply(console, args);
};
bot.onText(/\/start/, (msg) => { isRunning = true; sendMessage("✅ Bot **STARTED**."); });
bot.onText(/\/stop/, (msg) => { isRunning = false; sendMessage("❌ Bot **STOPPED**."); });
bot.onText(/\/status/, async (msg) => {
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const balance = await provider.getBalance(signer.address);
    sendMessage(`**Status Report**\n*State:* ${isRunning ? '✅ Running' : '❌ Stopped'}\n*Trades:* ${successCount}\n*Balance:* ${ethers.formatEther(balance)} ETH`);
});
bot.onText(/\/history/, (msg) => {
    if (tradeHistory.length === 0) { sendMessage("No successful trades recorded."); return; }
    let message = "**Recent Trade History (Last 5)**\n\n";
    tradeHistory.slice(-5).reverse().forEach(t => { message += `*#${t.id}:* ${t.pair} -> ${t.profit}\n[View Tx](https://sepolia.arbiscan.io/tx/${t.txHash})\n\n`; });
    sendMessage(message);
});
bot.onText(/\/logs/, (msg) => {
    if (logHistory.length === 0) { sendMessage("No logs recorded."); return; }
    sendMessage("```\n--- Recent Logs ---\n" + logHistory.slice(-15).join('\n') + "\n```");
});

// --- CORE LOGIC ---
const checkPair = async (token0Address, token1Address, signer) => {
    const { token0, token1 } = await getTokenAndContract(token0Address, token1Address, provider);
    const uResult = await getV3Price(uFactory, token0.address, token1.address, provider);
    const sResult = await getV3Price(sFactory, token0.address, token1.address, provider);
    if (!uResult || !sResult || uResult.price.eq(0) || sResult.price.eq(0)) return;
    const priceDifference = Math.abs((sResult.price.div(uResult.price).toNumber() * 100) - 100);
    if (priceDifference < PROFIT_THRESHOLD) return;

    console.log(`Price Difference Found! ${token0.symbol}/${token1.symbol} -> ${priceDifference.toFixed(4)}%`);
    const [buyQuoter, sellQuoter, startOnUni] = uResult.price.lt(sResult.price) ? [uQuoter, sQuoter, true] : [sQuoter, uQuoter, false];
    const feeTier = startOnUni ? uResult.fee : sResult.fee;
    
    let bestNetProfit = -Infinity; let bestAmount = 0n; let bestAmountOutFromFirstSwap = 0n;
    let amountIn = ethers.parseEther("0.1"); // Start with a smaller amount for testnet
    const gasPrice = (await provider.getFeeData()).gasPrice;

    for (let i = 0; i < 10; i++) { // Check up to 1 ETH
        const quote1 = await getQuote(buyQuoter, token0.address, token1.address, amountIn, feeTier);
        if (quote1.amountOut === 0n) continue;
        const quote2 = await getQuote(sellQuoter, token1.address, token0.address, quote1.amountOut, feeTier);
        const grossProfit = quote2.amountOut - amountIn;
        if (grossProfit > 0) {
            try {
                const estimatedGas = await arbitrageV3.connect(signer).executeTrade.estimateGas(startOnUni, token0.address, token1.address, feeTier, amountIn, 0);
                const gasCost = estimatedGas * gasPrice;
                const flashLoanFee = (amountIn * BigInt(Math.floor(FLASH_LOAN_FEE * 10000))) / 10000n;
                const netProfit = grossProfit - gasCost - flashLoanFee;
                if (netProfit > bestNetProfit) {
                    bestNetProfit = netProfit; bestAmount = amountIn; bestAmountOutFromFirstSwap = quote1.amountOut;
                }
            } catch (e) {}
        }
        amountIn += ethers.parseEther("0.1");
    }

    if (bestNetProfit > 0) {
        isExecuting = true;
        console.log(`🔥🔥🔥 Arbitrage Opportunity Found! Est. Profit: ${ethers.formatEther(bestNetProfit)} ${token0.symbol} 🔥🔥🔥`);
        const amountOutMinimum = (bestAmountOutFromFirstSwap * (10000n - SLIPPAGE_TOLERANCE)) / 10000n;
        try {
            const tx = await arbitrageV3.connect(signer).executeTrade(startOnUni, token0.address, token1.address, feeTier, bestAmount, amountOutMinimum, { gasLimit: 1500000 });
            const receipt = await tx.wait();
            successCount++;
            const profit = ethers.formatEther(bestNetProfit); const pair = `${token0.symbol}/${token1.symbol}`;
            const liveTradeMessage = `🚀 **Arbitrage Successful!** 🚀\n\n*Pair:* ${pair}\n*Profit:* ${profit} ${token0.symbol}`;
            sendMessage(liveTradeMessage);
            tradeHistory.push({ id: successCount, pair, profit: `${profit} ${token0.symbol}`, txHash: receipt.hash });
        } catch (error) {
            console.error("❌ Arbitrage TX Failed:", error.reason || "Unknown revert");
        } finally {
            isExecuting = false;
        }
    }
};

const main = async () => {
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    sendMessage("🤖 **Arbitrage Bot (Sepolia Testnet)**\nBot has been started. Send /status to check on me.");

    provider.on('block', async (blockNumber) => {
        if (!isRunning || isExecuting) return;
        isExecuting = true;
        try {
            console.log(`\nBlock: #${blockNumber} | Checking ${tokensAgainst.length} pairs...`);
            await Promise.all(tokensAgainst.map(addr => checkPair(arbForAddress, addr.trim(), signer)));
        } catch (error) {
            console.error("Main block handler error:", error);
        } finally {
            isExecuting = false;
        }
    });
};

main().catch(error => { console.error("Fatal startup error:", error); process.exit(1); });
