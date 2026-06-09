import {
  createSignalForgeAdapter,
  createFeedbackMeshAdapter,
  mountFeedbackWidget as mountAdapterFeedbackWidget,
  buildFeedbackPayload,
  submitFeedback,
  createSignalForgeContext,
  createFeedbackMeshContext,
} from '../../../packages/adapter/src/index.js';

export {
  buildFeedbackPayload,
  createFeedbackMeshAdapter,
  createFeedbackMeshContext,
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

export function createFeedbackMeshWidget(options = {}) {
  const adapter = options.adapter ?? createFeedbackMeshAdapter(options);
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
  const widget = options.brand === 'signalforge'
    ? createSignalForgeWidget(options)
    : createFeedbackMeshWidget(options);
  return widget.mount(root, options);
}
