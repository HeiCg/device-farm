import type pino from 'pino';

/**
 * Parse an Azure DevOps repository URL into organization, project, and repo slug.
 * Expected format: https://dev.azure.com/{organization}/{project}/_git/{repoSlug}
 */
export function parseAzureRepoUrl(url: string): { organization: string; project: string; repoSlug: string } {
  const match = url.match(/^https:\/\/dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_git\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid Azure repo URL: ${url}`);
  }
  return {
    organization: match[1],
    project: match[2],
    repoSlug: match[3],
  };
}

export interface AzurePullRequest {
  pullRequestId: number;
  status: string;
  isDraft: boolean;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit: { commitId: string };
  description: string;
  repository: { url: string; id: string; project: { id: string; name: string } };
}

export interface AzureClient {
  getPullRequest(organization: string, project: string, repoId: string, prId: number): Promise<AzurePullRequest>;
  createThread(
    organization: string, project: string, repoId: string, prId: number, body: string,
  ): Promise<{ threadId: string; commentId: string }>;
  updateComment(
    organization: string, project: string, repoId: string, prId: number, threadId: string, commentId: string, body: string,
  ): Promise<void>;
}

export interface AzureClientOpts {
  pat: string;
  logger: pino.Logger;
  fetchImpl?: typeof fetch;
}

export function createAzureClient(opts: AzureClientOpts): AzureClient {
  const f = opts.fetchImpl ?? fetch;
  const auth = 'Basic ' + Buffer.from(':' + opts.pat).toString('base64');
  const log = opts.logger.child({ component: 'azure-client' });

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await f(url, {
      ...init,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      log.error({ url, status: res.status, body: txt.slice(0, 500) }, 'azure api error');
      throw new Error(`Azure API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    async getPullRequest(organization, project, repoId, prId) {
      const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}?api-version=7.1`;
      return call<AzurePullRequest>(url);
    },
    async createThread(organization, project, repoId, prId, body) {
      const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=7.1`;
      const payload = {
        comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
        status: 1,
      };
      const r = await call<{ id: number; comments: Array<{ id: number }> }>(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return { threadId: String(r.id), commentId: String(r.comments[0].id) };
    },
    async updateComment(organization, project, repoId, prId, threadId, commentId, body) {
      const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads/${threadId}/comments/${commentId}?api-version=7.1`;
      await call(url, { method: 'PATCH', body: JSON.stringify({ content: body }) });
    },
  };
}
