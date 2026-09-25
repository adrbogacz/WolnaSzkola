import { combineGrades } from '../src/librus/gradesCombine';
import { parseGrades } from '../src/librus/normalize';
import { isJunkGrade, parseGradeDetailPage, parseGradesHtml, tidyGradeComment } from '../src/librus/scrape';
import type { SchoolGrade } from '../src/librus/types';

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

function grade(partial: Partial<SchoolGrade> & { id: string; value: string }): SchoolGrade {
  return {
    subject: 'Edukacja polonistyczna',
    subjectId: '1',
    category: 'Ocena',
    date: '2026-09-16',
    teacher: 'Anna Nowak',
    semester: 1,
    isSemester: false,
    isFinal: false,
    isProposition: false,
    ...partial,
  };
}

const nestedEarlyEd = `
<table class="decorated stretch">
  <tr class="line0">
    <td>Edukacja polonistyczna</td>
    <td>
      <span id="Ocena1" class="grade-box">
        <a class="ocena" href="/przegladaj_oceny/szczegoly/555001" title="Umiejętność: Samokształcenie<br>Data: 2026-09-16<br>Nauczyciel: Nowak Anna">3</a>
      </span>
    </td>
  </tr>
  <tr id="przedmioty_111" style="display: none">
    <td colspan="10">
      <table>
        <tr><td colspan="6">Okres 1</td></tr>
        <tr>
          <th>Ocena</th><th>K</th><th>Obszar oceniania</th><th>Umiejętność</th><th>Data</th><th>Nauczyciel</th>
        </tr>
        <tr>
          <td>
            <table><tr><td><span class="grade-box"><a class="ocena">6</a></span></td></tr></table>
          </td>
          <td>K</td>
          <td>Edukacja polonistyczna</td>
          <td>Samokształcenie</td>
          <td>2026-09-16</td>
          <td>Nowak Anna</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const htmlGrades = parseGradesHtml(nestedEarlyEd);
assert(
  'nested skill table keeps the 6 even when the collapsed box shows skill id 3',
  htmlGrades.some((item) => item.value === '6' && item.category === 'Samokształcenie'),
  htmlGrades,
);
const visibleSix = parseGradesHtml(`
<tr>
  <td>Edukacja polonistyczna</td>
  <td>
    <span class="grade-box">
      <a class="ocena" href="/przegladaj_oceny/szczegoly/555001" title="Umiejętność: Samokształcenie<br>Data: 2026-09-16<br>Nauczyciel: Nowak Anna">6</a>
    </span>
  </td>
</tr>
`);
assert(
  'visible grade-box 6 is kept even when the tooltip has a skill and no Ocena',
  visibleSix.some((item) => item.value === '6' && item.category === 'Samokształcenie'),
  visibleSix,
);

const tooltipSkillId = parseGradesHtml(`
<tr>
  <td>Edukacja polonistyczna</td>
  <td>
    <span class="grade-box">
      <a class="ocena" href="/przegladaj_oceny/szczegoly/555001" title="Ocena: 3<br>Umiejętność: Samokształcenie<br>Data: 2026-09-16<br>Nauczyciel: Nowak Anna">6</a>
    </span>
  </td>
</tr>
`);
assert(
  'tooltip Ocena 3 cannot beat the 6 shown in the grade-box',
  tooltipSkillId.some((item) => item.value === '6') && !tooltipSkillId.some((item) => item.value === '3'),
  tooltipSkillId,
);

const flatSkillTable = parseGradesHtml(`
<table>
  <tr><td>Okres 1</td></tr>
  <tr>
    <th>Ocena</th><th>K</th><th>Obszar oceniania</th><th>Umiejętność</th><th>Data</th><th>Nauczyciel</th>
  </tr>
  <tr>
    <td style="background:#ff0">6</td>
    <td>K</td>
    <td>Edukacja polonistyczna</td>
    <td>Samokształcenie</td>
    <td>16.09.2026</td>
    <td>Nowak Anna</td>
  </tr>
</table>
`);
assert(
  'flat skill table with Polish date still reads 6',
  flatSkillTable.some((item) => item.value === '6' && item.date === '2026-09-16' && item.category === 'Samokształcenie'),
  flatSkillTable,
);

const detailNoDate = parseGradeDetailPage(
  `
  <span class="grade-box"><a class="ocena">6</a></span>
  <table>
    <tr><th>Umiejętność</th><td>Samokształcenie</td></tr>
    <tr><th>Nauczyciel</th><td>Nowak Anna</td></tr>
  </table>
  `,
  '555001',
);
assert('szczegoly 6 is kept even without a date field', detailNoDate?.value === '6', detailNoDate);

const detailsOverTable = combineGrades({
  html: [grade({ id: 'html-table-1', value: '6', category: 'Samokształcenie', isFormative: true })],
  details: [grade({ id: 'szczegoly-555001', value: '3', category: 'Samokształcenie' })],
  skillIds: ['3'],
});
assert('szczegoly 3 cannot overwrite html-table 6', detailsOverTable[0]?.value === '6', detailsOverTable);

const apiGrades = parseGrades(
  {
    Grades: [
      {
        Id: 555001,
        Grade: '3',
        Date: '2026-09-16',
        Subject: { Id: 1, Name: 'Edukacja polonistyczna' },
        AddedBy: { FirstName: 'Anna', LastName: 'Nowak' },
      },
    ],
  },
  new Map([['1', 'Edukacja polonistyczna']]),
  new Map(),
  new Map([['9', 'Anna Nowak']]),
  new Map(),
  new Map([['3', 'Samokształcenie']]),
);

assert(
  'API Grade=3 with skill 3=Samokształcenie is not treated as the mark',
  apiGrades.length === 1 && apiGrades[0]?.value === '' && apiGrades[0]?.category === 'Samokształcenie',
  apiGrades,
);

const merged = combineGrades({
  html: htmlGrades,
  api: apiGrades,
  skillIds: ['3'],
});
assert(
  'combined result is 6 / Samokształcenie, never 3',
  merged.length === 1 && merged[0]?.value === '6' && merged[0]?.category === 'Samokształcenie',
  merged,
);
assert('no fake Przedmiot / 1 leftover from Okres 1', !merged.some((item) => item.subject === 'Przedmiot' || item.value === '1'), merged);
assert('skill details are not repeated under the grade', !merged[0]?.comment, merged[0]);
assert('formative skill grade is marked kształtująca', merged[0]?.isFormative === true, merged[0]);

const apiOnly = combineGrades({
  api: [
    grade({
      id: '555001',
      value: '3',
      category: 'Samokształcenie',
      teacher: 'Anna Nowak',
    }),
  ],
  skillIds: ['3'],
});
assert('API skill-id mark is dropped when HTML is missing', apiOnly.length === 0, apiOnly);

const realThree = parseGrades(
  {
    Grades: [
      {
        Id: 77,
        Grade: '3',
        Date: '2026-09-16',
        Subject: { Name: 'Matematyka' },
        Category: { Id: 10, Name: 'Kartkówka' },
        AddedBy: { FirstName: 'Jan', LastName: 'Kowalski' },
      },
    ],
  },
  new Map(),
  new Map([['10', 'Kartkówka']]),
  new Map(),
  new Map(),
  new Map([['3', 'Samokształcenie']]),
);
assert(
  'ordinary dostateczny 3 with a category stays 3',
  realThree[0]?.value === '3' && realThree[0]?.category === 'Kartkówka',
  realThree,
);

const detail = parseGradeDetailPage(
  `
  <table>
    <tr><th>Ocena</th><th>Kategoria</th><th>Data</th><th>Nauczyciel</th></tr>
    <tr><td>3</td><td>Samokształcenie</td><td>2026-09-16</td><td>Nowak Anna</td></tr>
  </table>
  <span class="grade-box"><a class="ocena">6</a></span>
  `,
  '555001',
);
assert('szczegoly prefers grade-box 6 over a labeled 3', detail?.value === '6', detail);
const detailSkillBox = parseGradeDetailPage(
  `
  <span class="grade-box">
    <a class="ocena" href="/przegladaj_oceny/szczegoly/555001" title="Umiejętność: Samokształcenie<br>Data: 2026-09-16<br>Nauczyciel: Nowak Anna">3</a>
  </span>
  <table>
    <tr><th>Ocena</th><th>K</th><th>Obszar oceniania</th><th>Umiejętność</th><th>Data</th><th>Nauczyciel</th></tr>
    <tr>
      <td>6</td><td>K</td><td>Edukacja polonistyczna</td><td>Samokształcenie</td>
      <td>2026-09-16</td><td>Nowak Anna</td>
    </tr>
  </table>
  `,
  '555001',
);
assert('szczegoly ignores skill-id box 3 and keeps table 6', detailSkillBox?.value === '6', detailSkillBox);

const boxAndTable = combineGrades({
  html: [
    grade({ id: 'html-a-1', value: '3', category: 'Samokształcenie', teacher: 'Nowak Anna' }),
    grade({ id: 'html-table-1', value: '6', category: 'Samokształcenie', teacher: 'Nowak Anna' }),
  ],
  api: [grade({ id: '555001', value: '3', category: 'Samokształcenie' })],
  skillIds: ['3'],
});
assert('html-table 6 wins over collapsed box 3 and API 3', boxAndTable[0]?.value === '6', boxAndTable);

const boxSixOverDetails = combineGrades({
  html: [grade({ id: 'html-a-1', value: '6', category: 'Samokształcenie', isFormative: true })],
  details: [grade({ id: 'szczegoly-555001', value: '3', category: 'Samokształcenie' })],
  api: [grade({ id: '555001', value: '3', category: 'Samokształcenie' })],
  skillIds: ['3'],
});
assert('visible html-a 6 wins over szczegoly 3 and API 3', boxSixOverDetails[0]?.value === '6', boxSixOverDetails);

const classic = parseGradesHtml(`
<tr>
  <td>Informatyka</td>
  <td>
    <span class="grade-box" style="background-color:#FFD700;">
      <a title="Kategoria: Aktywność<br>Data: 2017-09-19 (wt.)<br>Nauczyciel: Kowalska Maria" class="ocena" href="/przegladaj_oceny/szczegoly/100144">6</a>
    </span>
  </td>
</tr>
`);
assert(
  'classic grade-box still reads 6 / Aktywność',
  classic.some((item) => item.value === '6' && item.category === 'Aktywność' && item.subject === 'Informatyka'),
  classic,
);

const emptyTitleBox = parseGradesHtml(`
<tr class="line0">
  <td>Edukacja polonistyczna</td>
  <td>
    <span id="Ocena1" class="grade-box" style="background-color:#FFD700;">
      <a title="" class="ocena" href="/przegladaj_oceny/szczegoly/100512">6</a>
    </span>
  </td>
</tr>
`);
assert(
  'Mati365-style grade-box with empty title still keeps the visible 6',
  emptyTitleBox.some((item) => item.value === '6' && item.id.includes('100512')),
  emptyTitleBox,
);

const canaryHtml = parseGradesHtml(`
<tr class="line0">
  <td></td>
  <td>
    <span id="Ocena0" class="grade-box">
      <a title="" class="ocena" href="/przegladaj_oceny/szczegoly/000000" id="ocenaTest">1</a>
    </span>
  </td>
</tr>
<tr class="line1">
  <td>Edukacja polonistyczna</td>
  <td>
    <span id="Ocena1" class="grade-box" style="background-color:#FFD700;">
      <a title="" class="ocena" href="/przegladaj_oceny/szczegoly/100512">6</a>
    </span>
  </td>
</tr>
`);
assert(
  'Librus ocenaTest canary 1 is ignored on the grades list',
  canaryHtml.some((item) => item.value === '6') && !canaryHtml.some((item) => item.value === '1'),
  canaryHtml,
);

const szczegolyWithCanary = parseGradeDetailPage(
  `
  <div class="container-background">
    <h2 class="inside">Szczegóły oceny</h2>
    <table class="decorated medium center">
      <tr><th>Ocena</th><td><span class="grade-box"><a class="ocena">6</a></span></td></tr>
      <tr><th>Kategoria</th><td>Samokształcenie</td></tr>
      <tr><th>Obszar oceniania</th><td>Edukacja polonistyczna</td></tr>
      <tr><th>Data</th><td>16.09.2026</td></tr>
      <tr><th>Nauczyciel</th><td>Nowak Anna</td></tr>
    </table>
  </div>
  <span id="Ocena0" class="grade-box">
    <a title="" class="ocena" href="/przegladaj_oceny/szczegoly/000000" id="ocenaTest">1</a>
  </span>
  `,
  '100512',
);
assert(
  'szczegoly keeps table 6 and ignores layout canary 1',
  szczegolyWithCanary?.value === '6' && szczegolyWithCanary.category === 'Samokształcenie',
  szczegolyWithCanary,
);

const szczegolyCanaryOnlyBox = parseGradeDetailPage(
  `
  <div class="container-background">
    <h2 class="inside">Szczegóły oceny</h2>
    <table class="decorated medium center">
      <tr><th>Ocena</th><td>6</td></tr>
      <tr><th>Umiejętność</th><td>Samokształcenie</td></tr>
      <tr><th>Nauczyciel</th><td>Nowak Anna</td></tr>
    </table>
  </div>
  <span class="grade-box">
    <a class="ocena" href="/przegladaj_oceny/szczegoly/000000" id="ocenaTest">1</a>
  </span>
  `,
  '100512',
);
assert(
  'szczegoly labeled 6 wins when the only grade-box is the canary 1',
  szczegolyCanaryOnlyBox?.value === '6',
  szczegolyCanaryOnlyBox,
);

const deniedPage = parseGradeDetailPage(
  `
  <title>LIBRUS Synergia</title>
  <h2 class="inside">Brak dostępu</h2>
  <span id="Ocena0" class="grade-box">
    <a title="" class="ocena" href="/przegladaj_oceny/szczegoly/000000" id="ocenaTest">1</a>
  </span>
  `,
  '100512',
);
assert('denied szczegoly page does not become a fake 1', !deniedPage || deniedPage.value !== '1', deniedPage);

assert(
  'placeholder Przedmiot / Ocena is dropped even when it has an id',
  isJunkGrade(
    grade({
      id: 'szczegoly-555001',
      value: '1',
      subject: 'Przedmiot',
      category: 'Ocena',
      date: '',
      teacher: '',
    }),
  ),
);

const repeated = tidyGradeComment({
  ...grade({ id: '1', value: '6', category: 'Samokształcenie', subject: 'Edukacja polonistyczna', isFormative: true }),
  comment: [
    'Ocena kształtująca',
    'Umiejętność: Samokształcenie',
    'Obszar: Edukacja polonistyczna',
    'Ocena kształtująca',
    'Umiejętność: Samokształcenie',
    'Obszar: Edukacja polonistyczna',
    'Samokształcenie',
  ].join('\n'),
});
assert('skill lines that restate the grade are not shown again', !repeated, repeated);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll grade checks passed');
