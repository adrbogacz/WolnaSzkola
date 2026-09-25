import { alignMessageFields, tidySenderLabel } from '../src/reply';
import { parseInboxHtml, parseMessageDetailHtml } from '../src/librus/scrape';

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

assert(
  'duplicate name and role collapse',
  tidySenderLabel('Nowak Anna (Nowak Anna) [Nauczyciel]') ===
    'Nowak Anna [Nauczyciel]',
);

const swapped = alignMessageFields(
  'Wiśniewska Ewa (Wiśniewska Ewa) [Dyrektor Szkoły]',
  'Zebranie z rodzicami',
);
assert('person in the topic slot moves to sender', swapped.sender.startsWith('Wiśniewska Ewa'), swapped);
assert('subject stays the topic', swapped.topic === 'Zebranie z rodzicami', swapped);

const label = alignMessageFields('Nadawca', 'Zieliński Piotr');
assert('field label is not the title', label.topic !== 'Nadawca', label);
assert('sender stays a person when the title was a label', label.sender === 'Zieliński Piotr', label);

const html = `
<table>
  <tr>
    <td>Nadawca</td>
    <td><a href="/wiadomosci/1/5/10">Rodzic A. Adam</a></td>
    <td>18.09.2026 16:35</td>
  </tr>
  <tr>
    <td>Nowak Anna (Nowak Anna) [Nauczyciel]</td>
    <td><a href="/wiadomosci/1/5/12">Wyjście na basen</a></td>
    <td>14.09.2026 15:12</td>
  </tr>
  <tr>
    <td>Zebranie z rodzicami</td>
    <td><a href="/wiadomosci/1/5/13">Wiśniewska Ewa (Wiśniewska Ewa) [Dyrektor Szkoły]</a></td>
    <td>14.09.2026</td>
  </tr>
</table>
`;

const inbox = parseInboxHtml(html);
const basen = inbox.find((item) => item.id === '5-12');
const meeting = inbox.find((item) => item.id === '5-13');
const parent = inbox.find((item) => item.id === '5-10');
assert('topic link stays the title', basen?.topic === 'Wyjście na basen', basen);
assert('repeated sender name is collapsed', basen?.sender === 'Nowak Anna [Nauczyciel]', basen);
assert('swapped row puts the subject in the title', meeting?.topic === 'Zebranie z rodzicami', meeting);
assert('swapped row puts the person in the sender', Boolean(meeting?.sender.startsWith('Wiśniewska Ewa')), meeting);
assert('column label is not stored as the title', parent?.topic !== 'Nadawca', parent);

const detail = parseMessageDetailHtml(
  `<table><tr><th>Nadawca</th><td>Nowak Anna (Nowak Anna) [Nauczyciel]</td></tr>
   <tr><th>Temat</th><td>Wyjście na basen</td></tr></table>`,
  '5-12',
);
assert('detail sender is not doubled', detail.sender === 'Nowak Anna [Nauczyciel]', detail);
assert('detail topic is the subject', detail.topic === 'Wyjście na basen', detail);

if (failed > 0) {
  console.error(`${failed} failed`);
  process.exit(1);
}
