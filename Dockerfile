FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile=false
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
