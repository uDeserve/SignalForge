import { installFeedbackMeshPreset } from '@feedbackmesh/adapter';
import { createRoot } from 'react-dom/client';
import { AppShell } from './AppShell.jsx';

const root = createRoot(document.getElementById('root'));
root.render(<AppShell />);

installFeedbackMeshPreset({
  endpoint: 'https://signalforge.example.com',
  projectKey: 'proj_readerapp',
  appName: 'readerapp',
  environment: 'production',
  release: '1.2.3',
});
