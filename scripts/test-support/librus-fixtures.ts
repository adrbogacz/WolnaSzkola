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

/** What an expired wiadomosci session answers with instead of JSON. */
export const LOGIN_PAGE =
  '<!DOCTYPE html><html><body><form action="/loguj"><input name="login"><input name="pass"></form></body></html>';

/** synergia /wiadomosci list: the person cell and the subject cell both link to the message. */
export function inboxHtmlFixture() {
  const rows = inboxFixture().data.map(
    (item) => `
    <tr class="line0">
      <td class="center"><input type="checkbox" name="tablica_wiadomosci[]" value="${item.messageId}"></td>
      <td>&nbsp;</td>
      <td${item.readDate ? '' : ' style="font-weight: bold;"'}><a href="/wiadomosci/1/5/${item.messageId}/f0">${item.senderLastName} ${item.senderFirstName} (${item.senderLastName} ${item.senderFirstName}) [Nauczyciel]</a></td>
      <td${item.readDate ? '' : ' style="font-weight: bold;"'}><a href="/wiadomosci/1/5/${item.messageId}/f0">${item.topic}</a></td>
      <td class="center">${item.sendDate}</td>
    </tr>`,
  );
  return `<html><body><table class="decorated stretch"><tbody>${rows.join('')}</tbody></table></body></html>`;
}
