# --- build ---
FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/api ./cmd/seed-catalogo

# --- runtime ---
FROM alpine:3.24
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/ /usr/local/bin/
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["api"]
