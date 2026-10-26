#!/bin/bash

# Build script for creating production APK and automatically creating GitHub release
# 
# This script:
# 1. Builds a production Android APK using EAS
# 2. Finds and renames the APK with version info
# 3. Creates a git tag
# 4. Creates a GitHub release with the APK (if gh CLI is available)
#
# Usage:
#   ./build-release-auto.sh                              - Android local build + release flow
#   ./build-release-auto.sh cloud                        - Android cloud build + release flow
#   ./build-release-auto.sh cloud ios                    - iOS cloud build (download artifact)
#   ./build-release-auto.sh local android                - Explicit Android local build
#   ./build-release-auto.sh preview                      - Preview release notes without building

set -e

BUILD_MODE="local"
TARGET_PLATFORM="android"
PREVIEW_MODE=false

for arg in "$@"; do
    case "$arg" in
        cloud)
            BUILD_MODE="cloud"
            ;;
        local)
            BUILD_MODE="local"
            ;;
        ios)
            TARGET_PLATFORM="ios"
            ;;
        android)
            TARGET_PLATFORM="android"
            ;;
        preview)
            PREVIEW_MODE=true
            ;;
    esac
done

# Function to get commits for a release
get_release_commits() {
    local tag=$1
    local ALL_TAGS=$(git tag --sort=-v:refname 2>/dev/null | head -10)
    local PREVIOUS_TAG=""
    local COMMITS=""
    
    if [ -z "$ALL_TAGS" ]; then
        COMMITS=$(git log --oneline --no-merges --format="- %s" HEAD | head -20 | tr '\n' '|')
        echo "(beginning of repo)|${COMMITS%|}"
        return
    fi
    
    # Find the previous tag (not the current one)
    for tag_item in $ALL_TAGS; do
        if [ "$tag_item" != "$tag" ]; then
            PREVIOUS_TAG=$tag_item
            break
        fi
    done
    
    if [ -z "$PREVIOUS_TAG" ]; then
        COMMITS=$(git log --oneline --no-merges --format="- %s" HEAD | head -20 | tr '\n' '|')
        echo "(beginning of repo)|${COMMITS%|}"
    else
        COMMITS=$(git log --oneline --no-merges --format="- %s" ${PREVIOUS_TAG}..HEAD | head -20 | tr '\n' '|')
        echo "${PREVIOUS_TAG}|${COMMITS%|}"
    fi
}

# Function to generate release notes from commits (returns formatted text)
generate_release_notes() {
    local version=$1
    local build=$2
    local tag="v${version}"
    
    # Get commits
    local COMMIT_DATA=$(get_release_commits "$tag")
    local PREVIOUS_TAG=$(echo "$COMMIT_DATA" | cut -d'|' -f1)
    local COMMITS=$(echo "$COMMIT_DATA" | cut -d'|' -f2- | sed 's/|/\n/g')
    
    # If no commits found, use a default message
    if [ -z "$COMMITS" ] || [ "$COMMITS" = "" ]; then
        COMMITS="- No changes recorded"
    fi
    
    # Return the formatted notes
    cat <<EOF
## SharedMoney ${version}

Build Number: ${build}

### Installation
1. Download the APK file below
2. Enable "Install from unknown sources" on your Android device
3. Install the APK

### Changes
${COMMITS}
EOF
}

# Function to preview release notes (with detailed output)
preview_release_notes() {
    local version=$1
    local build=$2
    local tag="v${version}"
    
    # Get commits
    local COMMIT_DATA=$(get_release_commits "$tag")
    local PREVIOUS_TAG=$(echo "$COMMIT_DATA" | cut -d'|' -f1)
    local COMMITS=$(echo "$COMMIT_DATA" | cut -d'|' -f2- | sed 's/|/\n/g')
    
    # If no commits found, use a default message
    if [ -z "$COMMITS" ] || [ "$COMMITS" = "" ]; then
        COMMITS="- No changes recorded"
    fi
    
    # Count commits (count lines that start with "-")
    local COMMIT_COUNT=$(echo "$COMMITS" | grep -c "^-" || echo "0")
    
    if [ "$PREVIOUS_TAG" != "(beginning of repo)" ]; then
        echo "ℹ️  Commits since ${PREVIOUS_TAG}:"
    else
        echo "ℹ️  No previous tags found. Showing last 20 commits:"
    fi
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 Release Notes Preview for ${tag}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "## SharedMoney ${version}"
    echo ""
    echo "Build Number: ${build}"
    echo ""
    echo "### Installation"
    echo "1. Download the APK file below"
    echo "2. Enable \"Install from unknown sources\" on your Android device"
    echo "3. Install the APK"
    echo ""
    echo "### Changes (${COMMIT_COUNT} commits since ${PREVIOUS_TAG})"
    echo "$COMMITS"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Function to show past release notes
show_past_release() {
    local tag=$1
    
    if ! git rev-parse "$tag" >/dev/null 2>&1; then
        echo "❌ Tag ${tag} not found"
        return 1
    fi
    
    # Extract version from tag
    local version=${tag#v}
    
    # Get the tag before this one
    ALL_TAGS=$(git tag --sort=-v:refname 2>/dev/null)
    PREVIOUS_TAG=""
    FOUND_CURRENT=false
    
    for tag_item in $ALL_TAGS; do
        if [ "$FOUND_CURRENT" = true ]; then
            PREVIOUS_TAG=$tag_item
            break
        fi
        if [ "$tag_item" = "$tag" ]; then
            FOUND_CURRENT=true
        fi
    done
    
    if [ -z "$PREVIOUS_TAG" ]; then
        echo "ℹ️  This was the first release. Showing all commits up to ${tag}:"
        COMMITS=$(git log --oneline --no-merges --format="- %s" ${tag} | head -20)
        PREVIOUS_TAG="(beginning of repo)"
    else
        echo "ℹ️  Commits in ${tag} (since ${PREVIOUS_TAG}):"
        COMMITS=$(git log --oneline --no-merges --format="- %s" ${PREVIOUS_TAG}..${tag} | head -20)
    fi
    
    COMMIT_COUNT=$(echo "$COMMITS" | grep -c "^-" || echo "0")
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 Release Notes for ${tag}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "## SharedMoney ${version}"
    echo ""
    echo "### Changes (${COMMIT_COUNT} commits since ${PREVIOUS_TAG})"
    echo "$COMMITS"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Check for preview mode
if [ "$PREVIEW_MODE" = true ]; then
    echo "🔍 Preview Mode - Release Notes Generator"
    echo "=========================================="
    echo ""
    
    # Read version from version.json
    VERSION=$(node -p "require('./version.json').version")
    BUILD=$(node -p "require('./version.json').buildNumber")
    TAG="v${VERSION}"
    
    echo "Current version: ${VERSION} (Build ${BUILD})"
    echo "Tag: ${TAG}"
    echo ""
    
    # Show current version preview
    preview_release_notes "$VERSION" "$BUILD"
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📚 Past Releases:"
    echo ""
    
    # Show past releases
    PAST_TAGS=$(git tag --sort=-v:refname 2>/dev/null | head -5)
    if [ -z "$PAST_TAGS" ]; then
        echo "No previous releases found."
    else
        for past_tag in $PAST_TAGS; do
            show_past_release "$past_tag"
        done
    fi
    
    exit 0
fi

echo "🔨 Building SharedMoney ${TARGET_PLATFORM^^} Production Artifact for Release"
echo "==========================================================================="
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
echo "📱 Platform: ${TARGET_PLATFORM}"
echo ""

# Create releases directory if it doesn't exist
mkdir -p ../releases

RELEASE_ARTIFACT=""
ARTIFACT_KIND="artifact"

if [ "$TARGET_PLATFORM" = "ios" ] && [ "$BUILD_MODE" = "local" ]; then
    echo "❌ iOS local builds are not supported by this script."
    echo "Use cloud mode: ./build-release-auto.sh cloud ios"
    exit 1
fi

if [ "$TARGET_PLATFORM" = "android" ] && [ "$BUILD_MODE" = "local" ]; then
    ANDROID_FIREBASE_CONFIG="${GOOGLE_SERVICES_JSON:-$PWD/google-services.json}"
    if [[ "$ANDROID_FIREBASE_CONFIG" != /* ]]; then
        ANDROID_FIREBASE_CONFIG="$PWD/$ANDROID_FIREBASE_CONFIG"
    fi
    export GOOGLE_SERVICES_JSON="$ANDROID_FIREBASE_CONFIG"

    echo "🔐 Verifying Android Firebase client configuration..."
    EAS_BUILD_PLATFORM=android REQUIRE_ANDROID_PUSH_CONFIG=true npm run verify:android-push-config

    # Run local build
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
elif [ "$TARGET_PLATFORM" = "android" ] && [ "$BUILD_MODE" = "cloud" ]; then
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
elif [ "$TARGET_PLATFORM" = "ios" ] && [ "$BUILD_MODE" = "cloud" ]; then
    # Run iOS cloud build and wait for completion
    BUILD_JSON=$(eas build --platform ios --profile production --non-interactive --wait --json)

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
        echo "❌ Error: Could not find iOS build artifact URL from EAS cloud build output"
        exit 1
    fi

    ARTIFACT_FILENAME=$(echo "$BUILD_URL" | sed 's|?.*||' | awk -F/ '{print $NF}')
    ARTIFACT_EXT="${ARTIFACT_FILENAME##*.}"
    if [ -z "$ARTIFACT_EXT" ] || [ "$ARTIFACT_EXT" = "$ARTIFACT_FILENAME" ]; then
        ARTIFACT_EXT="ipa"
    fi

    RELEASE_ARTIFACT="../releases/sharedmoney-ios-${VERSION}.${ARTIFACT_EXT}"
    echo "⬇️  Downloading iOS build artifact from EAS..."
    curl -L "$BUILD_URL" -o "$RELEASE_ARTIFACT"
else
    echo "❌ Unsupported mode combination: platform=${TARGET_PLATFORM}, mode=${BUILD_MODE}"
    exit 1
fi

if [ "${RELEASE_ARTIFACT##*.}" = "apk" ]; then
    ARTIFACT_KIND="APK"
elif [ "${RELEASE_ARTIFACT##*.}" = "aab" ]; then
    ARTIFACT_KIND="AAB"
elif [ "${RELEASE_ARTIFACT##*.}" = "ipa" ]; then
    ARTIFACT_KIND="IPA"
fi

echo "✅ ${ARTIFACT_KIND} ready: $RELEASE_ARTIFACT"
echo ""

# iOS builds generally go through App Store Connect, not GitHub Releases.
if [ "$TARGET_PLATFORM" = "ios" ]; then
    echo "ℹ️ iOS artifact built successfully."
    echo "➡️  Submit with: eas submit --platform ios --profile production --path $RELEASE_ARTIFACT"
    exit 0
fi

# Check if gh CLI is available (Android release flow)
if command -v gh &> /dev/null; then
    echo "📦 Creating GitHub release..."
    echo ""
    
    # Generate release notes using the function
    echo "📝 Generating release notes from git commits..."
    RELEASE_NOTES=$(generate_release_notes "$VERSION" "$BUILD" 2>/dev/null)
    
    # Create tag if it doesn't exist
    if ! git rev-parse "$TAG" >/dev/null 2>&1; then
        echo "Creating git tag: ${TAG}"
        git tag "${TAG}"
        git push origin "${TAG}"
    fi
    
    # Create GitHub release
    gh release create "${TAG}" \
        --title "Release ${TAG}" \
        --notes "$RELEASE_NOTES" \
        "${RELEASE_ARTIFACT}" \
        --repo onima-tech/sharedmoney-app
    
    echo ""
    echo "✅ GitHub release created successfully!"
    echo "   https://github.com/onima-tech/sharedmoney-app/releases/tag/${TAG}"
else
    echo "📝 Manual release steps (gh CLI not found):"
    echo ""
    echo "1. Create a git tag:"
    echo "   git tag ${TAG}"
    echo "   git push origin ${TAG}"
    echo ""
    echo "2. Go to GitHub and create a release:"
    echo "   https://github.com/onima-tech/sharedmoney-app/releases/new"
    echo ""
    echo "3. Select tag: ${TAG}"
    echo "4. Upload artifact: $RELEASE_ARTIFACT"
    echo "5. Click 'Publish release'"
fi
