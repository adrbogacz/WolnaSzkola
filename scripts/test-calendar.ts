// Calendar (terminarz) days off: the page opens on the current month, whatever was asked for.
import { calendarShownMonth, parseCalendarHtml } from '../src/librus/scrape';

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

const day = (n: number, text: string, free = false) =>
  `<td class="kalendarz-dzien${free ? ' wolne' : ''}"><div class="kalendarz-numer-dnia">${n}</div><div>${text}</div></td>`;

const november = `
  <form method="post" action="/terminarz">
    <select name="miesiac"><option value="10">Październik</option><option value="11" selected="selected">Listopad</option><option value="12">Grudzień</option></select>
    <select name="rok"><option value="2025">2025</option><option value="2026" selected>2026</option></select>
  </form>
  <table>${day(1, 'Święto Wszystkich Świętych: SP', true)}${day(2, 'Dzień Dyrektorski - wolny od zajęć dydaktycznych: SP', true)}${day(3, '')}</table>`;

assert('month comes from the pickers', JSON.stringify(calendarShownMonth(november)) === '{"year":2026,"month":11}', calendarShownMonth(november));

const heading = `<h2>Grudzień 2026</h2><table>${day(24, 'Wigilia Bożego Narodzenia', true)}</table>`;
assert('month comes from the heading without pickers', JSON.stringify(calendarShownMonth(heading)) === '{"year":2026,"month":12}', calendarShownMonth(heading));

assert('page without a month says so', calendarShownMonth(`<table>${day(1, 'x')}</table>`) === null);

const marks = parseCalendarHtml(november, 2026, 11);
assert('November holidays land in November', marks.some((m) => m.date === '2026-11-01') && marks.some((m) => m.date === '2026-11-02'), marks);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
