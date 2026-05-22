# @signalforge/adapter

Easy-start integration layer for existing web apps.

This package is meant for developers who already have a web product and want a low-friction way to feed:

- user feedback
- runtime errors
- route / environment / release context

into SignalForge.

## What It Does

- sends feedback to `/submissions`
- sends runtime errors to `/runtime-events`
- converts Sentry-style events into SignalForge runtime events
- converts GlitchTip-style events into SignalForge runtime events
- provides a lightweight feedback widget

## Example

```js
import { createSignalForgeAdapter } from '@signalforge/adapter';

const sf = createSignalForgeAdapter({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});

await sf.captureFeedback({
  body: 'The save button freezes on mobile.',
  appContext: { route: '/reader/42' },
});

await sf.captureError(new Error('reader timeout'), {
  route: '/reader/42',
});
```

## Recommended Runtime Setup

SignalForge should not replace a mature error collection provider.

Recommended layering:

- Sentry or GlitchTip collects runtime exceptions
- `@signalforge/adapter` normalizes the event
- SignalForge turns the event into an engineering case

## Main Exports

- `createSignalForgeAdapter`
- `installSignalForge`
- `captureError`
- `linkSentry`
- `linkGlitchTip`
- `mountFeedbackWidget`
