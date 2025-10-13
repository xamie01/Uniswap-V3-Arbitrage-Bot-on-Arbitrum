/*
  Liquidator bot: monitors Aave users and simulates/executed liquidations via the Liquidator contract.
  - Requires in .env: ETH_SEPOLIA_RPC_URL, PRIVATE_KEY, AAVE_LENDING_POOL_ADDRESSES_PROVIDER, LIQUIDATOR_ADDRESS
  - Optional .env: MONITORED_ADDRESSES (comma list), HEALTH_FACTOR_THRESHOLD (default 1e18 scaled), DRY_RUN=true
*/

require('dotenv').config();
const hre = require('hardhat');
const { ethers } = hre;

const provider = new ethers.providers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const LIQUIDATOR_ADDRESS = process.env.LIQUIDATOR_ADDRESS; // set after deploy
const ADDRESSES_PROVIDER = process.env.AAVE_LENDING_POOL_ADDRESSES_PROVIDER;
const MONITORED_ADDRESSES = (process.env.MONITORED_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean);
const HEALTH_FACTOR_THRESHOLD = process.env.HEALTH_FACTOR_THRESHOLD ? BigInt(process.env.HEALTH_FACTOR_THRESHOLD) : BigInt(1e18); // default 1.0 scaled by 1e18
const DRY_RUN = process.env.DRY_RUN !== 'false'; // default true

async function resolveLendingPool() {
  if (!ADDRESSES_PROVIDER) throw new Error('AAVE_LENDING_POOL_ADDRESSES_PROVIDER missing');
  const artifactPath = '@aave/protocol-v2/artifacts/contracts/interfaces/ILendingPoolAddressesProvider.sol/ILendingPoolAddressesProvider.json';
  const addressesProviderAbi = require(artifactPath).abi;
  const ap = new ethers.Contract(ADDRESSES_PROVIDER, addressesProviderAbi, provider);
  const lp = await ap.getLendingPool();
  return lp;
}

async function resolvePriceOracle(addressesProvider) {
  try {
    const apAbiPath = '@aave/protocol-v2/artifacts/contracts/interfaces/ILendingPoolAddressesProvider.sol/ILendingPoolAddressesProvider.json';
    const apAbi = require(apAbiPath).abi;
    const ap = new ethers.Contract(addressesProvider, apAbi, provider);
    const priceOracleAddr = await ap.getPriceOracle();
    if (!priceOracleAddr || priceOracleAddr === ethers.constants.AddressZero) return null;
    const priceOracleAbiPath = '@aave/protocol-v2/artifacts/contracts/interfaces/IPriceOracleGetter.sol/IPriceOracleGetter.json';
    const priceOracleAbi = require(priceOracleAbiPath).abi;
    const priceOracle = new ethers.Contract(priceOracleAddr, priceOracleAbi, provider);
    return priceOracle;
  } catch (e) {
    console.warn('Price oracle resolution failed:', e.message || e);
    return null;
  }
}

async function ethWeiToTokenAmount(priceOracle, tokenAddress, ethWeiAmount) {
  if (!priceOracle) return null;
  // Aave price oracle returns price with 18 decimals (price of 1 token in ETH with 18 decimals)
  const price = await priceOracle.getAssetPrice(tokenAddress); // BigNumber
  const priceBig = BigInt(price.toString());
  // tokenAmount = ethWeiAmount * 1e18 / price
  const tokenAmount = (BigInt(ethWeiAmount) * BigInt(10 ** 18)) / priceBig;
  return tokenAmount.toString();
}

async function monitorLoop() {
  if (!LIQUIDATOR_ADDRESS) {
    console.error('LIQUIDATOR_ADDRESS not set in .env');
    process.exit(1);
  }

  const liquidatorArtifact = await hre.artifacts.readArtifact('Liquidator');
  const liquidator = new ethers.Contract(LIQUIDATOR_ADDRESS, liquidatorArtifact.abi, wallet);

  const lendingPoolAddr = await resolveLendingPool();
  console.log('Using LendingPool at', lendingPoolAddr);

  const lendingPoolAbiPath = '@aave/protocol-v2/artifacts/contracts/interfaces/ILendingPool.sol/ILendingPool.json';
  const lendingPoolAbi = require(lendingPoolAbiPath).abi;
  const lendingPool = new ethers.Contract(lendingPoolAddr, lendingPoolAbi, provider);

  const priceOracle = await resolvePriceOracle(ADDRESSES_PROVIDER);

  console.log('Monitoring', MONITORED_ADDRESSES.length, 'addresses, threshold:', HEALTH_FACTOR_THRESHOLD.toString());

  for (const addr of MONITORED_ADDRESSES) {
    try {
      const accountData = await lendingPool.getUserAccountData(addr);
      // getUserAccountData returns: totalCollateralETH, totalDebtETH, availableBorrowsETH, currentLiquidationThreshold, ltv, healthFactor
      const healthFactor = BigInt(accountData.healthFactor.toString());
      console.log(`Address ${addr} healthFactor=${healthFactor}`);

      if (healthFactor < HEALTH_FACTOR_THRESHOLD) {
        console.log(' -> Under collateralized candidate:', addr);
        // For simulation we choose repay amount = 50% of totalDebtETH converted to token units is complex; here we read totalDebtETH and propose an arbitrary repay amount
        const totalDebtETH = BigInt(accountData.totalDebtETH.toString());
        // Choose repay amount in wei of the debt token - this is a simplification; off-chain you should map ETH value->token units via price feeds
        const repayAmountEth = totalDebtETH / BigInt(2);

        let repayAmountToken; // string
        if (process.env.TEST_DEBT_TOKEN && priceOracle) {
          repayAmountToken = await ethWeiToTokenAmount(priceOracle, process.env.TEST_DEBT_TOKEN, repayAmountEth);
          console.log('Computed repayAmount in token units:', repayAmountToken);
        }

        const debtToken = process.env.TEST_DEBT_TOKEN || '0x0000000000000000000000000000000000000000';
        const collateralToken = process.env.TEST_COLLATERAL_TOKEN || '0x0000000000000000000000000000000000000000';

        try {
          // callStatic to simulate
          const protocolId = 1; // Aave
          const amountParam = repayAmountToken ? repayAmountToken : repayAmountEth.toString();
          const callResult = await liquidator.callStatic.executeLiquidation(protocolId, addr, debtToken, amountParam, collateralToken, '0x');
          console.log('Simulation success (callStatic returned):', callResult);
        } catch (simErr) {
          console.warn('Simulation failed:', simErr.message || simErr);
        }

        if (!DRY_RUN) {
          try {
            console.log('Sending liquidation tx...');
            const tx = await liquidator.executeLiquidation(1, addr, debtToken, repayAmountToken ? repayAmountToken : repayAmountEth.toString(), collateralToken, '0x');
            const receipt = await tx.wait();
            console.log('Liquidation tx mined:', receipt.transactionHash);
          } catch (execErr) {
            console.error('Execution failed:', execErr.message || execErr);
          }
        }
      }
    } catch (err) {
      console.error('Error querying account', addr, err.message || err);
    }
  }
}

async function main() {
  console.log('Starting Liquidator Monitor');
  await monitorLoop();
  // Optionally run regularly
  setInterval(async () => {
    try { await monitorLoop(); } catch (e) { console.error('monitorLoop error', e); }
  }, Number(process.env.LIQ_MONITOR_INTERVAL_MS || 60_000));
}

main().catch(err => { console.error(err); process.exit(1); });
