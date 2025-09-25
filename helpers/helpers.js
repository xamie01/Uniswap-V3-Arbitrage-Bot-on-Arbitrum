const ethers = require("ethers");
const Big = require('big.js');

const IUniswapV3Pool = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const IERC20 = require('@openzeppelin/contracts/build/contracts/ERC20.json');

// All common Uniswap V3 fee tiers
const FEE_TIERS = [500, 3000, 10000];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Gets the metadata for two tokens.
 */
async function getTokenAndContract(_token0Address, _token1Address, _provider) {
    const token0Contract = new ethers.Contract(_token0Address, IERC20.abi, _provider);
    const token1Contract = new ethers.Contract(_token1Address, IERC20.abi, _provider);

    // Use Promise.all for faster metadata fetching
    const [symbol0, name0, decimals0, symbol1, name1, decimals1] = await Promise.all([
        token0Contract.symbol(),
        token0Contract.name(),
        token0Contract.decimals(),
        token1Contract.symbol(),
        token1Contract.name(),
        token1Contract.decimals()
    ]);

    const token0 = { address: _token0Address, decimals: Number(decimals0), symbol: symbol0, name: name0 };
    const token1 = { address: _token1Address, decimals: Number(decimals1), symbol: symbol1, name: name1 };

    return { token0Contract, token1Contract, token0, token1 };
}

/**
 * NEW FUNCTION: Iterates through all fee tiers to find the first valid pool.
 * A more advanced version could check for the pool with the most liquidity.
 * @returns {object} An object containing the pool address and its fee tier, or null if no valid pool is found.
 */
async function findValidPool(_V3Factory, _token0, _token1) {
    for (const fee of FEE_TIERS) {
        const poolAddress = await _V3Factory.getPool(_token0, _token1, fee);
        if (poolAddress !== ZERO_ADDRESS) {
            // Found a valid pool
            return { poolAddress, fee };
        }
    }
    // No valid pool found for any fee tier
    return null;
}

/**
 * MODIFIED: This function is now more robust and fee-aware.
 * It finds the first available pool for a pair and returns its price.
 */
async function getV3Price(_V3Factory, _token0Address, _token1Address, _provider) {
    for (const fee of FEE_TIERS) {
        const poolAddress = await _V3Factory.getPool(_token0Address, _token1Address, fee);
        
        if (poolAddress !== ZERO_ADDRESS) {
            // Found a pool, now check if it has liquidity
            const poolContract = new ethers.Contract(poolAddress, IUniswapV3Pool.abi, _provider);
            const poolLiquidity = await poolContract.liquidity();

            if (poolLiquidity > 0) {
                // This is a valid, liquid pool. Get its price.
                const slot0 = await poolContract.slot0();
                const sqrtPriceX96 = slot0.sqrtPriceX96;
                const price = new Big(sqrtPriceX96.toString()).pow(2).div(new Big(2).pow(192));
                
                // Return the price and the fee of the first liquid pool we find
                return { price, fee };
            }
        }
    }

    // After checking all fee tiers, no liquid pool was found.
    return null;
}
/**
 * Gets a trade quote from a Uniswap V3 Quoter contract.
 */
async function getQuote(_quoterContract, _tokenIn, _tokenOut, _amountIn, _fee) {
    if (!_amountIn || BigInt(_amountIn) <= 0) {
        // Return zero values if amountIn is invalid to prevent contract call errors
        return { amountOut: 0n, sqrtPriceX96After: 0n, tickAfter: 0, gasEstimate: 0n };
    }
    
    const params = {
        tokenIn: _tokenIn,
        tokenOut: _tokenOut,
        fee: _fee,
        amountIn: _amountIn,
        sqrtPriceLimitX96: 0
    };

    try {
        const result = await _quoterContract.quoteExactInputSingle.staticCall(params);
        return {
            amountOut: result.amountOut,
            sqrtPriceX96After: result.sqrtPriceX96After,
            tickAfter: result.tickAfter,
            gasEstimate: result.gasEstimate
        };
    } catch (error) {
        // This can happen if there's no liquidity for the trade. Return zero values.
        console.error(`Error getting quote for amount ${ethers.formatEther(_amountIn)}: No liquidity or other issue.`);
        return { amountOut: 0n, sqrtPriceX96After: 0n, tickAfter: 0, gasEstimate: 0n };
    }
}

// These functions are now deprecated or unused by the new logic.
// getPairAddress is replaced by findValidPool
// getPairContract is no longer needed externally
// entropy and calculateDifference are not used in the main bot.
module.exports = {
    getTokenAndContract,
    getV3Price,
    getQuote,
    findValidPool // Exporting this in case the main bot needs it directly
};
