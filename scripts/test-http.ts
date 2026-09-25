import { librusHttpsUrl } from '../src/librus/urls';

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
  'wiadomosci http is upgraded to https',
  librusHttpsUrl('http://wiadomosci.librus.pl/api/inbox/messages/1') ===
    'https://wiadomosci.librus.pl/api/inbox/messages/1',
);
assert(
  'https librus urls stay https',
  librusHttpsUrl('https://synergia.librus.pl/przegladaj_oceny/uczen') ===
    'https://synergia.librus.pl/przegladaj_oceny/uczen',
);
assert('non-librus http is left alone', librusHttpsUrl('http://example.com/x') === 'http://example.com/x');

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll http checks passed');
