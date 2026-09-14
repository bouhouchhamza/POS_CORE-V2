# Local API sidecar

The packaging preparation command places the platform-specific, self-contained
`corepos-local-api` executable in this directory using Tauri's required target
triple suffix. The binary is deliberately not committed: it contains the Node
runtime and the compiled local API, but no café data or credentials.

Never point the desktop build at the hosted API. The sidecar binds only to
`127.0.0.1:32145` and stores mutable data below the Tauri application-data path.
