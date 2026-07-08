#!/usr/bin/env bash
# deploy-release.sh — publish the latest calcumaker-web GitHub release into a
# static web docroot.
#
# calcumaker-web ships as a prebuilt static bundle (JS/CSS + a WASI wasm); the
# wasm cross-build can't run on a plain web host, so we deploy the RELEASE
# ARTIFACT, not a source checkout. The release is a rolling "latest" prerelease
# with stable asset names (calcumaker-web-dist.tar.gz + SHA256SUMS +
# build-info.json). Each build is fingerprinted by web_sha + calcumaker_sha (so
# an engine-only rebuild still re-deploys), making re-runs idempotent.
#
# Layout (atomic, rollback-friendly) under $ROOT:
#   releases/<web_sha>-<core_sha>/   extracted bundle
#   current -> releases/<...>        nginx `root` points here; swapped atomically
#
# Runs as the docroot owner; re-execs via `sudo -u <owner>` if invoked as root
# (so a webhook/root cron lands files with the right ownership). Public repo, so
# no GitHub auth is needed.
set -euo pipefail

REPO="${CALCUMAKER_WEB_REPO:-calcumaker/calcumaker-web}"
TAG="${CALCUMAKER_WEB_TAG:-latest}"
ROOT="${CALCUMAKER_WEB_ROOT:-/www/web.calcumaker.co}"
KEEP="${CALCUMAKER_WEB_KEEP:-5}"      # releases to retain (incl. the live one)
BASE="https://github.com/$REPO/releases/download/$TAG"

[[ -d "$ROOT" ]] || { echo "deploy: docroot $ROOT does not exist" >&2; exit 1; }

# Land files as the docroot owner. sudo resets the environment, so forward the
# overrides explicitly — otherwise the re-exec silently reverts to the defaults.
owner=$(stat -c %U "$ROOT")
if [[ "$(id -un)" != "$owner" ]]; then
    exec sudo -u "$owner" \
        CALCUMAKER_WEB_REPO="$REPO" CALCUMAKER_WEB_TAG="$TAG" \
        CALCUMAKER_WEB_ROOT="$ROOT" CALCUMAKER_WEB_KEEP="$KEEP" \
        -- "$0" "$@"
fi

# One deploy at a time — webhook/cron events can overlap.
exec 9>"$ROOT/.deploy.lock"
flock -w 120 9 || { echo "deploy: another deploy holds the lock" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl() { command curl -fsSL --retry 3 --retry-all-errors --connect-timeout 30 "$@"; }

# 1. Fingerprint the published build (web + engine commits -> release id).
curl "$BASE/build-info.json" -o "$tmp/build-info.json"
read -r web_sha core_sha < <(python3 -c \
    'import json,sys; d=json.load(open(sys.argv[1])); print(d["web_sha"], d["calcumaker_sha"])' \
    "$tmp/build-info.json")
[[ -n "$web_sha" && -n "$core_sha" ]] || { echo "deploy: could not read shas from build-info.json" >&2; exit 1; }
rid="${web_sha}-${core_sha}"

dest="$ROOT/releases/$rid"
if [[ -d "$dest" && "$(readlink "$ROOT/current" 2>/dev/null)" == "releases/$rid" ]]; then
    echo "deploy: already at $rid; nothing to do"
    exit 0
fi

# 2. Download + verify the bundle against the release's SHA256SUMS.
curl "$BASE/calcumaker-web-dist.tar.gz" -o "$tmp/dist.tar.gz"
curl "$BASE/SHA256SUMS" -o "$tmp/SHA256SUMS"
want=$(awk '$2 ~ /calcumaker-web-dist\.tar\.gz$/ {print $1}' "$tmp/SHA256SUMS")
got=$(sha256sum "$tmp/dist.tar.gz" | awk '{print $1}')
[[ -n "$want" && "$want" == "$got" ]] || { echo "deploy: sha256 mismatch (want=$want got=$got)" >&2; exit 1; }

# 3. Materialize releases/<rid> via extract-then-rename (never a half-written dir).
mkdir -p "$ROOT/releases"
rm -rf "$ROOT"/releases/*.tmp 2>/dev/null || true   # clear leftovers from a crashed run
rm -rf "$dest.tmp"
mkdir -p "$dest.tmp"
tar -C "$dest.tmp" -xzf "$tmp/dist.tar.gz"
cp "$tmp/build-info.json" "$dest.tmp/.build-info.json"
rm -rf "$dest"
mv "$dest.tmp" "$dest"

# 4. Atomic publish: create a temp symlink, then rename() it over `current`
# (rename is atomic — no window where `current` is missing). Relative target so
# the docroot stays relocatable.
ln -sfn "releases/$rid" "$ROOT/.current.$$"
mv -Tf "$ROOT/.current.$$" "$ROOT/current"

# 5. GC old releases: keep the newest $KEEP, but never the live target. The
# `|| true` swallows grep's no-match (only the live release exists) so pipefail
# doesn't abort the script *after* a successful publish — real errors still surface.
( cd "$ROOT/releases" && ls -1dt */ 2>/dev/null | sed 's#/$##' \
    | { grep -vFx "$rid" || true; } | tail -n "+$KEEP" | xargs -r rm -rf )

built=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["built_at"], "ref", d["ref"], "core", d["calcumaker_sha"])' "$dest/.build-info.json")
echo "deploy: published $rid ($built) -> $ROOT/current"
