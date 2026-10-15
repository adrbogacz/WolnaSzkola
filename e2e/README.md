# Messaging e2e (Detox, Android emulator)

The suite never talks to real Librus. `e2e/mock-librus.ts` serves the login flow, the inbox
(40 threads) and a multi-paragraph message (delayed 1.5 s so the test can see the loading state),
using the same fixtures as `scripts/test-messaging-client.ts`. The app is pointed at it with
`EXPO_PUBLIC_LIBRUS_MOCK_URL`, which only e2e builds set.

`e2e/messages.test.ts` checks that:
1. after login the message list renders incoming threads (`message-row-*`), with no sync banner;
2. opening a thread shows the header and a body placeholder first, then the body text
   (Polish characters intact), the header does not move when the body arrives, and no JS frame
   during the first 3 s takes longer than 100 ms (`FrameProbe`, shown only when `EXPO_PUBLIC_E2E=1`);
3. when Librus returns 503 on refresh, the cached list stays and `sync-banner` appears.

## One-time setup

These are not in `package.json` yet, because they could not be installed from the sandbox that
wrote this suite:

```sh
npm i -D jest@29 babel-jest@29 @config-plugins/detox
```

Then add `"@config-plugins/detox"` to `expo.plugins` in `app.json` and run
`npx expo prebuild -p android` so the Android project gets the Detox test runner.
Create an emulator (or set `DETOX_AVD` to an existing one).

## Running

```sh
npm run e2e:mock      # terminal 1: mock Librus on :9091
npm run e2e:metro     # terminal 2: Metro with the e2e env
npm run e2e:build     # once per native change
npm run e2e
```
