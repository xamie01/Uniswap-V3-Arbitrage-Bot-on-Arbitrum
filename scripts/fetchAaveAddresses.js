require('dotenv').config();
const { JsonRpcProvider, Contract } = require('ethers');

async function main() {
  const rpc = process.env.ETH_SEPOLIA_RPC_URL;
  const providerAddr = process.env.AAVE_LENDING_POOL_ADDRESSES_PROVIDER;
  if (!rpc) return console.error('ETH_SEPOLIA_RPC_URL missing in .env');
  if (!providerAddr) return console.error('AAVE_LENDING_POOL_ADDRESSES_PROVIDER missing in .env');

  const provider = new JsonRpcProvider(rpc);

  // Load ABI directly from installed package (no copying to /abi)
  const artifactPath = '@aave/protocol-v2/artifacts/contracts/interfaces/ILendingPoolAddressesProvider.sol/ILendingPoolAddressesProvider.json';
  const addressesProviderAbi = require(artifactPath).abi;
  const ap = new Contract(providerAddr, addressesProviderAbi, provider);

  try {
    const lendingPool = await ap.getLendingPool();
    let priceOracle = 'not available';
    try { priceOracle = await ap.getPriceOracle(); } catch (e) { /* ignore */ }

    console.log('AddressesProvider:', providerAddr);
    console.log(' -> LendingPool:', lendingPool);
    console.log(' -> PriceOracle:', priceOracle);
    // you can fetch other addresses similarly if the provider exposes them
  } catch (err) {
    console.error('error resolving addresses:', err.message || err);
    process.exit(1);
  }
}

main();