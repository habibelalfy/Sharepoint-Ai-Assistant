const { createHmac } = require('node:crypto');
async function main() {
  const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const user = process.env.SHAREPOINT_USERNAME;
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const token = `${body}.${createHmac('sha256', process.env.JWT_SIGNING_KEY).update(body).digest('base64url')}`;
  const base = 'http://127.0.0.1:3001';
  async function request(path, data, authorized = true) {
    const r = await fetch(base + path, {
      method: data ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(240000),
    });
    const result = await r.json();
    return { status: r.status, data: result };
  }
  console.log('health', JSON.stringify(await request('/health')));
  console.log(
    'unauthenticated session',
    JSON.stringify(await request('/api/session', undefined, false)),
  );
  console.log('authenticated session', JSON.stringify(await request('/api/session')));
  console.log('invalid chat', JSON.stringify(await request('/api/chat', { messages: [] })));
  const projects = await request('/api/mcp/tool', {
    toolName: 'search_projects',
    args: { query: '' },
  });
  console.log('projects', JSON.stringify(projects));
  const prompt =
    'Create a proper, detailed project plan for Project 1 based on the k8s (Kubernetes) document in the hexacloud project. First identify the exact target project and source document and read the document. Include scope, phases, work breakdown, dependencies, estimated durations, responsible roles, milestones, acceptance criteria, risks, assumptions, and source references. Distinguish document facts from estimates. If document access or plan creation is unavailable, clearly report the missing capability; do not invent document contents or claim the plan was saved.';
  console.log('PLAN REQUEST', prompt);
  console.log(
    'PLAN RESPONSE',
    JSON.stringify(await request('/api/chat', { messages: [{ role: 'user', content: prompt }] })),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
