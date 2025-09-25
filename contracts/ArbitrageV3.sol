// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IFlashLoanRecipient.sol";
contract ArbitrageV3 is IFlashLoanRecipient {
    IVault public immutable balancerVault;
    ISwapRouter public immutable uRouter; ISwapRouter public immutable sRouter;
    address public immutable owner;
    constructor(address _balancerVault, address _uRouter, address _sRouter) {
        balancerVault = IVault(_balancerVault); uRouter = ISwapRouter(_uRouter); sRouter = ISwapRouter(_sRouter); owner = msg.sender;
    }
    modifier onlyOwner() { require(msg.sender == owner, "Only owner"); _; }
    function executeTrade(bool _startOnUniswap, address _token0, address _token1, uint24 _feeTier, uint256 _flashAmount, uint256 _amountOutMinimum) external onlyOwner {
        bytes memory userData = abi.encode(_startOnUniswap, _token0, _token1, _feeTier, _amountOutMinimum);
        IERC20[] memory tokens = new IERC20[](1); tokens[0] = IERC20(_token0);
        uint256[] memory amounts = new uint256[](1); amounts[0] = _flashAmount;
        balancerVault.flashLoan(address(this), tokens, amounts, userData);
    }
    function receiveFlashLoan(IERC20[] memory tokens, uint256[] memory amounts, uint256[] memory feeAmounts, bytes memory userData) external override {
        require(msg.sender == address(balancerVault), "Unauthorized callback");
        uint256 flashAmount = amounts[0]; uint256 feeAmount = feeAmounts[0]; uint256 amountToRepay = flashAmount + feeAmount;
        (bool startOnUniswap, address token0, address token1, uint24 feeTier, uint256 amountOutMinimum) = abi.decode(userData, (bool, address, address, uint24, uint256));
        uint256 amountReceivedAfterSwaps;
        if (startOnUniswap) {
            uint256 amountAfterFirstSwap = _swap(uRouter, token0, token1, feeTier, flashAmount, amountOutMinimum);
            amountReceivedAfterSwaps = _swap(sRouter, token1, token0, feeTier, amountAfterFirstSwap, amountToRepay);
        } else {
            uint256 amountAfterFirstSwap = _swap(sRouter, token0, token1, feeTier, flashAmount, amountOutMinimum);
            amountReceivedAfterSwaps = _swap(uRouter, token1, token0, feeTier, amountAfterFirstSwap, amountToRepay);
        }
        require(amountReceivedAfterSwaps >= amountToRepay, "Arbitrage not profitable");
        TransferHelper.safeApprove(token0, address(balancerVault), amountToRepay);
        TransferHelper.safeTransfer(token0, address(balancerVault), amountToRepay);
        uint256 profit = amountReceivedAfterSwaps - amountToRepay;
        if (profit > 0) { TransferHelper.safeTransfer(token0, owner, profit); }
    }
    function _swap(ISwapRouter _router, address _tokenIn, address _tokenOut, uint24 _fee, uint256 _amountIn, uint256 _amountOutMinimum) internal returns (uint256 amountOut) {
        TransferHelper.safeApprove(_tokenIn, address(_router), _amountIn);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({ tokenIn: _tokenIn, tokenOut: _tokenOut, fee: _fee, recipient: address(this), deadline: block.timestamp, amountIn: _amountIn, amountOutMinimum: _amountOutMinimum, sqrtPriceLimitX96: 0 });
        amountOut = _router.exactInputSingle(params);
    }
}
