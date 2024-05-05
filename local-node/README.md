# Hardhat Docker

## Docker build

```bash
docker build --progress=plain --tag "hardhat" .
```

## Docker run

```bash
docker run -it --rm --name node1 -e ARCHIVE_URL=https://eth-mainnet.g.alchemy.com/v2/R6T9uEsaOBdNz-cYURZzV68guW-i5F_R --volume ./cache:/app/cache hardhat
```
