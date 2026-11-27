# Official Go 1.27.4 multi-platform image manifest; includes the Go standard-library fixes
# reported against the earlier Go 1.25.14 builder.
FROM golang@sha256:5f1b98fa02fe396ebce2a0227a0e08309e11792915b9dd2e1f71053d7e7e6666 AS build

WORKDIR /src
COPY go.mod main.go main_test.go ./
RUN go version && gofmt -w main.go main_test.go && go test -count=1 ./... && go vet ./...
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -ldflags='-s -w' -o /out/clamav-tls-bridge .

FROM scratch AS runtime
COPY --from=build /out/clamav-tls-bridge /clamav-tls-bridge
USER 65532:65532
EXPOSE 13310 8080
ENTRYPOINT ["/clamav-tls-bridge"]
