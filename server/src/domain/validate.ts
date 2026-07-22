// Server-side project validation. The whole point of a JavaScript/TypeScript
// backend: we import the exact pure modules the client uses, so the "one final
// draft" rule (hard rule 4) and Fountain round-trip fidelity (hard rule 2) are
// enforced with the same code on both sides, never a drifting reimplementation.
//
// The client modules are plain JS; imported here as untyped (`any`), which is
// fine because their behavior, not their types, is what we depend on.

// @ts-ignore -- untyped JS module from the client source tree
import { normalizeDraftNames } from '../../../src/data/project-model.js';
// @ts-ignore -- untyped JS module from the client source tree
import { parseFountain } from '../../../src/fountain/parse.js';
import { HttpError } from '../errors';

interface Script {
  id?: string;
  name?: string;
  text?: string;
  final?: boolean;
}

interface Project {
  name?: string;
  scripts: Script[];
  [key: string]: unknown;
}

// The persisted branches, mirrored from src/data/schema.js. Missing branches are
// filled so stored JSON is always shaped consistently.
function ensureBranches(p: Record<string, unknown>): Project {
  return {
    name: 'Untitled', workspace: '', type: '', targetMins: 0,
    contributors: [], scripts: [], boards: [], research: [], links: [], comments: [],
    ...p,
  } as Project;
}

export function validateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'invalid project: expected an object');
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.scripts)) {
    throw new HttpError(400, 'invalid project: scripts must be an array');
  }

  // Run the client's own normalizer so stored names stay honest (exactly one
  // "Final Draft"), then store that normalized form.
  const project: Project = normalizeDraftNames(ensureBranches(obj));

  if (project.scripts.length) {
    const finals = project.scripts.filter((s) => s.final);
    if (finals.length !== 1) {
      throw new HttpError(400, 'project must have exactly one final draft');
    }
  }

  // Every script must still parse as Fountain. parseFountain never throws on
  // valid input; guard anyway so malformed text is a 400, not a 500.
  for (const s of project.scripts) {
    try {
      parseFountain(typeof s.text === 'string' ? s.text : '');
    } catch {
      throw new HttpError(400, `script "${s.name || 'untitled'}" failed to parse as Fountain`);
    }
  }

  return project;
}
