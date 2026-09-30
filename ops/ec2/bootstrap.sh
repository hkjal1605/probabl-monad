#!/usr/bin/env bash
# Run on the Ubuntu EC2 host as the SSH user. No application secrets are needed.
set -euo pipefail
umask 022

if [[ "$(id -u)" == 0 ]]; then
  echo "Run as the deployment user with passwordless sudo, not as root." >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64) probabl_node_arch=x64 ;;
  aarch64) probabl_node_arch=arm64 ;;
  *)
    echo "This bootstrap supports Ubuntu on x86_64 or arm64 (Graviton) only." >&2
    exit 1
    ;;
esac

sudo -n apt-get update
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates curl git jq logrotate nginx ripgrep unzip xz-utils

# Use the maintained Node 24 LTS line, verifying the official binary checksum.
probabl_install_dir=$(mktemp -d /tmp/probabl-runtime.XXXXXXXX)
curl --fail --silent --show-error --retry 3 \
  https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt \
  -o "$probabl_install_dir/SHASUMS256.txt"
probabl_node_pattern="^node-v24\.[0-9]+\.[0-9]+-linux-$probabl_node_arch\.tar\.xz$"
probabl_node_archive=$(PATTERN="$probabl_node_pattern" awk '$2 ~ ENVIRON["PATTERN"] {print $2}' "$probabl_install_dir/SHASUMS256.txt")
if [[ ! "$probabl_node_archive" =~ $probabl_node_pattern ]]; then
  echo "Could not select one official Node 24 $probabl_node_arch archive." >&2
  exit 1
fi
curl --fail --silent --show-error --retry 3 \
  "https://nodejs.org/dist/latest-v24.x/$probabl_node_archive" \
  -o "$probabl_install_dir/$probabl_node_archive"
(
  cd "$probabl_install_dir"
  awk -v archive="$probabl_node_archive" '$2 == archive' SHASUMS256.txt | sha256sum --check --strict -
)
sudo -n tar -xJf "$probabl_install_dir/$probabl_node_archive" -C /usr/local --strip-components=1 --no-same-owner

# Pin Bun to package.json; resolve and record PM2's published version at installation.
probabl_pm2_version=$(npm view pm2 version)
if [[ ! "$probabl_pm2_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Unexpected PM2 version." >&2
  exit 1
fi
sudo -n npm install --global --no-audit --no-fund "bun@1.3.14" "pm2@$probabl_pm2_version"
node --version
npm --version
bun --version
PM2_SILENT=true pm2 --version
nginx -v

# Download artifacts are bounded to one Node archive and its checksum manifest.
echo "Runtime download artifacts retained at $probabl_install_dir"
