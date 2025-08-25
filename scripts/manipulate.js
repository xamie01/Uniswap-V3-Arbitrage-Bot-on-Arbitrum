const hre = require("hardhat");
require("dotenv").config({ quiet: true });
const config = require("../config.json");

async function main() {
  const wethAddress = String(process.env.ARB_FOR).trim();
  const usdcAddress = String(process.env.ARB_AGAINST).trim();

  // Address validation - no changes needed
  if (!wethAddress || !hre.ethers.isAddress(wethAddress)) {
    throw new Error(`Invalid WETH address: ${wethAddress}`);
  }
  if (!usdcAddress || !hre.ethers.isAddress(usdcAddress)) {
    throw new Error(`Invalid USDC address: ${usdcAddress}`);
  }

  // Impersonate and fund the whale account for gas fees - no changes needed
  const unlockedAccount = await hre.ethers.getImpersonatedSigner("0xC6962004f452bE9203591991D15f6b388e09E8D0");
  console.log("Funding account with ETH for gas...");
  const ethAmount = hre.ethers.parseEther("10");
  await hre.network.provider.send("hardhat_setBalance", [
    unlockedAccount.address,
    hre.ethers.toBeHex(ethAmount),
  ]);
  const balance = await hre.ethers.provider.getBalance(unlockedAccount.address);
  console.log(`Account balance is now: ${hre.ethers.formatEther(balance)} ETH`);

  const amount = hre.ethers.parseUnits("100", 18);

  // Get contract instances - no changes needed
  const uniswapRouter = await hre.ethers.getContractAt("ISwapRouter", config.UNISWAPV3.V3_ROUTER_02_ADDRESS);
  const weth = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", wethAddress);
  const usdc = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", usdcAddress);

  // CORRECTED: Use .target instead of .address for the router address
  console.log("Approving WETH spend...");
  await weth.connect(unlockedAccount).approve(uniswapRouter.target, amount);

  console.log("Executing swap to manipulate price...");
  // CORRECTED: Use .target for weth and usdc contract addresses
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
