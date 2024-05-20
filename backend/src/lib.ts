import IUniswapV3FactoryABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json'
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { FeeAmount, Pool, Route, SwapOptions, SwapQuoter, SwapRouter, Trade } from "@uniswap/v3-sdk";
import { Wallet, ethers, utils } from 'ethers'
import JSBI from 'jsbi';
import { defaultAbiCoder } from 'ethers/lib/utils';

const POOL_FACTORY_ADDRESS = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const QUOTER_ADDRESS = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const SWAP_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

export interface PoolInfo {
    token0: string
    token1: string
    fee: number
    tickSpacing: number
    sqrtPriceX96: bigint
    liquidity: bigint
    tick: number
}

export type TokenTrade = Trade<Token, Token, TradeType>
export interface TradeInfo {
    pool: PoolInfo
    tokenIn: Token,
    tokenOut: Token,
    amount: number,
    trade: TokenTrade
}

export enum TransactionState {
    Failed = 'Failed',
    New = 'New',
    Rejected = 'Rejected',
    Sending = 'Sending',
    Sent = 'Sent',
}

export const ERC20_ABI = [
    // Read-Only Functions
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function allowance(address owner, address spender) view returns (uint256)',

    // Authenticated Functions
    'function transfer(address to, uint amount) returns (bool)',
    'function approve(address _spender, uint256 _value) returns (bool)',

    // Events
    'event Transfer(address indexed from, address indexed to, uint amount)',
]

export function fromReadableAmount(
    amount: number,
    decimals: number
): ethers.BigNumber {
    return ethers.utils.parseUnits(amount.toString(), decimals)
}

export function displayTrade(trade: Trade<Token, Token, TradeType>): string {
    return `${trade.inputAmount.toExact()} ${trade.inputAmount.currency.symbol
        } for ${trade.outputAmount.toExact()} ${trade.outputAmount.currency.symbol}`
}

export async function sendTransaction(
    wallet: ethers.Wallet,
    transaction: ethers.providers.TransactionRequest,
    noWait?: boolean
): Promise<TransactionState> {
    console.log('send transaction for ...', wallet.address);
    const provider = wallet.provider;
    if (!provider) {
        console.error('null provider');
        return TransactionState.Failed;
    }

    if (transaction.value) {
        transaction.value = ethers.BigNumber.from(transaction.value)
    }

    // TODO: optimize gas price according to configuration. 
    const fee = await provider!.getFeeData();
    transaction.maxFeePerGas = fee.maxFeePerGas!.mul(2);
    transaction.maxPriorityFeePerGas = fee.maxPriorityFeePerGas!.mul(2);

    const txRes = await wallet.sendTransaction(transaction);
    let receipt = null;

    while (!noWait && receipt === null) {
        try {
            receipt = await provider.getTransactionReceipt(txRes.hash)

            if (receipt === null) {
                continue
            }
        } catch (e) {
            console.log(`Receipt error:`, e)
            break
        }
    }

    // Transaction was successful if status === 1 or won wait for result.
    if (receipt || noWait) {
        return TransactionState.Sent
    } else {
        return TransactionState.Failed
    }
}

export async function getPoolInfo(provider: ethers.providers.Provider, tokenIn: Token, tokenOut: Token): Promise<PoolInfo> {
    //// computePoolAddress
    // const currentPoolAddress = computePoolAddress({
    //   factoryAddress: this._poolFactoryAddress,
    //   tokenA: tokenIn,
    //   tokenB: tokenOut,
    //   fee: FeeAmount.MEDIUM,
    // })
    // console.debug(`currentPoolAddress ${currentPoolAddress}`);

    /// fetch pool address from factory contract
    const factoryContract = new ethers.Contract(
        POOL_FACTORY_ADDRESS,
        IUniswapV3FactoryABI.abi,
        provider
    );

    var currentPoolAddress: string;

    currentPoolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, FeeAmount.LOWEST);
    if (currentPoolAddress == '0x0000000000000000000000000000000000000000') currentPoolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, FeeAmount.LOW);
    if (currentPoolAddress == '0x0000000000000000000000000000000000000000') currentPoolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, FeeAmount.MEDIUM);
    if (currentPoolAddress == '0x0000000000000000000000000000000000000000') currentPoolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, FeeAmount.HIGH);

    if (currentPoolAddress == '0x0000000000000000000000000000000000000000') {
        throw new Error('Pool not founded!');
    }
    console.debug(`currentPoolAddress ${currentPoolAddress}`);

    const poolContract = new ethers.Contract(
        currentPoolAddress,
        IUniswapV3PoolABI.abi,
        provider
    )

    const [token0, token1, fee, tickSpacing, liquidity, slot0] =
        await Promise.all([
            poolContract.token0(),
            poolContract.token1(),
            poolContract.fee(),
            poolContract.tickSpacing(), // todo: research
            poolContract.liquidity(),
            poolContract.slot0(), // todo: research
        ])

    return {
        token0,
        token1,
        fee: Number(fee),
        tickSpacing,
        liquidity,
        sqrtPriceX96: slot0[0],
        tick: Number(slot0[1]),
    }
}

export async function createTrade(provider: ethers.providers.Provider, tokenIn: Token, tokenOut: Token, amountIn: number): Promise<TradeInfo> {
    const poolInfo = await getPoolInfo(provider, tokenIn, tokenOut);
    // console.log(poolInfo);

    const pool = new Pool(
        tokenIn,
        tokenOut,
        poolInfo.fee,
        poolInfo.sqrtPriceX96.toString(),
        poolInfo.liquidity.toString(),
        poolInfo.tick
    )

    const swapRoute = new Route(
        [pool],
        tokenIn,
        tokenOut
    );

    // console.debug('swap route: ', swapRoute);

    const { calldata } = SwapQuoter.quoteCallParameters(
        swapRoute,
        CurrencyAmount.fromRawAmount(
            tokenIn,
            fromReadableAmount(
                amountIn,
                tokenIn.decimals
            ).toString()
        ),
        TradeType.EXACT_INPUT,
        {
            useQuoterV2: true,
        }
    )

    // console.log('calldata: ', calldata);
    // console.log('quoterAddress: ', this._quoterAddress);

    const quoteCallReturnData = await provider.call({
        to: QUOTER_ADDRESS,
        data: calldata,
    });

    // console.log('quoteCallReturnData: ', quoteCallReturnData);

    const amountOut = defaultAbiCoder.decode(['uint256'], quoteCallReturnData);

    // console.log("swap out amount: ", amountOut);

    const uncheckedTrade = Trade.createUncheckedTrade({
        route: swapRoute,
        inputAmount: CurrencyAmount.fromRawAmount(
            tokenIn,
            fromReadableAmount(
                amountIn,
                tokenIn.decimals
            ).toString()
        ),
        outputAmount: CurrencyAmount.fromRawAmount(
            tokenOut,
            JSBI.BigInt(amountOut)
        ),
        tradeType: TradeType.EXACT_INPUT,
    })

    console.log(displayTrade(uncheckedTrade));

    return {
        pool: poolInfo,
        trade: uncheckedTrade,
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amount: amountIn
    };
}

export async function executeTrade(
    wallet: ethers.Wallet,
    tradeInfo: TradeInfo
): Promise<TransactionState> {
    const options: SwapOptions = {
        slippageTolerance: new Percent(50, 10_000), // 50 bips, or 0.50%
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes from the current Unix time
        recipient: wallet.address,
    }

    const methodParameters = SwapRouter.swapCallParameters([tradeInfo.trade], options)

    const tx = {
        data: methodParameters.calldata,
        to: SWAP_ROUTER_ADDRESS,
        value: methodParameters.value,
        from: wallet.address
    };

    const res = await sendTransaction(wallet, tx, true);

    return res
}

export async function getTokenApprovalMax(
    token: Token,
    wallet: ethers.Wallet
): Promise<TransactionState> {
    try {
        const tokenContract = new ethers.Contract(
            token.address,
            ERC20_ABI,
            wallet
        )

        console.debug('approve max...');
        const transaction = await tokenContract.approve.populateTransaction(SWAP_ROUTER_ADDRESS, ethers.constants.MaxUint256);

        return sendTransaction(wallet, {
            ...transaction,
            from: wallet.address,
        });
    } catch (e) {
        console.error(e);
        return TransactionState.Failed;
    }
}

export async function getTokenTransferApproval(
    wallet: ethers.Wallet,
    token: Token,
    requiredAmount: number
): Promise<TransactionState> {
    try {
        const tokenContract = new ethers.Contract(
            token.address,
            ERC20_ABI,
            wallet
        )

        const requiredAllowance = fromReadableAmount(
            requiredAmount,
            token.decimals
        );

        const allowance = await tokenContract.allowance(wallet.address, SWAP_ROUTER_ADDRESS);
        if (allowance > requiredAllowance) {
            console.debug('allowance is enough, continue.');
            return TransactionState.Sent;
        }

        const transaction = await tokenContract.approve.populateTransaction(SWAP_ROUTER_ADDRESS, requiredAllowance);

        return sendTransaction(wallet, {
            ...transaction,
            from: wallet.address,
        })
    } catch (e) {
        console.error(e)
        return TransactionState.Failed
    }
}