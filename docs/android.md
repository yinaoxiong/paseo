# Android

## App variants

Controlled by `APP_VARIANT` in `packages/app/app.config.js` (vanilla Expo, no custom Gradle plugin):

| Variant       | App name    | Package ID       |
| ------------- | ----------- | ---------------- |
| `production`  | Paseo       | `sh.paseo`       |
| `development` | Paseo Debug | `sh.paseo.debug` |

EAS profiles: `development`, `production`, and `production-apk` in `packages/app/eas.json`.

`development` uses Android `debug`.

## Local build + install

From repo root:

```bash
npm run android:development    # Debug build
npm run android:production     # Release build
npm run android:clear          # Remove generated Android project
```

Or from `packages/app`:

```bash
# Debug
npx cross-env APP_VARIANT=development expo prebuild --platform android --non-interactive
npx cross-env APP_VARIANT=development expo run:android --variant=debug

# Release
npx cross-env APP_VARIANT=production expo prebuild --platform android --non-interactive
npx cross-env APP_VARIANT=production expo run:android --variant=release

# Clear generated Android project
rm -rf android
```

## Docker arm64 APK smoke builds

For local Android APK smoke testing without EAS, use the project Android builder image. This is
intended for personal verification builds, not store release publishing.

Build or refresh the cached builder image:

```bash
npm run android:builder:image
```

Build an arm64-only release APK:

```bash
npm run android:apk:arm64
```

The APK is written to:

```text
.local-build/paseo-android-arm64-<version>.apk
```

The builder image is defined in `docker/android-builder/Dockerfile` and is based on
`reactnativecommunity/react-native-android:v20.1`. The image preinstalls the static Android
toolchain components this app needs:

- Android platform `android-36`
- Build Tools `36.0.0` and `35.0.0`
- CMake `3.22.1`
- NDK `27.1.12297006` and `27.0.12077973`

The builder image and APK script point npm at the Tencent npm mirror with
`NPM_CONFIG_REGISTRY=https://mirrors.tencent.com/npm/` and
`NPM_CONFIG_REPLACE_REGISTRY_HOST=npmjs`, so lockfile `registry.npmjs.org` tarball URLs are
rewritten to the mirror during `npm ci` without rewriting tarball URLs that are already on the
mirror.

The APK script copies the current Git working tree's tracked and unignored files into a temporary
`.local-build/android-arm64-build` workspace, then runs the build inside Docker. This keeps
`expo prebuild` and generated `packages/app/android` files out of the main checkout. It uses named
Docker volumes for `node_modules` and Gradle caches, so host-side `node_modules` directories are not
created.

Build steps performed by `npm run android:apk:arm64`:

1. `npm ci --ignore-scripts`
2. `npm run build:app-deps`
3. `APP_VARIANT=production CI=1 NODE_ENV=production npx expo prebuild --platform android --no-install`
4. Set `reactNativeArchitectures=arm64-v8a` in generated `android/gradle.properties`
5. `./gradlew :app:assembleRelease -x lint -x test --no-daemon`
6. Verify the APK contains only `arm64-v8a` native libraries
7. Verify the APK signature with `apksigner`

Useful knobs:

```bash
PASEO_ANDROID_BUILDER_IMAGE=my-image:tag npm run android:builder:image
PASEO_ANDROID_BUILDER_IMAGE=my-image:tag npm run android:apk:arm64
npm run android:apk:arm64 -- --output .local-build/my-test.apk
npm run android:apk:arm64 -- --keep-workdir
PASEO_ANDROID_SKIP_NPM_CI=1 npm run android:apk:arm64
```

The generated APK is debug-signed by the local Gradle release configuration when no release signing
credentials are provided. It is suitable for temporary installation/testing, not Play Store upload.
Use EAS or the release workflows for signed distribution builds.

### React version lockstep

Keep `react` and `react-dom` pinned to the React version embedded by the current `react-native` release. React Native `0.81.x` embeds `react-native-renderer` `19.1.0`, so `packages/app` must use React `19.1.0`. Bumping React to a newer patch can build successfully but crash at JS startup on Android with `Incompatible React versions`, leaving the app on the native splash screen.

## Screenshots

```bash
adb exec-out screencap -p > screenshot.png
```

## Cloud build + submit (EAS)

Stable tag pushes like `v0.1.0` trigger:

- The EAS GitHub app on Expo servers (iOS + Android production builds + store submit). There is no workflow file in this repo for it.
- `.github/workflows/android-apk-release.yml` on GitHub Actions (APK asset on GitHub Release).

iOS auto-submits to App Store review via a Fastlane lane after EAS uploads to TestFlight. Android auto-submits to the Play Store via EAS-managed credentials.

Beta tags like `v0.1.1-beta.1` only trigger the GitHub APK workflow. They publish a GitHub prerelease APK for testing and do not submit to the stores.

`android-v*` tags also trigger only the GitHub APK workflow — useful when you want to ship an APK without going through stores. The GitHub APK workflow supports `workflow_dispatch` with an existing `tag` input so you can rebuild without cutting a new tag.

### Useful commands

```bash
cd packages/app

# Recent builds
npx eas build:list --limit 10 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Inspect a build (the printed `Logs` URL opens the build's Expo dashboard page,
# which has a Submissions section showing the auto-submit to the Play Store).
npx eas build:view <build-id>
```

The Play Console (Internal testing → Production tracks) is the final confirmation that the binary reached the store.

See [docs/release.md](release.md) for the full mobile-build babysitting flow.
