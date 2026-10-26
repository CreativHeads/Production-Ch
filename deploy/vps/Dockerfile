# Casting Manager for the VPS: builds the React frontend into server/public,
# then runs the Node.js server. Build context is the repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY frontend frontend
COPY server server
RUN cd frontend && npx vite build --outDir ../server/public --emptyOutDir

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app/server
COPY --from=build /app/server ./
VOLUME /data
EXPOSE 3000
CMD ["node", "src/index.js"]
