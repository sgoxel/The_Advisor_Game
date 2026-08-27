import { appendFile, readFile } from 'node:fs/promises';

export const RELEASE_APPROVAL_PHRASE = 'RELEASE CANDIDATE APPROVED FOR VERIFIED RELEASE WORKFLOW';

const FIELD_ORDER = [
  'verified_commit',
  'release_tag',
  'release_name',
  'restore_existing_verified'
];

function fail(message) {
  throw new Error(message);
}

function normalizeLines(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function authorizeReleaseComment(event, { repositoryOwner, actor } = {}) {
  if (!event || event.action !== 'created') {
    fail('Release authorization requires a newly created issue comment event.');
  }

  const issue = event.issue;
  const comment = event.comment;

  if (!issue || issue.pull_request) {
    fail('Release authorization is allowed only on a GitHub issue, not a pull request.');
  }
  if (issue.state !== 'open') {
    fail('Release authorization issue must still be open.');
  }
  if (typeof issue.title !== 'string' || !issue.title.toLowerCase().includes('release gate')) {
    fail('Release authorization issue title must identify a release gate.');
  }

  const normalizedIssueBody = typeof issue.body === 'string'
    ? issue.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : '';
  if (!/(?:^|\n)Role owner:[ \t]*Tester Worker[ \t]*(?:\n|$)/.test(normalizedIssueBody)) {
    fail('Release authorization issue must be owned by Tester Worker.');
  }

  if (!repositoryOwner || actor !== repositoryOwner) {
    fail('Release authorization actor must be the repository owner.');
  }
  if (!comment || comment.user?.login !== repositoryOwner) {
    fail('Release authorization comment must be created by the repository owner identity.');
  }
  if (!Number.isInteger(issue.number) || !Number.isInteger(comment.id)) {
    fail('Release authorization event is missing stable issue/comment identifiers.');
  }

  const body = typeof comment.body === 'string' ? comment.body : '';
  const lines = normalizeLines(body);
  if (lines[0] !== RELEASE_APPROVAL_PHRASE) {
    fail('Release authorization phrase must be the exact first line.');
  }

  const values = {};
  FIELD_ORDER.forEach((key, index) => {
    const line = lines[index + 1] ?? '';
    const prefix = `${key}: `;
    if (!line.startsWith(prefix)) {
      fail(`Release authorization field ${key} is missing or out of order.`);
    }
    const value = line.slice(prefix.length).trim();
    if (!value) {
      fail(`Release authorization field ${key} must not be empty.`);
    }
    values[key] = value;
  });

  const duplicateField = lines.slice(FIELD_ORDER.length + 1).find((line) =>
    FIELD_ORDER.some((key) => line.startsWith(`${key}:`))
  );
  if (duplicateField) {
    fail('Release authorization structured fields must appear exactly once.');
  }

  if (!/^[0-9a-fA-F]{40}$/.test(values.verified_commit)) {
    fail('verified_commit must be an exact 40-character hexadecimal commit SHA.');
  }
  if (/\s/.test(values.release_tag)) {
    fail('release_tag must not contain whitespace.');
  }
  if (/[\r\n]/.test(values.release_name)) {
    fail('release_name must be a single line.');
  }
  if (!['true', 'false'].includes(values.restore_existing_verified)) {
    fail('restore_existing_verified must be exactly true or false.');
  }

  return {
    ...values,
    issue_number: String(issue.number),
    authorization_comment_id: String(comment.id)
  };
}

async function runFromActionsEnvironment() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const outputPath = process.env.GITHUB_OUTPUT;
  const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER;
  const actor = process.env.GITHUB_ACTOR;

  if (!eventPath || !outputPath) {
    return;
  }

  try {
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    const authorization = authorizeReleaseComment(event, { repositoryOwner, actor });
    const output = Object.entries(authorization)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    await appendFile(outputPath, `${output}\n`, 'utf8');
    console.log(
      `Authorized verified release from issue #${authorization.issue_number}, comment ${authorization.authorization_comment_id}, commit ${authorization.verified_commit}.`
    );
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await runFromActionsEnvironment();
