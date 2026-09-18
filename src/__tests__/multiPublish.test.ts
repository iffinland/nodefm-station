import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import { TEST_WRITE_ACCOUNT, withUnlockedTestAccount } from './support/writeGateBridge';
import { resetAccountWriteGateCache } from '../qortium/accountWriteGate';
import {
  QdnPublishSourceUnsupportedError,
  publishMultipleResources,
  publishResource,
  resetQdnPublishCapabilityCache,
  stageQdnPublishSource,
} from '../qortium/qdn';

const mockedSend = vi.mocked(sendBridgeRequest);

const HOME_2_ACTIONS = [
  'SHOW_ACTIONS',
  'SELECT_QDN_PUBLISH_SOURCE',
  'STAGE_QDN_PUBLISH_SOURCE',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
];

/** Every field Home 2.1 refuses on a publish request. */
const REFUSED_PUBLISH_FIELDS = [
  'base64',
  'bytes',
  'bytesBase64',
  'data',
  'data64',
  'dataBase64',
  'fee',
  'file',
  'fileName',
  'filePath',
  'filename',
  'filepath',
  'mimeType',
  'path',
  'source',
  'sourceBase64',
  'uri',
];

function installHome2Bridge(actions: string[] | null = HOME_2_ACTIONS) {
  const staged: Record<string, unknown>[] = [];
  const publishes: Record<string, unknown>[] = [];
  let issued = 0;

  mockedSend.mockImplementation(
    withUnlockedTestAccount(async (request: Record<string, unknown>) => {
      if (request.action === 'SHOW_ACTIONS') {
        if (actions === null) throw new Error('SHOW_ACTIONS is unavailable.');
        return actions;
      }

      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') {
        staged.push(request);
        issued += 1;

        return {
          canceled: false,
          fileName: request.fileName,
          kind: 'blob',
          mimeType: typeof request.mimeType === 'string' ? request.mimeType : null,
          size: 3,
          sourceToken: `home-token-${issued}`,
        };
      }

      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        publishes.push(request);
        const resource = request as { identifier?: string; name: string; service: string };

        return {
          accepted: true,
          action: 'PUBLISH_QDN_RESOURCE',
          resource: {
            identifier: resource.identifier ?? null,
            name: resource.name,
            service: resource.service,
          },
          transactionSignature: 'sig-single',
        };
      }

      if (request.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
        publishes.push(request);
        const resources = request.resources as Array<Record<string, unknown>>;

        return {
          accepted: true,
          action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
          published: resources.map((resource) => ({
            result: {},
            resource: {
              identifier: (resource.identifier as string | undefined) ?? null,
              name: resource.name,
              service: resource.service,
            },
            transactionSignature: `sig-${String(resource.identifier)}`,
          })),
          failures: [],
        };
      }

      throw new Error(`Unexpected bridge action in test: ${String(request.action)}`);
    }),
  );

  return { staged, publishes };
}

function expectTokenOnlyPublish(requests: Record<string, unknown>[]): void {
  expect(requests.length).toBeGreaterThan(0);

  for (const request of requests) {
    const items =
      request.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES'
        ? (request.resources as Array<Record<string, unknown>>)
        : [request];

    for (const item of items) {
      expect(typeof item.sourceToken).toBe('string');
      for (const field of REFUSED_PUBLISH_FIELDS) {
        expect(item).not.toHaveProperty(field);
      }
    }
  }
}

describe('Home 2.1 publish contract', () => {
  beforeEach(() => {
    mockedSend.mockReset();
    resetQdnPublishCapabilityCache();
    resetAccountWriteGateCache();
  });

  it('stages app-held bytes and publishes the Home-issued token only', async () => {
    const { staged, publishes } = installHome2Bridge();

    const result = await publishResource({
      service: 'JSON',
      name: 'NodeFM',
      identifier: 'nodefm-track-t1',
      bytesBase64: 'e30=',
      fileName: 'nodefm-track-t1.json',
      mimeType: 'application/json',
      title: 'Track',
      description: 'A track',
      tags: ['chill'],
    });

    expect(staged).toEqual([
      {
        action: 'STAGE_QDN_PUBLISH_SOURCE',
        bytesBase64: 'e30=',
        fileName: 'nodefm-track-t1.json',
        mimeType: 'application/json',
      },
    ]);
    expect(publishes).toEqual([
      {
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-track-t1',
        sourceToken: 'home-token-1',
        title: 'Track',
        description: 'A track',
        tags: ['chill'],
      },
    ]);
    expectTokenOnlyPublish(publishes);
    expect(result.accepted).toBe(true);
  });

  it('normalizes the staged source filename to the transport-safe ASCII name', async () => {
    const { staged } = installHome2Bridge();

    await stageQdnPublishSource({
      bytesBase64: 'aW1hZ2U=',
      fileName: 'cover õhtu.png',
      mimeType: 'image/png',
    });

    expect(staged[0].fileName).toBe('cover õhtu.png');
  });

  it('passes an already-issued sourceToken through without staging or capability probing', async () => {
    const { staged, publishes } = installHome2Bridge();

    await publishResource({
      service: 'AUDIO',
      name: 'NodeFM',
      identifier: 'nodefm-audio-1',
      sourceToken: 'picker-token-1',
      title: 'Song',
    });

    expect(staged).toEqual([]);
    expect(publishes).toEqual([
      {
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'AUDIO',
        name: 'NodeFM',
        identifier: 'nodefm-audio-1',
        sourceToken: 'picker-token-1',
        title: 'Song',
      },
    ]);
    expect(mockedSend).not.toHaveBeenCalledWith({ action: 'SHOW_ACTIONS' });
  });

  it('fails closed when the runtime does not advertise STAGE_QDN_PUBLISH_SOURCE', async () => {
    const actions = HOME_2_ACTIONS.filter((action) => action !== 'STAGE_QDN_PUBLISH_SOURCE');
    const { publishes } = installHome2Bridge(actions);

    await expect(
      publishResource({
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-track-t1',
        bytesBase64: 'e30=',
        fileName: 'nodefm-track-t1.json',
      }),
    ).rejects.toBeInstanceOf(QdnPublishSourceUnsupportedError);

    expect(publishes).toEqual([]);
  });

  it('never falls back to the refused inline data64 contract', async () => {
    const { publishes } = installHome2Bridge(null);

    await expect(
      publishResource({
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-track-t1',
        bytesBase64: 'e30=',
        fileName: 'nodefm-track-t1.json',
      }),
    ).rejects.toThrow(/STAGE_QDN_PUBLISH_SOURCE/);

    expect(publishes).toEqual([]);
  });

  it('rejects legacy publish inputs before any bridge request', async () => {
    installHome2Bridge();

    await expect(
      publishResource({
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-track-t1',
        data64: 'e30=',
      } as never),
    ).rejects.toThrow(/does not accept data64/);

    await expect(
      publishResource({
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-track-t1',
        filename: 'track.json',
      } as never),
    ).rejects.toThrow(/does not accept filename/);

    await expect(
      publishResource({
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-track-t1',
        sourceToken: 'token-1',
        fee: 0,
      } as never),
    ).rejects.toThrow(/does not accept fee/);
  });
});

describe('PUBLISH_MULTIPLE_QDN_RESOURCES', () => {
  beforeEach(() => {
    mockedSend.mockReset();
    resetQdnPublishCapabilityCache();
    resetAccountWriteGateCache();
  });

  it('publishes one batch with a distinct staged token per item', async () => {
    const { staged, publishes } = installHome2Bridge();

    const result = await publishMultipleResources([
      {
        service: 'IMAGE',
        name: 'NodeFM',
        identifier: 'nodefm-cover-1',
        bytesBase64: 'aW1hZ2U=',
        fileName: 'cover.png',
        mimeType: 'image/png',
      },
      {
        service: 'JSON',
        name: 'NodeFM',
        identifier: 'nodefm-track-1',
        bytesBase64: 'e30=',
        fileName: 'nodefm-track-1.json',
        mimeType: 'application/json',
      },
    ]);

    expect(staged.map((request) => request.fileName)).toEqual(['cover.png', 'nodefm-track-1.json']);
    expect(publishes).toHaveLength(1);

    const resources = publishes[0].resources as Array<Record<string, unknown>>;
    expect(resources.map((resource) => resource.sourceToken)).toEqual([
      'home-token-1',
      'home-token-2',
    ]);
    expectTokenOnlyPublish(publishes);
    expect(result.published).toHaveLength(2);
    expect(result.failures).toEqual([]);
  });

  it('preserves per-item published and failed results', async () => {
    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'GET_SELECTED_ACCOUNT') return { ...TEST_WRITE_ACCOUNT };
      if (request.action === 'SHOW_ACTIONS') return HOME_2_ACTIONS;
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') {
        return {
          canceled: false,
          fileName: request.fileName,
          kind: 'blob',
          size: 3,
          sourceToken: 'token-a',
        };
      }
      if (request.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
        return {
          accepted: true,
          action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
          published: [
            {
              result: {},
              resource: { identifier: 'a', name: 'NodeFM', service: 'JSON' },
              transactionSignature: 'sig-a',
            },
          ],
          failures: [
            {
              error: 'publish failed',
              resource: { identifier: 'b', name: 'NodeFM', service: 'JSON' },
            },
          ],
        };
      }
      throw new Error('unexpected');
    });

    const result = await publishMultipleResources([
      { service: 'JSON', name: 'NodeFM', identifier: 'a', sourceToken: 'token-a' },
      { service: 'JSON', name: 'NodeFM', identifier: 'b', sourceToken: 'token-b' },
    ]);

    expect(result.published).toHaveLength(1);
    expect(result.failures).toEqual([
      { error: 'publish failed', resource: { identifier: 'b', name: 'NodeFM', service: 'JSON' } },
    ]);
  });

  it('keeps an unknown broadcast outcome as a non-retryable failure record', async () => {
    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'GET_SELECTED_ACCOUNT') return { ...TEST_WRITE_ACCOUNT };
      if (request.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
        return {
          accepted: true,
          action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
          published: [],
          failures: [
            {
              error: 'Publish broadcast outcome is unknown.',
              errorType: 'BROADCAST_UNKNOWN',
              outcome: 'unknown',
              resource: { identifier: 'a', name: 'NodeFM', service: 'JSON' },
              transactionSignature: 'sig-unknown',
            },
          ],
        };
      }
      throw new Error('unexpected');
    });

    const result = await publishMultipleResources([
      { service: 'JSON', name: 'NodeFM', identifier: 'a', sourceToken: 'token-a' },
    ]);

    expect(result.failures[0].outcome).toBe('unknown');
    expect(result.failures[0].transactionSignature).toBe('sig-unknown');
    expect(result.failures[0].errorType).toBe('BROADCAST_UNKNOWN');
  });

  it('chunks more than ten resources into bounded token-only requests', async () => {
    const { publishes } = installHome2Bridge();
    const resources = Array.from({ length: 23 }, (_, index) => ({
      service: 'JSON',
      name: 'NodeFM',
      identifier: `nodefm-track-${index}`,
      bytesBase64: 'e30=',
      fileName: `nodefm-track-${index}.json`,
      mimeType: 'application/json',
    }));

    const result = await publishMultipleResources(resources);

    expect(publishes.map((request) => (request.resources as unknown[]).length)).toEqual([
      10, 10, 3,
    ]);
    expect(result.published).toHaveLength(23);
    expect(result.failures).toEqual([]);
    expectTokenOnlyPublish(publishes);
  });

  it('reports later chunk items as failures when nothing was published yet in that chunk', async () => {
    let publishAttempt = 0;

    mockedSend.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.action === 'GET_SELECTED_ACCOUNT') return { ...TEST_WRITE_ACCOUNT };
      if (request.action !== 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
        throw new Error(`unexpected ${String(request.action)}`);
      }

      publishAttempt += 1;

      if (publishAttempt === 2) {
        throw new Error('Home batch request failed.');
      }

      const resources = request.resources as Array<Record<string, unknown>>;

      return {
        accepted: true,
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        published: resources.map((resource) => ({
          result: {},
          resource: {
            identifier: (resource.identifier as string) ?? null,
            name: resource.name,
            service: resource.service,
          },
          transactionSignature: `sig-${String(resource.identifier)}`,
        })),
        failures: [],
      };
    });

    const resources = Array.from({ length: 12 }, (_, index) => ({
      service: 'JSON',
      name: 'NodeFM',
      identifier: `nodefm-track-${index}`,
      sourceToken: `token-${index}`,
    }));

    const result = await publishMultipleResources(resources);

    expect(result.published).toHaveLength(10);
    expect(result.failures.map((failure) => failure.resource.identifier)).toEqual([
      'nodefm-track-10',
      'nodefm-track-11',
    ]);
    expect(result.failures[0].error).toContain('failed');
  });

  it('rejects an empty resources array', async () => {
    await expect(publishMultipleResources([])).rejects.toThrow(/at least one resource/i);
  });
});
