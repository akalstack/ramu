#!/usr/bin/env bash
# Builds the signed APT and DNF repositories served at getramu.dev/apt and getramu.dev/rpm for one release.
# Only the indexes are written: APT fetches each package through a redirect to the GitHub release
# (apps/site/public/_redirects), and DNF fetches it there directly through the index's base URL.
#
# Usage: scripts/release/linux-repo.sh <tag> <output dir>
# Needs gh, apt-ftparchive (apt-utils), createrepo_c and gpg holding the key in RAMU_REPO_KEY (a fingerprint).
# RAMU_REPO_FILES=<dir> uses .deb and .rpm files already on disk, named as on the release, instead of downloading them.
set -euo pipefail

tag=${1:?tag, such as v0.1.0-alpha.1}
out=${2:?output directory}
key=${RAMU_REPO_KEY:?fingerprint of the repository signing key}
repo=${RAMU_RELEASE_REPO:-akalstack/ramu}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/files"
if [ -n "${RAMU_REPO_FILES:-}" ]; then
  cp "$RAMU_REPO_FILES"/*.deb "$RAMU_REPO_FILES"/*.rpm "$work/files/"
else
  gh release download "$tag" --repo "$repo" --pattern 'linux-*.deb' --pattern 'linux-*.rpm' --dir "$work/files"
fi

# APT: one suite, `stable`, holding the latest release for amd64 and arm64.
apt="$work/apt"
mkdir -p "$apt/pool/$tag"
cp "$work"/files/*.deb "$apt/pool/$tag/"
for arch in amd64 arm64; do
  dir="$apt/dists/stable/main/binary-$arch"
  mkdir -p "$dir"
  (cd "$apt" && apt-ftparchive --arch "$arch" packages "pool/$tag") > "$dir/Packages"
  test -s "$dir/Packages" || { echo "No $arch package in $tag" >&2; exit 1; }
  gzip -9nk "$dir/Packages"
done
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Ramu \
  -o APT::FTPArchive::Release::Label=Ramu \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Components=main \
  -o "APT::FTPArchive::Release::Architectures=amd64 arm64" \
  release "$apt/dists/stable" > "$work/Release"
mv "$work/Release" "$apt/dists/stable/Release"
gpg --batch --yes --local-user "$key" --clearsign --output "$apt/dists/stable/InRelease" "$apt/dists/stable/Release"
gpg --batch --yes --local-user "$key" --armor --detach-sign --output "$apt/dists/stable/Release.gpg" "$apt/dists/stable/Release"

# DNF: one repository per architecture; packages are fetched from the release itself. Forge names the aarch64
# package `.arm64.rpm`; the package itself says aarch64, which is what DNF checks.
for pair in x86_64:x86_64 aarch64:arm64; do
  arch=${pair%%:*}
  dir="$work/rpm/$arch"
  mkdir -p "$dir"
  cp "$work"/files/*."${pair##*:}".rpm "$dir/"
  createrepo_c --quiet --no-database --baseurl "https://github.com/$repo/releases/download/$tag/" "$dir"
  gpg --batch --yes --local-user "$key" --armor --detach-sign --output "$dir/repodata/repomd.xml.asc" "$dir/repodata/repomd.xml"
  rm "$dir"/*.rpm
done

rm -rf "$out/apt" "$out/rpm"
mkdir -p "$out/apt"
cp -R "$apt/dists" "$out/apt/"
cp -R "$work/rpm" "$out/rpm"
echo "Wrote the APT and DNF repositories for $tag to $out"
