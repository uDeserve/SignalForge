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

export function mountFeedbackWidget(root, { endpoint, fetchImpl = fetch } = {}) {
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
      await submitFeedback({
        endpoint,
        fetchImpl,
        input: { body: textarea.value },
      });
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
