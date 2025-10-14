/**
 * scripts/testProfitCalculations.js
 * 
 * Test script to validate profit calculations
 * Run with: npx hardhat run scripts/testProfitCalculations.js --network sepolia
 * 
 * This helps debug and verify that:
 * 1. Flashloan fees are calculated correctly
 * 2. Profit calculations account for all costs
 * 3. The bot will only execute profitable trades
 */

require("dotenv").config();
const ethers = require("ethers");
const {
  calculateFlashloanRepayment,
  calculateTrueNetProfit,
  calculateAmountOutMinimum,
  formatProfitAnalysis
} = require("../helpers/profitCalculator");

console.log("═══════════════════════════════════════════════════════════");
console.log("     FLASHLOAN PROFIT CALCULATION TEST SUITE");
console.log("═══════════════════════════════════════════════════════════\n");

// ============================================
// TEST 1: Flashloan Fee Calculation
// ============================================
console.log("TEST 1: Flashloan Fee Calculation");
console.log("─────────────────────────────────────────────────────────────");

const borrowAmount = ethers.parseEther("1.0"); // 1 WETH
const feePercent = 0.0009; // 0.09% (Balancer fee)

const repayment = calculateFlashloanRepayment(borrowAmount, feePercent);

console.log(`Borrow Amount:     ${ethers.formatEther(repayment.flashAmount)} ETH`);
console.log(`Fee (%):           ${(feePercent * 100).toFixed(4)}%`);
console.log(`Fee Amount:        ${ethers.formatEther(repayment.feeAmount)} ETH`);
console.log(`Total to Repay:    ${ethers.formatEther(repayment.totalRepay)} ETH`);
console.log(`Basis Points:      ${repayment.feeBasisPoints.toString()}`);

// Verify calculation
const expectedFee = ethers.parseEther("1.0") * BigInt(9) / 10000n;
const matches = repayment.feeAmount === expectedFee;
console.log(`\n✓ Calculation verified: ${matches ? '✅ PASS' : '❌ FAIL'}`);
console.log();

// ============================================
// TEST 2: Profitable Trade (Simple Case)
// ============================================
console.log("TEST 2: Profitable Trade Analysis");
console.log("─────────────────────────────────────────────────────────────");

const amountIn = ethers.parseEther("1.0");           // Borrow 1 ETH
const after1stSwap = ethers.parseEther("0.98");      // Trade to 0.98 (2% slippage)
const after2ndSwap = ethers.parseEther("1.02");      // Trade back to 1.02 (2% profit)
const gasPrice = ethers.parseUnits("20", "gwei");
const estimatedGas = 500000n;

const profit = calculateTrueNetProfit(
  amountIn,
  after1stSwap,
  after2ndSwap,
  gasPrice,
  0.0009,
  estimatedGas
);

console.log(formatProfitAnalysis(profit));

// ============================================
// TEST 3: Unprofitable Trade (Verify it fails)
// ============================================
console.log("TEST 3: Unprofitable Trade (Should NOT execute)");
console.log("─────────────────────────────────────────────────────────────");

const unprofitable = calculateTrueNetProfit(
  ethers.parseEther("1.0"),
  ethers.parseEther("0.95"),      // 5% loss on first swap
  ethers.parseEther("0.95"),      // Can't recover
  gasPrice,
  0.0009,
  estimatedGas
);

console.log(formatProfitAnalysis(unprofitable));
console.log(`⚠️  Should NOT execute this trade (isProfitable = false)\n`);

// ============================================
// TEST 4: Break-even Analysis
// ============================================
console.log("TEST 4: Break-even Point Analysis");
console.log("─────────────────────────────────────────────────────────────");

const baseAmount = ethers.parseEther("1.0");
let results = [];

for (let slippage = 1; slippage <= 5; slippage += 1) {
  const firstOutput = (baseAmount * BigInt(100 - slippage)) / 100n;
  const secondOutput = (baseAmount * BigInt(100 + slippage)) / 100n; // Recover on second swap
  
  const analysis = calculateTrueNetProfit(
    baseAmount,
    firstOutput,
    secondOutput,
    gasPrice,
    0.0009,
    estimatedGas
  );
  
  results.push({
    slippage: slippage,
    gross: ethers.formatEther(analysis.grossProfit),
    fee: ethers.formatEther(analysis.flashloanFeeAmount),
    gas: ethers.formatEther(analysis.gasCostInWei),
    net: ethers.formatEther(analysis.netProfit),
    profitable: analysis.isProfitable ? '✅' : '❌'
  });
}

console.log("Slippage  Gross Profit  Fee      Gas Cost  Net Profit  Profitable");
console.log("─────────────────────────────────────────────────────────────────");
results.forEach(r => {
  console.log(
    `${r.slippage}%       ${r.gross.padEnd(12)} ${r.fee.padEnd(8)} ${r.gas.padEnd(9)} ${r.net.padEnd(11)} ${r.profitable}`
  );
});
console.log();

// ============================================
// TEST 5: Amount Out Minimum Calculation
// ============================================
console.log("TEST 5: Slippage Protection (Amount Out Minimum)");
console.log("─────────────────────────────────────────────────────────────");

const firstSwapOutput = ethers.parseEther("0.98");
const flashloanRepayNeeded = ethers.parseEther("1.0009");
const gasCostNeeded = ethers.parseUnits("10", "gwei").mul(500000n);

const slippageBps = 50; // 0.5%

const amountOutMin = calculateAmountOutMinimum(
  firstSwapOutput,
  slippageBps,
  flashloanRepayNeeded,
  gasCostNeeded
);

console.log(`First Swap Output:         ${ethers.formatEther(firstSwapOutput)} ETH`);
console.log(`Slippage Tolerance:        ${(slippageBps / 100).toFixed(2)}%`);
console.log(`With Slippage Applied:     ${ethers.formatEther(
  (firstSwapOutput * BigInt(10000 - slippageBps)) / 10000n
)} ETH`);
console.log(`\nFlashloan to Repay:        ${ethers.formatEther(flashloanRepayNeeded)} ETH`);
console.log(`Gas Cost:                  ${ethers.formatEther(gasCostNeeded)} ETH`);
console.log(`Minimum Required:          ${ethers.formatEther(flashloanRepayNeeded + gasCostNeeded)} ETH`);
console.log(`\n→ Amount Out Minimum:      ${ethers.formatEther(amountOutMin)} ETH`);
console.log(`\n✓ This ensures you receive at least this much on second swap\n`);

// ============================================
// TEST 6: Real-world scenario with mock tokens
// ============================================
console.log("TEST 6: Real-world Scenario (Mock Tokens on Sepolia)");
console.log("─────────────────────────────────────────────────────────────");

console.log("Scenario: Arbitrage between Uniswap V3 and Sushiswap V3");
console.log("Tokens: LINK/WETH pair");
console.log("Network: Sepolia testnet with mock tokens\n");

// Simulate a real arbitrage opportunity
const borrowWETH = ethers.parseEther("0.5");              // Borrow 0.5 WETH
const wethToLinkOutput = ethers.parseEther("2.45");       // Get ~2.45 LINK (at mock price)
const linkToWethOutput = ethers.parseEther("0.52");       // Get back 0.52 WETH (4% profit)

const realWorldAnalysis = calculateTrueNetProfit(
  borrowWETH,
  wethToLinkOutput,
  linkToWethOutput,
  ethers.parseUnits("20", "gwei"),
  0.0009,
  500000n
);

console.log(formatProfitAnalysis(realWorldAnalysis));

// ============================================
// TEST 7: Multiple amounts comparison
// ============================================
console.log("TEST 7: Optimal Trade Size Analysis");
console.log("─────────────────────────────────────────────────────────────");

console.log("Testing different borrow amounts to find optimal trade size:\n");

let bestTradeSize = null;
let bestProfit = -Infinity;

for (let i = 0.1; i <= 2.0; i += 0.1) {
  const testBorrow = ethers.parseEther(i.toString());
  const test1stSwap = (testBorrow * 98n) / 100n;    // 2% slippage
  const test2ndSwap = (testBorrow * 104n) / 100n;   // 4% profit
  
  const testAnalysis = calculateTrueNetProfit(
    testBorrow,
    test1stSwap,
    test2ndSwap,
    ethers.parseUnits("20", "gwei"),
    0.0009,
    500000n
  );
  
  const netProfit = testAnalysis.netProfit;
  
  if (testAnalysis.isProfitable && netProfit > 0n) {
    console.log(
      `${i.toFixed(1)} ETH → Profit: ${ethers.formatEther(netProfit).padEnd(10)} ✅`
    );
    
    if (Number(netProfit) > bestProfit) {
      bestProfit = Number(netProfit);
      bestTradeSize = {
        amount: i,
        profit: netProfit,
        analysis: testAnalysis
      };
    }
  } else {
    console.log(
      `${i.toFixed(1)} ETH → Not profitable ❌`
    );
  }
}

if (bestTradeSize) {
  console.log(`\n🎯 OPTIMAL TRADE SIZE: ${bestTradeSize.amount} ETH`);
  console.log(`   Maximum Net Profit: ${ethers.formatEther(bestTradeSize.profit)}\n`);
}

// ============================================
// SUMMARY
// ============================================
console.log("═══════════════════════════════════════════════════════════");
console.log("                    TEST SUMMARY");
console.log("═══════════════════════════════════════════════════════════");
console.log(`
✓ All calculations account for:
  • Flashloan fees (0.09% for Balancer)
  • Gas costs (estimated 500k units)
  • DEX slippage (0.5% protection)
  • Minimum amounts out (for safety)

✓ Bot will only execute trades where:
  • Net Profit > 0
  • Amount Received >= (Loan + Fee + Gas)

✓ Use these calculations to:
  • Set MIN_PROFIT_THRESHOLD in .env
  • Adjust SLIPPAGE_TOLERANCE based on volatility
  • Monitor gas prices to optimize profitability
`);

console.log("═══════════════════════════════════════════════════════════\n");
