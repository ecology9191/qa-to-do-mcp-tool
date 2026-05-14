# QA To Do

Local-first QA checklist for Sandcastle/RALPH output. The repo builds a Tauri desktop app and a Node-based MCP CLI named `qa-to-do`.

## Prerequisites

- Node.js 24 or newer
- npm
- Rust and Tauri Linux system dependencies, only needed for desktop packages
- gitleaks on `PATH`, only needed for `npm run secrets:scan`

## Install Dependencies

```bash
npm install
```

Use `npm ci` instead when installing from a clean checkout with an existing `package-lock.json`.

## Build The MCP CLI

```bash
npm run build:mcp
```

This writes the executable CLI bundle to `dist-node/qa-to-do.js`.

To install the CLI from this checkout:

```bash
npm install -g .
```

After installing, run:

```bash
qa-to-do
```

## Build The Web App

```bash
npm run build
```

This writes the Vite build output to `dist/`.

## Build Linux Desktop Packages

```bash
npm run package:linux
```

This runs the Tauri Linux build and creates `.deb` and `.AppImage` artifacts under `src-tauri/target/release/bundle/`.

## Development

Run the Vite dev server:

```bash
npm run dev
```

Run the Tauri app in development mode:

```bash
npm run tauri dev
```

## Checks

```bash
npm test
npm run typecheck
npm run secrets:scan
```

`npm run secrets:scan` uses the `gitleaks` binary from your `PATH`.
