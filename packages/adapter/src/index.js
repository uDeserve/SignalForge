function stripUndefined(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint ?? '').trim().replace(/\/$/, '');
  if (!value) throw new Error('endpoint is required');
  return value;
}

function getDefaultDocument(root, documentImpl) {
  return documentImpl ?? root?.ownerDocument ?? globalThis.document ?? null;
}

function resolveMountRoot(root, { documentImpl, target = globalThis } = {}) {
  if (!root) return null;
  if (typeof root !== 'string') return root;
  const resolvedDocument = documentImpl ?? target?.document ?? globalThis.document ?? null;
  if (!resolvedDocument?.querySelector) {
    throw new Error('document with querySelector is required when feedback root is a selector');
  }
  return resolvedDocument.querySelector(root);
}

function normalizeFeedbackInstallOptions(feedback) {
  if (feedback === true) return { selector: '#sf-feedback-root' };
  if (typeof feedback === 'string') return { selector: feedback };
  return feedback;
}

function getCurrentRoute({ route, routeResolver, target = globalThis } = {}) {
  if (route) return route;
  if (typeof routeResolver === 'function') {
    const resolved = routeResolver();
    if (resolved) return resolved;
  }
  const location = target?.location;
  if (!location) return '';
  return `${location.pathname ?? ''}${location.search ?? ''}${location.hash ?? ''}` || '';
}

function mergeContext(base = {}, override = {}, options = {}) {
  const next = stripUndefined({
    ...base,
    ...override,
  });
  if (!next.route) {
    const route = getCurrentRoute({
      route: override.route ?? base.route,
      routeResolver: options.routeResolver,
      target: options.target,
    });
    if (route) next.route = route;
  }
  return next;
}

async function postJson(url, payload, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeChoiceList(items = [], fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source.map((item) => {
    if (typeof item === 'string') {
      return { value: item, label: item };
    }
    return {
      value: item?.value ?? item?.label ?? '',
      label: item?.label ?? item?.value ?? '',
    };
  }).filter((item) => item.value && item.label);
}

function createElement(documentImpl, tagName, { className = '', textContent = '', type = '', value = '', placeholder = '' } = {}) {
  const element = documentImpl.createElement(tagName);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  if (type) element.type = type;
  if (value) element.value = value;
  if (placeholder) element.placeholder = placeholder;
  return element;
}

function appendChildren(parent, children = []) {
  for (const child of children) {
    if (child) parent.appendChild(child);
  }
  return parent;
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
  return postJson(`${normalizeEndpoint(endpoint)}/submissions`, buildFeedbackPayload(input), { fetchImpl });
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

export async function submitRuntimeEvent({ endpoint, input, fetchImpl = fetch }) {
  return postJson(`${normalizeEndpoint(endpoint)}/runtime-events`, createRuntimeEvent(input), { fetchImpl });
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

export function mountFeedbackWidget(root, {
  adapter = null,
  endpoint,
  projectKey = 'widget',
  appName = 'app',
  environment = 'development',
  release = '',
  fetchImpl = fetch,
  context = {},
  routeResolver,
  target = globalThis,
  document: documentImpl,
  onSubmit,
  title = 'Share feedback',
  description = 'Tell us what happened and what you expected instead.',
  triggerLabel = 'Feedback',
  submitLabel = 'Send',
  cancelLabel = 'Cancel',
  successMessage = 'Thanks for the report.',
  includeTitle = true,
  includeContactField = false,
  defaultOpen = false,
  categories = [
    { value: 'bug', label: 'Bug' },
    { value: 'ux', label: 'UX' },
    { value: 'idea', label: 'Idea' },
    { value: 'other', label: 'Other' },
  ],
  ratings = [
    { value: 'bad', label: 'Bad' },
    { value: 'ok', label: 'Okay' },
    { value: 'good', label: 'Good' },
  ],
} = {}) {
  if (!root) throw new Error('root element is required');

  const resolvedDocument = getDefaultDocument(root, documentImpl);
  if (!resolvedDocument?.createElement) {
    throw new Error('document with createElement is required');
  }

  const effectiveContext = mergeContext(
    createSignalForgeContext({ appName, environment, release }),
    context,
    { routeResolver, target },
  );

  const effectiveAdapter = adapter ?? (endpoint
    ? createSignalForgeAdapter({
        endpoint,
        projectKey,
        appName: effectiveContext.appName ?? appName,
        environment: effectiveContext.environment ?? environment,
        release: effectiveContext.release ?? release,
        fetchImpl,
        routeResolver,
        target,
      })
    : null);

  const categoryChoices = normalizeChoiceList(categories, []);
  const ratingChoices = normalizeChoiceList(ratings, []);

  const wrapper = createElement(resolvedDocument, 'div', { className: 'sf-widget-shell' });
  const style = createElement(resolvedDocument, 'style');
  style.textContent = `
    .sf-widget-shell { font-family: ui-sans-serif, system-ui, sans-serif; color: #132238; }
    .sf-widget-trigger { border: 0; border-radius: 999px; background: linear-gradient(135deg, #0f5bd8, #14b8a6); color: #fff; padding: 10px 16px; cursor: pointer; box-shadow: 0 10px 24px rgba(15, 91, 216, 0.24); }
    .sf-widget-panel { width: min(420px, 100%); border: 1px solid #d7e0ea; border-radius: 18px; padding: 16px; background: linear-gradient(180deg, #ffffff, #f4f8fc); box-shadow: 0 16px 40px rgba(19, 34, 56, 0.12); }
    .sf-widget-panel[hidden] { display: none; }
    .sf-widget-title { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
    .sf-widget-copy { font-size: 13px; line-height: 1.5; margin: 0 0 12px; color: #4d6076; }
    .sf-widget-field { display: grid; gap: 6px; margin-bottom: 12px; }
    .sf-widget-label { font-size: 12px; font-weight: 600; color: #38506b; }
    .sf-widget-input, .sf-widget-select, .sf-widget-textarea { width: 100%; box-sizing: border-box; border: 1px solid #c8d5e3; border-radius: 12px; padding: 10px 12px; background: #fff; color: #132238; }
    .sf-widget-textarea { min-height: 128px; resize: vertical; }
    .sf-widget-row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
    .sf-widget-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
    .sf-widget-secondary, .sf-widget-primary { border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer; }
    .sf-widget-secondary { background: #e8eef5; color: #27405b; }
    .sf-widget-primary { background: #132238; color: #fff; }
    .sf-widget-status { min-height: 18px; margin-top: 6px; font-size: 12px; color: #38506b; }
  `;

  const trigger = createElement(resolvedDocument, 'button', {
    className: 'sf-widget-trigger',
    textContent: triggerLabel,
    type: 'button',
  });

  const panel = createElement(resolvedDocument, 'form', { className: 'sf-widget-panel' });
  panel.hidden = !defaultOpen;

  const heading = createElement(resolvedDocument, 'h2', { className: 'sf-widget-title', textContent: title });
  const copy = createElement(resolvedDocument, 'p', { className: 'sf-widget-copy', textContent: description });

  const titleField = createElement(resolvedDocument, 'div', { className: 'sf-widget-field' });
  const titleLabel = createElement(resolvedDocument, 'label', { className: 'sf-widget-label', textContent: 'Short title' });
  const titleInput = createElement(resolvedDocument, 'input', {
    className: 'sf-widget-input',
    type: 'text',
    placeholder: 'One-line summary',
  });
  titleInput.value = effectiveContext.appName ? `${effectiveContext.appName} feedback` : '';
  if (!includeTitle) titleField.hidden = true;
  appendChildren(titleField, [titleLabel, titleInput]);

  const row = createElement(resolvedDocument, 'div', { className: 'sf-widget-row' });

  const categoryField = createElement(resolvedDocument, 'div', { className: 'sf-widget-field' });
  const categoryLabel = createElement(resolvedDocument, 'label', { className: 'sf-widget-label', textContent: 'Category' });
  const categorySelect = createElement(resolvedDocument, 'select', { className: 'sf-widget-select' });
  for (const choice of categoryChoices) {
    const option = createElement(resolvedDocument, 'option');
    option.value = choice.value;
    option.textContent = choice.label;
    categorySelect.appendChild(option);
  }
  appendChildren(categoryField, [categoryLabel, categorySelect]);

  const ratingField = createElement(resolvedDocument, 'div', { className: 'sf-widget-field' });
  const ratingLabel = createElement(resolvedDocument, 'label', { className: 'sf-widget-label', textContent: 'Rating' });
  const ratingSelect = createElement(resolvedDocument, 'select', { className: 'sf-widget-select' });
  for (const choice of ratingChoices) {
    const option = createElement(resolvedDocument, 'option');
    option.value = choice.value;
    option.textContent = choice.label;
    ratingSelect.appendChild(option);
  }
  appendChildren(ratingField, [ratingLabel, ratingSelect]);
  appendChildren(row, [categoryField, ratingField]);

  const bodyField = createElement(resolvedDocument, 'div', { className: 'sf-widget-field' });
  const bodyLabel = createElement(resolvedDocument, 'label', { className: 'sf-widget-label', textContent: 'What happened?' });
  const bodyInput = createElement(resolvedDocument, 'textarea', {
    className: 'sf-widget-textarea',
    placeholder: 'Describe the bug, confusion, or suggestion in your own words.',
  });
  appendChildren(bodyField, [bodyLabel, bodyInput]);

  const contactField = createElement(resolvedDocument, 'div', { className: 'sf-widget-field' });
  if (!includeContactField) contactField.hidden = true;
  const contactLabel = createElement(resolvedDocument, 'label', { className: 'sf-widget-label', textContent: 'Contact email (optional)' });
  const contactInput = createElement(resolvedDocument, 'input', {
    className: 'sf-widget-input',
    type: 'email',
    placeholder: 'you@example.com',
  });
  appendChildren(contactField, [contactLabel, contactInput]);

  const status = createElement(resolvedDocument, 'div', { className: 'sf-widget-status' });

  const actions = createElement(resolvedDocument, 'div', { className: 'sf-widget-actions' });
  const cancelButton = createElement(resolvedDocument, 'button', {
    className: 'sf-widget-secondary',
    textContent: cancelLabel,
    type: 'button',
  });
  const submitButton = createElement(resolvedDocument, 'button', {
    className: 'sf-widget-primary',
    textContent: submitLabel,
    type: 'button',
  });
  appendChildren(actions, [cancelButton, submitButton]);

  appendChildren(panel, [heading, copy, titleField, row, bodyField, contactField, status, actions]);
  appendChildren(wrapper, [style, trigger, panel]);

  let isOpen = defaultOpen;
  let isSubmitting = false;

  function syncPanelState() {
    panel.hidden = !isOpen;
    trigger.textContent = isOpen ? 'Close' : triggerLabel;
  }

  function setOpen(next) {
    isOpen = Boolean(next);
    syncPanelState();
  }

  async function submit() {
    if (isSubmitting) return null;

    const body = String(bodyInput.value ?? '').trim();
    if (!body) {
      status.textContent = 'Please describe the problem before sending.';
      return null;
    }

    isSubmitting = true;
    submitButton.disabled = true;
    status.textContent = 'Submitting...';

    const contactEmail = String(contactInput.value ?? '').trim();
    const payload = buildFeedbackPayload({
      source: 'web_widget',
      title: includeTitle ? String(titleInput.value ?? '').trim() : '',
      body,
      categoryHint: categorySelect.value || undefined,
      rating: ratingSelect.value || undefined,
      sentimentHint: ratingSelect.value === 'bad' ? 'negative' : undefined,
      reporter: contactEmail ? { email: contactEmail } : {},
      appContext: mergeContext(effectiveContext, {}, { routeResolver, target }),
      privacy: {
        containsPii: Boolean(contactEmail),
        redactionStatus: 'pending',
      },
      raw: {
        source: 'signalforge_widget',
        category: categorySelect.value || undefined,
        rating: ratingSelect.value || undefined,
      },
    });

    try {
      const result = effectiveAdapter
        ? await effectiveAdapter.captureFeedback(payload)
        : endpoint
          ? await submitFeedback({ endpoint, input: payload, fetchImpl })
          : payload;
      await onSubmit?.(result, payload);
      status.textContent = successMessage;
      bodyInput.value = '';
      contactInput.value = '';
      if (includeTitle) titleInput.value = effectiveContext.appName ? `${effectiveContext.appName} feedback` : '';
      setOpen(false);
      return result;
    } catch (error) {
      status.textContent = error.message;
      throw error;
    } finally {
      isSubmitting = false;
      submitButton.disabled = false;
    }
  }

  trigger.addEventListener('click', () => setOpen(!isOpen));
  cancelButton.addEventListener('click', () => setOpen(false));
  submitButton.addEventListener('click', async (event) => {
    event?.preventDefault?.();
    await submit();
  });

  if (typeof root.replaceChildren === 'function') {
    root.replaceChildren(wrapper);
  } else {
    root.innerHTML = '';
    root.appendChild(wrapper);
  }
  syncPanelState();

  return {
    root,
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    destroy() {
      if (typeof wrapper.remove === 'function') {
        wrapper.remove();
      } else if (root.firstChild === wrapper) {
        root.replaceChildren();
      }
    },
    submit,
    elements: {
      wrapper,
      trigger,
      panel,
      titleInput,
      categorySelect,
      ratingSelect,
      bodyInput,
      contactInput,
      status,
      submitButton,
      cancelButton,
    },
  };
}

export function installSignalForge({
  endpoint,
  projectKey,
  appName = 'app',
  environment = 'development',
  release = '',
  routeResolver,
  target = globalThis,
  fetchImpl = fetch,
} = {}) {
  if (!endpoint) throw new Error('endpoint is required');
  if (!projectKey) throw new Error('projectKey is required');

  const baseContext = createSignalForgeContext({ appName, environment, release });

  const api = {
    endpoint,
    projectKey,
    context: baseContext,
    getContext(override = {}) {
      return mergeContext(baseContext, override, { routeResolver, target });
    },
    async captureFeedback(input = {}) {
      return submitFeedback({
        endpoint,
        fetchImpl,
        input: {
          ...input,
          source: input.source ?? 'adapter',
          appContext: mergeContext(baseContext, input.appContext ?? {}, { routeResolver, target }),
        },
      });
    },
    async captureRuntimeEvent(input = {}) {
      return submitRuntimeEvent({
        endpoint,
        fetchImpl,
        input: {
          ...input,
          context: mergeContext(baseContext, input.context ?? {}, { routeResolver, target }),
          route: input.route ?? getCurrentRoute({ routeResolver, target }),
          environment: input.environment ?? baseContext.environment,
          release: input.release ?? baseContext.release,
        },
      });
    },
    async captureError(error, inputContext = {}) {
      const context = mergeContext(baseContext, inputContext, { routeResolver, target });
      const event = captureError(error, context);
      return api.captureRuntimeEvent(event);
    },
    async captureSentry(event, context = {}) {
      return api.captureRuntimeEvent(linkSentry(event, mergeContext(baseContext, context, { routeResolver, target })));
    },
    async captureGlitchTip(event, context = {}) {
      return api.captureRuntimeEvent(linkGlitchTip(event, mergeContext(baseContext, context, { routeResolver, target })));
    },
    reportContext(context = {}) {
      return mergeContext(baseContext, context, { routeResolver, target });
    },
    installGlobalErrorHandlers({ eventTarget = target, onError, onUnhandledRejection } = {}) {
      if (!eventTarget?.addEventListener || !eventTarget?.removeEventListener) {
        throw new Error('event target with addEventListener/removeEventListener is required');
      }

      const handleError = async (event) => {
        const error = event?.error ?? new Error(event?.message ?? 'window error');
        const result = await api.captureError(error, {
          route: event?.filename ?? getCurrentRoute({ routeResolver, target }),
        });
        await onError?.(result, event);
      };

      const handleUnhandledRejection = async (event) => {
        const reason = event?.reason instanceof Error ? event.reason : new Error(String(event?.reason ?? 'unhandled rejection'));
        const result = await api.captureError(reason, {
          route: getCurrentRoute({ routeResolver, target }),
          fingerprint: 'unhandledrejection',
        });
        await onUnhandledRejection?.(result, event);
      };

      eventTarget.addEventListener('error', handleError);
      eventTarget.addEventListener('unhandledrejection', handleUnhandledRejection);

      return () => {
        eventTarget.removeEventListener('error', handleError);
        eventTarget.removeEventListener('unhandledrejection', handleUnhandledRejection);
      };
    },
    mountFeedbackWidget(root, widgetOptions = {}) {
      return mountFeedbackWidget(root, {
        ...widgetOptions,
        adapter: api,
        context: mergeContext(baseContext, widgetOptions.context ?? {}, { routeResolver, target }),
        document: widgetOptions.document,
        target,
        routeResolver,
      });
    },
  };

  return api;
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

export function installSignalForgeBrowser({
  endpoint,
  projectKey,
  appName = 'app',
  environment = 'development',
  release = '',
  routeResolver,
  target = globalThis,
  fetchImpl = fetch,
  captureGlobalErrors = true,
  globalErrorOptions = {},
  feedback = null,
} = {}) {
  const adapter = createSignalForgeAdapter({
    endpoint,
    projectKey,
    appName,
    environment,
    release,
    routeResolver,
    target,
    fetchImpl,
  });

  let widget = null;
  let uninstallGlobalErrorHandlers = null;

  if (captureGlobalErrors) {
    uninstallGlobalErrorHandlers = adapter.installGlobalErrorHandlers({
      ...globalErrorOptions,
      eventTarget: globalErrorOptions.eventTarget ?? target,
    });
  }

  if (feedback) {
    const normalizedFeedback = normalizeFeedbackInstallOptions(feedback);
    const {
      root,
      selector,
      document: documentImpl,
      ...widgetOptions
    } = normalizedFeedback;
    const feedbackRoot = resolveMountRoot(root ?? selector, {
      documentImpl,
      target,
    });
    if (!feedbackRoot) {
      throw new Error('feedback root element is required for installSignalForgeBrowser');
    }
    widget = adapter.mountFeedbackWidget(feedbackRoot, {
      ...widgetOptions,
      document: documentImpl,
    });
  }

  return {
    adapter,
    widget,
    uninstallGlobalErrorHandlers,
    destroy() {
      uninstallGlobalErrorHandlers?.();
      widget?.destroy?.();
    },
  };
}

export function installSignalForgePreset({
  endpoint,
  projectKey,
  appName = 'app',
  environment = 'development',
  release = '',
  feedbackRoot = '#sf-feedback-root',
  feedback = true,
  routeResolver,
  target = globalThis,
  fetchImpl = fetch,
} = {}) {
  return installSignalForgeBrowser({
    endpoint,
    projectKey,
    appName,
    environment,
    release,
    routeResolver,
    target,
    fetchImpl,
    feedback:
      feedback === false
        ? null
        : typeof feedback === 'object'
          ? { selector: feedbackRoot, ...feedback }
          : feedbackRoot,
  });
}
