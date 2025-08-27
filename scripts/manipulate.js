const hre = require("hardhat");
require("dotenv").config({ quiet: true });
const config = require("../config.json");

// The delay function using a Promise
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const wethAddress = String(process.env.ARB_FOR).trim();
  const usdcAddress = String(process.env.ARB_AGAINST).trim();

  // Address validation
  if (!wethAddress || !hre.ethers.isAddress(wethAddress)) {
    throw new Error(`Invalid WETH address: ${wethAddress}`);
  }
  if (!usdcAddress || !hre.ethers.isAddress(usdcAddress)) {
    throw new Error(`Invalid USDC address: ${usdcAddress}`);
  }

  // Impersonate and fund the whale account for gas fees
  const unlockedAccount = await hre.ethers.getImpersonatedSigner("0xC6962004f452bE9203591991D15f6b388e09E8D0");
  console.log("Funding account with ETH for gas...");
  const ethAmount = hre.ethers.parseEther("10");
  await hre.network.provider.send("hardhat_setBalance", [
    unlockedAccount.address,
    hre.ethers.toBeHex(ethAmount),
  ]);
  const balance = await hre.ethers.provider.getBalance(unlockedAccount.address);
  console.log(`Account balance is now: ${hre.ethers.formatEther(balance)} ETH`);

  const amount = hre.ethers.parseUnits("10", 18);

  // Get contract instances
  const uniswapRouter = await hre.ethers.getContractAt("ISwapRouter", config.UNISWAPV3.V3_ROUTER_02_ADDRESS);
  const weth = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", wethAddress);
  const usdc = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", usdcAddress);

  // Use .target to get the address of the contract instance
  console.log("Approving WETH spend...");
  await weth.connect(unlockedAccount).approve(uniswapRouter.target, amount);

  console.log("Executing swap to manipulate price...");
  // Use .target for weth and usdc contract addresses
  await uniswapRouter.connect(unlockedAccount).exactInputSingle({
    tokenIn: weth.target,
    tokenOut: usdc.target,
    fee: 3000,
    recipient: unlockedAccount.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    amountIn: amount,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  });

  console.log("Price manipulated successfully on Uniswap V3!");
}

/**
 * New function to run the main logic in a loop.
 */
async function runner() {
  // Infinite loop
  while (true) {
    try {
      console.log("-----------------------------------------");
      console.log(`[${new Date().toLocaleTimeString()}] Running script...`);
      await main();
      console.log(`[${new Date().toLocaleTimeString()}] Script finished successfully.`);
    } catch (error) {
      // If any error occurs, log it but don't crash the process
      console.error(`[${new Date().toLocaleTimeString()}] An error occurred:`, error.message);
    }
    
    // Wait for 5 seconds before the next iteration
    console.log("Waiting for 5 seconds...");
    await delay(5000);
  }
}

// Start the runner
runner();
