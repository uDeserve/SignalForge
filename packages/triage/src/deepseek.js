function buildSystemPrompt() {
  return [
    'You are SignalForge triage.',
    'Your job is to turn noisy user feedback into a decision-ready engineering case.',
    'You must merge, filter, and translate user language into product and engineering language.',
    'Prioritize end-user feedback quality and user-experience problems over raw exception wording.',
    'A meaningful user-experience complaint should usually become a publishable decision surface, even if it is not a crash.',
    'Treat runtime errors as supporting evidence, not the primary product signal, unless the failure is severe and obvious.',
    'If feedback describes friction, confusion, blocked flow, awkward interaction, poor readability, or inability to continue a task, prefer problem_type=ux instead of noise.',
    'If feedback asks for guidance or help using the product without describing a product defect, prefer problem_type=support.',
    'Prefer lenient publication bias: publishing a somewhat noisy issue is acceptable.',
    'Do not invent certainty when evidence is weak.',
    'Return only valid JSON that matches the requested schema.',
  ].join(' ');
}

function buildUserPrompt(payload) {
  return JSON.stringify(
    {
      instruction: 'Analyze the following SignalForge triage payload and return one JSON object only.',
      schema: {
        triage_mode: 'llm',
        normalized_summary: 'string',
        problem_type: 'bug | ux | feature | support | noise',
        affected_surface: 'string',
        user_impact: 'string',
        evidence_used: [{ kind: 'string', id: 'string' }],
        cluster_key: 'string',
        cluster_action: 'new_cluster | merge_existing',
        cluster_size_estimate: 1,
        publish_recommendation: 'publish | hold',
        confidence: 0.0,
        open_questions: ['string'],
        suggested_labels: ['string'],
        suggested_next_action: 'investigate | fix | reply | ignore',
      },
      guidance: [
        'Use publish_recommendation=publish for credible user feedback about product friction, blocked flows, poor UX, or repeated annoyance.',
        'Use publish_recommendation=hold mainly for obvious noise, pure praise, or low-information support requests.',
        'Summaries should be engineering-readable, concise, and specific.',
        'Prefer cluster_action=merge_existing when the new signal clearly matches an existing cluster hint.',
      ],
      payload,
    },
    null,
    2
  );
}

function extractTextFromResponse(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === 'string' ? item.text : typeof item === 'string' ? item : ''))
      .join('')
      .trim();
  }
  return '';
}

function extractJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function shouldRetry(error) {
  const message = String(error?.message ?? error ?? '');
  const causeCode = error?.cause?.code;
  return (
    message.includes('fetch failed') ||
    message.includes('EAI_AGAIN') ||
    causeCode === 'EAI_AGAIN' ||
    causeCode === 'ECONNRESET' ||
    causeCode === 'ETIMEDOUT'
  );
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDeepSeekSubmissionAnalyzer({
  apiKey,
  baseUrl = 'https://api.deepseek.com',
  model = 'deepseek-v4-flash',
  fetchImpl = fetch,
  maxRetries = 2,
} = {}) {
  if (!apiKey) {
    throw new Error('DeepSeek apiKey is required');
  }

  return async function analyzeSubmission(payload) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: buildSystemPrompt(),
              },
              {
                role: 'user',
                content: buildUserPrompt(payload),
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(`DeepSeek triage request failed: ${response.status} ${errorText}`.trim());
        }

        const json = await response.json();
        const text = extractTextFromResponse(json);
        const parsed = extractJsonObject(text);
        if (!parsed) {
          throw new Error('DeepSeek triage response did not contain valid JSON');
        }
        return parsed;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries || !shouldRetry(error)) {
          throw error;
        }
        await wait(250 * (attempt + 1));
      }
    }
    throw lastError;
  };
}
