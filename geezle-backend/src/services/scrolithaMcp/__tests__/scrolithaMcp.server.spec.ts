import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createScrolithaMcpServer } from '../scrolithaMcp.server';
import type { McpDataSource } from '../scrolithaMcp.types';

describe('Scrolitha read-only MCP tool registry', () => {
  test('advertises only read-only tools and scopes data to the authenticated subject', async () => {
    const dataSource: McpDataSource = {
      getMyProfile: jest.fn(async (userId: string) => ({ id: userId, email: 'owner@example.test' })),
      searchJobs: jest.fn(async (userId: string) => ({ ownerContext: userId, items: [] })),
      getJobDetails: jest.fn(async () => null),
      searchGigs: jest.fn(async () => ({ items: [], nextOffset: null })),
      getGigDetails: jest.fn(async () => null)
    };
    const server = createScrolithaMcpServer({
      principal: { subject: 'user-1', scopes: new Set(['scrolith:read']) },
      dataSource
    });
    const client = new Client({ name: 'local-test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'get_gig_details',
      'get_job_details',
      'get_my_profile',
      'search_gigs',
      'search_jobs'
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);

    const profile = await client.callTool({ name: 'get_my_profile', arguments: {} });
    expect(profile.isError).not.toBe(true);
    expect(dataSource.getMyProfile).toHaveBeenCalledWith('user-1');

    const unavailableJob = await client.callTool({ name: 'get_job_details', arguments: { jobId: 'job-1' } });
    expect(unavailableJob.isError).toBe(true);
    expect(dataSource.getJobDetails).toHaveBeenCalledWith('user-1', 'job-1');

    await client.close();
    await server.close();
  });

  test('normalizes non-object data before returning structured content', async () => {
    const dataSource: McpDataSource = {
      getMyProfile: jest.fn(async () => null),
      searchJobs: jest.fn(async () => ['synthetic-listing']),
      getJobDetails: jest.fn(async () => null),
      searchGigs: jest.fn(async () => ({ items: [], nextOffset: null })),
      getGigDetails: jest.fn(async () => null)
    };
    const server = createScrolithaMcpServer({
      principal: { subject: 'user-1', scopes: new Set(['scrolith:read']) },
      dataSource
    });
    const client = new Client({ name: 'local-test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: 'search_jobs', arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ data: ['synthetic-listing'] });

    await client.close();
    await server.close();
  });
});
