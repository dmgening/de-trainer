# services.de-trainer: the server as a systemd unit, its data directory and a
# root-only `de-trainer-admin` that runs the admin CLI as the service user
# against the same database. Nothing here is secret: Access AUD tags and the
# team domain are public identifiers, so no environment file is needed.
{ self }:
{ config, lib, pkgs, ... }:

let
  cfg = config.services.de-trainer;
  dataDir = "/var/lib/de-trainer";

  environment = {
    APP_ENV = "prod";
    HOST = cfg.host;
    PORT = toString cfg.port;
    DATA_DIR = dataDir;
    ACCESS_TEAM_DOMAIN = cfg.access.teamDomain;
    ACCESS_AUD_USER = lib.concatStringsSep "," cfg.access.userAudiences;
    ACCESS_AUD_AGENT = lib.concatStringsSep "," cfg.access.agentAudiences;
    LOG_LEVEL = cfg.logLevel;
  };

  admin = pkgs.writeShellApplication {
    name = "de-trainer-admin";
    runtimeInputs = [ pkgs.util-linux ];
    text = ''
      ${lib.toShellVars environment}
      export ${lib.concatStringsSep " " (lib.attrNames environment)}
      exec runuser -u de-trainer -- ${lib.getExe' cfg.package "de-trainer-admin"} "$@"
    '';
  };
in
{
  options.services.de-trainer = {
    enable = lib.mkEnableOption "the de-class German trainer";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "de-trainer.packages.\${system}.default";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Listen address; 0.0.0.0 when the reverse proxy runs on another host.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8080;
    };

    logLevel = lib.mkOption {
      type = lib.types.enum [ "fatal" "error" "warn" "info" "debug" "trace" "silent" ];
      default = "info";
    };

    access = {
      teamDomain = lib.mkOption {
        type = lib.types.strMatching "https://[a-z0-9-]+\\.cloudflareaccess\\.com";
        example = "https://example.cloudflareaccess.com";
        description = "Cloudflare Access team domain; the server fetches its JWKS from here.";
      };
      userAudiences = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        description = "AUD tags of the Access application on /api and /auth (de-class owner).";
      };
      agentAudiences = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        description = "AUD tags of the Access application on /agent (de-class agent).";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [{
      assertion = cfg.access.userAudiences != [ ] && cfg.access.agentAudiences != [ ];
      message = "services.de-trainer.access: set the AUD tags of both Access applications.";
    }];

    users.users.de-trainer = {
      isSystemUser = true;
      group = "de-trainer";
      home = dataDir;
    };
    users.groups.de-trainer = { };

    environment.systemPackages = [ admin ];

    systemd.services.de-trainer = {
      description = "de-class German trainer";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      inherit environment;
      serviceConfig = {
        # Migrations are additive (tech-spec), so the previous generation still
        # runs on a migrated database after a rollback.
        ExecStartPre = lib.getExe' cfg.package "de-trainer-migrate";
        ExecStart = lib.getExe cfg.package;
        User = "de-trainer";
        Group = "de-trainer";
        StateDirectory = "de-trainer";
        StateDirectoryMode = "0700";
        UMask = "0077";
        Restart = "on-failure";
        RestartSec = 3;
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
      };
    };
  };
}
