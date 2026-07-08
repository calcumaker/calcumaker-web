#!/usr/bin/env bash
# deploy-release.sh — publish the latest calcumaker-web GitHub release into a
# static web docroot.
#
# calcumaker-web ships as a prebuilt static bundle (JS/CSS + a WASI wasm); the
# wasm cross-build can't run on a plain web host, so we deploy the RELEASE
# ARTIFACT, not a source checkout. The release is a rolling "latest" prerelease
# with stable
# asset names (calcumaker-web-dist.tar.gz + SHA256SUMS + build-info.json); each
# build is fingerprinted by build-info.json's web_sha, so re-runs are idempotent.
#
# Layout (atomic, rollback-friendly) under $ROOT:
#   releases/<web_sha>/           extracted bundle
#   current -> releases/<web_sha> nginx `root` points here; swapped atomically
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

owner=$(stat -c %U "$ROOT")
if [[ "$(id -un)" != "$owner" ]]; then
    exec sudo -u "$owner" -- "$0" "$@"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 1. Fingerprint the published build.
curl -fsSL "$BASE/build-info.json" -o "$tmp/build-info.json"
web_sha=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["web_sha"])' "$tmp/build-info.json")
[[ -n "$web_sha" ]] || { echo "deploy: could not read web_sha from build-info.json" >&2; exit 1; }

dest="$ROOT/releases/$web_sha"
if [[ -d "$dest" && "$(readlink "$ROOT/current" 2>/dev/null)" == "releases/$web_sha" ]]; then
    echo "deploy: already at $web_sha; nothing to do"
    exit 0
fi

# 2. Download + verify the bundle against the release's SHA256SUMS.
curl -fsSL "$BASE/calcumaker-web-dist.tar.gz" -o "$tmp/dist.tar.gz"
curl -fsSL "$BASE/SHA256SUMS" -o "$tmp/SHA256SUMS"
want=$(awk '$2 ~ /calcumaker-web-dist\.tar\.gz$/ {print $1}' "$tmp/SHA256SUMS")
got=$(sha256sum "$tmp/dist.tar.gz" | awk '{print $1}')
[[ -n "$want" && "$want" == "$got" ]] || { echo "deploy: sha256 mismatch (want=$want got=$got)" >&2; exit 1; }

# 3. Materialize releases/<sha> via extract-then-rename (never a half-written dir).
mkdir -p "$ROOT/releases"
rm -rf "$dest.tmp"
mkdir -p "$dest.tmp"
tar -C "$dest.tmp" -xzf "$tmp/dist.tar.gz"
cp "$tmp/build-info.json" "$dest.tmp/.build-info.json"
rm -rf "$dest"
mv "$dest.tmp" "$dest"

# 4. Atomic publish: flip the current symlink (relative target = location-independent).
ln -sfn "releases/$web_sha" "$ROOT/current"

# 5. GC old releases: keep the newest $KEEP, but never the live target.
live=${web_sha}
( cd "$ROOT/releases" && ls -1dt */ 2>/dev/null | sed 's#/$##' \
    | grep -vFx "$live" | tail -n "+$KEEP" | xargs -r rm -rf )

built_at=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["built_at"], "ref", d["ref"], "core", d["calcumaker_sha"])' "$dest/.build-info.json")
echo "deploy: published $web_sha ($built_at) -> $ROOT/current"
