#!/bin/bash

# Build script for creating production Android artifact for GitHub releases
# 
# This script:
# 1. Builds a production Android artifact using EAS
# 2. Finds/downloads and renames it with version info
# 3. Provides instructions for creating a GitHub release
#
# Usage:
#   ./build-release.sh          - Local EAS build (default)
#   ./build-release.sh local    - Explicit local EAS build
#   ./build-release.sh cloud    - EAS cloud build (wait + download artifact)

set -e

BUILD_MODE="local"
if [ "$1" = "cloud" ]; then
    BUILD_MODE="cloud"
elif [ "$1" = "local" ]; then
    BUILD_MODE="local"
fi

echo "🔨 Building SharedMoney Android Production APK for Release"
echo "=========================================================="
echo ""

# Check if .env.production file exists
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production file not found!"
    echo "Please create a .env.production file with EXPO_PUBLIC_* variables"
    exit 1
fi

echo "📋 Loading environment variables from .env.production..."
echo ""

# Load .env.production file and export variables
export $(grep -v '^#' .env.production | grep '^EXPO_PUBLIC_' | xargs)

# For production builds, don't set dev client flag
unset EXPO_PUBLIC_USE_DEV_CLIENT

# Verify required variables are set
if [ -z "$EXPO_PUBLIC_SUPABASE_URL" ] || [ -z "$EXPO_PUBLIC_SUPABASE_ANON_KEY" ]; then
    echo "❌ Error: Required environment variables not found in .env"
    echo "Please ensure .env contains:"
    echo "  EXPO_PUBLIC_SUPABASE_URL"
    echo "  EXPO_PUBLIC_SUPABASE_ANON_KEY"
    exit 1
fi

echo "✅ Environment variables loaded"
echo "   EXPO_PUBLIC_SUPABASE_URL: ${EXPO_PUBLIC_SUPABASE_URL:0:30}..."
echo "   EXPO_PUBLIC_SUPABASE_ANON_KEY: ${EXPO_PUBLIC_SUPABASE_ANON_KEY:0:20}..."
if [ ! -z "$EXPO_PUBLIC_API_URL" ]; then
    echo "   EXPO_PUBLIC_API_URL: $EXPO_PUBLIC_API_URL"
fi
echo ""

# Read version from version.json
VERSION=$(node -p "require('./version.json').version")
BUILD=$(node -p "require('./version.json').buildNumber")
TAG="v${VERSION}"

echo "📦 Version: ${VERSION} (Build ${BUILD})"
echo "🏷️  Tag: ${TAG}"
echo ""

# Set Java and Android SDK paths (for macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    export JAVA_HOME=$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home
    export PATH="$JAVA_HOME/bin:$PATH"
    export ANDROID_HOME=$HOME/Library/Android/sdk
    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools:$PATH"
fi

echo "🚀 Starting EAS production build..."
echo "🔧 Build mode: ${BUILD_MODE}"
echo ""

# Create releases directory if it doesn't exist
mkdir -p ../releases

if [ "$BUILD_MODE" = "local" ]; then
    ANDROID_FIREBASE_CONFIG="${GOOGLE_SERVICES_JSON:-$PWD/google-services.json}"
    if [[ "$ANDROID_FIREBASE_CONFIG" != /* ]]; then
        ANDROID_FIREBASE_CONFIG="$PWD/$ANDROID_FIREBASE_CONFIG"
    fi
    export GOOGLE_SERVICES_JSON="$ANDROID_FIREBASE_CONFIG"

    echo "🔐 Verifying Android Firebase client configuration..."
    EAS_BUILD_PLATFORM=android REQUIRE_ANDROID_PUSH_CONFIG=true npm run verify:android-push-config

    # Run the local build
    eas build --local --platform android --profile production

    echo ""
    echo "🔍 Finding built Android artifact..."

    # Find APK first, then AAB
    ARTIFACT_FILE=$(find . -name "*.apk" -type f -not -path "*/node_modules/*" | head -1)
    if [ -z "$ARTIFACT_FILE" ]; then
        ARTIFACT_FILE=$(find . -name "*.aab" -type f -not -path "*/node_modules/*" | head -1)
    fi

    if [ -z "$ARTIFACT_FILE" ]; then
        echo "❌ Error: Android artifact not found after build"
        echo "Please check the build output for errors"
        exit 1
    fi

    ARTIFACT_EXT="${ARTIFACT_FILE##*.}"
    RELEASE_ARTIFACT="../releases/sharedmoney-${VERSION}.${ARTIFACT_EXT}"
    cp "$ARTIFACT_FILE" "$RELEASE_ARTIFACT"
else
    # Run cloud build and wait for completion
    BUILD_JSON=$(eas build --platform android --profile production --non-interactive --wait --json)

    BUILD_URL=$(echo "$BUILD_JSON" | node -e "
let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => {
  const data = JSON.parse(raw);
  const build = Array.isArray(data) ? data[0] : data;
  const url = build?.artifacts?.buildUrl || build?.artifacts?.applicationArchiveUrl || '';
  if (!url) process.exit(1);
  process.stdout.write(url);
});
")

    if [ -z "$BUILD_URL" ]; then
        echo "❌ Error: Could not find build artifact URL from EAS cloud build output"
        exit 1
    fi

    ARTIFACT_FILENAME=$(echo "$BUILD_URL" | sed 's|?.*||' | awk -F/ '{print $NF}')
    ARTIFACT_EXT="${ARTIFACT_FILENAME##*.}"
    if [ -z "$ARTIFACT_EXT" ] || [ "$ARTIFACT_EXT" = "$ARTIFACT_FILENAME" ]; then
        ARTIFACT_EXT="aab"
    fi

    RELEASE_ARTIFACT="../releases/sharedmoney-${VERSION}.${ARTIFACT_EXT}"
    echo "⬇️  Downloading build artifact from EAS..."
    curl -L "$BUILD_URL" -o "$RELEASE_ARTIFACT"
fi

echo "✅ Android artifact ready for release: $RELEASE_ARTIFACT"
echo ""
echo "📝 Next steps to create GitHub release:"
echo ""
echo "1. Create a git tag:"
echo "   git tag ${TAG}"
echo "   git push origin ${TAG}"
echo ""
echo "2. Go to GitHub and create a release:"
echo "   https://github.com/onima-tech/sharedmoney-app/releases/new"
echo ""
echo "3. Select tag: ${TAG}"
echo "4. Title: Release ${TAG}"
echo "5. Description:"
echo "   ## SharedMoney ${VERSION}"
echo "   "
echo "   Build Number: ${BUILD}"
echo "   "
echo "   ### Installation"
echo "   1. Download the APK file below"
echo "   2. Enable \"Install from unknown sources\" on your Android device"
echo "   3. Install the APK"
echo "   "
echo "   ### Changes"
echo "   See [CHANGELOG.md](../CHANGELOG.md) for details."
echo ""
echo "6. Upload the artifact file: $RELEASE_ARTIFACT"
echo "7. Click 'Publish release'"
echo ""
