{
  description = "rho dev shell with Java + Android SDK for Capacitor builds";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachSystem [
      "x86_64-linux"
      "aarch64-linux"
    ] (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };

        jdk = pkgs.jdk17;
        node = pkgs.nodejs_22;

        androidComposition = pkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "34" ];
          buildToolsVersions = [ "34.0.0" ];
          abiVersions = [
            "x86_64"
            "arm64-v8a"
          ];
          includeEmulator = false;
          includeNDK = false;
          includeSystemImages = false;
          includeSources = false;
          useGoogleAPIs = false;
        };

        androidSdk = androidComposition.androidsdk;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            node
            jdk
            pkgs.gradle
            pkgs.git
            androidSdk
          ];

          shellHook = ''
            # Java
            export JAVA_HOME=${jdk}/lib/openjdk
            export PATH="$JAVA_HOME/bin:$PATH"

            # Android SDK (path differs slightly across Android SDK derivations)
            ANDROID_SDK_CANDIDATE="${androidSdk}/libexec/android-sdk"
            if [ -d "$ANDROID_SDK_CANDIDATE" ]; then
              export ANDROID_SDK_ROOT="$ANDROID_SDK_CANDIDATE"
            else
              export ANDROID_SDK_ROOT="${androidSdk}"
            fi
            export ANDROID_HOME="$ANDROID_SDK_ROOT"
            export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

            # Keep generated state local to repo
            export GRADLE_USER_HOME="$PWD/.gradle"
            export ANDROID_USER_HOME="$PWD/.android"

            echo "[rho] nix dev shell ready"
            echo "  JAVA_HOME=$JAVA_HOME"
            echo "  ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
          '';
        };
      }
    );
}
