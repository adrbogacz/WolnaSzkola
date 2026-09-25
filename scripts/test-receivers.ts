import {
  classIdFromUrl,
  classIdsFromMe,
  extractReceiverClassIds,
  parseWiadomosciReceiverTypes,
  refId,
} from '../src/librus/normalize';
import {
  INBOX_TTL_MS,
  loadWithTtl,
  messageHasBody,
  readFresh,
} from '../src/librus/cachePolicy';
import {
  wiadomosciReceiverApiPaths,
  wiadomosciReceiverApiPathsHitPeople,
} from '../src/librus/receiversPlan';
import {
  applyRecipientClassFields,
  canonicalRecipientTypeId,
  isAccessDeniedHtml,
  mergeRecipientTypes,
  parseRecipientClassIds,
  parseRecipientTypes,
  parseRecipientsHtml,
  parseSendResult,
  recipientNeedsClass,
  recipientTypeAliases,
  recipientTypesToFetch,
} from '../src/librus/scrape';

let failed = 0;

function assert(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`ok  ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label}`);
  if (detail !== undefined) console.error(detail);
}

const composeHtml = `
<script>
  selectRecipients('nauczyciel', false, 0, 0);
  selectRecipients('rodzic', false, 0, 10001);
</script>
<input type="radio" name="typAdresata" value="nauczyciel"><label>Nauczyciele</label>
<select name="klasa_rodzice"><option value="0">-</option><option value="10001">1a</option></select>
`;

const classIds = parseRecipientClassIds(composeHtml);
assert('class id from selectRecipients', classIds.includes('10001'), classIds);
assert('class id from klasa_rodzice select', classIds.includes('10001'), classIds);
assert(
  'class id from false, 0, N on one line',
  parseRecipientClassIds('foo(selectRecipients("rada", false, 0, 77711));').includes('77711'),
);

const htmlTypes = parseRecipientTypes(composeHtml);
assert(
  'html types include nauczyciel',
  htmlTypes.some((item) => item.id === 'nauczyciel'),
  htmlTypes,
);
const merged = mergeRecipientTypes(htmlTypes);
assert(
  'merged types keep rodzic, rada, opiekun',
  ['rodzic', 'rada', 'opiekun', 'szkolna_rada'].every((id) => merged.some((item) => item.id === id)),
  merged.map((item) => item.id),
);

const fetched = recipientTypesToFetch(htmlTypes);
assert(
  'fetch list skips psycholog unless HTML has it',
  fetched.some((item) => item.id === 'rodzic') && !fetched.some((item) => item.id === 'psycholog'),
  fetched.map((item) => item.id),
);

const people = parseRecipientsHtml(
  `
  <table class="message-recipients-detail">
    <tr class="line0">
      <td><input type="checkbox" name="DoKogo[]" value="90111"><label>Anna Kowalska</label></td>
    </tr>
  </table>
  `,
  'Rady klasowe rodziców',
  'rada',
);
assert('html recipients parse name and group', people[0]?.name === 'Anna Kowalska' && people[0]?.group === 'Rady klasowe rodziców', people);

const classOnly = parseRecipientsHtml(
  `<select name="klasa_rodzice"><option value="0">wybierz</option><option value="10001">1a</option></select>`,
  'Rodzice',
  'rodzic',
);
assert('class dropdown without people is empty', classOnly.length === 0, classOnly);
assert(
  'class id from getRecipients probe html',
  parseRecipientClassIds(
    `<select name="klasa_rodzice"><option value="0">wybierz</option><option value="10001">1a</option></select>`,
  ).includes('10001'),
);

const parentPeople = parseRecipientsHtml(
  `
  <table class="message-recipients-detail">
    <tr class="line0"><td><input name="DoKogo[]" value="70001"><label>Katarzyna Wiśniewska</label></td></tr>
  </table>
  `,
  'Rodzice',
  'rodzic',
);
assert('parents parsed after class-scoped getRecipients', parentPeople[0]?.typeId === 'rodzic' && parentPeople[0]?.name.includes('Wiśniewska'), parentPeople);

const typesPayload = {
  data: [
    { id: 4, symbol: 'rodzic', name: 'Rodzice', classes: [{ id: 10001, name: '1a' }] },
    { id: 1, symbol: 'nauczyciel', name: 'Nauczyciele' },
  ],
};
const types = parseWiadomosciReceiverTypes(typesPayload);
assert(
  'types json keeps rodzic symbol and class',
  types.some((item) => item.id === 'rodzic' && item.classIds.includes('10001') && item.apiId === '4'),
  types,
);
assert(
  'extract class ids from nested classes',
  extractReceiverClassIds(typesPayload).includes('10001'),
  extractReceiverClassIds(typesPayload),
);

assert('Class.Url is parsed', classIdFromUrl('/2.0/Classes/10001') === '10001');
assert(
  'refId reads Class.Url',
  refId({ Url: 'https://api.librus.pl/2.0/Classes/10001' }) === '10001',
);
assert(
  'class ids from /Me Class.Url',
  classIdsFromMe({ Me: { User: { Class: { Url: '/2.0/Classes/10001' } } } }).includes('10001'),
);

const parentForm = new URLSearchParams();
applyRecipientClassFields(parentForm, 'rodzic', '10001');
assert('send form keeps typAdresata=rodzic', parentForm.get('typAdresata') === 'rodzic');
assert('send form has klasa_rodzice', parentForm.get('klasa_rodzice') === '10001');

const teacherForm = new URLSearchParams();
applyRecipientClassFields(teacherForm, 'nauczyciel', '10001');
assert('teacher send form does not get klasa_rodzice', teacherForm.get('klasa_rodzice') === null);
assert('parent form does not set idGrupy', parentForm.get('idGrupy') === null);
assert('canonical rodzice is rodzic', canonicalRecipientTypeId('rodzice') === 'rodzic');
assert('canonical wychowawcy is wychowawca', canonicalRecipientTypeId('wychowawcy') === 'wychowawca');
assert('rada needs class id', recipientNeedsClass('rada') && recipientNeedsClass('rodzice'));
assert('wychowawca and szkolna rada do not need class', !recipientNeedsClass('wychowawca') && !recipientNeedsClass('szkolna_rada'));
assert(
  'aliases cover plural wychowawcy',
  recipientTypeAliases('wychowawca').includes('wychowawcy') && recipientTypeAliases('rodzice').includes('rodzic'),
);

const labeledTutor = parseRecipientsHtml(
  `<label for="user_445566">Jan Wychowawca</label>`,
  'Wychowawcy',
  'wychowawca',
);
assert(
  'wychowawca from label for without table',
  labeledTutor[0]?.id === '445566' && labeledTutor[0]?.name.includes('Wychowawca'),
  labeledTutor,
);

const divTutor = parseRecipientsHtml(
  `<div class="line0"><input type="checkbox" name="DoKogo[]" value="778899"><label>Anna Tutor</label></div>`,
  'Wychowawcy',
  'wychowawca',
);
assert('wychowawca from div line0', divTutor[0]?.id === '778899' && divTutor[0]?.name === 'Anna Tutor', divTutor);

const typesFromPlural = parseRecipientTypes(
  `<input type="radio" name="typAdresata" value="rodzice"><label>Rodzice</label>`,
);
assert('html type rodzice canonicalizes to rodzic', typesFromPlural.some((item) => item.id === 'rodzic'), typesFromPlural);

assert(
  'send result accepts confirmation',
  parseSendResult('<div class="green container">Wiadomość została wysłana.</div>').ok,
);
assert(
  'send result ignores unread class as error',
  !parseSendResult('<td class="unread">Anna Nowak</td>').hint,
);
assert(
  'denied send page has no fake hint',
  parseSendResult('<h1>Brak dostępu</h1>').ok === false && parseSendResult('<h1>Brak dostępu</h1>').hint === '',
);
assert('denied html detector', isAccessDeniedHtml('<h2>Brak dostępu</h2>'));

const apiPaths = wiadomosciReceiverApiPaths();
assert('receiver api stays on types endpoint', apiPaths.length === 1 && apiPaths[0]?.includes('/api/receivers/types?'));
assert('receiver api does not probe people paths', !wiadomosciReceiverApiPathsHitPeople(apiPaths));
assert(
  'people path detector works',
  wiadomosciReceiverApiPathsHitPeople(['/api/receivers?type=rodzic']),
);

assert(
  'message without body is not treated as opened',
  !messageHasBody({ id: 'w-1', topic: 'Hi', body: '', sentAt: '', sender: 'A', read: false, hasAttachments: false, kind: 'inbox' }),
);

async function runCacheChecks() {
  const now = 1_000_000;
  let fetches = 0;
  const cached = await loadWithTtl({
    force: false,
    memory: { savedAt: now - 1_000, data: ['cached'] },
    ttlMs: INBOX_TTL_MS,
    loadDisk: async () => null,
    fetchNetwork: async () => {
      fetches += 1;
      return ['network'];
    },
    now,
  });
  assert('fresh ttl cache skips network', cached.fromNetwork === false && cached.data[0] === 'cached' && fetches === 0, cached);

  fetches = 0;
  const stale = await loadWithTtl({
    force: false,
    memory: { savedAt: now - INBOX_TTL_MS - 1, data: ['old'] },
    ttlMs: INBOX_TTL_MS,
    loadDisk: async () => null,
    fetchNetwork: async () => {
      fetches += 1;
      return ['network'];
    },
    now,
  });
  assert('stale ttl cache fetches', stale.fromNetwork === true && stale.data[0] === 'network' && fetches === 1, stale);
}

assert('readFresh rejects stale', readFresh({ savedAt: 1, data: 1 }, 10, 100) === null);

void runCacheChecks()
  .catch((error) => {
    failed += 1;
    console.error('FAIL cache checks', error);
  })
  .then(() => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log('\nAll receiver checks passed');
  });
