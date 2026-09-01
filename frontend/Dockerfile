# Builds the app and serves it with nginx, which also proxies /api to the gateway.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# 127.0.0.11 is Docker's embedded DNS. The template resolves the gateway through it on
# every request, so a restarted gateway does not strand this container on a dead IP.
ENV GATEWAY_URL=http://gateway:8080
ENV NGINX_RESOLVER=127.0.0.11
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
