// scripts/test.js
const { ethers } = require("hardhat");
require("dotenv").config();
const ISwapRouterABI = require('../abi/ISwapRouter.json');
const INonfungiblePositionManagerABI = [ "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint256 liquidity, uint256 amount0, uint256 amount1)" ];
const WETH_ABI = ["function deposit() payable", "function approve(address,uint256) returns (bool)"];

const AMOUNT_TO_DUMP_WETH = ethers.parseEther("5");
const DELAY_BETWEEN_MANIPULATIONS = 5000;

const WETH_ADDRESS = process.env.ARB_FOR.toLowerCase();
const SUSHISWAP_ROUTER_ADDRESS = "0x0e3524b079a1a25ad525a9451878f998a4a17935";
const UNISWAP_POSITION_MANAGER = "0xc36442b4a4522e871399cd717abdd847ab11fe88";
const SUSHISWAP_POSITION_MANAGER = "0x72342366768322622a278a3a17535ba8a6099155";

const tokensToTest = {
    "LINK": { address: process.env.MOCK_LINK_ADDRESS, amountToSeed: ethers.parseEther("250000"), wethToSeed: ethers.parseEther("500") },
    "WBTC": { address: process.env.MOCK_WBTC_ADDRESS, amountToSeed: ethers.parseUnits("50", 8),    wethToSeed: ethers.parseEther("500") },
    "ARB":  { address: process.env.MOCK_ARB_ADDRESS,  amountToSeed: ethers.parseEther("250000"), wethToSeed: ethers.parseEther("500") },
    "UNI":  { address: process.env.MOCK_UNI_ADDRESS,  amountToSeed: ethers.parseEther("50000"),  wethToSeed: ethers.parseEther("500") }
};

async function seedLiquidity(signer, tokenAddress, config) {
    console.log(`\n--- Seeding Liquidity for ${tokenAddress} ---`);
    const dexConfigs = [{ name: "Uniswap", manager: UNISWAP_POSITION_MANAGER }, { name: "Sushiswap", manager: SUSHISWAP_POSITION_MANAGER }];
    for (const dex of dexConfigs) {
        const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
        const tokenContract = await ethers.getContractAt("MockToken", tokenAddress, signer);
        const positionManager = new ethers.Contract(dex.manager, INonfungiblePositionManagerABI, signer);
        await tokenContract.mint(await signer.getAddress(), config.amountToSeed);
        await tokenContract.approve(dex.manager, config.amountToSeed);
        await wethContract.approve(dex.manager, config.wethToSeed);
        const tickLower = -887220; const tickUpper = 887220;
        const [token0, token1] = WETH_ADDRESS < tokenAddress ? [WETH_ADDRESS, tokenAddress] : [tokenAddress, WETH_ADDRESS];
        const params = {
            token0, token1, fee: 3000, tickLower, tickUpper,
            amount0Desired: token0 === WETH_ADDRESS ? config.wethToSeed : config.amountToSeed,
            amount1Desired: token1 === WETH_ADDRESS ? config.wethToSeed : config.amountToSeed,
            amount0Min: 0, amount1Min: 0, recipient: await signer.getAddress(),
            deadline: Math.floor(Date.now() / 1000) + 60 * 10,
        };
        await (await positionManager.mint(params)).wait();
        console.log(`✅ Successfully seeded ${dex.name} pool.`);
    }
}

async function main() {
    console.log("--- Test Runner Started ---");
    const signer = await ethers.provider.getSigner();
    const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
    await ethers.provider.send("hardhat_setBalance", [await signer.getAddress(), ethers.toBeHex(ethers.parseEther("3000"))]);
    await wethContract.deposit({ value: ethers.parseEther("2100") });

    for (const symbol in tokensToTest) {
        const token = tokensToTest[symbol];
        if (!token.address) { console.log(`Skipping ${symbol}: address not found in .env file.`); continue; }
        await seedLiquidity(signer, token.address, token);
    }
    
    console.log("\n--- Starting Market Manipulation Loop ---");
    const sushiRouter = new ethers.Contract(SUSHISWAP_ROUTER_ADDRESS, ISwapRouterABI, signer);
    await wethContract.approve(SUSHISWAP_ROUTER_ADDRESS, ethers.MaxUint256);

    while (true) {
        for (const symbol in tokensToTest) {
            const token = tokensToTest[symbol];
            if (!token.address) continue;
            console.log(`--> Manipulating market for WETH / ${symbol}...`);
            const params = { tokenIn: WETH_ADDRESS, tokenOut: token.address, fee: 3000, recipient: await signer.getAddress(), deadline: Math.floor(Date.now() / 1000) + 60 * 20, amountIn: AMOUNT_TO_DUMP_WETH, amountOutMinimum: 0, sqrtPriceLimitX96: 0 };
            await (await sushiRouter.exactInputSingle(params, { gasLimit: 800000 })).wait();
            console.log(`✅ Swap successful for ${symbol}.\n`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MANIPULATIONS));
        }
    }
}

main().catch(error => { console.error("A fatal error occurred:", error); process.exitCode = 1; });
