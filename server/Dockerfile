# PebbleTesla API server (public Funnel surface + tailnet proxy)
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /pebbletesla-server .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /pebbletesla-server /usr/local/bin/pebbletesla-server
WORKDIR /data
ENV TOKEN_FILE=/data/tokens.json
EXPOSE 8080 9000
ENTRYPOINT ["/usr/local/bin/pebbletesla-server"]
