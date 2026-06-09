# @feedbackmesh/adapter

Easy-start integration layer for existing web apps.

This package is meant for developers who already have a web product and want a low-friction way to feed:

- user feedback
- runtime errors
- route / environment / release context

into FeedbackMesh.

## What It Does

- sends feedback to `/submissions`
- sends runtime errors to `/runtime-events`
- converts Sentry-style events into FeedbackMesh runtime events
- converts GlitchTip-style events into FeedbackMesh runtime events
- installs browser-style global error handlers
- mounts a reusable feedback widget

## Example

```js
import { createFeedbackMeshAdapter } from '@feedbackmesh/adapter';

const sf = createFeedbackMeshAdapter({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
  routeResolver: () => window.location.pathname,
});

await sf.captureFeedback({
  title: 'Popup covers content',
  body: 'The word popup overlaps the paragraph on mobile.',
  categoryHint: 'bug',
});

await sf.captureError(new Error('reader timeout'));

const uninstallGlobalErrorHandlers = sf.installGlobalErrorHandlers();

sf.mountFeedbackWidget(document.getElementById('sf-feedback-root'), {
  includeContactField: true,
  defaultOpen: false,
});
```

## Small-Team Fast Path

For teams that want the shortest browser-side setup, use the one-call installer:

```js
import { installFeedbackMeshBrowser } from '@feedbackmesh/adapter';

const sf = installFeedbackMeshBrowser({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
  feedback: {
    selector: '#sf-feedback-root',
    includeContactField: true,
    defaultOpen: false,
  },
});
```

This path is meant for small teams that want:

- global browser error capture
- a mounted feedback widget
- a short installation path without hand-wiring every piece

If you want the shortest possible preset, use:

```js
import { installFeedbackMeshPreset } from '@feedbackmesh/adapter';

installFeedbackMeshPreset({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});
```

With this preset, FeedbackMesh will:

- look for `#sf-feedback-root`
- mount the feedback widget there
- install browser global error capture
- send feedback and runtime events to the configured endpoint

## Recommended Runtime Setup

FeedbackMesh should not replace a mature error collection provider.

Recommended layering:

- Sentry or GlitchTip collects runtime exceptions
- `@feedbackmesh/adapter` normalizes the event and captures product context
- FeedbackMesh turns the event into an engineering case

## Main Exports

- `createFeedbackMeshAdapter`
- `installSignalForge`
- `installFeedbackMeshBrowser`
- `installFeedbackMeshPreset`
- `captureError`
- `linkSentry`
- `linkGlitchTip`
- `mountFeedbackWidget`
- `submitFeedback`
- `submitRuntimeEvent`

## Why This Shape

The adapter exists for developers who already have an app and do not want to wire raw intake endpoints by hand.

The intended default setup is:

- install the adapter once
- capture direct user feedback through the widget
- capture explicit app errors through `captureError`
- optionally bind browser global errors
- optionally forward Sentry or GlitchTip events

This is the first practical integration layer for early-stage teams using SignalForge as a feedback-to-GitHub operating loop.
