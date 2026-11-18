import { describe, expect, it } from 'vitest';
import {
  CustomizationStatusService,
  type CustomizationStatusDeps,
  type StatusHook,
  type StatusMcp,
  type StatusPlugin,
} from '../../../../src/main/application/services/customization-status-service.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';
import type { HealthCheck } from '../../../../src/shared/health.js';
import { WORKSPACE_SOURCE, type Entity } from '../../../../src/shared/entity.js';

const FROZEN = new Date('2026-11-17T10:00:00.000Z');

const check = (entityUrn: string, channel: HealthCheck['channel'], outcome: HealthCheck['outcome']): HealthCheck => ({
  id: `${entityUrn}:${channel ?? ''}:${outcome ?? ''}`,
  category: 'symlink',
  severity: outcome === 'installed' ? 'ok' : 'warning',
  title: 't',
  entityUrn,
  ...(channel !== undefined ? { channel } : {}),
  ...(outcome !== undefined ? { outcome } : {}),
  observedAt: FROZEN.toISOString(),
});

const detectedSkill = (name: string, harness: DetectedEntity['harness']): DetectedEntity => ({
  id: `${harness}:${name}`,
  kind: 'skill',
  name,
  description: '',
  harness,
  scope: 'personal',
  path: `/home/.${harness}/skills/${name}`,
  importable: true,
  preview: {},
});

function make(over: {
  checks?: HealthCheck[];
  detected?: DetectedEntity[];
  mcps?: StatusMcp[];
  hooks?: StatusHook[];
  plugins?: StatusPlugin[];
  entities?: Entity[];
} = {}): CustomizationStatusService {
  const deps: CustomizationStatusDeps = {
    health: {
      getReport: async () => ({ generatedAt: '', worst: 'ok', counts: { ok: 0, warning: 0, error: 0 }, checks: over.checks ?? [] }),
    },
    detection: { list: async () => over.detected ?? [] },
    mcps: async () => over.mcps ?? [],
    hooks: async () => over.hooks ?? [],
    plugins: async () => over.plugins ?? [],
    entities: async () => over.entities ?? [],
    clock: new FixedClock(FROZEN),
  };
  return new CustomizationStatusService(deps);
}

describe('CustomizationStatusService', () => {
  it('is installed when every channel checks ok', async () => {
    const report = await make({
      checks: [check('urn:skill:a', 'claude', 'installed'), check('urn:skill:a', 'cursor', 'installed')],
    }).getReport();
    expect(report.generatedAt).toBe(FROZEN.toISOString());
    expect(report.items['urn:skill:a']).toEqual({
      status: 'installed',
      channels: { claude: { status: 'installed' }, cursor: { status: 'installed' } },
    });
  });

  it('makes a destination held by a file the app does not own a not-installed draft on that channel', async () => {
    const report = await make({
      checks: [check('urn:skill:a', 'claude', 'installed'), check('urn:skill:a', 'cursor', 'draft')],
    }).getReport();
    expect(report.items['urn:skill:a']).toEqual({
      status: 'draft',
      reason: 'not-installed',
      channels: { claude: { status: 'installed' }, cursor: { status: 'draft', reason: 'not-installed' } },
    });
  });

  it('makes a failing check an error on that channel', async () => {
    const report = await make({
      checks: [check('urn:skill:a', 'claude', 'installed'), check('urn:skill:a', 'cursor', 'error')],
    }).getReport();
    expect(report.items['urn:skill:a']).toEqual({
      status: 'error',
      channels: { claude: { status: 'installed' }, cursor: { status: 'error' } },
    });
  });

  it('ranks error over draft over installed, per channel and overall', async () => {
    const report = await make({
      checks: [check('urn:skill:a', 'claude', 'error'), check('urn:skill:a', 'cursor', 'installed')],
      detected: [detectedSkill('a', 'cursor')],
    }).getReport();
    expect(report.items['urn:skill:a']).toEqual({
      status: 'error',
      channels: { claude: { status: 'error' }, cursor: { status: 'draft', reason: 'detected' } },
    });
  });

  it('ignores checks without an outcome, entity or channel', async () => {
    const report = await make({
      checks: [check('urn:skill:a', undefined, 'error'), check('urn:skill:b', 'claude', undefined)],
    }).getReport();
    expect(report.items).toEqual({});
  });

  it('keeps a detected MCP server a draft when the Claude runtime reports it failing or needing auth', async () => {
    const report = await make({
      checks: [check('urn:mcp:atlassian', 'claude', 'error'), check('urn:mcp:ide', 'claude', 'error')],
      mcps: [
        { name: 'atlassian', enabled: true, source: { kind: 'detected', harness: 'claude' } },
        { name: 'ide', enabled: false, source: { kind: 'detected' } },
      ],
    }).getReport();
    expect(report.items['urn:mcp:atlassian']).toEqual({ status: 'draft', reason: 'detected', channels: { claude: { status: 'draft', reason: 'detected' } } });
    expect(report.items['urn:mcp:ide']).toMatchObject({ status: 'draft', reason: 'detected' });
  });

  it('marks detected skills and detected MCP servers/hooks as drafts on the channel they were found in', async () => {
    const report = await make({
      detected: [detectedSkill('legacy', 'claude'), detectedSkill('legacy', 'cursor')],
      mcps: [{ name: 'gh', enabled: false, source: { kind: 'detected', harness: 'cursor' } }],
      hooks: [{ id: 'detected:abc', source: { kind: 'detected', harness: 'claude' } }],
    }).getReport();
    expect(report.items['urn:skill:legacy']).toEqual({
      status: 'draft',
      reason: 'detected',
      channels: { claude: { status: 'draft', reason: 'detected' }, cursor: { status: 'draft', reason: 'detected' } },
    });
    // A detected server reports `enabled: false` only because the app doesn't manage it: not "disabled".
    expect(report.items['urn:mcp:gh']).toMatchObject({ status: 'draft', reason: 'detected' });
    expect(report.items['urn:hook:detected:abc']).toMatchObject({ status: 'draft', reason: 'detected' });
  });

  it('makes what the user turned off a draft that goes to no channel, whatever its checks say', async () => {
    const report = await make({
      checks: [check('urn:mcp:sentry', 'claude', 'error')],
      mcps: [{ name: 'sentry', enabled: false, source: { kind: 'workspace' } }],
      hooks: [{ id: 'stop', enabled: false, source: { kind: 'workspace' } }],
      plugins: [{ id: 'old', enabled: false }],
    }).getReport();
    const disabled = { status: 'draft', reason: 'disabled', channels: {} };
    expect(report.items['urn:mcp:sentry']).toEqual(disabled);
    expect(report.items['urn:hook:stop']).toEqual(disabled);
    expect(report.items['urn:plugin:old']).toEqual(disabled);
  });

  it('rolls a plugin child status up to its plugin', async () => {
    const report = await make({
      checks: [check('urn:mcp:pmcp', 'claude', 'error'), check('urn:hook:ph', 'cursor', 'installed')],
      mcps: [{ name: 'pmcp', enabled: true, source: { kind: 'plugin', pluginId: 'kit' } }],
      hooks: [{ id: 'ph', source: { kind: 'plugin', pluginId: 'kit' } }],
      plugins: [{ id: 'kit', enabled: true }],
    }).getReport();
    expect(report.items['urn:plugin:kit']).toEqual({
      status: 'error',
      channels: { claude: { status: 'error' }, cursor: { status: 'installed' } },
    });
  });
});

describe('CustomizationStatusService — disabled entities', () => {
  const entity = (kind: 'skill' | 'agent' | 'instruction', name: string, scopes: Entity['scopes'] = ['personal']): Entity => ({
    urn: `urn:${kind}:${name}`, kind, name, description: '', scopes, ...(scopes[0] === 'workspace' ? { scopeId: 'ws-1' } : {}),
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, enabled: false,
  });

  it('reports a disabled skill, agent and workspace instruction as draft/disabled', async () => {
    const report = await make({
      checks: [check('urn:skill:tdd', 'claude', 'installed')],
      entities: [entity('skill', 'tdd'), entity('agent', 'rev'), entity('instruction', 'acme', ['workspace'])],
    }).getReport();
    for (const urn of ['urn:skill:tdd', 'urn:agent:rev', 'urn:instruction:acme']) {
      expect(report.items[urn]).toEqual({ status: 'draft', reason: 'disabled', channels: {} });
    }
  });

  it('leaves an enabled entity to its health checks', async () => {
    const report = await make({
      checks: [check('urn:skill:tdd', 'claude', 'installed')],
      entities: [{ ...entity('skill', 'tdd'), enabled: true }],
    }).getReport();
    expect(report.items['urn:skill:tdd']?.status).toBe('installed');
  });
});

describe('CustomizationStatusService — coverage', () => {
  it('a covered skill reports installed on Cursor from the copied Claude check', async () => {
    const covered: HealthCheck = { ...check('urn:skill:tdd', 'cursor', 'installed'), coveredBy: 'claude' };
    const report = await make({ checks: [check('urn:skill:tdd', 'claude', 'installed'), covered] }).getReport();
    expect(report.items['urn:skill:tdd']).toEqual({ status: 'installed', channels: { claude: { status: 'installed' }, cursor: { status: 'installed' } } });
  });
});
