FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY public ./public
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lampa-kinopub .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
ENV LISTEN_ADDR=0.0.0.0:3000
COPY --from=build /out/lampa-kinopub /app/lampa-kinopub
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["/app/lampa-kinopub"]
