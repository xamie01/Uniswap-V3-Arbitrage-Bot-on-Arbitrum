const hre = require("hardhat");
const config = require("../config.json");

async function main() {
  const unlockedAccount = await hre.ethers.getImpersonatedSigner("0xC6962004f452bE9203591991D15f6b388e09E8D0"); // Whale
  const amount = ethers.parseUnits("100", 18); // 100 WETH to manipulate

  const uniswapRouter = await hre.ethers.getContractAt("ISwapRouter", config.UNISWAPV3.V3_ROUTER_02_ADDRESS);
  const weth = await hre.ethers.getContractAt("IERC20", process.env.ARB_FOR);
  const usdc = await hre.ethers.getContractAt("IERC20", process.env.ARB_AGAINST);

  await weth.connect(unlockedAccount).approve(uniswapRouter.address, amount);
  await uniswapRouter.connect(unlockedAccount).exactInputSingle({
    tokenIn: weth.address,
    tokenOut: usdc.address,
    fee: 3000, // 0.3% fee tier
    recipient: unlockedAccount.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
    amountIn: amount,
    amountOutMinimum: 0, // Allow any output for manipulation
    sqrtPriceLimitX96: 0,
  });

  console.log("Price manipulated on Uniswap V3");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
