// Anonymised Librus wiadomosci payloads shared by the integration test and the e2e mock server.
export const POLISH_SAMPLE = 'Zażółć gęślą jaźń';

const BODY_HTML = [
  '<p>Dzień dobry,</p>',
  `<p>w piątek klasa 3b jedzie na wycieczkę do Krakowa. ${POLISH_SAMPLE}.</p>`,
  '<p>Proszę o podpisanie zgody do <b>środy</b>.<br>Pozdrawiam,<br>Anna Wiśniewska</p>',
].join('');

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function inboxFixture(count = 3) {
  const base = [
    { messageId: '101', topic: 'Wycieczka – zgoda rodziców', senderFirstName: 'Anna', senderLastName: 'Wiśniewska', sendDate: '2026-10-13 09:30:00', readDate: '2026-10-13 10:00:00' },
    { messageId: '102', topic: 'Zebranie z rodzicami', senderFirstName: 'Piotr', senderLastName: 'Zieliński', sendDate: '2026-10-01 15:12:00', readDate: '2026-10-01 18:00:00' },
    { messageId: '103', topic: 'Zmiana planu lekcji', senderFirstName: 'Ewa', senderLastName: 'Nowak', sendDate: '2026-10-14 08:15:00', readDate: null },
  ];
  const extra = Array.from({ length: Math.max(0, count - base.length) }, (_, index) => ({
    messageId: String(200 + index),
    topic: `Informacja ${index + 1}`,
    senderFirstName: 'Sekretariat',
    senderLastName: 'Szkoły',
    sendDate: `2026-09-${String((index % 28) + 1).padStart(2, '0')} 12:00:00`,
    readDate: '2026-09-30 12:00:00',
  }));
  return { data: [...base, ...extra].slice(0, count) };
}

export function messageDetailFixture(id = '101') {
  return {
    data: {
      messageId: id,
      topic: 'Wycieczka – zgoda rodziców',
      senderFirstName: 'Anna',
      senderLastName: 'Wiśniewska',
      sendDate: '2026-10-13 09:30:00',
      Message: base64Utf8(BODY_HTML),
    },
  };
}
