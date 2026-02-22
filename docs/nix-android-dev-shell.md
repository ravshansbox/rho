# Nix dev shell for Android (Capacitor)

This repo includes a `flake.nix` that provides a reproducible shell with:

- JDK 17
- Node 22
- Gradle
- Android SDK (platform 34 + build-tools 34.0.0 + platform-tools)

## Usage

```bash
nix develop
```

Inside the shell, verify toolchain:

```bash
echo "$JAVA_HOME"
echo "$ANDROID_SDK_ROOT"
java -version
```

Then run mobile build flow:

```bash
npm run -s mobile:build
npm run -s mobile:sync
cd mobile/rho-android/android
./gradlew assembleDebug
```

## Notes

- Android licenses are accepted via flake nixpkgs config (`android_sdk.accept_license = true`).
- Generated Gradle/Android user state is kept local to the repo (`.gradle/`, `.android/`).
