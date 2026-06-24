#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <chrome-extension-id>" >&2
  exit 64
fi

extension_id="$1"
script_dir="$(cd "$(dirname "$0")" && pwd)"
host_source="$script_dir/macos-tab-switcher-host.swift"
app_support_dir="$HOME/Library/Application Support/Tab Switcher"
host_binary="$app_support_dir/tab-switcher-native-host"
module_cache="$app_support_dir/module-cache"
host_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
host_manifest="$host_dir/com.tab_switcher.native.json"

mkdir -p "$app_support_dir" "$module_cache"
swiftc -module-cache-path "$module_cache" "$host_source" -o "$host_binary"
chmod +x "$host_binary"

mkdir -p "$host_dir"

cat > "$host_manifest" <<JSON
{
  "name": "com.tab_switcher.native",
  "description": "Tab Switcher native helper for Ctrl+Tab",
  "path": "$host_binary",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$extension_id/"
  ]
}
JSON

echo "Installed $host_manifest"
echo "Built $host_binary"
echo "Reload the unpacked extension, then grant Accessibility permission if macOS prompts for it."
