#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun clang -fobjc-arc -fblocks -framework Foundation -framework IOBluetooth "$HERE/joy_rfcomm.m" -o "$HERE/joy_rfcomm"
