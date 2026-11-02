{
  description = "de-class: German trainer PWA and its server";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.callPackage ./nix/package.nix {
          version = self.shortRev or self.dirtyShortRev or "dev";
        };
      });

      # Deployed from the homelab repo, which imports this module.
      nixosModules.default = import ./nix/module.nix { inherit self; };
    };
}
