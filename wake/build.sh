#!/bin/sh
set -eu

WAKE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WAKE_LOCAL="$WAKE_DIR/../.local/wake"
mkdir -p "$WAKE_LOCAL" "$WAKE_DIR/../.local/artifacts"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

if [ -z "${GRADLE_BIN:-}" ]; then
    for candidate in "${GRADLE_USER_HOME:-$HOME/.gradle}"/wrapper/dists/gradle-9.6.0-bin/*/gradle-9.6.0/bin/gradle; do
        if [ -x "$candidate" ]; then
            GRADLE_BIN="$candidate"
            break
        fi
    done
fi
if [ -z "${GRADLE_BIN:-}" ]; then
    GRADLE_BIN="$WAKE_LOCAL/gradle-9.6.0/bin/gradle"
    if [ ! -x "$GRADLE_BIN" ]; then
        curl -fL https://services.gradle.org/distributions/gradle-9.6.0-bin.zip -o "$WAKE_LOCAL/gradle.zip"
        unzip -q "$WAKE_LOCAL/gradle.zip" -d "$WAKE_LOCAL"
        rm "$WAKE_LOCAL/gradle.zip"
    fi
fi

if [ ! -f "$WAKE_LOCAL/debug.keystore" ]; then
    keytool -genkeypair -keystore "$WAKE_LOCAL/debug.keystore" -storepass android \
        -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 \
        -validity 10000 -dname 'CN=QRBridge Wake Debug'
fi

"$GRADLE_BIN" -p "$WAKE_DIR" --project-cache-dir "$WAKE_LOCAL/gradle-cache" \
    --no-daemon --console=plain testDebugUnitTest lintDebug assembleDebug
WAKE_VERSION=$(cat "$WAKE_DIR/version.txt")
WAKE_APK="$WAKE_DIR/../.local/artifacts/qrbridge-wake-$WAKE_VERSION.apk"
cp "$WAKE_LOCAL/build/outputs/apk/debug/qrbridge-wake-debug.apk" "$WAKE_APK"
printf '%s\n' "$WAKE_APK"
