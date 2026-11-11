import type { TestProject } from 'vitest/node';
import { startTestPostgres } from '../src/testing';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
    pgTemplateDb: string;
  }
}

export default async function setup(project: TestProject) {
  const pg = await startTestPostgres();
  project.provide('pgAdminUrl', pg.adminUrl);
  project.provide('pgTemplateDb', pg.templateDb);
  return async () => {
    await pg.stop();
  };
}
