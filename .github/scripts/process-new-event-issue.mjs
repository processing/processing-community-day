import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePlusCode } from './plus-code.mjs';
import {
  YEAR,
  PCD_FORUM_THREAD_URL,
  PCD_CONTACT_EMAIL,
  VALID_ORG_TYPES,
  VALID_EVENT_FORMATS,
  PLUS_CODE_FIELD_LABEL,
  PLUS_CODE_FIELD_ALIASES,
  parseIssueSections,
  required,
  requiredAny,
  isValidDate,
  isValidTime,
  isValidEmail,
  isValidHttpUrl,
  normalizeUrl,
  slugify,
  parseActivities,
  parseOrganizers,
  buildValidationComment,
  generateUniqueUid,
  eventDataToDisplayMap,
  buildNewEventTable,
  formatLongDescription,
  buildPlusCodeNoteBlocks,
  buildPrBody,
} from './event-issue-helpers.mjs';

const WORKSPACE = process.cwd();
const RUNNER_TEMP = process.env.RUNNER_TEMP ?? path.join(WORKSPACE, '.tmp');
const OUTPUT_PATH = process.env.GITHUB_OUTPUT;
const EVENT_PATH = process.env.GITHUB_EVENT_PATH;

await fs.mkdir(RUNNER_TEMP, { recursive: true });

const eventPayload = JSON.parse(await fs.readFile(EVENT_PATH, 'utf8'));
const issue = eventPayload.issue;
const issueNumber = issue.number;
const issueBody = issue.body ?? '';
const submitterLogin = issue.user?.login ?? '';

async function setOutput(key, value) {
  if (!OUTPUT_PATH) return;
  await fs.appendFile(OUTPUT_PATH, `${key}=${String(value)}\n`);
}


console.log(`[process-new-event-issue] issue #${issueNumber}, body length: ${issueBody.length}`);

// Skip if this is an edit-event issue (has ### Event canonical ID heading)
if (issueBody.includes('### Event canonical ID')) {
  console.log('[process-new-event-issue] found ### Event canonical ID heading — skipping (this is an edit event issue)');
  await setOutput('valid', 'skip');
  process.exit(0);
}

// GitHub strips HTML comments from markdown blocks. The edit-event guard above
// handles the only other template that uses this heading, so reaching here means
// we are processing a new-event issue or something unrecognized.
if (!issueBody.includes(`### ${PLUS_CODE_FIELD_LABEL}`)) {
  console.log('[process-new-event-issue] template headings not found — skipping (not a new event issue)');
  await setOutput('valid', 'skip');
  process.exit(0);
}

async function main() {
  const fields = parseIssueSections(issueBody);
  const errors = [];

  const eventName = required(fields, 'Event name', errors);
  const rawPlusCode = requiredAny(fields, PLUS_CODE_FIELD_ALIASES, errors, {
    field: 'Map placement (Plus Code)',
    message: 'This field is required. A Plus Code looks like `8FW4V75V+8Q`. [Find your Plus Code →](https://plus.codes/)',
  });
  const eventFormat = required(fields, 'Event format', errors, {
    field: 'Event format',
    message: 'This field is required. Choose one of: `In person` or `Online`.',
  });
  const isOnlineEvent = eventFormat === 'Online';
  const eventUrl = normalizeUrl(fields.get('Event URL (only for online events)')?.trim() ?? '');
  const primaryContactName = required(fields, 'Primary contact name', errors);
  const contactEmail = required(fields, 'Primary contact email', errors);
  // Parse city/country before plus_code resolution — needed for short-code recovery
  const city = fields.get('City or locality')?.trim() ?? '';
  const country = fields.get('Country')?.trim() ?? '';
  const organizationName = fields.get('Organization name')?.trim() ?? '';
  const organizationUrl = normalizeUrl(fields.get('Organization website')?.trim() ?? '');
  const organizationType = (fields.get('Organization type')?.trim() ?? '').replace(/^None$/i, '');
  const address = fields.get('Street address of the event venue')?.trim() ?? '';
  const eventDate = fields.get('Date of the event')?.trim() ?? '';
  const eventEndDate = fields.get('End date (for multi-day events)')?.trim() ?? '';
  const startTime = fields.get('Start time')?.trim() ?? '';
  const endTime = fields.get('End time')?.trim() ?? '';
  const eventPageUrl = normalizeUrl(fields.get('Event page URL')?.trim() ?? '');
  const organizers = parseOrganizers(fields.get('Organizers')?.trim() ?? '');
  const shortDescription = fields.get('Short description')?.trim() ?? '';
  const fullDescription = fields.get('Full event description')?.trim() ?? '';
  const activities = parseActivities(fields.get('Event activities')?.trim() ?? '');
  const forumThreadUrl = normalizeUrl(fields.get('Forum discussion URL')?.trim() ?? '');
  const maintainerNotes = fields.get('Additional notes')?.trim() ?? '';

  // Resolve plus_code with smart recovery before validation
  const { code: resolvedPlusCode, note: plusCodeNote } = await resolvePlusCode(rawPlusCode, city, country);
  const plusCode = resolvedPlusCode ?? rawPlusCode.replace(/\s+/g, '').toUpperCase();
  if (plusCodeNote) {
    console.log(`[process-new-event-issue] plus_code auto-recovered: ${rawPlusCode} → ${plusCode}`);
  }

  if (eventDate && !isValidDate(eventDate)) errors.push({ field: 'Event date', found: eventDate, message: 'Invalid format. Please use `YYYY-MM-DD`, e.g. `2026-03-21`.' });
  if (eventEndDate && !isValidDate(eventEndDate)) errors.push({ field: 'End date', found: eventEndDate, message: 'Invalid format. Please use `YYYY-MM-DD`, e.g. `2026-03-22`.' });
  if (isValidDate(eventDate) && eventEndDate && isValidDate(eventEndDate) && eventEndDate < eventDate) errors.push({ field: 'End date', found: eventEndDate, message: 'The end date must be on or after the event date.' });
  if (startTime && !isValidTime(startTime)) errors.push({ field: 'Start time', found: startTime, message: 'Invalid format. Please use 24-hour `HH:MM`, e.g. `14:00`.' });
  if (endTime && !isValidTime(endTime)) errors.push({ field: 'End time', found: endTime, message: 'Invalid format. Please use 24-hour `HH:MM`, e.g. `16:30`.' });
  if (
    startTime &&
    endTime &&
    isValidTime(startTime) &&
    isValidTime(endTime) &&
    (!eventEndDate || eventEndDate === eventDate) &&
    endTime <= startTime
  ) {
    errors.push({ field: 'End time', found: endTime, message: 'End time must be later than start time for single-day events.' });
  }
  if (eventPageUrl && !isValidHttpUrl(eventPageUrl)) errors.push({ field: 'Event page URL', found: eventPageUrl, message: 'Not a valid URL. Please enter a web address like `https://example.com/pcd`.' });
  if (forumThreadUrl && !isValidHttpUrl(forumThreadUrl)) errors.push({ field: 'Forum discussion URL', found: forumThreadUrl, message: 'Not a valid URL. Please enter a web address like `https://forum.example.com/thread`.' });
  if (contactEmail && !isValidEmail(contactEmail)) errors.push({ field: 'Primary contact email', found: contactEmail, message: 'Not a valid email address. Please provide a valid email like `you@example.com`.' });
  if (rawPlusCode && !resolvedPlusCode) errors.push({ field: 'Map placement (Plus Code)', found: rawPlusCode.replace(/\s+/g, '').toUpperCase(), message: 'Not a valid full global Plus Code. It should look like `8FW4V75V+8Q`. [Find your Plus Code →](https://plus.codes/)' });
  if (eventUrl && !isValidHttpUrl(eventUrl)) errors.push({ field: 'Event URL', found: eventUrl, message: 'Not a valid URL. Please enter a web address like `https://example.com`.' });
  if (organizationUrl && !isValidHttpUrl(organizationUrl)) errors.push({ field: 'Organization website', found: organizationUrl, message: 'Not a valid URL. Please enter a web address like `https://example.com`.' });
  if (eventFormat && !VALID_EVENT_FORMATS.has(eventFormat)) errors.push({ field: 'Event format', found: eventFormat, message: 'Not a recognized option. Please choose one of: `In person` or `Online`.' });
  if (organizationType && !VALID_ORG_TYPES.has(organizationType)) errors.push({ field: 'Organization type', found: organizationType, message: 'Not a recognized option. Please choose one of the valid options from the form.' });
  if (isOnlineEvent && !eventUrl) errors.push({ field: 'Event URL', message: 'An event URL is required for online events. Please provide the URL where people can join.' });

  const normalizedEventName = slugify(eventName).replace(/-\d{4}$/, '');
  const eventId = normalizedEventName.startsWith('pcd-')
    ? `${normalizedEventName}-${YEAR}`
    : `pcd-${normalizedEventName}-${YEAR}`;

  const eventDirPath = path.join(WORKSPACE, 'pcd-website/src/content/events', eventId);
  const markdownPath = path.join(eventDirPath, 'content.md');
  const metadataPath = path.join(eventDirPath, 'metadata.json');

  try {
    await fs.access(eventDirPath);
    errors.push({ field: 'Event name', found: eventName, message: `An event with the generated ID \`${eventId}\` already exists. If you need to update an existing event, post in the [PCD 2026 forum thread](${PCD_FORUM_THREAD_URL}) (recommended) or write to ${PCD_CONTACT_EMAIL}.` });
  } catch {
    // Directory does not exist yet.
  }

  if (errors.length > 0) {
    console.log(`[process-new-event-issue] validation failed with ${errors.length} error(s):`);
    errors.forEach((e) => console.log(`  - [${e.field}]${e.found !== undefined ? ` (found: "${e.found}")` : ''} ${e.message}`));
    const validationCommentPath = path.join(RUNNER_TEMP, `validation-${issueNumber}.md`);
    await fs.writeFile(validationCommentPath, buildValidationComment(errors));
    await setOutput('valid', 'false');
    await setOutput('validation_comment_path', validationCommentPath);
    process.exit(0);
  }

  // Collect existing uids and generate a new unique one
  const existingEventDirs = await fs.readdir(path.join(WORKSPACE, 'pcd-website/src/content/events')).catch(() => []);
  const existingUids = new Set();
  for (const dir of existingEventDirs) {
    const mpath = path.join(WORKSPACE, 'pcd-website/src/content/events', dir, 'metadata.json');
    try {
      const meta = JSON.parse(await fs.readFile(mpath, 'utf8'));
      if (meta.uid) existingUids.add(meta.uid);
    } catch {
      // skip
    }
  }
  const uid = generateUniqueUid(existingUids);

  const nodeRecord = {
    id: eventId,
    uid,
    organizers,
    primary_contact: { name: primaryContactName, email: contactEmail },
    organization_name: organizationName,
    organization_url: organizationUrl,
    organization_type: organizationType,
    online_event: isOnlineEvent,
    event_url: eventUrl,
    event_name: eventName,
    event_location: {
      address,
      plus_code: plusCode,
    },
    event_date: eventDate,
    ...(eventEndDate ? { event_end_date: eventEndDate } : {}),
    event_start_time: startTime,
    event_end_time: endTime,
    event_short_description: shortDescription,
    event_activities: activities,
    event_page_url: eventPageUrl,
    forum_thread_url: forumThreadUrl,
    city,
    country,
    placeholder: false,
    intake: {
      issue_number: issueNumber,
      submitted_by_github: submitterLogin,
      submitted_date: new Date().toISOString().slice(0, 10),
      maintainer_notes: maintainerNotes,
    },
  };

  const markdownLines = [
    '---',
    `id: ${eventId}`,
    `uid: "${uid}"`,
    '---',
    '',
    ...(fullDescription ? [fullDescription, ''] : []),
  ];

  await fs.mkdir(eventDirPath, { recursive: true });
  await fs.writeFile(markdownPath, markdownLines.join('\n'));
  await fs.writeFile(metadataPath, `${JSON.stringify(nodeRecord, null, 2)}\n`);

  const displayMap = eventDataToDisplayMap(nodeRecord);
  const dataTable = buildNewEventTable(displayMap);
  const longDescriptionSection = formatLongDescription(fullDescription);
  const noteBlocks = buildPlusCodeNoteBlocks(plusCodeNote, rawPlusCode, resolvedPlusCode);
  const prBodyPath = path.join(RUNNER_TEMP, `pr-body-${issueNumber}.md`);
  await fs.writeFile(prBodyPath, buildPrBody({ mode: 'new', number: issueNumber, eventName, submitterLogin, plusCodeForLink: plusCode, dataTable, longDescriptionSection, noteBlocks }));

  console.log(`[process-new-event-issue] validation passed — event id: ${eventId}, uid: ${uid}`);
  await setOutput('valid', 'true');
  await setOutput('branch', `automation/new-event-${issueNumber}-${eventId}`);
  await setOutput('commit_message', `Add ${eventName} event from issue #${issueNumber}`);
  await setOutput('pr_title', `Add ${eventName} to the PCD map`);
  await setOutput('pr_body_path', prBodyPath);
  await setOutput('event_name', eventName);
  await setOutput('pr_label', 'new event');
  await setOutput('action_verb', 'added to');
}

await main().catch(async (err) => {
  console.error('[process-new-event-issue] unhandled error:', err);
  try {
    const validationCommentPath = path.join(RUNNER_TEMP, `validation-${issueNumber}.md`);
    await fs.writeFile(validationCommentPath, [
      'Thanks for submitting your event to Processing Community Day 2026! 🌍',
      '',
      'An unexpected error occurred while processing your submission. Our team has been notified.',
      '',
      `If this persists, please ask in the [PCD 2026 forum thread](${PCD_FORUM_THREAD_URL}) or write to ${PCD_CONTACT_EMAIL}.`,
    ].join('\n'));
    await setOutput('valid', 'false');
    await setOutput('validation_comment_path', validationCommentPath);
  } catch {
    // Best-effort — if we can't write the comment, at least exit non-zero
  }
  process.exit(1);
});
