// -- HANDLE INITIAL SETUP -- //
require('./helpers/serverbot.js');
require("dotenv").config();

const ethers = require("ethers");
const config = require('./config.json');
const QuoterV2 = require("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json");
const { getTokenAndContract, getPairContract, getV3Price, getQuote } = require('./helpers/helpers');
const { provider, uFactory, sFactory, arbitrageV3 } = require('./helpers/initialization');

// -- CONFIG & STATE VARIABLES -- //
const uQuoteAddress = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const sQuoteAddress = '0x0524E833cCD057e4d7A296e3aaAb9f7675964Ce1';

// .ENV VALUES
const arbForAddress = process.env.ARB_FOR;      // Address of token we are arbitraging (e.g., WETH)
const arbAgainstAddress = process.env.ARB_AGAINST; // Address of token we are trading against (e.g., USDC)
const gasLimit = process.env.GAS_LIMIT || 1600000;
const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD) || 0.5; // Minimum profit % to execute

// State trackers
let isExecuting = false;
let attempts = 0;
let success = 0;

/**
 * Calculates the optimal arbitrage trade and returns the details.
 * @param {object} token0 - The primary token object (e.g., WETH).
 * @param {object} token1 - The secondary token object (e.g., USDC).
 * @param {ethers.Contract} uQuoter - The Uniswap V3 Quoter contract instance.
 * @param {ethers.Contract} sQuoter - The Sushiswap V3 Quoter contract instance.
 * @returns {object} An object containing trade details if profitable.
 */
const quoteSwap = async (token0, token1, uQuoter, sQuoter) => {
    let profit, profitable, best = 0, bestAmount = 0, startOnUni;

    // 1. Get fresh prices for the decision
    const uPrice = await getV3Price(uFactory, arbForAddress, arbAgainstAddress, provider);
    const sPrice = await getV3Price(sFactory, arbForAddress, arbAgainstAddress, provider);

    console.log(`Uniswap Price:    ${uPrice} ${token1.symbol}/${token0.symbol}`);
    console.log(`Sushiswap Price:  ${sPrice} ${token1.symbol}/${token0.symbol}`);
    const priceDifference = (sPrice / uPrice * 100) - 100;
    console.log(`Price Difference: ${priceDifference.toFixed(4)}%\n`);

    let buyExchange, sellExchange;

    // 2. CORRECTED LOGIC: Determine the correct trading route by finding the lower price
    if (uPrice < sPrice) {
        // Price is LOWER on Uniswap, so we BUY there and SELL on Sushiswap
        console.log('Strategy: Buy on Uniswap, Sell on Sushiswap');
        buyExchange = uQuoter;
        sellExchange = sQuoter;
        startOnUni = true;
    } else {
        // Price is LOWER on Sushiswap, so we BUY there and SELL on Uniswap
        console.log('Strategy: Buy on Sushiswap, Sell on Uniswap');
        buyExchange = sQuoter;
        sellExchange = uQuoter;
        startOnUni = false;
    }

    // 3. Loop to find the most profitable trade amount
    if (Math.abs(priceDifference) > PROFIT_THRESHOLD) {
        console.log("--- Finding Optimal Trade Amount ---");
        const fee = 3000;
        let amountIn = 100000000000000000n; // Start at 0.1 WETH

        for (let i = 0; i < 20; i++) {
            const quote1 = await getQuote(buyExchange, arbForAddress, arbAgainstAddress, amountIn, fee);
            const quote2 = await getQuote(sellExchange, arbAgainstAddress, arbForAddress, quote1.amountOut, fee);
            profit = quote2.amountOut - amountIn;

            if (profit > best) {
                best = profit;
                bestAmount = amountIn;
                console.log(`New best profit: ${ethers.formatEther(best)} ${token0.symbol} with input: ${ethers.formatEther(bestAmount)} ${token0.symbol}`);
            }
            amountIn += 100000000000000000n; // Increment by 0.1 WETH
        }
        console.log("------------------------------------");
    }

    // 4. Return the result
    if (best > 0) {
        console.log(`\nOptimal arbitrage found! Profit: ${ethers.formatEther(best)} ${token0.symbol} by swapping ${ethers.formatEther(bestAmount)} ${token0.symbol}.`);
        profitable = true;
        return { profitable, bestAmount, startOnUni };
    } else {
        console.log(`\nNo profitable arbitrage opportunity found. Cancelling attempt.`);
        profitable = false;
        return { profitable: false, bestAmount: 0, startOnUni: null };
    }
}

/**
 * Main execution function.
 */
const main = async () => {
    console.log("Arbitrage Bot Starting...");
    console.log(`Monitoring for opportunities between ${arbForAddress} and ${arbAgainstAddress}`);
    console.log(`Profit Threshold set to: ${PROFIT_THRESHOLD}%\n`);

    // -- ONE-TIME SETUP -- //
    const { token0Contract, token1Contract, token0, token1 } = await getTokenAndContract(arbForAddress, arbAgainstAddress, provider);
    const uPair = await getPairContract(uFactory, token0.address, token1.address, provider);
    const sPair = await getPairContract(sFactory, token0.address, token1.address, provider);
    const uQuoter = new ethers.Contract(uQuoteAddress, QuoterV2.abi, provider);
    const sQuoter = new ethers.Contract(sQuoteAddress, QuoterV2.abi, provider);
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    console.log(`Bot Wallet Address: ${signer.address}`);
    console.log(`Uniswap Pair: \t${await uPair.getAddress()}`);
    console.log(`Sushiswap Pair: \t${await sPair.getAddress()}\n`);

    // REFACTORED: Single handler for both Uniswap and Sushiswap swap events
    const handleSwapEvent = async (log) => {
        if (isExecuting) return;

        isExecuting = true;
        attempts += 1;
        console.log(`\n-- Swap Detected! [Attempt #${attempts}] --`);

        const result = await quoteSwap(token0, token1, uQuoter, sQuoter);

        if (result.profitable) {
            console.log("Proceeding with trade execution...");

            const ethBalanceBefore = await provider.getBalance(signer.address);
            const tokenBalanceBefore = await token0Contract.balanceOf(signer.address);

            try {
                const tx = await arbitrageV3.connect(signer).executeTrade(
                    result.startOnUni,
                    token0.address,
                    token1.address,
                    result.bestAmount,
                    { gasLimit: gasLimit }
                );

                const receipt = await tx.wait();
                success += 1;
                console.log("✅ Arbitrage transaction successful! TX Hash:", receipt.hash);

            } catch (error) {
                console.error("❌ Arbitrage transaction failed:", error.reason || error.message);
            }

            const ethBalanceAfter = await provider.getBalance(signer.address);
            const tokenBalanceAfter = await token0Contract.balanceOf(signer.address);
            const ethSpent = ethBalanceBefore - ethBalanceAfter;
            const tokenGained = tokenBalanceAfter - tokenBalanceBefore;

            console.table({
                'ETH Spent (Gas)': ethers.formatEther(ethSpent),
                'WETH Profit': ethers.formatEther(tokenGained)
            });

        }

        isExecuting = false;
        console.log(`-- End of Attempt #${attempts} | Success Rate: ${success}/${attempts} | Waiting for next event... --\n`);
    };

    // Attach the single handler to both listeners
    uPair.on('Swap', handleSwapEvent);
    sPair.on('Swap', handleSwapEvent);

    console.log("Listening for Swap events...");
};

main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
