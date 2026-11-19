#!/usr/bin/env bash
# Release-infrastructure helper for macOS signing. Reads everything from the environment (CI secrets); writes nothing to the repository.
#   setup   import the Developer ID certificate into a temporary keychain and stage the notarization API key
#   verify  check the packaged app's signature, Gatekeeper assessment and notarization ticket
#   cleanup delete the temporary keychain and key file
# Without MACOS_CERTIFICATE_P12 (base64 .p12) the build stays unsigned and `verify` is skipped.
set -euo pipefail

keychain="${RUNNER_TEMP:-/tmp}/ramu-signing.keychain-db"
keyfile="${RUNNER_TEMP:-/tmp}/ramu-notary-key.p8"

export_env() { if [ -n "${GITHUB_ENV:-}" ]; then echo "$1=$2" >>"$GITHUB_ENV"; fi; }

case "${1:-}" in
  setup)
    if [ -z "${MACOS_CERTIFICATE_P12:-}" ]; then echo "No signing certificate configured; building unsigned."; exit 0; fi
    : "${MACOS_CERTIFICATE_PASSWORD:?MACOS_CERTIFICATE_PASSWORD is required with MACOS_CERTIFICATE_P12}"
    : "${RAMU_SIGN_IDENTITY:?RAMU_SIGN_IDENTITY is required with MACOS_CERTIFICATE_P12}"
    password="$(uuidgen)"
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    security unlock-keychain -p "$password" "$keychain"
    printf '%s' "$MACOS_CERTIFICATE_P12" | base64 --decode >"${keychain}.p12"
    security import "${keychain}.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
    rm -f "${keychain}.p12"
    security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$keychain" >/dev/null
    security list-keychains -d user -s "$keychain" login.keychain-db
    if [ -n "${APPLE_API_KEY_P8:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ]; then
      umask 077
      printf '%s' "$APPLE_API_KEY_P8" | base64 --decode >"$keyfile"
      export_env APPLE_API_KEY "$keyfile"
    else
      echo "Notarization credentials incomplete; the app will be signed but not notarized."
    fi
    ;;
  verify)
    app="${2:?Usage: macos-signing.sh verify <path to Ramu.app>}"
    if [ -z "${MACOS_CERTIFICATE_P12:-}" ]; then echo "Unsigned build; skipping signature verification."; exit 0; fi
    codesign --verify --deep --strict --verbose=2 "$app"
    if [ -n "${APPLE_API_KEY_P8:-}" ]; then
      spctl --assess --type execute --verbose=2 "$app"
      xcrun stapler validate "$app"
    fi
    ;;
  cleanup)
    security delete-keychain "$keychain" 2>/dev/null || true
    rm -f "$keyfile" "${keychain}.p12"
    ;;
  *)
    echo "Usage: macos-signing.sh setup|verify <app>|cleanup" >&2
    exit 2
    ;;
esac
