FROM node:24-bookworm AS builder
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter "@apiscope/cli" deploy --prod --legacy /app/pruned
RUN ln -s ../../packages/cli /app/pruned/node_modules/@apiscope/cli

FROM gcr.io/distroless/nodejs24-debian12 AS runtime
WORKDIR /app
COPY --from=builder /app/pruned/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
ENV NODE_ENV=production
EXPOSE 4620
CMD ["/app/packages/cli/dist/cli.js", "serve"]
