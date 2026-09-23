import {
  SETTING_CATALOG,
  describeSettingCatalog,
  findSettingDefinition,
  nearestSettingDefinition,
} from './settingCatalog';

describe('SETTING_CATALOG', () => {
  it('is non-empty and every entry is complete', () => {
    expect(SETTING_CATALOG.length).toBeGreaterThan(0);
    for (const def of SETTING_CATALOG) {
      expect(def.group).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(['string', 'json']).toContain(def.valueType);
      expect(typeof def.restartRequired).toBe('boolean');
    }
  });

  it('has no duplicate keys', () => {
    const keys = SETTING_CATALOG.map((d) => `${d.group}.${d.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('marks every password-type console field as secret', () => {
    for (const key of [
      'integrations.github_pat',
      'integrations.bridle_api_key',
      'integrations.aws_secret_access_key',
      'knowledge.api_key',
    ]) {
      const [group, name] = key.split('.');
      expect(findSettingDefinition(group, name)?.secret).toBe(true);
    }
  });
});

describe('describeSettingCatalog', () => {
  it('mentions every key with its meaning and flags', () => {
    const text = describeSettingCatalog();
    for (const def of SETTING_CATALOG) {
      expect(text).toContain(`${def.group}.${def.name} — ${def.description}`);
    }
    expect(text).toContain('[integrations]');
    expect(text).toContain('(string, restart required)');
    expect(text).toContain('(json)');
  });
});

describe('findSettingDefinition', () => {
  it('finds an exact key and nothing else', () => {
    expect(
      findSettingDefinition('auth', 'registration_enabled')?.valueType,
    ).toBe('string');
    expect(findSettingDefinition('auth', 'registration')).toBeNull();
    expect(findSettingDefinition('nope', 'registration_enabled')).toBeNull();
  });
});

describe('nearestSettingDefinition', () => {
  it('finds an obvious near miss in the same group', () => {
    expect(nearestSettingDefinition('integrations', 's3_buckt')?.name).toBe(
      's3_bucket',
    );
    expect(nearestSettingDefinition('auth', 'registration')?.name).toBe(
      'registration_enabled',
    );
    expect(nearestSettingDefinition('knowledge', 'ocr_pages')?.name).toBe(
      'ocr_max_pages',
    );
  });

  it('never crosses groups and gives up when nothing overlaps', () => {
    expect(nearestSettingDefinition('auth', 's3_bucket')).toBeNull();
    expect(nearestSettingDefinition('integrations', 'zzz')).toBeNull();
    expect(nearestSettingDefinition('unknown_group', 's3_bucket')).toBeNull();
  });
});
