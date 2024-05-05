FROM node:21-alpine

ENV NODE_ENV=development
ENV ARCHIVE_URL=https://eth-mainnet.alchemyapi.io/v2/your-api-key

COPY . /app/
WORKDIR /app
RUN npm install
CMD npx hardhat node --fork ${ARCHIVE_URL}