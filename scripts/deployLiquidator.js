const hre = require('hardhat');

async function main() {
  console.log('Deploying Liquidator...');
  const Liquidator = await hre.ethers.getContractFactory('Liquidator');

  // Try to determine Aave lending pool address
  const provider = hre.ethers.provider;
  let aaveLpAddr = process.env.AAVE_LENDING_POOL;

  if (!aaveLpAddr && process.env.AAVE_LENDING_POOL_ADDRESSES_PROVIDER) {
    try {
      const artifactPath = '@aave/protocol-v2/artifacts/contracts/interfaces/ILendingPoolAddressesProvider.sol/ILendingPoolAddressesProvider.json';
      const addressesProviderAbi = require(artifactPath).abi;
      const ap = new hre.ethers.Contract(process.env.AAVE_LENDING_POOL_ADDRESSES_PROVIDER, addressesProviderAbi, provider);
      aaveLpAddr = await ap.getLendingPool();
      console.log('Resolved Aave LendingPool from AddressesProvider:', aaveLpAddr);
    } catch (err) {
      console.warn('Could not resolve LendingPool from AddressesProvider:', err.message || err);
    }
  }

  const AAVE_LENDING_POOL_ADDRESS = aaveLpAddr || '0x0000000000000000000000000000000000000000';

  const liquidator = await Liquidator.deploy(AAVE_LENDING_POOL_ADDRESS);
  await liquidator.waitForDeployment();

  console.log('Liquidator deployed to:', await liquidator.getAddress());
  console.log('\n--');
  console.log('Fill these env vars in .env:');
  console.log('LIQUIDATOR_ADDRESS=' + await liquidator.getAddress());
}

main().catch(err => { console.error(err); process.exit(1); });


// AAVE_LENDING_POOL_ADDRESSES_PROVIDER=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
// LIQUIDATOR_ADDRESS=
// TEST_DEBT_TOKEN =
//  TEST_COLLATERAL_TOKEN =
// DRY_RUN=true
