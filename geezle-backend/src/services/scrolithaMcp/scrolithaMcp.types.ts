export type McpSearchInput = {
  query?: string;
  limit: number;
  offset: number;
};

export type McpDataSource = {
  getMyProfile: (userId: string) => Promise<unknown | null>;
  searchJobs: (userId: string, input: McpSearchInput) => Promise<unknown>;
  getJobDetails: (userId: string, jobId: string) => Promise<unknown | null>;
  searchGigs: (userId: string, input: McpSearchInput) => Promise<unknown>;
  getGigDetails: (userId: string, gigId: string) => Promise<unknown | null>;
};
