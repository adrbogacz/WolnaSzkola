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

const shortSubject = alignMessageFields('Zgoda na wyjście', 'Wójcik Adam (Przedstawiciel Klasowej Rady Rodziców)');
assert('short subject that reads like a name stays the topic', shortSubject.topic === 'Zgoda na wyjście', shortSubject);
assert(
  'parent representative with a role in brackets stays the sender',
  shortSubject.sender === 'Wójcik Adam (Przedstawiciel Klasowej Rady Rodziców)',
  shortSubject,
);

const plainWords = alignMessageFields('Prośba o zgodę', 'Kowalska Anna');
assert('two plain fields are left as Librus sent them', plainWords.topic === 'Prośba o zgodę', plainWords);

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

// Real synergia layout: the person cell and the subject cell both link to the message.
const synergiaRow = (id: number, sender: string, topic: string, bold = false) => `
  <tr class="line0">
    <td class="center"><input type="checkbox" name="tablica_wiadomosci[]" value="${id}"></td>
    <td>&nbsp;</td>
    <td${bold ? ' style="font-weight: bold;"' : ''}><a href="/wiadomosci/1/5/${id}/f0">${sender}</a></td>
    <td${bold ? ' style="font-weight: bold;"' : ''}><a href="/wiadomosci/1/5/${id}/f0">${topic}</a></td>
    <td class="center">2026-10-07 13:40:00</td>
    <td class="center"><a href="/wiadomosci/1/5/${id}/f0/usun" title="Usuń"><img src="/images/trash.png"></a></td>
  </tr>`;
const synergia = parseInboxHtml(`<table class="decorated stretch">
  <thead><tr><td></td><td></td><td>Nadawca</td><td>Temat</td><td>Wysłano</td><td></td></tr></thead>
  ${synergiaRow(21, 'Zielińska Maria (Zielińska Maria) [Nauczyciel]', 'Zadanie domowe.', true)}
  ${synergiaRow(22, 'Lis Tomasz (Lis Tomasz) [Dyrektor Szkoły]', 'Parking dla hulajnóg przy szkole')}
  ${synergiaRow(23, 'Kowalski Jan', 'Nowak Anna')}
</table>`);
const materials = synergia.find((item) => item.id === '5-21');
const bikes = synergia.find((item) => item.id === '5-22');
const namesOnly = synergia.find((item) => item.id === '5-23');
assert('synergia rows: every message parsed once', synergia.length === 3, synergia);
assert('synergia row: short subject is not mistaken for a person', materials?.topic === 'Zadanie domowe.', materials);
assert('synergia row: sender comes from the first linked cell', materials?.sender === 'Zielińska Maria [Nauczyciel]', materials);
assert('synergia row: bold row is unread', materials?.read === false, materials);
assert('synergia row: subject stays the title', bikes?.topic === 'Parking dla hulajnóg przy szkole', bikes);
assert('synergia row: plain row is read', bikes?.read === true, bikes);
assert('synergia row: a subject that looks like a name is not swapped', namesOnly?.topic === 'Nowak Anna' && namesOnly.sender === 'Kowalski Jan', namesOnly);
assert('synergia row: date is not taken as a subject', materials?.sentAt === '2026-10-07 13:40:00', materials);

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
