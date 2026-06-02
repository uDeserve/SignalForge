import {
  createSignalForgeAdapter,
  mountFeedbackWidget as mountAdapterFeedbackWidget,
  buildFeedbackPayload,
  submitFeedback,
  createSignalForgeContext,
} from '../../../packages/adapter/src/index.js';

export {
  buildFeedbackPayload,
  createSignalForgeAdapter,
  createSignalForgeContext,
  submitFeedback,
} from '../../../packages/adapter/src/index.js';

export function createSignalForgeWidget(options = {}) {
  const adapter = options.adapter ?? createSignalForgeAdapter(options);
  return {
    adapter,
    mount(root, widgetOptions = {}) {
      return mountAdapterFeedbackWidget(root, {
        ...options,
        ...widgetOptions,
        adapter,
      });
    },
  };
}

export function mountFeedbackWidget(root, options = {}) {
  const widget = createSignalForgeWidget(options);
  return widget.mount(root, options);
}
