import { describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import { publishMultipleResources } from '../qortium/qdn';

const mockedSend = vi.mocked(sendBridgeRequest);

describe('PUBLISH_MULTIPLE_QDN_RESOURCES', () => {
  it('sends one coordinated request with the full resources array', async () => {
    mockedSend.mockReset();
    mockedSend.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [
        {
          result: {},
          resource: { identifier: 'a', name: 'NodeFM', service: 'JSON' },
          transactionSignature: 'sig-a',
        },
      ],
      failures: [],
    });

    const result = await publishMultipleResources([
      { service: 'JSON', name: 'NodeFM', identifier: 'a', data64: 'e30=' },
    ]);

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resources: [
        {
          service: 'JSON',
          name: 'NodeFM',
          identifier: 'a',
          data64: 'e30=',
        },
      ],
    });
    expect(result.accepted).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('returns published and failures arrays as partial-success state', async () => {
    mockedSend.mockReset();
    mockedSend.mockResolvedValue({
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
    });

    const result = await publishMultipleResources([
      { service: 'JSON', name: 'NodeFM', identifier: 'a', data64: 'e30=' },
      { service: 'JSON', name: 'NodeFM', identifier: 'b', data64: 'e30=' },
    ]);

    expect(result.published).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
  });

  it('rejects an empty resources array', async () => {
    await expect(publishMultipleResources([])).rejects.toThrow(/at least one resource/i);
  });
});
