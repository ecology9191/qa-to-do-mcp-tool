import fs from "node:fs";

const packageJsonPath = "package.json";
const tauriConfigPath = "src-tauri/tauri.conf.json";
const cargoTomlPath = "src-tauri/Cargo.toml";

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const { version } = packageJson;

if (typeof version !== "string" || version.length === 0) {
  throw new Error("package.json version must be a non-empty string");
}

const tauriConfig = fs.readFileSync(tauriConfigPath, "utf8");
const updatedTauriConfig = tauriConfig.replace(
  /^(\s*"version":\s*)"[^"]+"/m,
  `$1"${version}"`,
);

if (updatedTauriConfig === tauriConfig && !tauriConfig.includes(`"version": "${version}"`)) {
  throw new Error("Could not update src-tauri/tauri.conf.json version");
}

fs.writeFileSync(tauriConfigPath, updatedTauriConfig);

const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const updatedCargoToml = cargoToml.replace(
  /^version = ".*"$/m,
  `version = "${version}"`,
);

if (updatedCargoToml === cargoToml && !cargoToml.includes(`version = "${version}"`)) {
  throw new Error("Could not update src-tauri/Cargo.toml package version");
}

fs.writeFileSync(cargoTomlPath, updatedCargoToml);
