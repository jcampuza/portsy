# Portsy

Portsy is a macOS menu bar app for watching local development ports and freeing them when needed.

## Features

- Watches configurable TCP listening port ranges, defaulting to `3000-9999`.
- Shows owning process, PID, bind address, and user for each watched port.
- Hides excluded process names from the list, tray count, and kill-all action.
- Sends `SIGTERM` first when killing a process, then `SIGKILL` only if the watched port remains occupied.
- Runs as a Tauri v2 menu bar app with a reusable Rust monitoring core.

## Development

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun run dev
```

## Checks

```sh
bun run test
cargo test
```

## Build

```sh
bun run build
```

