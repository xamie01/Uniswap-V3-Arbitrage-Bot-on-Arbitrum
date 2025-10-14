/**
 * scripts/v3manipulate_multi.js
 * 
 * Creates price differences for MULTIPLE tokens
 * Runs buy/sell for each token in sequence
 */

require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
const UNISWAP_V3_ROUTER = "0xb41b78Ce3D1BDEDE48A3d303eD2564F6d1F6fff0";

const BASE_TOKEN = process.env.ARB_FOR;
const TOKEN_ADDRESSES = process.env.ARB_AGAINST_TOKENS
  .split(',')
  .map(addr => addr.trim());

const SWAP_AMOUNT = ethers.parseEther("0.5");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

const V2_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

const V3_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)"
];

async function manipulateToken(signer, tokenAddress, index) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TOKEN ${index} MANIPULATION`);
  console.log(`${"=".repeat(60)}\n`);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const symbol = await token.symbol();
  const v2Router = new ethers.Contract(UNISWAP_V2_ROUTER, V2_ROUTER_ABI, signer);
  const v3Router = new ethers.Contract(UNISWAP_V3_ROUTER, V3_ROUTER_ABI, signer);

  // Get initial prices
  const initialV2 = await v2Router.getAmountsOut(ethers.parseEther("1"), [BASE_TOKEN, tokenAddress]);
  const initialPrice = ethers.formatEther(initialV2[1]);

  console.log(`📊 Initial Price (V2): 1 WETH = ${initialPrice} ${symbol}`);

  // Step 1: Buy on V2
  console.log(`\n💰 STEP 1: Buy on V2`);
  console.log(`   Selling: ${ethers.formatEther(SWAP_AMOUNT)} WETH`);

  const baseToken = new ethers.Contract(BASE_TOKEN, ERC20_ABI, signer);
  await baseToken.approve(UNISWAP_V2_ROUTER, SWAP_AMOUNT);
  
  const swapTx1 = await v2Router.swapExactTokensForTokens(
    SWAP_AMOUNT,
    0,
    [BASE_TOKEN, tokenAddress],
    signer.address,
    Math.floor(Date.now() / 1000) + 1200,
    { gasLimit: 500000 }
  );
  await swapTx1.wait();

  const tokenBalance = await token.balanceOf(signer.address);
  console.log(`   ✅ Bought: ${ethers.formatEther(tokenBalance)} ${symbol}`);

  // Step 2: Sell on V3
  console.log(`\n📈 STEP 2: Sell on V3`);
  console.log(`   Selling: ${ethers.formatEther(tokenBalance)} ${symbol}`);

  await token.approve(UNISWAP_V3_ROUTER, tokenBalance);

  const swapTx2 = await v3Router.exactInputSingle({
    tokenIn: tokenAddress,
    tokenOut: BASE_TOKEN,
    fee: 3000,
    recipient: signer.address,
    deadline: Math.floor(Date.now() / 1000) + 1200,
    amountIn: tokenBalance,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  }, { gasLimit: 500000 });
  
  await swapTx2.wait();

  console.log(`   ✅ Sold on V3`);

  // Get new prices
  const newV2 = await v2Router.getAmountsOut(ethers.parseEther("1"), [BASE_TOKEN, tokenAddress]);
  const newPrice = ethers.formatEther(newV2[1]);
  const priceChange = (
    ((Number(initialPrice) - Number(newPrice)) / Number(initialPrice)) * 100
  ).toFixed(2);

  console.log(`\n📊 Final Price (V2): 1 WETH = ${newPrice} ${symbol}`);
  console.log(`📊 Price Change: ${priceChange}% (dropped - more profitable)\n`);

  return { symbol, priceChange };
}

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  MULTI-TOKEN PRICE MANIPULATION`);
  console.log(`  Tokens: ${TOKEN_ADDRESSES.length}`);
  console.log(`${"=".repeat(60)}\n`);

  const [signer] = await ethers.getSigners();
  console.log(`📍 Signer: ${signer.address}\n`);

  const results = [];

  // Manipulate each token
  for (let i = 0; i < TOKEN_ADDRESSES.length; i++) {
    try {
      const result = await manipulateToken(signer, TOKEN_ADDRESSES[i], i + 1);
      results.push(result);
      
      // Wait between manipulations
      if (i < TOKEN_ADDRESSES.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`Error manipulating token ${i + 1}: ${error.message}`);
    }
  }
