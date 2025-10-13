// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/*
  Minimal scaffold of a Liquidator contract using Aave flash loans.
  - This is a scaffold with TODO markers where you must supply protocol addresses/ABI details.
  - NOT production ready. Do not deploy to mainnet until reviewed.
*/

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ILendingPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;

    // Aave v2 liquidation call signature
    function liquidationCall(
        address collateral,
        address principal,
        address user,
        uint256 purchaseAmount,
        bool receiveAToken
    ) external;
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract Liquidator {
    address public owner;
    // TODO: set default Aave addresses provider / lending pool via constructor or env
    address public aaveLendingPool;
    address public uniswapRouter; // set via setter

    event FlashLoanRequested(address indexed initiator, address asset, uint256 amount);
    // protocolId identifies which protocol adapter was used (1=Aave,2=Compound,3=Maker)
    event LiquidationAttempt(uint8 indexed protocolId, address indexed borrower, address debtToken, uint256 debtAmount, bool success);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _aaveLendingPool) {
        owner = msg.sender;
        aaveLendingPool = _aaveLendingPool; // TODO: supply Aave lending pool address for target network
    }

    // Admin
    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    function setAaveLendingPool(address _addr) external onlyOwner {
        aaveLendingPool = _addr;
    }

    function setUniswapRouter(address _router) external onlyOwner {
        uniswapRouter = _router;
    }

    // High level entry point for off-chain bot to request a liquidation flashloan.
    // - protocolId: a code that the contract uses to select the protocol adapter (e.g., 1 = Aave, 2 = Compound)
    // - borrower: account to liquidate
    // - debtToken: token to borrow in flashloan and repay debt with
    // - debtAmount: amount to borrow (in wei)
    // - collateralToken: expected seized collateral token (adapter may override)
    // - data: abi-encoded extra params for the adapter
    //
    // TODOs in adapters: implement protocol-specific liquidation calls.
    function executeLiquidation(
        uint8 protocolId,
        address borrower,
        address debtToken,
        uint256 debtAmount,
        address collateralToken,
        bytes calldata data
    ) external onlyOwner {
        require(aaveLendingPool != address(0), "Aave lending pool not set");

        address[] memory assets = new address[](1);
        assets[0] = debtToken;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = debtAmount;
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // 0 = no debt (flash)

        // Pack parameters for executeOperation callback
        bytes memory params = abi.encode(protocolId, borrower, debtToken, debtAmount, collateralToken, data);

        emit FlashLoanRequested(msg.sender, debtToken, debtAmount);
        ILendingPool(aaveLendingPool).flashLoan(address(this), assets, amounts, modes, address(this), params, 0);
    }

    /**
     * Aave flash loan callback
     * NOTE: Aave v2/v3 signatures differ. This scaffold expects a simplified flashLoan callback.
     * You will likely need to adapt to the exact Aave deployment (v2/v3) on your network.
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address /*initiator*/,
        bytes calldata params
    ) external returns (bool) {
        // Validate caller is the configured Aave lending pool
        require(msg.sender == aaveLendingPool, "Caller is not lending pool");

        // decode params
        (uint8 protocolId, address borrower, address debtToken, uint256 debtAmount, address collateralToken, bytes memory data) =
            abi.decode(params, (uint8, address, address, uint256, address, bytes));

        bool ok = false;
        // Adapter dispatch
        if (protocolId == 1) {
            // Aave
            ok = _liquidateOnAave(borrower, debtToken, debtAmount, collateralToken, data);
        } else if (protocolId == 2) {
            // Compound
            ok = _liquidateOnCompound(borrower, debtToken, debtAmount, collateralToken, data);
        } else if (protocolId == 3) {
            // Maker / other
            ok = _liquidateOnMaker(borrower, debtToken, debtAmount, collateralToken, data);
        } else {
            revert("Unsupported protocolId");
        }

        // Repay flash loan + premium
        // Note: this scaffold assumes single asset flashloan
        uint256 amountOwing = amounts[0] + premiums[0];
        IERC20(assets[0]).approve(address(aaveLendingPool), amountOwing);

        emit LiquidationAttempt(protocolId, borrower, debtToken, debtAmount, ok);
        return true;
    }

    // --- Protocol adapters (stubs) ---
    function _liquidateOnAave(address /*borrower*/, address debtToken, uint256 debtAmount, address collateralToken, bytes memory /*data*/) internal returns (bool) {
        // Basic Aave v2 liquidation flow implementation (best-effort for testing)
        // Preconditions: aaveLendingPool and uniswapRouter must be set. Caller must ensure debtToken and collateralToken are valid.
        if (aaveLendingPool == address(0) || uniswapRouter == address(0)) return false;

        // Approve the lending pool to pull the repay amount
        IERC20(debtToken).approve(aaveLendingPool, debtAmount);

        // Call Aave liquidation
        try ILendingPool(aaveLendingPool).liquidationCall(collateralToken, debtToken, address(this), debtAmount, false) {
            // after liquidation, the contract should hold seized collateralToken
        } catch {
            return false;
        }

        // Swap seized collateral -> debtToken on Uniswap V2
        uint256 collateralBalance = IERC20(collateralToken).balanceOf(address(this));
        if (collateralBalance == 0) return false;

        // Approve router
        IERC20(collateralToken).approve(uniswapRouter, collateralBalance);

        address[] memory path = new address[](2);
        path[0] = collateralToken;
        path[1] = debtToken;

        uint256 deadline = block.timestamp + 300;
        try IUniswapV2Router02(uniswapRouter).swapExactTokensForTokens(collateralBalance, 1, path, address(this), deadline) {
            // success
        } catch {
            return false;
        }

        return true;
    }

    function _liquidateOnCompound(address /*borrower*/, address /*debtToken*/, uint256 /*debtAmount*/, address /*collateralToken*/, bytes memory /*data*/) internal pure returns (bool) {
        // TODO: Implement Compound-specific liquidation call (Comptroller/liquidateBorrow)
        return false; // placeholder
    }

    function _liquidateOnMaker(address /*borrower*/, address /*debtToken*/, uint256 /*debtAmount*/, address /*collateralToken*/, bytes memory /*data*/) internal pure returns (bool) {
        // TODO: Implement MakerDAO-specific liquidation flow if desired
        return false; // placeholder
    }

}
