import { by, device, element, expect, waitFor } from 'detox';

// The mock runs on the host; Detox reverses port 9091 so the emulator reaches it as localhost.
const MOCK = `http://localhost:${process.env.MOCK_PORT ?? 9091}`;
const LONG_FRAME_MS = 100;

async function setScenario(name: 'normal' | 'librus-down') {
  await fetch(`${MOCK}/__scenario`, { method: 'POST', body: JSON.stringify({ name }) });
}

async function frameY(testID: string): Promise<number> {
  const attributes = (await element(by.id(testID)).getAttributes()) as { frame: { y: number } };
  return attributes.frame.y;
}

describe('Messages', () => {
  beforeAll(async () => {
    await setScenario('normal');
    await device.launchApp({ newInstance: true, delete: true });
  });

  it('renders incoming threads on startup', async () => {
    await element(by.id('login-input')).typeText('1234567');
    await element(by.id('password-input')).typeText('haslo');
    await element(by.id('login-submit')).tap();

    await waitFor(element(by.id('messages-list'))).toBeVisible().withTimeout(20_000);
    await waitFor(element(by.id('message-row-w-103'))).toBeVisible().withTimeout(10_000);
    await expect(element(by.text('Zmiana planu lekcji'))).toBeVisible();
    await expect(element(by.text('Wycieczka – zgoda rodziców'))).toBeVisible();
    await expect(element(by.id('sync-banner'))).not.toExist();
  });

  it('opens a multi-paragraph message without layout shift or long frames', async () => {
    // Detox normally waits for the network to go idle; turn that off to observe the loading state.
    await device.disableSynchronization();
    try {
      await element(by.id('message-row-w-101')).tap();
      await waitFor(element(by.id('message-body-placeholder'))).toBeVisible().withTimeout(5_000);
      await expect(element(by.id('message-topic'))).toHaveText('Wycieczka – zgoda rodziców');
      const topicBefore = await frameY('message-topic');

      await waitFor(element(by.id('message-body'))).toBeVisible().withTimeout(10_000);
      await expect(element(by.text('Dzień dobry,'))).toBeVisible();
      await expect(
        element(by.text('w piątek klasa 3b jedzie na wycieczkę do Krakowa. Zażółć gęślą jaźń.')),
      ).toBeVisible();
      const topicAfter = await frameY('message-topic');
      if (topicAfter !== topicBefore) {
        throw new Error(`Header moved when the body loaded: y ${topicBefore} -> ${topicAfter}`);
      }

      // FrameProbe reports the longest JS frame gap during the first 3 s on screen.
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      const probe = (await element(by.id('frame-probe')).getAttributes()) as { text?: string };
      const worst = Number(probe.text);
      if (!Number.isFinite(worst) || worst > LONG_FRAME_MS) {
        throw new Error(`A JS frame took ${probe.text} ms while opening the message (limit ${LONG_FRAME_MS} ms)`);
      }
    } finally {
      await device.enableSynchronization();
    }
  });

  it('keeps cached messages with a banner when Librus is down', async () => {
    await device.pressBack();
    await setScenario('librus-down');
    await element(by.id('messages-list')).swipe('down', 'slow', 0.6);
    await waitFor(element(by.id('sync-banner'))).toBeVisible().withTimeout(20_000);
    await expect(element(by.id('message-row-w-103'))).toBeVisible();
    await setScenario('normal');
  });
});
