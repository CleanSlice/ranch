import { IManifest, IInstallParamValues } from './templateInstall.types';

export abstract class IManifestGateway {
  // Parse YAML and return a fully-validated manifest. Throws on schema
  // violations with a message listing every problem found.
  abstract parse(yamlSource: string): IManifest;

  // Validate operator-supplied params against the manifest's `params`
  // declarations. Returns the normalized value map (defaults applied,
  // types coerced). Throws if a required param is missing or fails
  // validation.
  abstract validateParams(
    manifest: IManifest,
    supplied: IInstallParamValues,
  ): IInstallParamValues;

  // Render `{{ params.* }}` placeholders in a text file body.
  // Unknown placeholders are left intact (defensive — never silently
  // drop content). Secrets are NEVER substituted at install time —
  // they are referenced by runtime via process.env.
  abstract render(body: string, params: IInstallParamValues): string;
}
