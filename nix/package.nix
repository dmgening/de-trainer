# The production build: server bundle, both web builds and the server's runtime
# node_modules, with better-sqlite3 compiled from source (no prebuilt download
# in the sandbox). After any change to pnpm-lock.yaml, update pnpmDeps.hash:
# set it to "", run `nix build`, copy the hash from the mismatch error.
{
  lib,
  stdenv,
  nodejs_22,
  pnpm_11,
  fetchPnpmDeps,
  pnpmConfigHook,
  python3,
  makeBinaryWrapper,
  version ? "dev",
}:

let
  # better-sqlite3 12.x is pinned for Node 22 (13.x segfaults on it). pnpm 11:
  # nixos-26.05 marks its pnpm_10 insecure; the lockfile format is the same.
  nodejs = nodejs_22;
  pnpm = pnpm_11;
in
stdenv.mkDerivation (finalAttrs: {
  pname = "de-trainer";
  inherit version;

  # Only what the build reads, so docs and e2e changes don't rebuild the package.
  # e2e/package.json stays: the lockfile lists it as a workspace project.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../tsconfig.base.json
      ../apps
      ../packages
      ../e2e/package.json
    ];
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    # pnpm 11 rejects lockfile entries younger than minimumReleaseAge, which
    # would make this fetch depend on the day it runs. The lockfile pins every
    # tarball by integrity, so the check adds nothing here.
    prePnpmInstall = "pnpm config set minimum-release-age 0";
    hash = "sha256-bmifU6DYFJBB0t9+pn3Yvy+vGluKOjPqynSeG9mfbRo=";
  };

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    python3
    makeBinaryWrapper
  ];

  # node-gyp takes Node's headers from here instead of downloading them.
  env.npm_config_nodedir = nodejs;

  buildPhase = ''
    runHook preBuild

    pnpm build

    # Drop devDependencies (vite, tsup, playwright, ...) once the bundles exist.
    # A fresh install from the offline store, because `install --prod` over the
    # full tree leaves the dev packages in node_modules/.pnpm. The native addon
    # is compiled afterwards.
    rm -rf node_modules {apps,packages}/*/node_modules e2e/node_modules
    pnpm install --offline --prod --frozen-lockfile --ignore-scripts

    pushd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
    npm run build-release --offline
    # Keep the addon, not the object files and makefiles that reference the toolchain.
    find build -mindepth 1 -not -path build/Release -not -path build/Release/better_sqlite3.node -delete
    popd

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app=$out/lib/de-trainer
    mkdir -p $app/apps/server $app/apps/web $out/bin
    cp -r package.json node_modules $app/
    cp -r apps/server/{package.json,dist,drizzle,node_modules} $app/apps/server/
    cp -r apps/web/dist $app/apps/web/
    # tsup bundles the workspace packages into dist/, so their links (into
    # packages/ and e2e/, not shipped) would only dangle.
    rm -r $app/node_modules/.pnpm/node_modules/@de-trainer $app/apps/server/node_modules/@de-trainer

    # The server finds drizzle/ and the web builds relative to its dist/, so the
    # wrappers need no paths. Configuration comes from the environment (config.ts).
    makeWrapper ${lib.getExe nodejs} $out/bin/de-trainer-server \
      --add-flags "--enable-source-maps $app/apps/server/dist/main.js"
    makeWrapper ${lib.getExe nodejs} $out/bin/de-trainer-migrate \
      --add-flags "--enable-source-maps $app/apps/server/dist/migrate.js"
    makeWrapper ${lib.getExe nodejs} $out/bin/de-trainer-admin \
      --add-flags "--enable-source-maps $app/apps/server/dist/admin.js"

    runHook postInstall
  '';

  meta = {
    description = "de-class: German trainer PWA and its Node server";
    mainProgram = "de-trainer-server";
    platforms = lib.platforms.linux;
  };
})
