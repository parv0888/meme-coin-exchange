import dotenv from "dotenv";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import { AlphaRouter, SwapOptionsSwapRouter02, SwapType, UniswapMulticallProvider } from "@uniswap/smart-order-router";
import { ChainId, CurrencyAmount, Percent, Token } from "@uniswap/sdk-core";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import JSBI from "jsbi";
import { TradeInfo, createTrade, executeTrade, getPoolInfo, getTokenApprovalMax } from "./lib";

dotenv.config();

const app: Express = express();
const PORT: string | number = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET!;
const CHAIN_ID = ChainId.BASE;
const CHAIN_JSON_RPC_URL: string = process.env.CHAIN_JSON_RPC_URL!;
const USER_HEADER = "user.wallet";
const provider = new ethers.providers.JsonRpcProvider(CHAIN_JSON_RPC_URL, CHAIN_ID);
const WALLET_PRIV_KEY = process.env.WALLET_PRIV_KEY!;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS!;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

function auth(req: Request, res: Response, next: NextFunction) {
	// check `USER_HEADER` in headers

	const authHeader = req.headers["authorization"];
	const token = authHeader && authHeader.split(" ")[1];

	if (token == null) return res.sendStatus(401);

	jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
		if (err) {
			console.log("error : ", err);
			return res.sendStatus(403);
		}

		req.headers[USER_HEADER] = user.walletAddress;
		next();
	});
}

app.post("/login", (req: Request, res: Response) => {
	const { walletAddress } = req.body;
	const token = jwt.sign({ walletAddress }, JWT_SECRET);
	res.json({ token });
});

app.post("/pool", async (req: Request, res: Response) => {
	let {
		tokenInput: {
			address: tokenInputAddress,
			decimal: tokenInputDecimal,
			symbol: tokenInputSymbol,
			name: tokenInputName,
		},
		tokenOutput: {
			address: tokenOutputAddress,
			decimal: tokenOutputDecimal,
			symbol: tokenOutputSymbol,
			name: tokenOutputName,
		},
	} = req.body;

	const inputToken = new Token(
		CHAIN_ID,
		tokenInputAddress,
		tokenInputDecimal,
		tokenInputSymbol,
		tokenInputName
	);
	const outputToken = new Token(
		CHAIN_ID,
		tokenOutputAddress,
		tokenOutputDecimal,
		tokenOutputSymbol,
		tokenOutputName
	);

	try {
		let pool = await getPoolInfo(provider, inputToken, outputToken);
		return res.json({ pool: pool });
	} catch (error) {
		console.error(error);
		return res.status(500).json({ error: "failed to find a pool" });
	}
});

app.post("/token-approval-max", auth, (req: Request, res: Response) => {
	console.debug("token-approval-max", req.body);
	let {
		tokenInput: {
			address: tokenInputAddress,
			decimal: tokenInputDecimal,
			symbol: tokenInputSymbol,
			name: tokenInputName,
		},
	} = req.body;

	const inputToken = new Token(
		CHAIN_ID,
		tokenInputAddress,
		tokenInputDecimal,
		tokenInputSymbol,
		tokenInputName
	);

	try {
		let txn = getTokenApprovalMax(inputToken, new ethers.Wallet(WALLET_PRIV_KEY, provider));
		return res.json({ txn });

	} catch (error) {
		console.error(error);
		return res.status(500).json({ error: "error token approval max" });
	}
});

app.post("/create-trade", auth, async (req: Request, res: Response) => {
	console.debug("create-trade", req.body);
	let {
		tokenInput: {
			address: tokenInputAddress,
			decimal: tokenInputDecimal,
			symbol: tokenInputSymbol,
			name: tokenInputName,
			amount: tokenInputAmount,
		},
		tokenOutput: {
			address: tokenOutputAddress,
			decimal: tokenOutputDecimal,
			symbol: tokenOutputSymbol,
			name: tokenOutputName,
		},
	} = req.body;

	const inputToken = new Token(
		CHAIN_ID,
		tokenInputAddress,
		tokenInputDecimal,
		tokenInputSymbol,
		tokenInputName
	);
	const outputToken = new Token(
		CHAIN_ID,
		tokenOutputAddress,
		tokenOutputDecimal,
		tokenOutputSymbol,
		tokenOutputName
	);

	try {
		let trade = await createTrade(provider, inputToken, outputToken, Number(tokenInputAmount));
		console.debug("trade", trade);
		return res.json(trade);
	}
	catch (error) {
		console.error(error);
		return res.status(500).json({ error: "failed to create a trade" });
	}
});

app.post("/trade", auth, async (req: Request, res: Response) => {
	console.debug("trade", req.body);
	let {
		tokenInput: {
			address: tokenInputAddress,
			decimal: tokenInputDecimal,
			symbol: tokenInputSymbol,
			name: tokenInputName,
			amount: tokenInputAmount,
		},
		tokenOutput: {
			address: tokenOutputAddress,
			decimal: tokenOutputDecimal,
			symbol: tokenOutputSymbol,
			name: tokenOutputName,
		},
	} = req.body;

	const inputToken = new Token(
		CHAIN_ID,
		tokenInputAddress,
		tokenInputDecimal,
		tokenInputSymbol,
		tokenInputName
	);
	const outputToken = new Token(
		CHAIN_ID,
		tokenOutputAddress,
		tokenOutputDecimal,
		tokenOutputSymbol,
		tokenOutputName
	);

	try {
		let trade = await createTrade(provider, inputToken, outputToken, Number(tokenInputAmount));
		let txn = await executeTrade(new ethers.Wallet(WALLET_PRIV_KEY, provider), trade);
		console.debug("txn", txn);
		return res.json({ trade, txn });
	}
	catch (error) {
		console.error(error);
		return res.status(500).json({ error: "failed to execute a trade" });
	}
});

app.post("/route", auth, async (req: Request, res: Response) => {
	console.debug(req.body);
	let {
		tokenInput: {
			address: tokenInputAddress,
			decimal: tokenInputDecimal,
			symbol: tokenInputSymbol,
			name: tokenInputName,
			amount: tokenInputAmount,
		},
		tokenOutput: {
			address: tokenOutputAddress,
			decimal: tokenOutputDecimal,
			symbol: tokenOutputSymbol,
			name: tokenOutputName,
		},
		tradeType
	} = req.body;
	const options: SwapOptionsSwapRouter02 = {
		recipient: req.get(USER_HEADER)!,
		slippageTolerance: new Percent(50, 10_000),
		deadline: Math.floor(Date.now() / 1000 + 1800),
		type: SwapType.SWAP_ROUTER_02,
	};

	const router = new AlphaRouter({
		chainId: CHAIN_ID,
		provider: provider,
		multicall2Provider: new UniswapMulticallProvider(CHAIN_ID, provider)
	});
	const inputToken = new Token(
		CHAIN_ID,
		tokenInputAddress,
		tokenInputDecimal,
		tokenInputSymbol,
		tokenInputName
	);
	const outputToken = new Token(
		CHAIN_ID,
		tokenOutputAddress,
		tokenOutputDecimal,
		tokenOutputSymbol,
		tokenOutputName
	);

	const wethAmount = CurrencyAmount.fromRawAmount(inputToken, JSBI.BigInt(tokenInputAmount));

	try {
		const route = await router.route(
			wethAmount,
			outputToken,
			tradeType,
			options
		);

		return res.json({ route });
	} catch (error) {
		console.error(error);
		return res.status(500).json({ error: "failed to find a route" });
	}

});

app.listen(PORT, () => {
	console.log(`[Server] : Server is running on http://localhost:${PORT}`);
});
