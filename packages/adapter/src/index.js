function stripUndefined(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function buildFeedbackPayload(input = {}) {
  return {
    source: input.source ?? 'web_widget',
    reporter: input.reporter ?? {},
    appContext: input.appContext ?? {},
    content: {
      title: input.title ?? '',
      body: input.body ?? '',
      categoryHint: input.categoryHint,
      rating: input.rating,
      sentimentHint: input.sentimentHint,
      language: input.language,
    },
    evidence: input.evidence ?? {},
    privacy: input.privacy ?? {
      containsPii: false,
      redactionStatus: 'pending',
    },
    raw: input.raw ?? {},
  };
}

export async function submitFeedback({ endpoint, input, fetchImpl = fetch }) {
  const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildFeedbackPayload(input)),
  });

  if (!response.ok) {
    throw new Error(`submission failed: ${response.status}`);
  }

  return response.json();
}

export function createSignalForgeContext({
  appName = 'app',
  environment = 'development',
  release = '',
  route = '',
  userId = '',
  sessionId = '',
  extra = {},
} = {}) {
  return stripUndefined({
    appName,
    environment,
    release,
    route,
    userId,
    sessionId,
    ...extra,
  });
}

export function createRuntimeEvent(input = {}) {
  return {
    source: input.source ?? 'adapter',
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    environment: input.environment ?? 'unknown',
    release: input.release ?? '',
    route: input.route ?? '',
    fingerprint: input.fingerprint ?? '',
    error: input.error ?? {},
    tags: input.tags ?? {},
    context: input.context ?? {},
    raw: input.raw ?? {},
  };
}

export function captureError(error, context = {}) {
  return createRuntimeEvent({
    source: 'adapter',
    environment: context.environment ?? 'unknown',
    release: context.release ?? '',
    route: context.route ?? '',
    fingerprint: context.fingerprint ?? '',
    error: {
      type: error?.name ?? 'Error',
      message: error?.message ?? String(error),
      stack: error?.stack ?? '',
    },
    tags: context.tags ?? {},
    context,
    raw: {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    },
  });
}

export function linkSentry(event, context = {}) {
  return createRuntimeEvent({
    source: 'sentry',
    occurredAt: event?.timestamp ?? new Date().toISOString(),
    environment: event?.environment ?? context.environment ?? 'unknown',
    release: event?.release ?? context.release ?? '',
    route: event?.request?.url ?? event?.transaction ?? context.route ?? '',
    fingerprint: Array.isArray(event?.fingerprint) ? event.fingerprint.join('|') : event?.fingerprint ?? '',
    error: {
      type: event?.exception?.values?.[0]?.type ?? event?.level ?? 'Error',
      message: event?.exception?.values?.[0]?.value ?? event?.message ?? 'Runtime failure detected.',
    },
    tags: event?.tags ?? {},
    context,
    raw: event ?? {},
  });
}

export function linkGlitchTip(event, context = {}) {
  return createRuntimeEvent({
    source: 'glitchtip',
    occurredAt: event?.timestamp ?? new Date().toISOString(),
    environment: event?.environment ?? context.environment ?? 'unknown',
    release: event?.release ?? context.release ?? '',
    route: event?.request?.url ?? event?.transaction ?? context.route ?? '',
    fingerprint: Array.isArray(event?.fingerprint) ? event.fingerprint.join('|') : event?.fingerprint ?? '',
    error: {
      type: event?.exception?.values?.[0]?.type ?? event?.level ?? 'Error',
      message: event?.exception?.values?.[0]?.value ?? event?.message ?? 'Runtime failure detected.',
    },
    tags: event?.tags ?? {},
    context,
    raw: event ?? {},
  });
}

export function mountFeedbackWidget(root, { endpoint, fetchImpl = fetch, context = {}, onSubmit } = {}) {
  if (!root) throw new Error('root element is required');

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <style>
      .sf-widget { font-family: system-ui, sans-serif; border: 1px solid #ddd; border-radius: 12px; padding: 16px; max-width: 420px; background: #fff; }
      .sf-widget textarea { width: 100%; min-height: 120px; margin: 8px 0; }
      .sf-widget button { padding: 8px 12px; cursor: pointer; }
    </style>
    <div class="sf-widget">
      <strong>Send feedback</strong>
      <textarea placeholder="What happened?"></textarea>
      <button type="button">Submit</button>
      <div data-status></div>
    </div>
  `;
  const textarea = wrapper.querySelector('textarea');
  const button = wrapper.querySelector('button');
  const status = wrapper.querySelector('[data-status]');

  button.addEventListener('click', async () => {
    status.textContent = 'Submitting...';
    try {
      const payload = buildFeedbackPayload({
        body: textarea.value,
        appContext: stripUndefined(context),
      });
      const result = endpoint
        ? await submitFeedback({ endpoint, fetchImpl, input: payload })
        : payload;
      await onSubmit?.(result);
      status.textContent = 'Submitted';
      textarea.value = '';
    } catch (error) {
      status.textContent = error.message;
    }
  });

  root.innerHTML = '';
  root.appendChild(wrapper);
  return wrapper;
}

export function installSignalForge({
  endpoint,
  projectKey,
  appName = 'app',
  environment = 'development',
  release = '',
  fetchImpl = fetch,
} = {}) {
  if (!endpoint) throw new Error('endpoint is required');
  if (!projectKey) throw new Error('projectKey is required');

  const baseContext = createSignalForgeContext({ appName, environment, release });

  return {
    endpoint,
    projectKey,
    context: baseContext,
    async captureFeedback(input = {}) {
      return submitFeedback({
        endpoint,
        fetchImpl,
        input: {
          ...input,
          source: input.source ?? 'adapter',
          appContext: {
            ...baseContext,
            ...(input.appContext ?? {}),
          },
        },
      });
    },
    async captureError(error, inputContext = {}) {
      const event = captureError(error, {
        ...baseContext,
        ...(inputContext ?? {}),
      });
      const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}/runtime-events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        throw new Error(`runtime event failed: ${response.status}`);
      }
      return response.json();
    },
    async reportContext(context = {}) {
      return {
        ...baseContext,
        ...context,
      };
    },
  };
}

export function wrapErrorBoundary({ onError, capture } = {}) {
  return function wrapErrorBoundaryImpl(Component) {
    return function SignalForgeBoundary(props) {
      try {
        return Component(props);
      } catch (error) {
        const payload = capture ? capture(error, props?.signalforgeContext ?? {}) : captureError(error, props?.signalforgeContext ?? {});
        onError?.(payload, error);
        throw error;
      }
    };
  };
}

export function createSignalForgeAdapter(options = {}) {
  return installSignalForge(options);
}
