#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in \
    "$HOME/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home" \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  do
    if [[ -x "$candidate/bin/java" ]]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "Brak JDK. Zainstaluj Temurin 21 albo Android Studio." >&2
  exit 1
fi

if [[ ! -d "$ANDROID_HOME/platform-tools" ]]; then
  echo "Brak Android SDK w $ANDROID_HOME" >&2
  exit 1
fi

# Android Studio 2026 can install platforms as android-37.0; Gradle looks for android-36 / android-37.
ensure_platform() {
  local api="$1"
  local want="$ANDROID_HOME/platforms/android-$api"
  local dotted="$ANDROID_HOME/platforms/android-${api}.0"
  local alt="$ANDROID_HOME/platforms/android-${api}-2"

  if [[ -d "$want" && ! -L "$want" ]]; then
    return 0
  fi
  if [[ -d "$alt" && ! -d "$want" ]]; then
    mv "$alt" "$want"
    echo "moved $alt -> $want"
    return 0
  fi
  if [[ -d "$dotted" ]]; then
    if [[ -L "$want" ]]; then
      return 0
    fi
    if [[ ! -e "$want" ]]; then
      ln -sfn "android-${api}.0" "$want"
      echo "linked $want -> android-${api}.0"
    fi
  fi
}

ensure_platform 36
ensure_platform 37

echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"

CI=1 npx expo prebuild --platform android

export NODE_ENV=production
cd android
./gradlew :app:assembleRelease --quiet

APK="$(find "$ROOT/android/app/build/outputs/apk/release" -name '*.apk' | head -n 1)"
if [[ -z "$APK" ]]; then
  echo "Nie znaleziono APK." >&2
  exit 1
fi

mkdir -p "$ROOT/dist"
DEST="$ROOT/dist/WolnaSzkola.apk"
cp "$APK" "$DEST"
echo "APK: $DEST"
ls -lh "$DEST"
