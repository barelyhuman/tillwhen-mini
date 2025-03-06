FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --update --no-cache openssl python3 libsodium build-base
WORKDIR /app
COPY package.json pnpm-lock.yaml .
RUN npm i -g corepack@latest && corepack enable \
    && pnpm i --production --ignore-scripts


FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
# setup litestream
# COPY ./litestream.yml /etc/litestream.yml
# COPY --from=litestream/litestream:latest /usr/local/bin/litestream /usr/local/bin/litestream

COPY package.json pnpm-lock.yaml .
COPY ./resources ./resources
COPY ./src ./src
COPY ./prisma ./prisma
COPY ./scripts ./scripts
RUN npm i -g corepack@latest && corepack enable && pnpm prisma generate && pnpm build

FROM base AS app

WORKDIR /app
COPY --from=builder /app/node_modules /app/node_modules
COPY package.json pnpm-lock.yaml .
COPY ./prisma ./prisma
COPY ./scripts ./scripts
COPY ./dist ./dist

RUN npm i -g corepack@latest && corepack enable && pnpm i --production
RUN mkdir -p /data 

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "scripts/run.sh"]
