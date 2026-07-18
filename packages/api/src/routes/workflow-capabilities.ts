import type { FastifyPluginAsync } from 'fastify';
import {
  buildWorkflowCapabilityProfile,
  summarizeWorkflowCapabilityProfile,
} from '../domains/workflow-capabilities/profile.js';

export const workflowCapabilitiesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/workflow-capabilities', async () => {
    const profile = buildWorkflowCapabilityProfile();
    return {
      ...profile,
      summary: summarizeWorkflowCapabilityProfile(profile),
    };
  });
};
