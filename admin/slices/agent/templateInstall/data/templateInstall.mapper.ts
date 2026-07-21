import type {
  IInstallPreview,
  IInstallResult,
} from '../domain/templateInstall.types';

/**
 * Maps install responses onto the domain shapes. The manifest/preview/result
 * are opaque nested structures from our own API (see `IInstallManifest`'s
 * loose shape), so these are presence-validated casts rather than deep maps.
 */
export class TemplateInstallMapper {
  toPreview(raw: unknown): IInstallPreview | null {
    return raw && typeof raw === 'object' ? (raw as IInstallPreview) : null;
  }

  toResult(raw: unknown): IInstallResult | null {
    return raw && typeof raw === 'object' ? (raw as IInstallResult) : null;
  }
}
