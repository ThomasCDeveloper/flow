.PHONY: help install dev build start typecheck test clean

PORT ?= 4321

help:
	@echo "make install    Install dependencies"
	@echo "make dev        Run server and web UI with hot reload (http://localhost:5173)"
	@echo "make build      Build the web UI into web/dist"
	@echo "make start      Build and serve the app (http://localhost:$(PORT))"
	@echo "make typecheck  Type-check server and web UI"
	@echo "make test       Run the tests"
	@echo "make clean      Remove build output and node_modules"

node_modules: package.json server/package.json web/package.json
	npm install
	@touch node_modules

install: node_modules

dev: node_modules
	npm run dev

build: node_modules
	npm run build

start: node_modules
	PORT=$(PORT) npm start

typecheck: node_modules
	npm run typecheck

test: node_modules
	npm test

clean:
	rm -rf web/dist node_modules server/node_modules web/node_modules
