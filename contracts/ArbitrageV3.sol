// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IFlashLoanRecipient.sol";

contract ArbitrageV3 is IFlashLoanRecipient {
    IVault public immutable balancerVault;
    ISwapRouter public immutable uRouter; // Uniswap V3
    ISwapRouter public immutable sRouter; // Sushiswap V3
    address public immutable owner;
    uint24 public constant feeTier = 3000; // 0.3% fee tier

    constructor(address _balancerVault, address _uRouter, address _sRouter) {
        balancerVault = IVault(_balancerVault);
        uRouter = ISwapRouter(_uRouter);
        sRouter = ISwapRouter(_sRouter);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    function executeTrade(
        bool _startOnUniswap,
        address _token0,
        address _token1,
        uint256 _flashAmount
    ) external onlyOwner {
        bytes memory userData = abi.encode(_startOnUniswap, _token0, _token1, _flashAmount);
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(_token0);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _flashAmount;
        balancerVault.flashLoan(address(this), tokens, amounts, userData);
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == address(balancerVault), "Unauthorized callback");
        uint256 flashAmount = amounts[0];
        uint256 feeAmount = feeAmounts[0];
        (bool startOnUniswap, address token0, address token1, ) = abi.decode(
            userData,
            (bool, address, address, uint256)
        );

        // Perform arbitrage
        address[] memory path = new address[](2);
        path[0] = token0;
        path[1] = token1;

        if (startOnUniswap) {
            _swapOnUniswap(path, flashAmount, 0);
            path[0] = token1;
            path[1] = token0;
            _swapOnSushiswap(path, IERC20(token1).balanceOf(address(this)), flashAmount + feeAmount);
        } else {
            _swapOnSushiswap(path, flashAmount, 0);
            path[0] = token1;
            path[1] = token0;
            _swapOnUniswap(path, IERC20(token1).balanceOf(address(this)), flashAmount + feeAmount);
        }

        // Repay flash loan with fees
        TransferHelper.safeApprove(token0, address(balancerVault), flashAmount + feeAmount);
        TransferHelper.safeTransfer(token0, address(balancerVault), flashAmount + feeAmount);

        // Check profitability and transfer profits
        uint256 finalBalance = IERC20(token0).balanceOf(address(this));
        require(finalBalance >= flashAmount + feeAmount, "Arbitrage not profitable");
        TransferHelper.safeTransfer(token0, owner, finalBalance);
    }

    function _swapOnUniswap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        TransferHelper.safeApprove(_path[0], address(uRouter), _amountIn);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: _path[0],
            tokenOut: _path[1],
            fee: feeTier,
            recipient: address(this),
            deadline: block.timestamp + 15,
            amountIn: _amountIn,
            amountOutMinimum: _amountOut,
            sqrtPriceLimitX96: 0 // Consider adding slippage protection
        });
        uRouter.exactInputSingle(params);
    }

    function _swapOnSushiswap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        TransferHelper.safeApprove(_path[0], address(sRouter), _amountIn);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: _path[0],
            tokenOut: _path[1],
            fee: feeTier,
            recipient: address(this),
            deadline: block.timestamp + 15,
            amountIn: _amountIn,
            amountOutMinimum: _amountOut,
            sqrtPriceLimitX96: 0 // Consider adding slippage protection
        });
        sRouter.exactInputSingle(params);
    }
}
