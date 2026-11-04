import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PageErrorBoundary from './PageErrorBoundary';
import './index.css';
import './firebase-auth.css';
import './design-system.css';
import './mobile.css';
import './dashboard-mobile.css';
import './trash-mobile.css';
import './running-workspace.css';
import './checklist.css';
import './aurora-hypergrid.css';
import './phase-a.css';
import './phase-b.css';
import './phase-c.css';
import './phase-d.css';
import './phase-e.css';
import './phase-f.css';
import './phase-g.css';
import './phase-h.css';
import './import-intelligence.css';
import './aurora-ops.css';
import './mobile-hypergrid.css';
import './signal-console-polish.css';
import './phase-i-polish.css';
import './phase-j-editor.css';
import './mobile-performance.css';
import './progress-timeline-polish.css';
import './progress-timeline-polish.js';
import './escalation-email.css';
import './progress-autoparse.css';
import './enterprise-overhaul.css';
import './cutpoint-polish.css';
import './responsive-viewport-fix.css';
import './sidebar-command-center.css';
import './glass-float-theme.css';
import './workspace-restore-recovery.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PageErrorBoundary screenName="NOC Incident Desk"><App /></PageErrorBoundary>
    </StrictMode>
);
