import { Injectable, BadRequestException } from '@nestjs/common';
import * as YAML from 'yaml';
import { IManifestGateway } from '../domain/manifest.gateway';
import {
  IManifest,
  IManifestParam,
  IInstallParamValues,
} from '../domain/templateInstall.types';

@Injectable()
export class ManifestGateway extends IManifestGateway {
  parse(yamlSource: string): IManifest {
    let raw: unknown;
    try {
      raw = YAML.parse(yamlSource);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`template.yaml: invalid YAML — ${msg}`);
    }
    return this.validate(raw);
  }

  validateParams(
    manifest: IManifest,
    supplied: IInstallParamValues,
  ): IInstallParamValues {
    const out: IInstallParamValues = {};
    const errors: string[] = [];
    const declared = manifest.params ?? [];

    for (const p of declared) {
      const required = p.required ?? true;
      const provided = supplied[p.name];
      if (provided === undefined || provided === null || provided === '') {
        if (p.default !== undefined) {
          out[p.name] = p.default;
          continue;
        }
        if (required) errors.push(`params.${p.name}: required`);
        continue;
      }
      const coerced = this.coerce(p, provided, errors);
      if (coerced !== undefined) out[p.name] = coerced;
    }

    // Reject extras — keeps the install surface predictable.
    for (const k of Object.keys(supplied)) {
      if (!declared.find((d) => d.name === k)) {
        errors.push(`params.${k}: not declared in manifest`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(
        `Invalid params:\n  - ${errors.join('\n  - ')}`,
      );
    }
    return out;
  }

  render(body: string, params: IInstallParamValues): string {
    // Two reference syntaxes are supported (both equivalent for params):
    //   `$param:name`             — preferred (compact, AgentSpec-style)
    //   `{{ params.name }}`       — legacy (kept for back-compat)
    // `$secret:NAME` and `$env:NAME` are NOT substituted at install time —
    // they are runtime references and must reach the agent unchanged.
    const compact = body.replace(
      /\$param:([A-Za-z_][A-Za-z0-9_]*)/g,
      (match, name: string) => {
        const v = params[name];
        return v === undefined ? match : String(v);
      },
    );
    return compact.replace(
      /\{\{\s*params\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
      (match, name: string) => {
        const v = params[name];
        return v === undefined ? match : String(v);
      },
    );
  }

  // ---- internal ----

  private validate(raw: unknown): IManifest {
    const errors: string[] = [];
    if (typeof raw !== 'object' || raw === null) {
      throw new BadRequestException(
        'template.yaml: top-level must be an object',
      );
    }
    const obj = raw as Record<string, unknown>;

    if (obj.apiVersion !== 'ranch/v1') {
      errors.push(
        `apiVersion: must be "ranch/v1" (got ${JSON.stringify(obj.apiVersion)})`,
      );
    }
    if (obj.kind !== 'AgentTemplate') {
      errors.push(
        `kind: must be "AgentTemplate" (got ${JSON.stringify(obj.kind)})`,
      );
    }

    const meta = obj.metadata as Record<string, unknown> | undefined;
    if (!meta || typeof meta !== 'object') {
      errors.push('metadata: missing');
    } else {
      for (const k of ['id', 'name', 'version', 'description'] as const) {
        if (typeof meta[k] !== 'string' || meta[k] === '') {
          errors.push(`metadata.${k}: required, must be non-empty string`);
        }
      }
      if (meta.i18n !== undefined) {
        if (
          typeof meta.i18n !== 'object' ||
          meta.i18n === null ||
          Array.isArray(meta.i18n)
        ) {
          errors.push('metadata.i18n: must be a map of locale → {name, description}');
        }
      }
    }

    const req = obj.requirements as Record<string, unknown> | undefined;
    if (req !== undefined) {
      if (typeof req !== 'object' || req === null || Array.isArray(req)) {
        errors.push('requirements: must be an object');
      } else {
        for (const arrKey of ['services', 'env'] as const) {
          const v = req[arrKey];
          if (v !== undefined && !this.isStringArray(v)) {
            errors.push(`requirements.${arrKey}: must be an array of strings`);
          }
        }
      }
    }

    const files = obj.files as Record<string, unknown> | undefined;
    if (!files || typeof files !== 'object') {
      errors.push('files: missing');
    } else {
      if (typeof files.agent !== 'string' || files.agent === '') {
        errors.push('files.agent: required, must be non-empty string');
      }
    }

    if (obj.params !== undefined) {
      if (!Array.isArray(obj.params)) {
        errors.push('params: must be an array');
      } else {
        obj.params.forEach((p: unknown, i: number) => {
          if (typeof p !== 'object' || p === null) {
            errors.push(`params[${i}]: must be an object`);
            return;
          }
          const pp = p as Record<string, unknown>;
          if (typeof pp.name !== 'string' || pp.name === '') {
            errors.push(`params[${i}].name: required`);
          }
          if (
            !['string', 'number', 'boolean', 'enum'].includes(
              pp.type as string,
            )
          ) {
            errors.push(
              `params[${i}].type: must be one of string|number|boolean|enum`,
            );
          }
          if (pp.type === 'enum') {
            if (!Array.isArray(pp.values) || pp.values.length === 0) {
              errors.push(
                `params[${i}].values: required when type=enum`,
              );
            }
          }
        });
      }
    }

    if (obj.skills !== undefined && !Array.isArray(obj.skills)) {
      errors.push('skills: must be an array');
    }
    if (obj.mcp !== undefined && !Array.isArray(obj.mcp)) {
      errors.push('mcp: must be an array');
    }
    if (obj.secrets !== undefined && !Array.isArray(obj.secrets)) {
      errors.push('secrets: must be an array');
    }

    const paddock = obj.paddock as Record<string, unknown> | undefined;
    if (paddock !== undefined) {
      if (typeof paddock !== 'object' || paddock === null || Array.isArray(paddock)) {
        errors.push('paddock: must be an object');
      } else {
        if (
          paddock.passThreshold !== undefined &&
          (typeof paddock.passThreshold !== 'number' ||
            paddock.passThreshold < 0 ||
            paddock.passThreshold > 1)
        ) {
          errors.push('paddock.passThreshold: must be a number between 0 and 1');
        }
        const requiredFor = paddock.requiredFor as
          | Record<string, unknown>
          | undefined;
        if (
          requiredFor !== undefined &&
          (typeof requiredFor !== 'object' ||
            requiredFor === null ||
            Array.isArray(requiredFor))
        ) {
          errors.push('paddock.requiredFor: must be an object with boolean fields');
        }
      }
    }

    const compliance = obj.compliance as Record<string, unknown> | undefined;
    if (compliance !== undefined) {
      if (
        typeof compliance !== 'object' ||
        compliance === null ||
        Array.isArray(compliance)
      ) {
        errors.push('compliance: must be an object');
      } else if (
        compliance.packs !== undefined &&
        !this.isStringArray(compliance.packs)
      ) {
        errors.push('compliance.packs: must be an array of strings');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(
        `Invalid template.yaml:\n  - ${errors.join('\n  - ')}`,
      );
    }
    return raw as IManifest;
  }

  private isStringArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every((x) => typeof x === 'string');
  }

  private coerce(
    p: IManifestParam,
    value: unknown,
    errors: string[],
  ): string | number | boolean | undefined {
    switch (p.type) {
      case 'string': {
        const s = String(value);
        if (p.pattern) {
          const re = new RegExp(p.pattern);
          if (!re.test(s)) {
            errors.push(`params.${p.name}: does not match pattern ${p.pattern}`);
            return undefined;
          }
        }
        return s;
      }
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isNaN(n)) {
          errors.push(`params.${p.name}: not a number`);
          return undefined;
        }
        return n;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        const s = String(value).toLowerCase();
        if (s === 'true') return true;
        if (s === 'false') return false;
        errors.push(`params.${p.name}: not a boolean`);
        return undefined;
      }
      case 'enum': {
        const s = String(value);
        if (!p.values || !p.values.includes(s)) {
          errors.push(
            `params.${p.name}: must be one of ${(p.values ?? []).join('|')}`,
          );
          return undefined;
        }
        return s;
      }
    }
  }
}
