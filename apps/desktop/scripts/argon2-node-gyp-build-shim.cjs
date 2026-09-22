// The desktop sidecar is a pkg executable.  pkg extracts a statically
// required .node asset, whereas node-gyp-build resolves its native addon via
// runtime directory probing that points at the pkg snapshot.  Keep this shim
// deliberately narrow: it exposes only the Argon2 binding built by the
// sidecar script and never accepts a caller-controlled path.
module.exports = () => eval('require')('./argon2.win32-x64.node');
