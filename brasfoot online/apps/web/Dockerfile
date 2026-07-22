# Build from the monorepo root: docker build -f apps/web/Dockerfile .
#
# Vite inlines VITE_* env vars into the static bundle at BUILD time, not
# container-start time — pass the real API/realtime URLs as build args:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_URL=https://api.example.com \
#     --build-arg VITE_REALTIME_URL=https://realtime.example.com .
# Changing them later means rebuilding the image, not just restarting it.

FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web apps/web

ARG VITE_API_URL
ARG VITE_REALTIME_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_REALTIME_URL=$VITE_REALTIME_URL

RUN npm run build -w @brfut/web

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
