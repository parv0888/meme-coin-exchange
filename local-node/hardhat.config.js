/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	defaultNetwork: "mainnet",
	solidity: "0.8.24",
	networks: {
		mainnet: {
			url: "http://127.0.0.1:8545",
			chainId: 1,
			forking: {
				url: "https://eth-mainnet.g.alchemy.com/v2/R6T9uEsaOBdNz-cYURZzV68guW-i5F_R",
			},
		},
	},
};
