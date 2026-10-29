#!/usr/bin/env bash
# Android / Capacitor build check: web build -> cap sync -> gradle assembleDebug -> APK sanity (package, permissions,
# bundled web assets, no .env / secrets). Needs JDK 17 + Android SDK (defaults: /home/box/jdk17, /home/box/android-sdk).
set -euo pipefail; cd "$(dirname "$0")/.."
export JAVA_HOME=${JAVA_HOME:-/home/box/jdk17} ANDROID_HOME=${ANDROID_HOME:-/home/box/android-sdk}; export PATH="$JAVA_HOME/bin:$PATH"
npx vite build >/dev/null; npx cap sync android >/dev/null
(cd android && ./gradlew assembleDebug --no-daemon -q)
APK=android/app/build/outputs/apk/debug/app-debug.apk; AAPT=$(ls "$ANDROID_HOME"/build-tools/*/aapt | tail -1)
P=$("$AAPT" dump permissions "$APK"); B=$("$AAPT" dump badging "$APK"); Z=$(unzip -l "$APK") # captured first: grep -q on a live pipe + pipefail = SIGPIPE false failures
for perm in INTERNET RECORD_AUDIO MODIFY_AUDIO_SETTINGS CAMERA; do grep -q "android.permission.$perm" <<<"$P" || { echo "missing $perm"; exit 1; }; done
grep -q "package: name='com.cybermates.app'" <<<"$B" || { echo "bad package"; exit 1; }
grep -q "assets/public/index.html" <<<"$Z" || { echo "web assets not bundled"; exit 1; }
if grep -Eiq '\.env|keystore|\.jks' <<<"$Z"; then echo "secret-looking file in APK"; exit 1; fi
if [ -f .env.admin ]; then while IFS='=' read -r k v; do [ ${#v} -ge 12 ] || continue; if unzip -p "$APK" 'assets/public/*' 2>/dev/null | grep -F -- "$v" >/dev/null; then echo "env value $k bundled"; exit 1; fi; done < <(grep -v '^#' .env.admin); fi
echo "ANDROID OK: $(grep -o "versionName='[^']*'" <<<"$B") $(grep -o "targetSdkVersion:'[0-9]*'" <<<"$B") $(du -h "$APK" | cut -f1)"
