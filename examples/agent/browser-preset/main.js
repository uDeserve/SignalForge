import { installFeedbackMeshPreset } from '@feedbackmesh/adapter';

installFeedbackMeshPreset({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});
