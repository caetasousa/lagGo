# --- build ---
FROM node:26.13.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# docs/ vem do contexto extra "docs" (docker-compose.yml) e fica em /docs:
# o mesmo caminho relativo (../docs) que o build usa no repositório.
COPY --from=docs . /docs
RUN npm run build

# --- runtime ---
FROM nginx:1.31.8-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
