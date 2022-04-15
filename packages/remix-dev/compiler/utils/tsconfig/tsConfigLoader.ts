import * as path from "path";
import * as fs from "fs";
import JSON5 from "json5";
import stripBom from "strip-bom";
import * as colors from "../../../colors";

/**
 * Typing for the parts of tsconfig that we care about
 */
export interface TsConfig {
  extends?: string;
  compilerOptions?: {
    baseUrl?: string;
    paths?: { [key: string]: Array<string> };
    strict?: boolean;
  };
}

export interface TsConfigLoaderResult {
  tsConfigPath: string | undefined;
  baseUrl: string | undefined;
  paths: { [key: string]: Array<string> } | undefined;
}

export interface TsConfigLoaderParams {
  getEnv: (key: string) => string | undefined;
  cwd: string;
  loadSync?(
    cwd: string,
    filename?: string,
    baseUrl?: string
  ): TsConfigLoaderResult;
}

export function tsConfigLoader({
  cwd,
}: TsConfigLoaderParams): TsConfigLoaderResult {
  let loadResult = loadSync(cwd);
  return loadResult;
}

function loadSync(cwd: string): TsConfigLoaderResult {
  // Tsconfig.loadSync uses path.resolve. This is why we can use an absolute path as filename
  let configPath = resolveConfigPath(cwd);

  if (!configPath) {
    return {
      tsConfigPath: undefined,
      baseUrl: undefined,
      paths: undefined,
    };
  }

  let config = parseTsConfig(configPath);

  writeConfigurationDefaults(config, configPath);

  return {
    tsConfigPath: configPath,
    baseUrl: config && config.compilerOptions && config.compilerOptions.baseUrl,
    paths: config && config.compilerOptions && config.compilerOptions.paths,
  };
}

function resolveConfigPath(cwd: string): string | undefined {
  if (fs.statSync(cwd).isFile()) {
    return path.resolve(cwd);
  }

  let configAbsolutePath = walkForTsConfig(cwd);
  return configAbsolutePath ? path.resolve(configAbsolutePath) : undefined;
}

function walkForTsConfig(
  directory: string,
  existsSync: (path: string) => boolean = fs.existsSync
): string | undefined {
  let configPath = path.join(directory, "./tsconfig.json");
  if (existsSync(configPath)) {
    return configPath;
  }

  configPath = path.join(directory, "./jsconfig.json");
  if (existsSync(configPath)) {
    return configPath;
  }

  let parentDirectory = path.join(directory, "../");

  // If we reached the top
  if (directory === parentDirectory) {
    return undefined;
  }

  return walkForTsConfig(parentDirectory, existsSync);
}

function parseTsConfig(
  configFilePath: string,
  existsSync: (path: string) => boolean = fs.existsSync,
  readFileSync: (filename: string) => string = (filename: string) =>
    fs.readFileSync(filename, "utf8")
): TsConfig | undefined {
  if (!existsSync(configFilePath)) {
    return undefined;
  }

  let configString = readFileSync(configFilePath);
  let cleanedJson = stripBom(configString);
  let config = JSON5.parse<TsConfig>(cleanedJson);
  let extendedConfig = config.extends;

  if (extendedConfig) {
    if (
      typeof extendedConfig === "string" &&
      extendedConfig.indexOf(".json") === -1
    ) {
      extendedConfig += ".json";
    }
    let currentDir = path.dirname(configFilePath);
    let extendedConfigPath = path.join(currentDir, extendedConfig);
    if (
      extendedConfig.indexOf("/") !== -1 &&
      extendedConfig.indexOf(".") !== -1 &&
      !existsSync(extendedConfigPath)
    ) {
      extendedConfigPath = path.join(
        currentDir,
        "node_modules",
        extendedConfig
      );
    }

    let base =
      parseTsConfig(extendedConfigPath, existsSync, readFileSync) || {};

    // baseUrl should be interpreted as relative to the base tsconfig,
    // but we need to update it so it is relative to the original tsconfig being loaded
    if (base.compilerOptions && base.compilerOptions.baseUrl) {
      let extendsDir = path.dirname(extendedConfig);
      base.compilerOptions.baseUrl = path.join(
        extendsDir,
        base.compilerOptions.baseUrl
      );
    }

    return {
      ...base,
      ...config,
      compilerOptions: {
        ...base.compilerOptions,
        ...config.compilerOptions,
      },
    };
  }
  return config;
}

type DesiredCompilerOptionsShape = {
  [key: string]: { suggested: any } | { value: any; reason: string };
};

function getDesiredCompilerOptions(): DesiredCompilerOptionsShape {
  return {
    // These are suggested values and will be set when not present in the
    // tsconfig.json
    target: { suggested: "ES2019" },
    lib: { suggested: ["DOM", "DOM.Iterable", "ES2019"] },
    allowJs: { suggested: true },
    strict: { suggested: true },
    baseUrl: { suggested: "." },
    forceConsistentCasingInFileNames: { suggested: true },

    // These values are required and cannot be changed by the user
    // Keep this in sync with esbuild
    esModuleInterop: {
      value: true,
      reason: "requirement for esbuild",
    },
    isolatedModules: {
      value: true,
      reason: "requirement for esbuild",
    },
    jsx: {
      value: "react-jsx",
      reason: "requirement for esbuild",
    },
    moduleResolution: {
      value: "node",
      reason: "to match esbuild",
    },
    resolveJsonModule: {
      value: true,
      reason: "to match esbuild",
    },
    noEmit: {
      value: true,
      reason: "Remix takes care of building everything in `remix build`.",
    },
  };
}

export function writeConfigurationDefaults(config: any, configPath: string) {
  let configType = path.basename(configPath);

  let suggestedActions: string[] = [];
  let requiredActions: string[] = [];

  let desiredCompilerOptions = getDesiredCompilerOptions();
  for (let optionKey of Object.keys(desiredCompilerOptions)) {
    let check = desiredCompilerOptions[optionKey];
    if ("suggested" in check) {
      if (!(optionKey in config)) {
        let optionValue = config.compilerOptions[optionKey];
        if (optionValue === undefined) {
          optionValue = check.suggested;
          suggestedActions.push(
            colors.blue(optionKey) +
              " was set to " +
              colors.bold(check.suggested)
          );
        }
      }
    } else if ("value" in check) {
      let optionValue = config.compilerOptions[optionKey];
      if (check.value !== optionValue) {
        config.compilerOptions[optionKey] = check.value;
        requiredActions.push(
          colors.blue(optionKey) +
            " was set to " +
            colors.bold(check.value) +
            ` (${check.reason})`
        );
      }
    }
  }

  if (!("include" in config)) {
    config.include = ["remix.env.d.ts", "**/*.ts", "**/*.tsx"];
    suggestedActions.push(
      colors.blue("include") +
        " was set to " +
        colors.bold(`['remix.env.d.ts', '**/*.ts', '**/*.tsx']`)
    );
  }

  if (suggestedActions.length < 1 && requiredActions.length < 1) {
    return;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  if (suggestedActions.length) {
    console.log(
      `The following suggested values were added to your ${colors.blue(
        `"${configType}"`
      )}. These values ${colors.bold(
        "can be changed"
      )} to fit your project's needs:\n`
    );

    suggestedActions.forEach((action) => console.log(`\t- ${action}`));
    console.log("");
  }

  if (requiredActions.length) {
    console.log(
      `The following ${colors.bold(
        "mandatory changes"
      )} were made to your ${colors.blue(configType)}:\n`
    );

    requiredActions.forEach((action) => console.log(`\t- ${action}`));
    console.log("");
  }
}
